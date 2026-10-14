// Atajos de Evalos · Perfiles Workflow (por departamentos).
//
//   - Cada persona tiene su departamento (EM_DEPA) y su rol (EM_WORKFLOWROL: EMPLEADO, RESPONSABLE o RRHH).
//   - RESPONSABLE valida las solicitudes de su departamento y, si se le añaden, de otros departamentos.
//   - Nivel 1 de una persona = los responsables (en alta) que validan su departamento, sin contarse a sí misma;
//     o, si se le asigna a mano, quien la valida (típico: el jefe de departamento lo valida un superior).
//   - El responsable ve a la gente de los departamentos que valida (WF_FILT = EM_DEPA='A' OR EM_DEPA='B');
//     RRHH ve a todo el personal; EMPLEADO, lo de su plantilla.
//   - Se crea un perfil en WORKFLOW (copia de la plantilla del rol, 997/998/999 por defecto, código Q01, Q02…) por
//     cada combinación de rol + departamento + departamentos que valida + validadores asignados a mano, y se escribe
//     en EM_WFOP. Se registran en PS_WF2PERFILES con esa clave: solo esos perfiles se modifican o se borran.
//   - Las asignaciones manuales (validadores de una persona y departamentos de más de un responsable) están en PS_WF2VALIDA.
//   - Niveles 2 a 4 y el orden de validación de cada solicitud se editan en la pantalla y se conservan al recalcular.
//   - Los perfiles que se quedan sin nadie se borran. También los de la versión anterior por equipos (PS_WFPERFILES).
import { HttpError } from '../http.ts';
import type { WorkflowPlan, WorkflowRow } from './types.ts';

export const WF_ROLES = ['EMPLEADO', 'RESPONSABLE', 'RRHH'] as const;
export type WfRole = (typeof WF_ROLES)[number];
export const isWfRole = (v: unknown): v is WfRole => typeof v === 'string' && (WF_ROLES as readonly string[]).includes(v);
/** Rol abreviado para cuando EM_WORKFLOWROL es más corta que el nombre del rol (p. ej. nvarchar(5)). */
export const WF_ROLE_SHORT: Record<WfRole, string> = { EMPLEADO: 'EMP', RESPONSABLE: 'RESP', RRHH: 'RRHH' };
/** Rol leído de EM_WORKFLOWROL: el nombre completo, su abreviatura o el principio del nombre (si la columna lo cortó). */
export function roleFromDb(v: unknown): string {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s || isWfRole(s)) return s;
  const hit = WF_ROLES.find((r) => WF_ROLE_SHORT[r] === s) || (s.length >= 3 ? WF_ROLES.find((r) => r.startsWith(s)) : undefined);
  return hit || s;
}
/** Valor para EM_WORKFLOWROL: el nombre completo si cabe; si no, la abreviatura (EMP, RESP, RRHH). */
export function roleToDb(rol: string, max: number | null | undefined): string {
  if (!rol || !max || rol.length <= max) return rol;
  const short = isWfRole(rol) ? WF_ROLE_SHORT[rol] : rol;
  if (short.length <= max) return short;
  throw new HttpError(409, `EM_WORKFLOWROL admite solo ${max} caracteres y el rol ${rol} necesita al menos ${short.length}. Amplía la columna en la base de datos de Evalos (p. ej. nvarchar(15)).`);
}

/** Tablas propias (los nombres vienen de cuando esta opción era «Perfiles Workflow 2»). */
export const WF_PERFILES_TABLE = 'PS_WF2PERFILES';
export const WF_VALIDA_TABLE = 'PS_WF2VALIDA';
/** Registro de la versión anterior por equipos: sus perfiles se borran cuando ya no los tiene nadie. */
export const LEGACY_PERFILES_TABLE = 'PS_WFPERFILES';
/** Columna de PERSONAL con el rol. */
export const WF_ROLE_COLUMN = 'EM_WORKFLOWROL';

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const val = (r: WorkflowRow | undefined, c: string) => (r?.[c] == null ? '' : String(r[c]).trim());

/** Autorizadores por nivel (códigos de empleado separados por «;»). */
export const WF_LEVEL_COLS = ['WF_NIV1', 'WF_NIV2', 'WF_NIV3', 'WF_NIV4'] as const;
/**
 * Tipos de solicitud: columna con los niveles programados (orden de validación, p. ej. «1,2»).
 * Vacío = la solicitud no aparece; «0» = sin validación.
 */
