// Atajos de Evalos · Perfiles Workflow 2 (por departamentos, sin equipos).
//
// Alternativa paralela a Perfiles Workflow (equipos). Solo una de las dos está activa: es la que recalcula EM_WFOP.
//   - Cada persona tiene su departamento (EM_DEPA) y su rol (EM_WORKFLOWROL: EMPLEADO, RESPONSABLE o RRHH).
//   - RESPONSABLE valida las solicitudes de su departamento y, si se le añaden, de otros departamentos.
//   - Nivel 1 de una persona = los responsables (en alta) que validan su departamento, sin contarse a sí misma;
//     o, si se le asigna a mano, quien la valida (típico: el jefe de departamento lo valida un superior).
//   - El responsable ve a la gente de los departamentos que valida (WF_FILT = EM_DEPA='A' OR EM_DEPA='B');
//     RRHH ve a todo el personal; EMPLEADO, lo de su plantilla.
//   - Se crea un perfil (copia de la plantilla del rol, código Q01, Q02…) por cada combinación de rol + departamento
//     + departamentos que valida + validadores asignados a mano. Se registran en PS_WF2PERFILES con esa clave.
//   - Las asignaciones manuales (validadores de una persona y departamentos de más de un responsable) están en PS_WF2VALIDA.
//   - Niveles 2 a 4 y el orden de validación de cada solicitud se editan en la pantalla y se conservan al recalcular.
import { HttpError } from '../http.ts';
import type { WorkflowPlan, WorkflowRow } from './types.ts';
import { WF_REQUESTS, isWfRole, nextProfileCode, type WfRole, type WorkflowSettings } from './workflow.ts';

export const WF2_PERFILES_TABLE = 'PS_WF2PERFILES';
export const WF2_VALIDA_TABLE = 'PS_WF2VALIDA';
/** Modo activo de Perfiles Workflow: con equipos (1) o con departamentos (2). */
export type WorkflowMode = 'equipos' | 'departamentos';
export const DEFAULT_WF2_SETTINGS: WorkflowSettings = { templates: { EMPLEADO: '997', RESPONSABLE: '998', RRHH: '999' }, prefix: 'Q' };

/** Perfil creado por Perfiles Workflow 2: código y clave (JSON con rol, departamento, departamentos que ve y validadores a mano). */
export interface Dyn2Profile { code: string; clave: string }
export interface Dyn2Key { r: string; d: string; v: string[]; m: string[]; s?: string }
/** Asignación manual: V = esta persona la valida `valor` (empleado); D = este responsable valida además el departamento `valor`. */
export interface WfValida { employee: string; tipo: 'V' | 'D'; valor: string }
export interface Wf2Person { code: string; name: string; active: boolean; department: string; workflowRol: string; profile: string }

export const parseKey = (clave: string): Dyn2Key | null => {
  try { const k = JSON.parse(clave); return k && typeof k.r === 'string' ? { r: k.r, d: k.d || '', v: k.v || [], m: k.m || [], s: k.s } : null; } catch { return null; }
};
const keyOf = (k: Dyn2Key) => JSON.stringify({ r: k.r, d: k.d, v: k.v, m: k.m, ...(k.s ? { s: k.s } : {}) });
const val = (r: WorkflowRow | undefined, c: string) => (r?.[c] == null ? '' : String(r[c]).trim());

/** Filtro de personal de un responsable: los departamentos que valida. */
export const deptFilter = (depts: string[]) => depts.map((d) => `EM_DEPA='${d.replace(/'/g, "''")}'`).join(' OR ');

/** Quién valida a cada persona y qué departamentos ve cada responsable (para la pantalla y para el cálculo). */
export function validationMap(people: Wf2Person[], valida: WfValida[]) {
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
  const level1 = (p: Wf2Person) => {
    const m = manual.get(p.code);
    if (m?.length) return { codes: m, manual: true, self: false };
    const all = p.department ? byDept.get(p.department) || [] : [];
    return { codes: all.filter((c) => c !== p.code), manual: false, self: all.includes(p.code) };
  };
  return { manual, extra, validates, byDept, level1 };
}

export interface Workflow2SyncResult {
  plan: WorkflowPlan;
  created: { code: string; name: string }[];
  updated: string[];
  removed: { code: string; name: string }[];
  assigned: number;
  warnings: string[];
}

