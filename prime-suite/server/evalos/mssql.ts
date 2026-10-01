// Driver de SQL Server para Atajos de Evalos: conexión directa a la base de datos de Evalos 8 (sin servicios web).
import { createHash } from 'node:crypto';
import { HttpError } from '../http.ts';
import type {
  ColumnInfo, ConnectionInfo, Department, DepartmentEmployee, DetectResult, EvalosDriver, EvalosMapping, TableInfo
} from './types.ts';

// mssql se carga bajo demanda: así el modo demo y el resto del portal no dependen de él.
type Sql = typeof import('mssql');
let sqlMod: Sql | null = null;
async function mssql(): Promise<Sql> {
  if (sqlMod) return sqlMod;
  const m: any = await import('mssql');
  sqlMod = (m.default || m) as Sql;
  return sqlMod;
}

// ---------- Identificadores ----------
// Los nombres de tabla/columna vienen de la configuración (no del usuario final), pero se validan igualmente
// porque no se pueden pasar como parámetros: solo letras, números y _ (más $#@ que admite SQL Server).
const IDENT = /^[A-Za-z_][A-Za-z0-9_$#@]{0,127}$/;
export function ident(name: string, what = 'identificador') {
  if (!name || !IDENT.test(name)) throw new HttpError(400, `Nombre de ${what} no válido en la configuración: "${name || '(vacío)'}"`);
  return `[${name}]`;
}
export function tableRef(t: { schema?: string; table: string }) {
  return (t.schema ? `${ident(t.schema, 'esquema')}.` : '') + ident(t.table, 'tabla');
}

const DATE_TYPES = ['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset'];
const NUM_TYPES = ['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney', 'bit'];
const CHAR_TYPES = ['char', 'nchar', 'varchar', 'nvarchar', 'text', 'ntext'];

export const todayYmd = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/** Expresión SQL "el empleado está activo hoy" según el tipo de la columna de baja. */
export function activeExpr(alias: string, col: string | undefined, type: string | undefined) {
  if (!col) return '1=1';
  const c = `${alias}.${ident(col, 'columna')}`;
  const t = (type || '').toLowerCase();
  if (DATE_TYPES.includes(t)) return `(${c} IS NULL OR ${c} >= CAST(GETDATE() AS date))`;
  if (NUM_TYPES.includes(t)) return `(${c} IS NULL OR ${c} = 0 OR ${c} >= @today_n)`;
  // Texto: Evalos guarda las fechas como aaaammdd; vacío o "0" = sin baja.
  return `(${c} IS NULL OR LTRIM(RTRIM(${c})) IN ('', '0') OR ${c} >= @today)`;
}

// ---------- Conexiones (se reutilizan entre peticiones de la misma instancia) ----------
const pools = new Map<string, Promise<any>>();

async function getPool(conn: string) {
  const key = createHash('sha256').update(conn).digest('hex');
  let p = pools.get(key);
  if (!p) {
    p = (async () => {
      const sql = await mssql();
      const Pool: any = (sql as any).ConnectionPool;
      let cfg: any = conn;
      // Se respetan los tiempos de la cadena; si no los trae, se acortan para no agotar la función.
      if (typeof Pool.parseConnectionString === 'function') {
        try {
          cfg = Pool.parseConnectionString(conn);
          cfg.connectionTimeout ??= 8000;
          cfg.requestTimeout ??= 15000;
          cfg.options = { appName: 'Atajos de Evalos', ...(cfg.options || {}) };
          cfg.pool = { max: 4, min: 0, idleTimeoutMillis: 60000, ...(cfg.pool || {}) };
        } catch {
          cfg = conn;
        }
      }
      const pool = new Pool(cfg);
      pool.on?.('error', () => pools.delete(key));
      await pool.connect();
      return pool;
    })();
    pools.set(key, p);
    p.catch(() => pools.delete(key));
  }
  return p;
}

function friendly(e: any): never {
  if (e instanceof HttpError) throw e;
  const msg = String(e?.message || e);
  const code = e?.code || e?.originalError?.code;
  if (code === 'ELOGIN') throw new HttpError(502, `La base de datos rechazó el usuario o la contraseña de la cadena de conexión (${msg})`);
  if (code === 'ETIMEOUT' || code === 'ESOCKET') throw new HttpError(502, `No se pudo conectar con el servidor de base de datos: ${msg}. Comprueba el servidor, el puerto y que sea accesible desde Prime Suite.`);
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/.test(msg)) throw new HttpError(500, 'Falta el paquete "mssql" en el servidor (npm install).');
  throw new HttpError(502, `Error de base de datos: ${msg}`);
}

