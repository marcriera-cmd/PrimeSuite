// Driver de SQL Server para Atajos de Evalos: conexión directa a la base de datos de Evalos 8 (sin servicios web).
import { createHash } from 'node:crypto';
import { HttpError } from '../http.ts';
import type {
  ColumnInfo, ConnectionInfo, Department, DepartmentEmployee, DetectResult, EvalosDriver, EvalosMapping, SchemaExport, SchemaTable, TableInfo
} from './types.ts';

/** Pantalla de Atajos a la que probablemente pertenece una tabla, por su nombre (orientativo). */
const TOPICS: [string, RegExp][] = [
  ['calendarios', /CALEN|FESTIV|LABORA/i],
  ['convenios', /CONVEN|VACAC|ANTIG/i],
  ['marcajes', /MARCA|FICHA|PUNCH|TRANSAC|MOVIM|PRESEN/i],
  ['solicitudes', /SOLIC|PETIC|WORKFLOW|APROB/i],
  ['ausencias', /AUSEN|INCID|PERMIS|JUSTIF|BAJA/i],
  ['departamentos', /DEP/i],
  ['personal', /^PERSONAL|EMPLE/i]
];
const topicOf = (name: string) => TOPICS.find(([, re]) => re.test(name))?.[0];

/**
 * Tablas de las que se pueden exportar filas de ejemplo (opcional) para ver cómo guarda Evalos 8 los datos.
 * null = todas las columnas (salvo binarias); lista = solo esas columnas (en PERSONAL, sin nombres ni datos personales).
 */