export const WF_REQUESTS = [
  { n: 1, col: 'WF_CAHO', label: 'Cambio de horario' },
  { n: 2, col: 'WF_OLMA', label: 'Olvido de marcaje' },
  { n: 3, col: 'WF_MAHA', label: 'Marcaje hora actual' },
  { n: 4, col: 'WF_HDIA', label: 'Tiempos de incidencia' },
  { n: 5, col: 'WF_DCAB', label: 'Días de absentismo' },
  { n: 6, col: 'WF_VACA', label: 'Vacaciones' },
  { n: 7, col: 'WF_PEIN', label: 'Petición de incidencias' },
  { n: 8, col: 'WF_CAINMA', label: 'Cambio de incidencias en marcajes' },
  { n: 9, col: 'WF_HOIN', label: 'Horas de incidencia' },
  { n: 99, col: 'WF_ANUL', label: 'Anulación de solicitudes' }
] as const;

export interface WorkflowSettings {
  /** Código en WORKFLOW de la plantilla de cada rol. */
  templates: Record<WfRole, string>;
  /** Letra con la que empiezan los códigos de los perfiles creados (Q → Q01, Q02…). */
  prefix: string;
}
export const DEFAULT_WF_SETTINGS: WorkflowSettings = { templates: { EMPLEADO: '997', RESPONSABLE: '998', RRHH: '999' }, prefix: 'Q' };


export function sanitizeWfSettings(b: any): WorkflowSettings {
  const templates = {} as Record<WfRole, string>;
  for (const r of WF_ROLES) {
    const t = str(b?.templates?.[r], 10).toUpperCase();
    if (!t) throw new HttpError(400, `Indica la plantilla del rol ${r}`);
    templates[r] = t;
  }
  const prefix = str(b?.prefix, 5).toUpperCase();
  if (!/^[A-Z]$/.test(prefix)) throw new HttpError(400, 'El prefijo de los códigos tiene que ser una letra');
  if (Object.values(templates).some((t) => t.startsWith(prefix) && t.length === 3)) throw new HttpError(400, `Ninguna plantilla puede empezar por ${prefix}: se confundiría con los perfiles que crea Prime Suite`);
  return { templates, prefix };
}

/** Orden de validación de una solicitud: '' (no aparece), '0' (sin validación) o niveles 1-4 sin repetir, «4,2». */
export function cleanOrder(v: unknown, label = 'la solicitud') {
  const s = str(v, 20).replace(/\s+/g, '');
  if (s === '' || s === '0') return s;
  if (!/^[1-4](,[1-4]){0,3}$/.test(s)) throw new HttpError(400, `Orden de validación no válido en ${label}: usa los niveles 1 a 4 separados por comas, o 0 sin validación`);
  const parts = s.split(',');
  if (new Set(parts).size !== parts.length) throw new HttpError(400, `Orden de validación de ${label}: un nivel no puede repetirse`);
  return s;
}

/** Códigos de una lista de autorizadores («0000000001;0000000003»). */
export const levelCodes = (v: unknown) => String(v ?? '').split(/[;,]/).map((x) => x.trim()).filter(Boolean);

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Siguiente código libre: prefijo + 2 caracteres (Q01…Q09, Q0A…QZZ). */
export function nextProfileCode(prefix: string, taken: Set<string>) {
  for (let i = 1; i < ALPHABET.length ** 2; i++) {
    const c = `${prefix}${ALPHABET[Math.floor(i / ALPHABET.length)]}${ALPHABET[i % ALPHABET.length]}`;
    if (!taken.has(c)) return c;
  }
  return null;
}

/**
 * Cambios de un perfil desde la pantalla: autorizadores de los niveles 2 a 4 y orden de validación de cada solicitud.
 * El nivel 1 no se edita: lo calcula Prime Suite.
 */
export function sanitizeProfileEdit(b: any, known: Set<string>): WorkflowRow {
  const set: WorkflowRow = {};
  for (const [i, c] of WF_LEVEL_COLS.entries()) {
    if (i === 0 || b?.levels?.[c] === undefined) continue;
    const codes = Array.isArray(b.levels[c]) ? b.levels[c].map((x: unknown) => str(x, 20)).filter(Boolean) : levelCodes(b.levels[c]);
    for (const e of codes) if (!known.has(e)) throw new HttpError(400, `No existe el empleado ${e} (nivel ${i + 1})`);
    set[c] = [...new Set<string>(codes)].join(';');
  }
  for (const r of WF_REQUESTS) {
    if (b?.orders?.[r.col] === undefined) continue;
    set[r.col] = cleanOrder(b.orders[r.col], r.label);
  }
  return set;
}