export class SqlServerDriver implements EvalosDriver {
  private colCache = new Map<string, ColumnInfo[]>();
  constructor(private conn: string, private mapping: EvalosMapping) {}

  private async req(params: Record<string, unknown> = {}) {
    const pool = await getPool(this.conn).catch(friendly);
    const r = pool.request();
    for (const [k, v] of Object.entries(params)) r.input(k, v);
    return r;
  }

  private async query<T = any>(text: string, params: Record<string, unknown> = {}): Promise<{ rows: T[]; affected: number }> {
    try {
      const r = await (await this.req(params)).query(text);
      return { rows: (r.recordset || []) as T[], affected: (r.rowsAffected || []).reduce((a: number, b: number) => a + b, 0) };
    } catch (e) {
      friendly(e);
    }
  }

  private async columns(t: { schema?: string; table: string }): Promise<ColumnInfo[]> {
    const key = `${t.schema || ''}.${t.table}`.toUpperCase();
    const hit = this.colCache.get(key);
    if (hit) return hit;
    const { rows } = await this.query(
      `SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS type, c.CHARACTER_MAXIMUM_LENGTH AS maxLength,
              CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS nullable,
              CASE WHEN c.COLUMN_DEFAULT IS NULL THEN 0 ELSE 1 END AS hasDefault,
              ISNULL(COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity'), 0) AS isIdentity,
              ISNULL(COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsComputed'), 0) AS isComputed
         FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_NAME = @t AND (@s = '' OR c.TABLE_SCHEMA = @s)
        ORDER BY c.ORDINAL_POSITION`,
      { t: t.table, s: t.schema || '' }
    );
    const cols: ColumnInfo[] = rows.map((r: any) => ({
      name: r.name, type: String(r.type).toLowerCase(), maxLength: r.maxLength == null || r.maxLength < 0 ? null : Number(r.maxLength),
      nullable: !!r.nullable, hasDefault: !!r.hasDefault, identity: !!r.isIdentity, computed: !!r.isComputed
    }));
    this.colCache.set(key, cols);
    return cols;
  }

  private async col(t: { schema?: string; table: string }, name: string) {
    return (await this.columns(t)).find((c) => c.name.toUpperCase() === name.toUpperCase());
  }

  private dep() {
    const d = this.mapping.departments;
    if (!d?.table || !d.code || !d.description) throw new HttpError(409, 'Falta configurar la tabla de departamentos en Configuración › Base de datos (pulsa "Detectar").');
    return d;
  }

  private async activeSql(alias: string) {
    const e = this.mapping.employees;
    if (!e.endDate) return '1=1';
    const c = await this.col(e, e.endDate);
    return activeExpr(alias, e.endDate, c?.type);
  }

  private todayParams() {
    const t = todayYmd();
    return { today: t, today_n: Number(t) };
  }

  async info(): Promise<ConnectionInfo> {
    const { rows } = await this.query(`SELECT @@SERVERNAME AS server, DB_NAME() AS db, CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64)) AS version, CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition`);
    const r: any = rows[0] || {};
    return { engine: 'mssql', server: r.server, database: r.db, version: [r.edition, r.version].filter(Boolean).join(' · ') };
  }

