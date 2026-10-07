// Driver de SQL Server para Atajos de Evalos: conexión directa a la base de datos de Evalos 8 (sin servicios web).
import { createHash } from 'node:crypto';
import { HttpError } from '../http.ts';
import {
  PERSONAL_FIXED_ON_CREATE,
  type ColumnInfo, type ConnectionInfo, type Department, type DepartmentEmployee, type DetectResult, type EvalosDriver, type EvalosMapping,
  type ChangeStamp, type HistoryKind, type HistoryValue, type NewNames, type OrgKind, type Personal, type PersonalHistory, type ReadmitInput, type PersonalInput, type PersonalLimits, type PersonalLookupKey, type PersonalLookups, type SchemaExport, type SchemaTable, type TableInfo
} from './types.ts';
import { HISTORY, HISTORY_KINDS, ORG_KINDS, checkEndChange, checkReadmit, cardDescription, dmy, madridNow, nextCode, prevDay, toEntry, ymdOf, type HistoryDef } from './history.ts';

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

  // ---------- Personal ----------

  /** Columna de PERSONAL de cada campo de la ficha (código, nombre, departamento y baja salen de la configuración). */
  private personalCols(): Record<keyof PersonalInput, string> {
    const e = this.mapping.employees;
    return { ...PERSONAL_COLUMNS, code: e.code || 'EM_CODI', name: e.name || 'EM_NOMB', department: e.department || 'EM_DEPA', endDate: e.endDate || 'EM_FBAJ' };
  }

  private async personalTable() {
    const t = this.mapping.employees;
    const cols = await this.columns(t);
    if (!cols.length) throw new HttpError(409, `No existe la tabla ${t.table} en la base de datos de Evalos 8.`);
    return { t, cols, byName: (n: string) => cols.find((c) => c.name.toUpperCase() === n.toUpperCase()) };
  }

  async personalLimits(): Promise<PersonalLimits> {
    const { byName } = await this.personalTable();
    const out: PersonalLimits = {};
    for (const [k, n] of Object.entries(this.personalCols())) {
      const c = byName(n);
      out[k as keyof PersonalInput] = c && CHAR_TYPES.includes(c.type) ? c.maxLength : null;
    }
    return out;
  }

  private async selectPersonal(code?: string): Promise<Personal[]> {
    const { t, byName } = await this.personalTable();
    const pc = this.personalCols();
    const sel = Object.entries(pc).map(([k, n]) => (byName(n) ? `p.${ident(n, 'columna')} AS ${ident(k)}` : `NULL AS ${ident(k)}`));
    const end = byName(pc.endDate);
    const { rows } = await this.query(
      `SELECT ${sel.join(', ')}, CASE WHEN ${activeExpr('p', end ? pc.endDate : undefined, end?.type)} THEN 1 ELSE 0 END AS active
         FROM ${tableRef(t)} p
        ${code !== undefined ? `WHERE p.${ident(pc.code, 'columna')} = @code` : ''}
        ORDER BY p.${ident(pc.code, 'columna')}`,
      { ...this.todayParams(), ...(code !== undefined ? { code } : {}) }
    );
    return rows.map((r: any) => ({
      code: txt(r.code), name: txt(r.name), card: txt(r.card), email: txt(r.email),
      hireDate: isoFromDb(r.hireDate), endDate: isoFromDb(r.endDate),
      company: txt(r.company), department: txt(r.department), section: txt(r.section), area: txt(r.area),
      consultas: txt(r.consultas), solicitudes: txt(r.solicitudes), active: !!r.active
    }));
  }

  async listPersonal() { return this.selectPersonal(); }
  async getPersonal(code: string) { return (await this.selectPersonal(code))[0] || null; }

  /** Ejecuta varias sentencias en una transacción: o se aplican todas o ninguna. */
  private async inTx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    const pool = await getPool(this.conn).catch(friendly);
    const sql: any = await mssql();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const q: Q = async (text, params = {}) => {
        const r = new sql.Request(tx);
        for (const [k, v] of Object.entries(params)) r.input(k, v);
        const res = await r.query(text);
        return { rows: (res.recordset || []) as any[], affected: (res.rowsAffected || []).reduce((a: number, b: number) => a + b, 0) };
      };
      const out = await fn(q);
      await tx.commit();
      return out;
    } catch (e) {
      try { await tx.rollback(); } catch { /* la transacción no llegó a abrirse */ }
      friendly(e);
    }
  }

  /** Valor para la columna: fechas aaaammdd (o Date si la columna es de tipo fecha), vacío = NULL. */
  private personalValue(col: ColumnInfo, field: keyof PersonalInput, v: string) {
    if (field === 'hireDate' || field === 'endDate') {
      if (!v) return null;
      const ymd = v.replace(/-/g, '');
      if (DATE_TYPES.includes(col.type)) return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
      if (NUM_TYPES.includes(col.type)) return Number(ymd);
      return ymd;
    }
    return v === '' && field !== 'code' ? null : v;
  }

  async createPersonal(p: PersonalInput, stamp: ChangeStamp, newNames: NewNames = {}) {
    const { t, cols, byName } = await this.personalTable();
    if (await this.getPersonal(p.code)) throw new HttpError(409, `Ya existe el empleado ${p.code}`);
    // Tablas de históricos de los campos que llevan valor (tarjeta y organización).
    const kinds = HISTORY_KINDS.filter((k) => p[HISTORY[k].field] || (k !== 'card' && newNames[k as OrgKind]));
    const tables = new Map<HistoryKind, HisTables>();
    for (const k of kinds) {
      // La tarjeta exige sus tablas; en organización, si una instalación no tiene el histórico, solo se escribe el campo EM_*.
      const ht = k === 'card' || newNames[k as OrgKind] ? await this.hisTables(k) : await this.hisTables(k, false);
      if (ht) tables.set(k, ht);
    }

    const vt = await this.vigTable();
    await this.inTx(async (q) => {
      const emp = { ...p };
      // Valores nuevos escritos a mano: se crean con código automático (o se reutiliza uno con el mismo nombre).
      for (const k of ORG_KINDS) {
        const name = newNames[k];
        if (name && !emp[k]) emp[k] = await this.resolveValue(q, tables.get(k)!, { name });
      }
      if (emp.card) await this.checkCardFree(q, tables.get('card')!, emp.card, emp.code, emp.hireDate);

      const names: string[] = [];
      const values: string[] = [];
      const params: Record<string, unknown> = {};
      const used = new Set<string>();
      let i = 0;
      const add = (c: ColumnInfo, v: unknown) => {
        names.push(ident(c.name, 'columna'));
        values.push(`@v${i}`);
        params[`v${i++}`] = v;
        used.add(c.name.toUpperCase());
      };
      for (const [k, n] of Object.entries(this.personalCols()) as [keyof PersonalInput, string][]) {
        const c = byName(n);
        if (!c) {
          if (emp[k]) throw new HttpError(409, `La tabla ${t.table} no tiene la columna ${n}.`);
          continue;
        }
        add(c, this.personalValue(c, k, emp[k]));
      }
      for (const [n, v] of Object.entries(PERSONAL_FIXED_ON_CREATE)) {
        const c = byName(n);
        if (c) add(c, v);
      }
      // Columnas obligatorias sin valor por defecto: vacío o 0, como en el resto de altas.
      for (const c of cols) {
        if (used.has(c.name.toUpperCase()) || c.nullable || c.hasDefault || c.identity || c.computed) continue;
        if (DATE_TYPES.includes(c.type)) throw new HttpError(409, `La tabla ${t.table} exige la columna ${c.name} (fecha) y Atajos de Evalos no sabe qué valor darle.`);
        add(c, NUM_TYPES.includes(c.type) ? 0 : '');
      }
      await q(`INSERT INTO ${tableRef(t)} (${names.join(', ')}) VALUES (${values.join(', ')})`, params);

      // Un tramo por cada campo con valor, desde la fecha de alta.
      for (const k of HISTORY_KINDS) {
        const v = emp[HISTORY[k].field];
        const ht = tables.get(k);
        if (!v || !ht) continue;
        if (k === 'card') await this.ensureCard(q, ht, v);
        await this.insertTramo(q, ht, emp.code, v, emp.hireDate, stamp);
      }
      if (vt) await this.openPeriod(q, vt, emp.code, emp.hireDate, stamp);
      // Alta con fecha de baja ya indicada: sus tramos y su periodo se cierran en esa fecha.
      if (emp.endDate) await this.closeAllAt(q, [...tables.values()], vt, emp.code, emp.endDate, emp.hireDate, stamp);
    });
  }

  async updatePersonal(code: string, p: Omit<PersonalInput, 'code'>, stamp: ChangeStamp) {
    const { t, byName } = await this.personalTable();
    const pc = this.personalCols();
    const withHistory = new Set<keyof PersonalInput>(HISTORY_KINDS.map((k) => HISTORY[k].field));
    const sets: string[] = [];
    const params: Record<string, unknown> = { code };
    let i = 0;
    for (const [k, n] of Object.entries(pc) as [keyof PersonalInput, string][]) {
      // El código no se modifica nunca; tarjeta, empresa, departamento, sección y área van por su histórico.
      if (k === 'code' || withHistory.has(k)) continue;
      const c = byName(n);
      if (!c) continue;
      sets.push(`${ident(c.name, 'columna')} = @v${i}`);
      params[`v${i++}`] = this.personalValue(c, k, (p as PersonalInput)[k]);
    }
    const cur = await this.getPersonal(code);
    if (!cur) throw new HttpError(404, `No existe el empleado ${code}`);
    checkEndChange(code, cur.endDate, p.endDate);
    const closing = !!p.endDate && p.endDate !== cur.endDate;
    const his = closing ? await this.allHisTables() : [];
    const vt = closing ? await this.vigTable() : null;
    await this.inTx(async (q) => {
      const { affected } = await q(`UPDATE ${tableRef(t)} SET ${sets.join(', ')} WHERE ${ident(pc.code, 'columna')} = @code`, params);
      if (!affected) throw new HttpError(404, `No existe el empleado ${code}`);
      if (closing) await this.closeAllAt(q, his, vt, code, p.endDate, p.hireDate || cur.hireDate, stamp);
    });
  }

  private async allHisTables() {
    const out: HisTables[] = [];
    for (const k of HISTORY_KINDS) {
      const ht = await this.hisTables(k, false);
      if (ht) out.push(ht);
    }
    return out;
  }

  /**
   * Baja del empleado: cierra con la fecha de baja todos sus tramos abiertos ese día (sin baja o con baja posterior).
   * Si algún tramo empieza después de la baja no se puede cerrar: 409 con el detalle.
   */
  private async closeAllAt(q: Q, his: HisTables[], vt: VigTable | null, code: string, end: string, hireDate: string, stamp: ChangeStamp) {
    const endYmd = ymdOf(end);
    const later: string[] = [];
    for (const ht of his) {
      const { rows } = await q(
        `SELECT RTRIM(${hc(ht, 'CODI')}) AS value, RTRIM(${hc(ht, 'FALT')}) AS falt FROM ${tableRef(ht.his)} WITH (UPDLOCK, HOLDLOCK)
          WHERE ${hc(ht, 'PCOD')} = @code AND ${hc(ht, 'FALT')} > @end`,
        { code, end: endYmd }
      );
      for (const r of rows) later.push(`${ht.def.label} ${r.value} (desde el ${dmy(isoFromDb(r.falt))})`);
    }
    if (vt) {
      const { rows } = await q(`SELECT RTRIM([HV_FALT]) AS falt FROM ${tableRef(vt)} WITH (UPDLOCK, HOLDLOCK) WHERE [HV_PCOD] = @code AND [HV_FALT] > @end`, { code, end: endYmd });
      for (const r of rows) later.push(`el periodo de alta que empieza el ${dmy(isoFromDb(r.falt))}`);
    }
    if (later.length) throw new HttpError(409, `No se puede dar de baja el ${dmy(end)}: estos tramos empiezan después y no se pueden cerrar antes de empezar: ${later.join(', ')}. Elimínalos o ajusta la fecha de baja.`);
    const stampP = { fech: stamp.date, hora: stamp.time, usua: stamp.user };
    for (const ht of his) {
      await q(
        `UPDATE ${tableRef(ht.his)} SET ${hc(ht, 'FBAJ')} = @end, ${hc(ht, 'TIPO')} = 'B', ${hc(ht, 'FECH')} = @fech, ${hc(ht, 'HORA')} = @hora, ${hc(ht, 'USUA')} = @usua
          WHERE ${hc(ht, 'PCOD')} = @code AND (${NO_END(ht)} OR ${hc(ht, 'FBAJ')} > @end)`,
        { code, end: endYmd, ...stampP }
      );
    }
    if (vt) {
      // Cierra el periodo de alta en curso; si el empleado no tenía ninguno (altas anteriores a Prime Suite), se registra el periodo completo.
      const { affected } = await q(
        `UPDATE ${tableRef(vt)} SET [HV_FBAJ] = @end, [HV_TIPO] = 'B', [HV_FECH] = @fech, [HV_HORA] = @hora, [HV_USUA] = @usua
          WHERE [HV_PCOD] = @code AND ([HV_FBAJ] IS NULL OR LTRIM(RTRIM([HV_FBAJ])) IN ('', '0') OR [HV_FBAJ] > @end)`,
        { code, end: endYmd, ...stampP }
      );
      if (!affected) {
        const { rows } = await q(`SELECT TOP 1 1 AS x FROM ${tableRef(vt)} WHERE [HV_PCOD] = @code`, { code });
        if (!rows[0] && hireDate) {
          await q(
            `INSERT INTO ${tableRef(vt)} ([HV_PCOD], [HV_FALT], [HV_FBAJ], [HV_TIPO], [HV_FECH], [HV_HORA], [HV_USUA]) VALUES (@code, @from, @end, 'B', @fech, @hora, @usua)`,
            { code, from: ymdOf(hireDate), end: endYmd, ...stampP }
          );
        }
      }
    }
  }

  // ---------- Periodos de alta (HIS_VIGENCIA) ----------

  private async vigTable(): Promise<VigTable | null> {
    const t = { schema: this.mapping.employees.schema, table: 'HIS_VIGENCIA' };
    const cols = await this.columns(t);
    const ok = ['HV_PCOD', 'HV_FALT', 'HV_FBAJ', 'HV_TIPO', 'HV_FECH', 'HV_HORA', 'HV_USUA'].every((n) => cols.some((c) => c.name.toUpperCase() === n));
    return ok ? t : null;
  }

  private async openPeriod(q: Q, vt: VigTable, code: string, from: string, stamp: ChangeStamp) {
    await q(
      `INSERT INTO ${tableRef(vt)} ([HV_PCOD], [HV_FALT], [HV_FBAJ], [HV_TIPO], [HV_FECH], [HV_HORA], [HV_USUA]) VALUES (@code, @from, '0', 'A', @fech, @hora, @usua)`,
      { code, from: ymdOf(from), fech: stamp.date, hora: stamp.time, usua: stamp.user }
    );
  }

  async personalPeriods(code: string) {
    const vt = await this.vigTable();
    if (!vt) return [];
    const { rows } = await this.query(
      `SELECT '' AS value, RTRIM([HV_FALT]) AS falt, RTRIM(ISNULL([HV_FBAJ], '')) AS fbaj, RTRIM(ISNULL([HV_TIPO], '')) AS tipo,
              RTRIM(ISNULL([HV_FECH], '')) AS fech, RTRIM(ISNULL([HV_HORA], '')) AS hora, RTRIM(ISNULL([HV_USUA], '')) AS usua
         FROM ${tableRef(vt)} WHERE [HV_PCOD] = @code ORDER BY [HV_FALT] DESC`,
      { code }
    );
    const today = madridNow().date;
    return rows.map((r: any) => toEntry(r, today));
  }

  async readmitPersonal(code: string, r: ReadmitInput, stamp: ChangeStamp, newNames: NewNames = {}) {
    const { t, byName } = await this.personalTable();
    const cur = await this.getPersonal(code);
    if (!cur) throw new HttpError(404, `No existe el empleado ${code}`);
    checkReadmit(code, cur.endDate, r.hireDate);
    const his = await this.allHisTables();
    const tables = new Map(his.map((ht) => [ht.kind, ht] as const));
    if (r.card && !tables.has('card')) await this.hisTables('card'); // lanza el error de tablas
    for (const k of ORG_KINDS) if (newNames[k] && !tables.has(k)) await this.hisTables(k);
    const vt = await this.vigTable();
    const pc = this.personalCols();

    await this.inTx(async (q) => {
      const v: ReadmitInput = { ...r };
      for (const k of ORG_KINDS) if (newNames[k] && !v[k]) v[k] = await this.resolveValue(q, tables.get(k)!, { name: newNames[k]! });
      // Por si quedara algún tramo abierto de antes (altas previas a este cambio): se cierra en la fecha de baja.
      await this.closeAllAt(q, his, vt, code, cur.endDate, cur.hireDate, stamp);
      if (v.card) await this.checkCardFree(q, tables.get('card')!, v.card, code, v.hireDate);

      // Ficha: nueva fecha de alta, sin baja y con los valores elegidos (vacío = NULL).
      const sets: string[] = [];
      const params: Record<string, unknown> = { code };
      let i = 0;
      for (const k of ['hireDate', 'endDate', 'card', 'company', 'department', 'section', 'area'] as const) {
        const c = byName(pc[k]);
        if (!c) continue;
        sets.push(`${ident(c.name, 'columna')} = @v${i}`);
        params[`v${i++}`] = this.personalValue(c, k, k === 'endDate' ? '' : (v as any)[k] || '');
      }
      await q(`UPDATE ${tableRef(t)} SET ${sets.join(', ')} WHERE ${ident(pc.code, 'columna')} = @code`, params);

      if (vt) await this.openPeriod(q, vt, code, v.hireDate, stamp);
      for (const k of HISTORY_KINDS) {
        const val = (v as any)[HISTORY[k].field] as string;
        const ht = tables.get(k);
        if (!val || !ht) continue;
        if (k === 'card') await this.ensureCard(q, ht, val);
        await this.insertTramo(q, ht, code, val, v.hireDate, stamp);
      }
    });
  }

  async deletePersonal(code: string) {
    const { t } = await this.personalTable();
    const schema = t.schema || '';
    // Solo se comprueban las tablas que existen en esta instalación.
    const { rows: present } = await this.query<{ t: string; c: string }>(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
        WHERE (@s = '' OR TABLE_SCHEMA = @s) AND TABLE_NAME + '.' + COLUMN_NAME IN (${PERSONAL_REFS.map((_, i) => `@r${i}`).join(', ')})`,
      { s: schema, ...Object.fromEntries(PERSONAL_REFS.map(([tb, c], i) => [`r${i}`, `${tb}.${c}`])) }
    );
    const refs = PERSONAL_REFS.filter(([tb, c]) => present.some((x) => x.t.toUpperCase() === tb && x.c.toUpperCase() === c));
    if (refs.length) {
      const { rows } = await this.query<{ what: string; n: number }>(
        refs.map(([tb, c, what], i) => `SELECT @w${i} AS what, COUNT(*) AS n FROM ${tableRef({ schema: t.schema, table: tb })} WHERE ${ident(c, 'columna')} = @code`).join(' UNION ALL '),
        { code, ...Object.fromEntries(refs.map(([, , w], i) => [`w${i}`, w])) }
      );
      const used = rows.filter((r) => Number(r.n) > 0).map((r) => `${r.what} (${r.n})`);
      if (used.length) throw new HttpError(409, `No se puede eliminar el empleado ${code} porque tiene datos en Evalos: ${used.join(', ')}. Dale de baja con la fecha de baja.`);
    }
    const his = await this.allHisTables();
    const vt = await this.vigTable();
    await this.inTx(async (q) => {
      // Sus históricos (HIS_*) se borran con él; las tablas maestras (TARJETA, EMPRESA…) se conservan.
      for (const ht of his) await q(`DELETE FROM ${tableRef(ht.his)} WHERE ${hc(ht, 'PCOD')} = @code`, { code });
      if (vt) await q(`DELETE FROM ${tableRef(vt)} WHERE [HV_PCOD] = @code`, { code });
      const { affected } = await q(`DELETE FROM ${tableRef(t)} WHERE ${ident(this.personalCols().code, 'columna')} = @code`, { code });
      if (!affected) throw new HttpError(404, `No existe el empleado ${code}`);
    });
  }

  // ---------- Históricos: tarjeta, empresa, departamento, sección y área (HIS_*) ----------

  /** Tabla maestra y de histórico de un tipo. Si no existen con sus columnas: error (required) o null. */
  private async hisTables(kind: HistoryKind): Promise<HisTables>;
  private async hisTables(kind: HistoryKind, required: false): Promise<HisTables | null>;
  private async hisTables(kind: HistoryKind, required = true): Promise<HisTables | null> {
    const def = HISTORY[kind];
    const schema = this.mapping.employees.schema;
    const d = this.mapping.departments;
    const m = kind === 'card' ? { table: 'TARJETA', code: 'TA_CODI', description: 'TA_DESC' }
      : kind === 'department' && d?.table && d.code && d.description ? { table: d.table, code: d.code, description: d.description, schema: d.schema }
      : PERSONAL_LOOKUP_TABLES[kind];
    const master = { schema: (m as any).schema ?? schema, table: m.table, code: m.code, description: m.description };
    const his = { schema, table: def.his };
    const [mc, hcols] = await Promise.all([this.columns(master), this.columns(his)]);
    const has = (cols: ColumnInfo[], names: string[]) => names.every((n) => cols.some((c) => c.name.toUpperCase() === n.toUpperCase()));
    const ok = has(mc, [master.code, master.description]) && has(hcols, ['PCOD', 'CODI', 'FALT', 'FBAJ', 'TIPO', 'FECH', 'HORA', 'USUA'].map((n) => `${def.prefix}_${n}`));
    if (ok) return { kind, def, master, his, masterCols: mc };
    if (required) throw new HttpError(409, `La base de datos de Evalos 8 no tiene las tablas ${master.table} y ${def.his} con las columnas esperadas.`);
    return null;
  }

  /** Código para un valor: el indicado, uno existente con el mismo nombre, o uno nuevo con código automático. */
  private async resolveValue(q: Q, ht: HisTables, v: HistoryValue): Promise<string> {
    if ('code' in v) return v.code;
    const m = ht.master;
    const mcode = ident(m.code, 'columna');
    const mdesc = ident(m.description, 'columna');
    const { rows } = await q(`SELECT RTRIM(${mcode}) AS code, RTRIM(ISNULL(${mdesc}, '')) AS description FROM ${tableRef(m)} WITH (UPDLOCK, HOLDLOCK)`);
    const same = rows.find((r: any) => String(r.description).toUpperCase() === v.name.toUpperCase());
    if (same) return String(same.code);
    const codeCol = ht.masterCols.find((c) => c.name.toUpperCase() === m.code.toUpperCase());
    const descCol = ht.masterCols.find((c) => c.name.toUpperCase() === m.description.toUpperCase());
    let code: string;
    try { code = nextCode(rows.map((r: any) => String(r.code)), codeCol?.maxLength ?? null); }
    catch (e: any) { throw new HttpError(409, `${e.message} en ${m.table}.`); }
    const name = descCol?.maxLength ? v.name.slice(0, descCol.maxLength) : v.name;
    // Columnas obligatorias de la tabla maestra que no son código ni nombre: vacío o 0.
    const extra = ht.masterCols.filter((c) => !c.nullable && !c.hasDefault && !c.identity && !c.computed && ![m.code, m.description].some((n) => n.toUpperCase() === c.name.toUpperCase()));
    const names = [mcode, mdesc, ...extra.map((c) => ident(c.name, 'columna'))];
    const params: Record<string, unknown> = { code, name };
    extra.forEach((c, i) => { params[`x${i}`] = NUM_TYPES.includes(c.type) ? 0 : ''; });
    await q(`INSERT INTO ${tableRef(m)} (${names.join(', ')}) VALUES (@code, @name${extra.map((_, i) => `, @x${i}`).join('')})`, params);
    return code;
  }

  /** Tarjetas: 409 si otro empleado la tiene en un tramo que sigue abierto en la fecha indicada. */
  private async checkCardFree(q: Q, ht: HisTables, card: string, code: string, from: string) {
    const { rows } = await q(
      `SELECT TOP 1 RTRIM(${hc(ht, 'PCOD')}) AS emp, RTRIM(ISNULL(${hc(ht, 'FBAJ')}, '')) AS fbaj
         FROM ${tableRef(ht.his)} WITH (UPDLOCK, HOLDLOCK)
        WHERE ${hc(ht, 'CODI')} = @card AND ${hc(ht, 'PCOD')} <> @code AND ${OPEN_AT(ht, '@from')}
        ORDER BY ${hc(ht, 'FALT')} DESC`,
      { card, code, from: ymdOf(from) }
    );
    const r = rows[0];
    if (r) {
      const until = isoFromDb(r.fbaj);
      throw new HttpError(409, `La tarjeta ${card} la tiene asignada el empleado ${r.emp}${until ? ` hasta el ${dmy(until)}` : ' sin fecha de baja'}.`);
    }
  }

  private async ensureCard(q: Q, ht: HisTables, card: string) {
    const m = ht.master;
    await q(
      `IF NOT EXISTS (SELECT 1 FROM ${tableRef(m)} WITH (UPDLOCK, HOLDLOCK) WHERE ${ident(m.code, 'columna')} = @card)
         INSERT INTO ${tableRef(m)} (${ident(m.code, 'columna')}, ${ident(m.description, 'columna')}) VALUES (@card, @desc)`,
      { card, desc: cardDescription(card) }
    );
  }

  private async insertTramo(q: Q, ht: HisTables, code: string, value: string, from: string, stamp: ChangeStamp) {
    const cols = ['PCOD', 'CODI', 'FALT', 'FBAJ', 'TIPO', 'FECH', 'HORA', 'USUA'].map((n) => hc(ht, n)).join(', ');
    await q(
      `INSERT INTO ${tableRef(ht.his)} (${cols}) VALUES (@code, @value, @from, '0', 'A', @fech, @hora, @usua)`,
      { code, value, from: ymdOf(from), fech: stamp.date, hora: stamp.time, usua: stamp.user }
    );
  }

  /** Columna EM_* = valor vigente más reciente (antes los tramos sin fecha de baja), o NULL si no queda ninguno. */
  private async syncField(q: Q, ht: HisTables, code: string, today: string) {
    const { t } = await this.personalTable();
    const pc = this.personalCols();
    await q(
      `UPDATE ${tableRef(t)} SET ${ident(pc[ht.def.field], 'columna')} = (
         SELECT TOP 1 h.${hc(ht, 'CODI')} FROM ${tableRef(ht.his)} h
          WHERE h.${hc(ht, 'PCOD')} = @code AND ${OPEN_AT(ht, '@today', 'h')}
          ORDER BY CASE WHEN ${NO_END(ht, 'h')} THEN 0 ELSE 1 END, h.${hc(ht, 'FALT')} DESC)
        WHERE ${ident(pc.code, 'columna')} = @code`,
      { code, today }
    );
  }

  async personalHistory(code: string): Promise<PersonalHistory> {
    const today = madridNow().date;
    const out = {} as PersonalHistory;
    for (const k of HISTORY_KINDS) {
      const ht = await this.hisTables(k, false);
      if (!ht) { out[k] = []; continue; }
      const { rows } = await this.query(
        `SELECT RTRIM(${hc(ht, 'CODI')}) AS value, RTRIM(${hc(ht, 'FALT')}) AS falt, RTRIM(ISNULL(${hc(ht, 'FBAJ')}, '')) AS fbaj,
                RTRIM(ISNULL(${hc(ht, 'TIPO')}, '')) AS tipo, RTRIM(ISNULL(${hc(ht, 'FECH')}, '')) AS fech,
                RTRIM(ISNULL(${hc(ht, 'HORA')}, '')) AS hora, RTRIM(ISNULL(${hc(ht, 'USUA')}, '')) AS usua
           FROM ${tableRef(ht.his)} WHERE ${hc(ht, 'PCOD')} = @code ORDER BY ${hc(ht, 'FALT')} DESC, ${hc(ht, 'CODI')}`,
        { code }
      );
      out[k] = rows.map((r: any) => toEntry(r, today));
    }
    return out;
  }

  async assignHistory(kind: HistoryKind, code: string, value: HistoryValue, from: string, stamp: ChangeStamp) {
    const ht = await this.hisTables(kind);
    if (!(await this.getPersonal(code))) throw new HttpError(404, `No existe el empleado ${code}`);
    await this.inTx(async (q) => {
      const v = await this.resolveValue(q, ht, value);
      const fromYmd = ymdOf(from);
      // Tramos abiertos del empleado en esa fecha (bloqueados hasta el final de la transacción).
      const { rows: open } = await q(
        `SELECT RTRIM(${hc(ht, 'CODI')}) AS value, RTRIM(${hc(ht, 'FALT')}) AS falt FROM ${tableRef(ht.his)} WITH (UPDLOCK, HOLDLOCK)
          WHERE ${hc(ht, 'PCOD')} = @code AND ${OPEN_AT(ht, '@from')}`,
        { code, from: fromYmd }
      );
      if (kind === 'card') {
        await this.checkCardFree(q, ht, v, code, from);
        const mine = open.find((r: any) => r.value === v);
        if (mine) throw new HttpError(409, `El empleado ${code} ya tiene asignada la tarjeta ${v} desde el ${dmy(isoFromDb(mine.falt))}.`);
        await this.ensureCard(q, ht, v);
      } else {
        const same = open.find((r: any) => r.value === v);
        if (same) throw new HttpError(409, `El empleado ${code} ya está en ${ht.def.label} ${v} desde el ${dmy(isoFromDb(same.falt))}.`);
        const later = open.find((r: any) => String(r.falt) >= fromYmd);
        if (later) throw new HttpError(409, `El tramo vigente de ${ht.def.label} (${later.value}) empieza el ${dmy(isoFromDb(later.falt))}: la nueva alta tiene que ser posterior.`);
        // Solo puede haber uno vigente: el anterior se cierra el día antes de la nueva alta.
        if (open.length) {
          await q(
            `UPDATE ${tableRef(ht.his)} SET ${hc(ht, 'FBAJ')} = @to, ${hc(ht, 'TIPO')} = 'B', ${hc(ht, 'FECH')} = @fech, ${hc(ht, 'HORA')} = @hora, ${hc(ht, 'USUA')} = @usua
              WHERE ${hc(ht, 'PCOD')} = @code AND ${OPEN_AT(ht, '@from')}`,
            { code, from: fromYmd, to: ymdOf(prevDay(from)), fech: stamp.date, hora: stamp.time, usua: stamp.user }
          );
        }
      }
      const { rows: dup } = await q(`SELECT 1 AS x FROM ${tableRef(ht.his)} WHERE ${hc(ht, 'PCOD')} = @code AND ${hc(ht, 'CODI')} = @value AND ${hc(ht, 'FALT')} = @from`, { code, value: v, from: fromYmd });
      if (dup[0]) throw new HttpError(409, `Ya hay un tramo de ${ht.def.label} ${v} que empieza el ${dmy(from)} para este empleado.`);
      await this.insertTramo(q, ht, code, v, from, stamp);
      await this.syncField(q, ht, code, stamp.date);
    });
  }

  async closeHistory(kind: HistoryKind, code: string, value: string, from: string, to: string, stamp: ChangeStamp) {
    const ht = await this.hisTables(kind);
    if (to < from) throw new HttpError(400, 'La fecha de baja no puede ser anterior a la de alta del tramo');
    await this.inTx(async (q) => {
      const { affected } = await q(
        `UPDATE ${tableRef(ht.his)} SET ${hc(ht, 'FBAJ')} = @to, ${hc(ht, 'TIPO')} = 'B', ${hc(ht, 'FECH')} = @fech, ${hc(ht, 'HORA')} = @hora, ${hc(ht, 'USUA')} = @usua
          WHERE ${hc(ht, 'PCOD')} = @code AND ${hc(ht, 'CODI')} = @value AND ${hc(ht, 'FALT')} = @from AND ${OPEN_AT(ht, '@today')}`,
        { code, value, from: ymdOf(from), to: ymdOf(to), today: stamp.date, fech: stamp.date, hora: stamp.time, usua: stamp.user }
      );
      if (!affected) throw new HttpError(404, `El empleado ${code} no tiene vigente ${ht.def.label} ${value} desde el ${dmy(from)}.`);
      await this.syncField(q, ht, code, stamp.date);
    });
  }

  async updatePersonalContact(code: string, name: string, email: string) {
    const { t, byName } = await this.personalTable();
    const pc = this.personalCols();
    const sets: string[] = [];
    const params: Record<string, unknown> = { code };
    if (byName(pc.name)) { sets.push(`${ident(pc.name, 'columna')} = @name`); params.name = name; }
    if (byName(pc.email)) { sets.push(`${ident(pc.email, 'columna')} = @email`); params.email = email || null; }
    if (!sets.length) return;
    const { affected } = await this.query(`UPDATE ${tableRef(t)} SET ${sets.join(', ')} WHERE ${ident(pc.code, 'columna')} = @code`, params);
    if (!affected) throw new HttpError(404, `No existe en Evalos el empleado ${code} vinculado a este usuario`);
  }

  async userInitials(email: string): Promise<string> {
    const t = { schema: this.mapping.employees.schema, table: 'USUARIOS' };
    const cols = await this.columns(t);
    const u = cols.find((c) => c.name.toUpperCase() === 'USUARIO');
    const i = cols.find((c) => c.name.toUpperCase() === 'INICIALES');
    if (u && i) {
      const { rows } = await this.query(`SELECT TOP 1 RTRIM(${ident(i.name)}) AS i FROM ${tableRef(t)} WHERE LOWER(${ident(u.name)}) = LOWER(@u)`, { u: email });
      if (rows[0]?.i) return String(rows[0].i);
    }
    // Si aún no está en USUARIOS, se da de alta como hace Prime Suite con todos sus usuarios.
    return (await ensureEvalosUser(this.conn, t.schema, email)).initials;
  }

  async personalLookups(): Promise<PersonalLookups> {
    const schema = this.mapping.employees.schema;
    const d = this.mapping.departments;
    const sources: Record<PersonalLookupKey, { table: string; code: string; description: string; schema?: string }> = {
      ...PERSONAL_LOOKUP_TABLES,
      department: d?.table && d.code && d.description ? d : PERSONAL_LOOKUP_TABLES.department
    };
    const out = {} as PersonalLookups;
    await Promise.all(Object.entries(sources).map(async ([k, s]) => {
      const t = { schema: s.schema ?? schema, table: s.table };
      const cols = await this.columns(t);
      const has = (n: string) => cols.some((c) => c.name.toUpperCase() === n.toUpperCase());
      if (!has(s.code)) { out[k as PersonalLookupKey] = null; return; }
      const desc = has(s.description) ? `RTRIM(ISNULL(${ident(s.description, 'columna')}, ''))` : `''`;
      const { rows } = await this.query(`SELECT RTRIM(${ident(s.code, 'columna')}) AS code, ${desc} AS description FROM ${tableRef(t)} ORDER BY ${ident(s.code, 'columna')}`);
      out[k as PersonalLookupKey] = rows.map((r: any) => ({ code: txt(r.code), description: txt(r.description) })).filter((x) => x.code);
    }));
    return out;
  }
}

// ---------- Personal: columnas, catálogos y tablas relacionadas ----------
const PERSONAL_COLUMNS: Record<keyof PersonalInput, string> = {
  code: 'EM_CODI', name: 'EM_NOMB', card: 'EM_TARJ', email: 'EM_WFEM', hireDate: 'EM_FALT', endDate: 'EM_FBAJ',
  company: 'EM_CEMP', department: 'EM_DEPA', section: 'EM_SECC', area: 'EM_AREA', consultas: 'EM_KOPC', solicitudes: 'EM_WFOP'
};

/** Tabla de la que sale cada desplegable de la ficha. */
const PERSONAL_LOOKUP_TABLES: Record<PersonalLookupKey, { table: string; code: string; description: string }> = {
  company: { table: 'EMPRESA', code: 'EP_CODI', description: 'EP_NOMB' },
  department: { table: 'DEPMENTO', code: 'DP_CODI', description: 'DP_DESC' },
  section: { table: 'SECCION', code: 'SC_CODI', description: 'SC_DESC' },
  area: { table: 'AREA', code: 'AR_CODI', description: 'AR_DESC' },
  consultas: { table: 'KIOSKO', code: 'KI_KOPC', description: 'KI_DESC' },
  solicitudes: { table: 'WORKFLOW', code: 'WF_CODI', description: 'WF_DESC' }
};

/** Tablas con datos del empleado que impiden borrarlo (tabla, columna del código de empleado, descripción). */
const PERSONAL_REFS: [string, string, string][] = [
  ['MARCAPRES', 'MP_CODI', 'marcajes de presencia'],
  ['MARCAACCES', 'MC_CODI', 'marcajes de acceso'],
  ['MARCACOME', 'MA_CODI', 'marcajes de comedor'],
  ['MARCACONT', 'MT_CODI', 'marcajes de contrata'],
  ['MARCAPROD', 'MD_CODI', 'marcajes de producción'],
  ['ABSENTIS', 'AB_CODI', 'ausencias'],
  ['CALENDARIOEMPLEADOTURNO', 'CODIGOEMPLEADO', 'calendario de turnos'],
  ['CALENDARIOEMPLEADOACCESO', 'CODIGOEMPLEADO', 'calendario de accesos'],
  ['PERSONALACCESO', 'PA_CODIEMP', 'accesos asignados'],
  ['EMPLEADOHORASEXTRASDIA', 'CODIGOEMPLEADO', 'horas extra'],
  ['EMPLEADOSCREDITOMENSUAL', 'CODIGOEMPLEADO', 'créditos mensuales'],
  ['WORKCOLA', 'WC_PCOD', 'solicitudes del portal del empleado']
];

const txt = (v: unknown) => (v == null ? '' : String(v).trim());

type Q = (text: string, params?: Record<string, unknown>) => Promise<{ rows: any[]; affected: number }>;
type VigTable = { schema?: string; table: string };
interface HisTables {
  kind: HistoryKind;
  def: HistoryDef;
  master: { schema?: string; table: string; code: string; description: string };
  his: { schema?: string; table: string };
  masterCols: ColumnInfo[];
}
/** Columna del histórico: [HT_CODI], [HD_FALT]… */
const hc = (ht: HisTables, n: string) => ident(`${ht.def.prefix}_${n}`, 'columna');
/** Tramo sin fecha de baja (NULL, vacío o 0). */
const NO_END = (ht: HisTables, a?: string) => { const c = `${a ? a + '.' : ''}${hc(ht, 'FBAJ')}`; return `(${c} IS NULL OR LTRIM(RTRIM(${c})) IN ('', '0'))`; };
/** Tramo abierto en una fecha (aaaammdd): sin baja o con baja igual o posterior. */
const OPEN_AT = (ht: HisTables, param: string, a?: string) => `(${NO_END(ht, a)} OR ${a ? a + '.' : ''}${hc(ht, 'FBAJ')} >= ${param})`;

/** Fecha de Evalos (aaaammdd, número o date) a AAAA-MM-DD; '' si no hay. */
function isoFromDb(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
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

/** Quita el acceso a Evalos 8 de un usuario del portal (fila de USUARIOS con su email). Devuelve si existía. */
export async function removeEvalosUser(conn: string, schema: string | undefined, email: string): Promise<boolean> {
  const t = { schema, table: 'USUARIOS' };
  const pool = await getPool(conn).catch(friendly);
  try {
    // Nombre real de la columna (USUARIO / Usuario), por si la BD distingue mayúsculas en los identificadores.
    const rc = pool.request();
    rc.input('t', t.table);
    rc.input('s', schema || '');
    const cols = (await rc.query(`SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t AND (@s = '' OR TABLE_SCHEMA = @s)`)).recordset as { name: string }[];
    const cUser = cols.find((c) => c.name.toUpperCase() === 'USUARIO');
    if (!cUser) return false;
    const r = pool.request();
    r.input('u', email);
    const res = await r.query(`DELETE FROM ${tableRef(t)} WHERE LOWER(${ident(cUser.name)}) = LOWER(@u)`);
    return (res.rowsAffected || []).reduce((a: number, b: number) => a + b, 0) > 0;
  } catch (e) {
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