/** Avisos de un perfil: solicitudes que pasan por niveles sin autorizadores. */
export function profileAlerts(row: WorkflowRow): string[] {
  const out: string[] = [];
  const empty = new Set(WF_LEVEL_COLS.map((c, i) => (levelCodes(row[c]).length ? 0 : i + 1)).filter(Boolean));
  for (const r of WF_REQUESTS) {
    const o = val(row, r.col);
    if (!o || o === '0') continue;
    const missing = o.split(',').map(Number).filter((n) => empty.has(n));
    if (missing.length) out.push(`${r.label}: pasa por el nivel ${missing.join(' y ')}, que no tiene autorizadores.`);
  }
  return out;
}

/** Perfil creado por Prime Suite: código y clave (JSON con rol, departamento, departamentos que ve y validadores a mano). */
export interface DynProfile { code: string; clave: string }
export interface DynKey { r: string; d: string; v: string[]; m: string[]; s?: string }
/** Asignación manual: V = esta persona la valida `valor` (empleado); D = este responsable valida además el departamento `valor`. */
export interface WfValida { employee: string; tipo: 'V' | 'D'; valor: string }
/** Datos de una persona que necesita el cálculo de perfiles (profile = EM_WFOP actual). */
export interface WorkflowPerson { code: string; name: string; active: boolean; department: string; workflowRol: string; profile: string }

export const parseKey = (clave: string): DynKey | null => {
  try { const k = JSON.parse(clave); return k && typeof k.r === 'string' ? { r: k.r, d: k.d || '', v: k.v || [], m: k.m || [], s: k.s } : null; } catch { return null; }
};
const keyOf = (k: DynKey) => JSON.stringify({ r: k.r, d: k.d, v: k.v, m: k.m, ...(k.s ? { s: k.s } : {}) });

/** Filtro de personal de un responsable: los departamentos que valida. */
export const deptFilter = (depts: string[]) => depts.map((d) => `EM_DEPA='${d.replace(/'/g, "''")}'`).join(' OR ');

/** Quién valida a cada persona y qué departamentos ve cada responsable (para la pantalla y para el cálculo). */
export function validationMap(people: WorkflowPerson[], valida: WfValida[]) {
  const exists = new Set(people.map((p) => p.code));
  const manual = new Map<string, string[]>();
  const extra = new Map<string, string[]>();
  for (const v of valida) {
    if (!exists.has(v.employee) || !v.valor) continue;
    const m = v.tipo === 'V' ? manual : extra;
    if (v.tipo === 'V' && !exists.has(v.valor)) continue;
    m.set(v.employee, [...new Set([...(m.get(v.employee) || []), v.valor])].sort());
  }
  /** Departamentos que valida cada responsable en alta: el suyo y los añadidos. */
  const validates = new Map<string, string[]>();
  const byDept = new Map<string, string[]>();
  for (const p of people) {
    if (!p.active || p.workflowRol !== 'RESPONSABLE') continue;
    const depts = [...new Set([p.department, ...(extra.get(p.code) || [])].filter(Boolean))].sort();
    validates.set(p.code, depts);
    for (const d of depts) byDept.set(d, [...(byDept.get(d) || []), p.code]);
  }
  for (const v of byDept.values()) v.sort();
  /** Nivel 1 de una persona: los validadores a mano o los responsables de su departamento (sin ella). */
  const level1 = (p: WorkflowPerson) => {
    const m = manual.get(p.code);
    if (m?.length) return { codes: m, manual: true, self: false };
    const all = p.department ? byDept.get(p.department) || [] : [];
    return { codes: all.filter((c) => c !== p.code), manual: false, self: all.includes(p.code) };
  };
  return { manual, extra, validates, byDept, level1 };
}

export interface WorkflowSyncResult {
  plan: WorkflowPlan;
  created: { code: string; name: string }[];
  updated: string[];
  removed: { code: string; name: string }[];
  assigned: number;
  warnings: string[];
}

/** Descripción del perfil (WF_DESC). */
export function profileDescription(k: DynKey, depts: Map<string, string>, people: Map<string, string>, max = 60) {
  const dn = (c: string) => depts.get(c) || c;
  const shortName = (c: string) => (people.get(c) || c).split(',')[0].trim();
  let d: string;
  if (k.r === 'RESPONSABLE') {
    const others = k.v.filter((x) => x !== k.d);
    d = `RESPONSABLE ${k.d ? dn(k.d) : 'SIN DPTO.'}${others.length ? ` +${others.length} DPTO.` : ''}`;
  } else d = `${k.d ? dn(k.d) : 'SIN DPTO.'} · ${k.r}`;
  if (k.m.length) d += ` · VALIDA ${k.m.map(shortName).join(', ')}`;
  return d.length > max ? d.slice(0, max - 1) + '…' : d;
}