  async detect(): Promise<DetectResult> {
    const warnings: string[] = [];
    const { rows: tables } = await this.query<{ schema: string; name: string }>(
      `SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`
    );
    const find = (n: string) => tables.find((t) => t.name.toUpperCase() === n.toUpperCase());
    const load = async (t: { schema: string; name: string }): Promise<TableInfo> => ({ schema: t.schema, name: t.name, columns: await this.columns({ schema: t.schema, table: t.name }) });

    // Departamentos: nombres habituales y, si no, cualquier tabla con "DEP" que no sea de históricos.
    const depCands = [
      ...['DEPMENTO', 'DEPARTAMENTOS', 'DEPARTAMENTO', 'DEPTOS', 'DEPARTMENTS'].map(find).filter(Boolean),
      ...tables.filter((t) => /DEP/i.test(t.name) && !/^HIS_/i.test(t.name))
    ].filter((t, i, a) => a.indexOf(t) === i) as { schema: string; name: string }[];
    const candidates: TableInfo[] = [];
    for (const t of depCands.slice(0, 8)) candidates.push(await load(t));

    const mapping: EvalosMapping = JSON.parse(JSON.stringify(this.mapping));
    const pickCode = (cols: ColumnInfo[]) => cols.find((c) => /_CODI$/i.test(c.name)) || cols.find((c) => /COD/i.test(c.name)) || cols[0];
    const pickDesc = (cols: ColumnInfo[]) => cols.find((c) => /_DESC$/i.test(c.name)) || cols.find((c) => /_NOMB$/i.test(c.name)) || cols.find((c) => /DESC|NOMB|NAME/i.test(c.name));
    const dep = candidates[0];
    if (dep) {
      const code = pickCode(dep.columns);
      const desc = pickDesc(dep.columns.filter((c) => c !== code));
      mapping.departments = { schema: dep.schema, table: dep.name, code: code?.name || '', description: desc?.name || '' };
      if (!desc) warnings.push(`No se ha identificado la columna de descripción en ${dep.name}: elígela a mano.`);
    } else {
      warnings.push('No se ha encontrado ninguna tabla de departamentos. Indica la tabla y sus columnas a mano.');
    }

    // Personal
    const per = find(mapping.employees.table || 'PERSONAL') || find('PERSONAL');
    if (per) {
      const pi = await load(per);
      candidates.push(pi);
      const has = (n: string) => pi.columns.some((c) => c.name.toUpperCase() === n.toUpperCase());
      mapping.employees = { ...mapping.employees, schema: per.schema, table: per.name };
      for (const [k, n] of Object.entries({ code: 'EM_CODI', name: 'EM_NOMB', department: 'EM_DEPA', endDate: 'EM_FBAJ' }) as [keyof EvalosMapping['employees'], string][]) {
        if (!mapping.employees[k] || !has(String(mapping.employees[k]))) {
          if (has(n)) (mapping.employees as any)[k] = n;
          else warnings.push(`La tabla ${per.name} no tiene la columna ${n}: revísala a mano.`);
        }
      }
    } else {
      warnings.push('No se ha encontrado la tabla PERSONAL.');
    }

    // Histórico de departamentos (si la instalación trabaja con históricos).
    const his = find('HIS_DEPMENTO');
    if (his) {
      const hi = await load(his);
      candidates.push(hi);
      const empCol = mapping.employees.code.toUpperCase();
      const depCol = hi.columns.find((c) => /_DEPA$/i.test(c.name)) || hi.columns.find((c) => /DEP/i.test(c.name) && c.name.toUpperCase() !== empCol);
      if (depCol) mapping.departmentHistory = { schema: his.schema, table: his.name, department: depCol.name };
      else {
        mapping.departmentHistory = null;
        warnings.push('Hay tabla HIS_DEPMENTO pero no se ha identificado su columna de departamento: indícala para que no se puedan borrar departamentos con históricos.');
      }
    } else {
      mapping.departmentHistory = null;
    }
    return { mapping, candidates, warnings };
  }

  async departmentLimits() {
    const d = this.dep();
    const [c, de] = await Promise.all([this.col(d, d.code), this.col(d, d.description)]);
    return { code: c?.maxLength ?? null, description: de?.maxLength ?? null };
  }

  async listDepartments(): Promise<Department[]> {
    return this.selectDepartments();
  }

  async getDepartment(code: string) {
    return (await this.selectDepartments(code))[0] || null;
  }

  private async selectDepartments(code?: string): Promise<Department[]> {
    const d = this.dep();
    const e = this.mapping.employees;
    const dc = `d.${ident(d.code, 'columna')}`;
    const dd = `d.${ident(d.description, 'columna')}`;
    const ec = `e.${ident(e.code, 'columna')}`;
    const { rows } = await this.query(
      `SELECT RTRIM(${dc}) AS code, RTRIM(ISNULL(${dd}, '')) AS description,
              COUNT(${ec}) AS employees,
              SUM(CASE WHEN ${ec} IS NOT NULL AND ${await this.activeSql('e')} THEN 1 ELSE 0 END) AS active
         FROM ${tableRef(d)} d
         LEFT JOIN ${tableRef(e)} e ON e.${ident(e.department, 'columna')} = ${dc}
        ${code !== undefined ? `WHERE ${dc} = @code` : ''}
        GROUP BY ${dc}, ${dd}
        ORDER BY ${dc}`,
      { ...this.todayParams(), ...(code !== undefined ? { code } : {}) }
    );
    return rows.map((r: any) => ({ code: String(r.code ?? '').trim(), description: String(r.description ?? '').trim(), employees: Number(r.employees) || 0, active: Number(r.active) || 0 }));
  }