/** Descripción del perfil (WF_DESC). */
export function profile2Description(k: Dyn2Key, depts: Map<string, string>, people: Map<string, string>, max = 60) {
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
export function planWorkflow2(i: {
  people: Wf2Person[]; departments: { code: string; description: string }[]; valida: WfValida[];
  rows: WorkflowRow[]; dyn: Dyn2Profile[]; settings: WorkflowSettings; descMax?: number | null;
}): Workflow2SyncResult {
  const rows = new Map(i.rows.map((r) => [val(r, 'WF_CODI'), r]));
  const depts = new Map(i.departments.map((d) => [d.code, d.description]));
  const names = new Map(i.people.map((p) => [p.code, p.name]));
  const dynByKey = new Map<string, Dyn2Profile>();
  for (const d of i.dyn) { const k = parseKey(d.clave); if (k) dynByKey.set(keyOf(k), d); }
  const dynCodes = new Set(i.dyn.map((d) => d.code));
  const taken = new Set<string>([...rows.keys(), ...dynCodes]);
  const plan: WorkflowPlan = { insert: [], update: [], remove: [], assign: [] };
  const res: Workflow2SyncResult = { plan, created: [], updated: [], removed: [], assigned: 0, warnings: [] };
  const assign = (p: Wf2Person, profile: string) => { if (p.profile !== profile) { plan.assign.push({ employee: p.code, profile }); res.assigned++; } };
  const vm = validationMap(i.people, i.valida);

  const groups = new Map<string, { key: Dyn2Key; niv1: string[]; people: Wf2Person[] }>();
  for (const p of i.people) {
    if (!isWfRole(p.workflowRol)) {
      if (p.workflowRol) res.warnings.push(`${p.code} ${p.name}: el rol «${p.workflowRol}» no es EMPLEADO, RESPONSABLE ni RRHH; no se le asigna perfil.`);
      if (dynCodes.has(p.profile)) assign(p, '');
      continue;
    }
    const l1 = vm.level1(p);
    const key: Dyn2Key = {
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
    const managed: WorkflowRow = { WF_DESC: profile2Description(key, depts, names, i.descMax || 60), WF_NIV1: niv1.join(';') };
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
export function workflow2Sql(schema = 'dbo') {
  const s = `[${(schema || 'dbo').replace(/]/g, ']]')}]`;
  return `-- Atajos de Evalos (Prime Suite) · Perfiles Workflow 2 (por departamentos)
-- Crea las tablas de perfiles de Workflow gestionados y de asignaciones manuales. Se puede ejecutar varias veces: solo crea lo que falta.
-- Necesita además en PERSONAL la columna EM_WORKFLOWROL (la misma que Perfiles Workflow).
--
-- ${WF2_PERFILES_TABLE}: perfiles de WORKFLOW creados por Perfiles Workflow 2 (los demás perfiles no se tocan nunca).
--   WQ_CODI   código del perfil (WORKFLOW.WF_CODI)
--   WQ_CLAVE  rol, departamento, departamentos que ve y validadores asignados a mano (JSON)
--
-- ${WF2_VALIDA_TABLE}: asignaciones manuales.
--   WV_EMPL   empleado (PERSONAL.EM_CODI)
--   WV_TIPO   V = WV_VALOR (empleado) valida a esta persona; D = este responsable valida además el departamento WV_VALOR
--   WV_VALOR  código de empleado o de departamento

IF OBJECT_ID(N'${s}.[${WF2_PERFILES_TABLE}]', N'U') IS NULL
BEGIN
  CREATE TABLE ${s}.[${WF2_PERFILES_TABLE}] (
    WQ_CODI  nvarchar(3)    NOT NULL,
    WQ_CLAVE nvarchar(2000) NOT NULL,
    CONSTRAINT PK_${WF2_PERFILES_TABLE} PRIMARY KEY (WQ_CODI)
  );
END;

IF OBJECT_ID(N'${s}.[${WF2_VALIDA_TABLE}]', N'U') IS NULL
BEGIN
  CREATE TABLE ${s}.[${WF2_VALIDA_TABLE}] (
    WV_EMPL  nvarchar(20) NOT NULL,
    WV_TIPO  nchar(1)     NOT NULL,
    WV_VALOR nvarchar(20) NOT NULL,
    CONSTRAINT PK_${WF2_VALIDA_TABLE} PRIMARY KEY (WV_EMPL, WV_TIPO, WV_VALOR)
  );
END;
`;
}