/** Calcula los perfiles de Workflow por departamentos. Solo toca los perfiles registrados en PS_WF2PERFILES. */
export function planWorkflow(i: {
  people: WorkflowPerson[]; departments: { code: string; description: string }[]; valida: WfValida[];
  rows: WorkflowRow[]; dyn: DynProfile[]; settings: WorkflowSettings; descMax?: number | null;
  /** Perfiles de la versión anterior por equipos (PS_WFPERFILES): se quitan a quien no tiene rol y se borran cuando no los tiene nadie. */
  legacy?: string[];
}): WorkflowSyncResult {
  const rows = new Map(i.rows.map((r) => [val(r, 'WF_CODI'), r]));
  const depts = new Map(i.departments.map((d) => [d.code, d.description]));
  const names = new Map(i.people.map((p) => [p.code, p.name]));
  const dynByKey = new Map<string, DynProfile>();
  for (const d of i.dyn) { const k = parseKey(d.clave); if (k) dynByKey.set(keyOf(k), d); }
  const dynCodes = new Set(i.dyn.map((d) => d.code));
  const legacy = new Set(i.legacy || []);
  const taken = new Set<string>([...rows.keys(), ...dynCodes]);
  const plan: WorkflowPlan = { insert: [], update: [], remove: [], assign: [] };
  const res: WorkflowSyncResult = { plan, created: [], updated: [], removed: [], assigned: 0, warnings: [] };
  const assign = (p: WorkflowPerson, profile: string) => { if (p.profile !== profile) { plan.assign.push({ employee: p.code, profile }); res.assigned++; } };
  const vm = validationMap(i.people, i.valida);

  const groups = new Map<string, { key: DynKey; niv1: string[]; people: WorkflowPerson[] }>();
  for (const p of i.people) {
    if (!isWfRole(p.workflowRol)) {
      if (p.workflowRol) res.warnings.push(`${p.code} ${p.name}: el rol «${p.workflowRol}» no es EMPLEADO, RESPONSABLE ni RRHH; no se le asigna perfil.`);
      if (dynCodes.has(p.profile) || legacy.has(p.profile)) assign(p, '');
      continue;
    }
    const l1 = vm.level1(p);
    const key: DynKey = {
      r: p.workflowRol, d: p.department, v: p.workflowRol === 'RESPONSABLE' && p.active ? vm.validates.get(p.code) || [] : [],
      m: l1.manual ? l1.codes : [],
      // Responsable de su propio departamento sin validador a mano: su nivel 1 son los demás responsables, no él.
      ...(l1.self ? { s: p.code } : {})
    };
    const k = keyOf(key);
    const g = groups.get(k) || { key, niv1: l1.codes, people: [] };
    g.people.push(p);
    groups.set(k, g);
    if (p.active && !l1.codes.length) {
      res.warnings.push(l1.self
        ? `${p.code} ${p.name} es el único responsable de su departamento y nadie le valida: asígnale quién le valida.`
        : `${p.code} ${p.name}: nadie valida sus solicitudes (${p.department ? `ningún responsable valida el departamento ${depts.get(p.department) || p.department}` : 'no tiene departamento'}).`);
    }
  }

  const used = new Set<string>();
  for (const [k, { key, niv1, people }] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const managed: WorkflowRow = { WF_DESC: profileDescription(key, depts, names, i.descMax || 60), WF_NIV1: niv1.join(';') };
    if (key.r === 'RESPONSABLE' && key.v.length) { managed.WF_VFIL = 'S'; managed.WF_FILT = deptFilter(key.v); }
    if (key.r === 'RRHH') { managed.WF_VFIL = 'S'; managed.WF_FILT = ''; }
    const existing = dynByKey.get(k);
    if (existing && rows.has(existing.code)) {
      const cur = rows.get(existing.code)!;
      const set: WorkflowRow = {};
      for (const [c, v] of Object.entries(managed)) if (val(cur, c) !== (v ?? '')) set[c] = v;
      if (Object.keys(set).length) { plan.update.push({ code: existing.code, set }); res.updated.push(existing.code); }
      used.add(existing.code);
      for (const p of people) assign(p, existing.code);
      continue;
    }
    if (existing) plan.remove.push(existing.code);
    const tplCode = i.settings.templates[key.r as WfRole];
    const tpl = rows.get(tplCode);
    if (!tpl) { res.warnings.push(`No existe la plantilla ${tplCode} (${key.r}) en WORKFLOW: no se ha creado el perfil ${managed.WF_DESC} para ${people.length} persona(s).`); continue; }
    const code = nextProfileCode(i.settings.prefix, taken);
    if (!code) { res.warnings.push(`No quedan códigos libres con el prefijo ${i.settings.prefix}.`); continue; }
    taken.add(code);
    const row: WorkflowRow = { ...tpl, WF_CODI: code, WF_NIV2: '', WF_NIV3: '', WF_NIV4: '', ...managed };
    for (const r of WF_REQUESTS) if (!val(tpl, r.col)) row[r.col] = '1';
    plan.insert.push({ code, row, key: { clave: k } });
    res.created.push({ code, name: String(managed.WF_DESC) });
    used.add(code);
    for (const p of people) assign(p, code);
  }
  for (const d of i.dyn) {
    if (used.has(d.code) || plan.remove.includes(d.code)) continue;
    plan.remove.push(d.code);
    if (rows.has(d.code)) res.removed.push({ code: d.code, name: val(rows.get(d.code), 'WF_DESC') });
  }
  // Perfiles de la versión por equipos que, tras los cambios, ya no tiene nadie.
  if (legacy.size) {
    const after = new Map(i.people.map((p) => [p.code, p.profile]));
    for (const a of plan.assign) after.set(a.employee, a.profile);
    const still = new Set(after.values());
    plan.removeLegacy = [...legacy].filter((c) => !still.has(c));
    for (const c of plan.removeLegacy) if (rows.has(c)) res.removed.push({ code: c, name: val(rows.get(c), 'WF_DESC') });
  }
  return res;
}