  async createDepartment(code: string, description: string) {
    const d = this.dep();
    if (await this.getDepartment(code)) throw new HttpError(409, `Ya existe el departamento ${code}`);
    // Columnas obligatorias sin valor por defecto que no son código ni descripción: se rellenan con vacío/0.
    const cols = await this.columns(d);
    const extra = cols.filter((c) => !c.nullable && !c.hasDefault && !c.identity && !c.computed && ![d.code, d.description].some((n) => n.toUpperCase() === c.name.toUpperCase()));
    const names = [ident(d.code, 'columna'), ident(d.description, 'columna')];
    const values = ['@code', '@description'];
    const params: Record<string, unknown> = { code, description };
    extra.forEach((c, i) => {
      if (DATE_TYPES.includes(c.type)) throw new HttpError(409, `La tabla ${d.table} exige la columna ${c.name} (fecha) y Atajos de Evalos no sabe qué valor darle. Avísanos para añadirla.`);
      names.push(ident(c.name, 'columna'));
      values.push(`@x${i}`);
      params[`x${i}`] = NUM_TYPES.includes(c.type) ? 0 : CHAR_TYPES.includes(c.type) ? '' : null;
    });
    await this.query(`INSERT INTO ${tableRef(d)} (${names.join(', ')}) VALUES (${values.join(', ')})`, params);
  }

  async updateDepartment(code: string, description: string) {
    const d = this.dep();
    const { affected } = await this.query(
      `UPDATE ${tableRef(d)} SET ${ident(d.description, 'columna')} = @description WHERE ${ident(d.code, 'columna')} = @code`,
      { code, description }
    );
    if (!affected) throw new HttpError(404, `No existe el departamento ${code}`);
  }

  async deleteDepartment(code: string) {
    const d = this.dep();
    const e = this.mapping.employees;
    const { rows } = await this.query(`SELECT COUNT(*) AS n FROM ${tableRef(e)} WHERE ${ident(e.department, 'columna')} = @code`, { code });
    const n = Number((rows[0] as any)?.n) || 0;
    if (n) throw new HttpError(409, `No se puede eliminar: ${n} empleado(s) tienen asignado el departamento ${code}.`);
    const h = this.mapping.departmentHistory;
    if (h?.table && h.department) {
      const { rows: hr } = await this.query(`SELECT COUNT(*) AS n FROM ${tableRef(h)} WHERE ${ident(h.department, 'columna')} = @code`, { code });
      const hn = Number((hr[0] as any)?.n) || 0;
      if (hn) throw new HttpError(409, `No se puede eliminar: el departamento ${code} aparece en ${hn} tramo(s) del histórico de departamentos.`);
    }
    const { affected } = await this.query(`DELETE FROM ${tableRef(d)} WHERE ${ident(d.code, 'columna')} = @code`, { code });
    if (!affected) throw new HttpError(404, `No existe el departamento ${code}`);
  }

  async departmentEmployees(code: string, limit = 500): Promise<DepartmentEmployee[]> {
    const e = this.mapping.employees;
    const end = e.endDate ? `, e.${ident(e.endDate, 'columna')} AS endDate` : '';
    const { rows } = await this.query(
      `SELECT TOP (${Math.max(1, Math.min(2000, Math.floor(limit)))})
              RTRIM(e.${ident(e.code, 'columna')}) AS code, RTRIM(ISNULL(e.${ident(e.name, 'columna')}, '')) AS name,
              CASE WHEN ${await this.activeSql('e')} THEN 1 ELSE 0 END AS active${end}
         FROM ${tableRef(e)} e
        WHERE e.${ident(e.department, 'columna')} = @code
        ORDER BY e.${ident(e.name, 'columna')}`,
      { ...this.todayParams(), code }
    );
    return rows.map((r: any) => ({ code: String(r.code).trim(), name: String(r.name).trim(), active: !!r.active, endDate: fmtEnd(r.endDate) }));
  }
}

function fmtEnd(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10).split('-').reverse().join('/');
  const s = String(v).trim();
  if (!s || s === '0') return undefined;
  if (/^\d{8}$/.test(s)) return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  return s;
}

/** Servidor y base de datos de una cadena de conexión ADO.NET, sin credenciales. */
export function connectionHint(conn: string) {
  const get = (keys: string[]) => {
    for (const part of conn.split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && keys.includes(part.slice(0, i).trim().toLowerCase())) return part.slice(i + 1).trim();
    }
    return '';
  };
  const server = get(['server', 'data source', 'address', 'addr', 'network address']);
  const db = get(['database', 'initial catalog']);
  return [server, db].filter(Boolean).join(' / ') || 'Cadena de conexión guardada';
}