const SAMPLE_TABLES: Record<string, string[] | null> = {
  CALENDARIO: null, FESTIVOS: null, CALENDAR: null, HIS_CALENDARIOFES: null, HIS_CALENDARIO: null,
  CALENDARIOTURNO: null, CALENDARIOEMPLEADOTURNO: null, GESTURNO: null, HORARIO: null,
  TIPOSVACACIONES: null, VACACIONES: null, VACACIONESDIA: null,
  MARCAPRES: ['MP_CODI', 'MP_FECH', 'MP_HORA', 'MP_INCI', 'MP_DEPU', 'MP_ORD', 'MP_INST', 'MP_RELO', 'MP_LECT', 'MP_CUSU', 'MP_SAP'],
  INCIDENC: null, ABSENTIS: null, INCIDENCIASVALIDABLES: null,
  WORKFLUJ: ['WM_NUME', 'WM_FINI', 'WM_HINI', 'WM_CODIGEN', 'WM_SOLI', 'WM_TIPO', 'WM_CODI', 'WM_VAL1', 'WM_VAL2', 'WM_VAL3', 'WM_VAL4', 'WM_FVA1', 'WM_UVA1', 'WM_FVA2', 'WM_FVA3', 'WM_FVA4', 'WM_FECHBORR', 'WM_FECHANU', 'WM_TANU', 'WM_REAV'],
  PERSONAL: ['EM_CODI', 'EM_FALT', 'EM_FBAJ', 'EM_DEPA', 'EM_TURN', 'EM_CALENDARIO', 'EM_CALENDARIOFES', 'EM_FTRIENIO', 'EM_FQUINQUENIO', 'EM_TRIENIOCUMPLIDO', 'EM_QUINQUENIOCUMPLIDO', 'EM_WFOP', 'EM_SITU']
};
const BINARY_TYPES = ['binary', 'varbinary', 'image', 'timestamp', 'rowversion'];

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

  /** Estructura de toda la base de datos: tablas, columnas, claves y filas aproximadas. Solo lectura y sin datos. */
  async schema(opts: { samples?: boolean } = {}): Promise<SchemaExport> {
    const info = await this.info();
    const { rows: cols } = await this.query(
      `SELECT c.TABLE_SCHEMA AS s, c.TABLE_NAME AS t, c.COLUMN_NAME AS name, LOWER(c.DATA_TYPE) AS type, c.CHARACTER_MAXIMUM_LENGTH AS maxLength,
              CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS nullable,
              CASE WHEN c.COLUMN_DEFAULT IS NULL THEN 0 ELSE 1 END AS hasDefault,
              ISNULL(COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity'), 0) AS isIdentity,
              ISNULL(COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsComputed'), 0) AS isComputed
         FROM INFORMATION_SCHEMA.COLUMNS c
         JOIN INFORMATION_SCHEMA.TABLES tb ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME AND tb.TABLE_TYPE = 'BASE TABLE'
        ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`
    );
    const { rows: counts } = await this.query(
      `SELECT s.name AS s, o.name AS t, SUM(p.rows) AS n
         FROM sys.partitions p JOIN sys.objects o ON o.object_id = p.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE o.type = 'U' AND p.index_id IN (0, 1)
        GROUP BY s.name, o.name`
    );
    const { rows: pks } = await this.query(
      `SELECT k.TABLE_SCHEMA AS s, k.TABLE_NAME AS t, k.COLUMN_NAME AS c
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k ON k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA
        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ORDER BY k.TABLE_SCHEMA, k.TABLE_NAME, k.ORDINAL_POSITION`
    );
    const { rows: fks } = await this.query(
      `SELECT SCHEMA_NAME(o.schema_id) AS s, o.name AS t, pc.name AS c, ro.name AS rt, rc.name AS rc
         FROM sys.foreign_key_columns f
         JOIN sys.objects o ON o.object_id = f.parent_object_id
         JOIN sys.columns pc ON pc.object_id = f.parent_object_id AND pc.column_id = f.parent_column_id
         JOIN sys.objects ro ON ro.object_id = f.referenced_object_id
         JOIN sys.columns rc ON rc.object_id = f.referenced_object_id AND rc.column_id = f.referenced_column_id`
    );
    const k = (s: string, t: string) => `${s}.${t}`.toUpperCase();
    const map = new Map<string, SchemaTable>();
    for (const r of cols as any[]) {
      let tb = map.get(k(r.s, r.t));
      if (!tb) map.set(k(r.s, r.t), (tb = { schema: r.s, name: r.t, rows: 0, primaryKey: [], foreignKeys: [], topic: topicOf(r.t), columns: [] }));
      tb.columns.push({
        name: r.name, type: String(r.type), maxLength: r.maxLength == null || r.maxLength < 0 ? null : Number(r.maxLength),
        nullable: !!r.nullable, hasDefault: !!r.hasDefault, identity: !!r.isIdentity, computed: !!r.isComputed
      });
    }
    for (const r of counts as any[]) { const tb = map.get(k(r.s, r.t)); if (tb) tb.rows = Number(r.n) || 0; }
    for (const r of pks as any[]) map.get(k(r.s, r.t))?.primaryKey.push(r.c);
    for (const r of fks as any[]) map.get(k(r.s, r.t))?.foreignKeys.push({ column: r.c, refTable: r.rt, refColumn: r.rc });
    if (opts.samples) {
      for (const tb of map.values()) {
        const allow = SAMPLE_TABLES[tb.name.toUpperCase()];
        if (allow === undefined || !tb.rows) continue;
        const cols = tb.columns.filter((c) => !BINARY_TYPES.includes(c.type) && (allow === null || allow.some((a) => a.toUpperCase() === c.name.toUpperCase())));
        if (!cols.length) continue;
        const order = tb.primaryKey[0] ? ` ORDER BY ${ident(tb.primaryKey[0])} DESC` : '';
        try {
          const { rows } = await this.query(`SELECT TOP (8) ${cols.map((c) => ident(c.name)).join(', ')} FROM ${tableRef({ schema: tb.schema, table: tb.name })}${order}`);
          tb.sample = rows as Record<string, unknown>[];
        } catch (e: any) {
          tb.sample = [{ error: String(e?.message || e) }];
        }
      }
    }
    return { server: info.server, database: info.database, version: info.version, exportedAt: new Date().toISOString(), samples: !!opts.samples, tables: [...map.values()] };
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

// ---------- Usuarios de acceso a Evalos 8 (tabla USUARIOS) ----------

/** Valores fijos con los que se da de alta en Evalos 8 a cada usuario de Prime Suite. */
export const EVALOS_USER_DEFAULTS: Record<string, string | number | null> = {
  Win: '',
  claveacceso: '',
  Rol: 'ROL',
  Opciones: 'CONFIGURADOR',
  CodZona: '',
  CodZonaDefecto: null,
  CodUICulture: 'ES-ES',
  NombreEtiquetaVisita: null,
  DiasPassword: 9999,
  LongitudPassword: 1,
  LetrasPassword: 'N',
  NumerosPassword: 'N',
  SimbolosPassword: 'N',
  PermitidoFingerCardAdmin: 'N',
  UltimoDiaPassword: '20260101'
};

/**
 * Iniciales para Evalos: las tres primeras letras del email y, si ya están cogidas, otras combinaciones
 * de letras del email manteniendo el orden (primero de la parte local, después del email completo).
 */
export function pickInitials(email: string, taken: Set<string>, len = 3): string {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const local = clean(email.split('@')[0] || '');
  const all = clean(email);
  const free = (s: string) => s.length === len && !taken.has(s);
  const combos = function* (src: string, k: number, start = 0, prefix = ''): Generator<string> {
    if (prefix.length === k) { yield prefix; return; }
    for (let i = start; i < src.length; i++) yield* combos(src, k, i + 1, prefix + src[i]);
  };
  for (const src of [local, all]) {
    if (src.length < len) continue;
    for (const c of combos(src, len)) if (free(c)) return c;
  }
  // Último recurso: inicio del email + números.
  const base = (all + 'XXX').slice(0, len - 1);
  for (let n = 0; n < 10; n++) if (free(base + n)) return base + n;
  const base1 = (all + 'X').slice(0, Math.max(1, len - 2));
  for (let n = 0; n < 100; n++) {
    const c = base1 + String(n).padStart(len - base1.length, '0');
    if (free(c)) return c;
  }
  throw new HttpError(409, `No hay iniciales libres en Evalos 8 para ${email}`);
}

function coerce(col: ColumnInfo, v: string | number | null) {
  if (v === null) return null;
  if (NUM_TYPES.includes(col.type)) return Number(v);
  if (DATE_TYPES.includes(col.type) && /^\d{8}$/.test(String(v))) {
    const s = String(v);
    return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
  }
  return String(v);
}

export interface EvalosUserResult {
  created: boolean;
  initials: string;
  /** Columnas de la lista que no existen en esta instalación (se han omitido). */
  skipped: string[];
}

/** Da de alta (si no existe ya) un usuario de acceso a Evalos 8 con su email como nombre de usuario. */
export async function ensureEvalosUser(conn: string, schema: string | undefined, email: string): Promise<EvalosUserResult> {
  const t = { schema, table: 'USUARIOS' };
  const ref = tableRef(t);
  const pool = await getPool(conn).catch(friendly);
  const sql: any = await mssql();
  const tx = new sql.Transaction(pool);
  try {
    // Columnas de la tabla
    const rc = new sql.Request(pool);
    rc.input('t', t.table);
    rc.input('s', schema || '');
    const colRows = (await rc.query(
      `SELECT c.COLUMN_NAME AS name, LOWER(c.DATA_TYPE) AS type, c.CHARACTER_MAXIMUM_LENGTH AS maxLength,
              CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS nullable,
              CASE WHEN c.COLUMN_DEFAULT IS NULL THEN 0 ELSE 1 END AS hasDefault,
              ISNULL(COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity'), 0) AS isIdentity,
              ISNULL(COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsComputed'), 0) AS isComputed
         FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_NAME = @t AND (@s = '' OR c.TABLE_SCHEMA = @s)
        ORDER BY c.ORDINAL_POSITION`
    )).recordset as any[];
    const cols: ColumnInfo[] = colRows.map((r) => ({
      name: r.name, type: String(r.type), maxLength: r.maxLength == null || r.maxLength < 0 ? null : Number(r.maxLength),
      nullable: !!r.nullable, hasDefault: !!r.hasDefault, identity: !!r.isIdentity, computed: !!r.isComputed
    }));
    if (!cols.length) throw new HttpError(409, 'No existe la tabla USUARIOS en la base de datos de Evalos 8.');
    const col = (n: string) => cols.find((c) => c.name.toUpperCase() === n.toUpperCase());
    const cUser = col('Usuario');
    const cIni = col('Iniciales');
    if (!cUser || !cIni) throw new HttpError(409, 'La tabla USUARIOS de Evalos 8 no tiene las columnas Usuario e Iniciales.');
    if (cUser.maxLength && email.length > cUser.maxLength) throw new HttpError(400, `El email ${email} supera los ${cUser.maxLength} caracteres que admite Usuario en Evalos 8.`);

    await tx.begin();
    // Bloqueo de la tabla durante el alta: evita que dos altas simultáneas elijan las mismas iniciales.
    const r1 = new sql.Request(tx);
    r1.input('u', email);
    const rows = (await r1.query(
      `SELECT RTRIM(${ident(cUser.name)}) AS u, RTRIM(ISNULL(${ident(cIni.name)}, '')) AS i FROM ${ref} WITH (UPDLOCK, HOLDLOCK)`
    )).recordset as { u: string; i: string }[];
    const mine = rows.find((r) => String(r.u || '').toLowerCase() === email.toLowerCase());
    if (mine) {
      await tx.commit();
      return { created: false, initials: String(mine.i || ''), skipped: [] };
    }
    const taken = new Set(rows.map((r) => String(r.i || '').toUpperCase()));
    const initials = pickInitials(email, taken, Math.min(3, cIni.maxLength || 3));

    const names: string[] = [];
    const values: string[] = [];
    const r2 = new sql.Request(tx);
    let n = 0;
    const add = (c: ColumnInfo, v: unknown) => {
      names.push(ident(c.name, 'columna'));
      values.push(`@p${n}`);
      r2.input(`p${n++}`, v);
    };
    add(cUser, email);
    add(cIni, initials);
    const skipped: string[] = [];
    for (const [name, v] of Object.entries(EVALOS_USER_DEFAULTS)) {
      const c = col(name);
      if (!c) { skipped.push(name); continue; }
      add(c, coerce(c, v));
    }
    // Columnas obligatorias que no están en la lista: vacío o 0, como en el resto de altas.
    const used = new Set([cUser.name, cIni.name, ...Object.keys(EVALOS_USER_DEFAULTS)].map((x) => x.toUpperCase()));
    for (const c of cols) {
      if (used.has(c.name.toUpperCase()) || c.nullable || c.hasDefault || c.identity || c.computed) continue;
      if (DATE_TYPES.includes(c.type)) throw new HttpError(409, `La tabla USUARIOS exige la columna ${c.name} (fecha) y Prime Suite no sabe qué valor darle.`);
      add(c, NUM_TYPES.includes(c.type) ? 0 : '');
    }
    await r2.query(`INSERT INTO ${ref} (${names.join(', ')}) VALUES (${values.join(', ')})`);
    await tx.commit();
    return { created: true, initials, skipped };
  } catch (e) {
    try { await tx.rollback(); } catch { /* no había transacción abierta */ }
    friendly(e);
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