/** Asignaciones manuales de una persona desde la pantalla: quién la valida y departamentos de más que valida. */
export function sanitizeValidation(b: any, opts: { people: Set<string>; departments: Set<string> | null; code: string }) {
  const list = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => (typeof x === 'string' ? x.trim().toUpperCase() : '')).filter(Boolean);
  const manual = [...new Set(list(b?.manual))];
  for (const m of manual) {
    if (!opts.people.has(m)) throw new HttpError(400, `No existe el empleado ${m}`);
    if (m === opts.code) throw new HttpError(400, 'Una persona no puede validarse a sí misma');
  }
  const depts = [...new Set(list(b?.depts))];
  if (opts.departments) for (const d of depts) if (!opts.departments.has(d)) throw new HttpError(400, `No existe el departamento ${d}`);
  return { manual, depts };
}

/** Script para crear PS_WF2PERFILES y PS_WF2VALIDA en la base de datos de Evalos 8. */
export function workflowSql(schema = 'dbo') {
  const s = `[${(schema || 'dbo').replace(/]/g, ']]')}]`;
  return `-- Atajos de Evalos (Prime Suite) · Perfiles Workflow (por departamentos)
-- Crea las tablas de perfiles de Workflow gestionados y de asignaciones manuales. Se puede ejecutar varias veces: solo crea lo que falta.
-- Necesita además en PERSONAL la columna EM_WORKFLOWROL .
--
-- ${WF_PERFILES_TABLE}: perfiles de WORKFLOW creados por Prime Suite (los demás perfiles no se tocan nunca).
--   WQ_CODI   código del perfil (WORKFLOW.WF_CODI)
--   WQ_CLAVE  rol, departamento, departamentos que ve y validadores asignados a mano (JSON)
--
-- ${WF_VALIDA_TABLE}: asignaciones manuales.
--   WV_EMPL   empleado (PERSONAL.EM_CODI)
--   WV_TIPO   V = WV_VALOR (empleado) valida a esta persona; D = este responsable valida además el departamento WV_VALOR
--   WV_VALOR  código de empleado o de departamento

IF OBJECT_ID(N'${s}.[${WF_PERFILES_TABLE}]', N'U') IS NULL
BEGIN
  CREATE TABLE ${s}.[${WF_PERFILES_TABLE}] (
    WQ_CODI  nvarchar(3)    NOT NULL,
    WQ_CLAVE nvarchar(2000) NOT NULL,
    CONSTRAINT PK_${WF_PERFILES_TABLE} PRIMARY KEY (WQ_CODI)
  );
END;

IF OBJECT_ID(N'${s}.[${WF_VALIDA_TABLE}]', N'U') IS NULL
BEGIN
  CREATE TABLE ${s}.[${WF_VALIDA_TABLE}] (
    WV_EMPL  nvarchar(20) NOT NULL,
    WV_TIPO  nchar(1)     NOT NULL,
    WV_VALOR nvarchar(20) NOT NULL,
    CONSTRAINT PK_${WF_VALIDA_TABLE} PRIMARY KEY (WV_EMPL, WV_TIPO, WV_VALOR)
  );
END;
`;
}
