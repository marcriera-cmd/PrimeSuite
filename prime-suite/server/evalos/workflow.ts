// Atajos de Evalos · Perfiles Workflow.
//
// Cada persona tiene en PERSONAL tres campos que pone Prime Suite:
//   EM_EQUIPO       equipo al que pertenece (PS_EQUIPOS)
//   EM_VALEQUIPO    equipo cuyas solicitudes valida ('' = ninguno)
//   EM_WORKFLOWROL  EMPLEADO, RESPONSABLE o RRHH ('' = su perfil no lo gestiona Prime Suite)
// A partir de ellos se calcula su perfil de Workflow (tabla WORKFLOW de Evalos 8) y se escribe en EM_WFOP:
//   - Un perfil por combinación de equipo + rol (+ equipo que valida, para RESPONSABLE). Se crea copiando la fila
//     de la plantilla de su rol (por defecto 997 EMPLEADO, 998 RESPONSABLE, 999 RRHH) con código P01, P02…
//   - Nivel 1 (WF_NIV1) = las personas en alta que validan el equipo de quien pide (códigos separados por «;»).
//   - RESPONSABLE: ve a la gente del equipo que valida (WF_VFIL = S, WF_FILT = EM_EQUIPO='X').
//     RRHH: ve a todo el personal (WF_VFIL = S, WF_FILT vacío). EMPLEADO: lo que diga su plantilla.
//   - Niveles 2 a 4 y el orden de validación de cada solicitud se editan en la pantalla y se conservan al recalcular.
//   - Los perfiles que se quedan sin nadie se borran (solo los creados por Prime Suite, registrados en PS_WFPERFILES).
import { HttpError } from '../http.ts';
import type { DynProfile, Equipo, WorkflowPerson, WorkflowPlan, WorkflowRow } from './types.ts';

export const WF_ROLES = ['EMPLEADO', 'RESPONSABLE', 'RRHH'] as const;
export type WfRole = (typeof WF_ROLES)[number];
export const isWfRole = (v: unknown): v is WfRole => typeof v === 'string' && (WF_ROLES as readonly string[]).includes(v);

export const EQUIPOS_TABLE = 'PS_EQUIPOS';
export const WFPERFILES_TABLE = 'PS_WFPERFILES';
export const EQUIPO_CODE_MAX = 20;
export const EQUIPO_NAME_MAX = 60;
/** Columnas de PERSONAL. */
export const WF_PERSONAL_COLUMNS = { equipo: 'EM_EQUIPO', valEquipo: 'EM_VALEQUIPO', workflowRol: 'EM_WORKFLOWROL' } as const;

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
  /** Letra con la que empiezan los códigos de los perfiles creados (P → P01, P02…). */
  prefix: string;
}
export const DEFAULT_WF_SETTINGS: WorkflowSettings = { templates: { EMPLEADO: '997', RESPONSABLE: '998', RRHH: '999' }, prefix: 'P' };

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const val = (r: WorkflowRow | undefined, c: string) => (r?.[c] == null ? '' : String(r[c]).trim());

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

/** Código de equipo: letras, números, guion y guion bajo, en mayúsculas (va dentro del filtro EM_EQUIPO='…'). */
export function cleanEquipoCode(v: unknown, max: number | null) {
  const s = str(v, 100).toUpperCase();
  if (!s) throw new HttpError(400, 'El código del equipo es obligatorio');
  if (!/^[A-Z0-9_-]+$/.test(s)) throw new HttpError(400, 'El código del equipo solo admite letras, números, guion y guion bajo');
  const m = Math.min(EQUIPO_CODE_MAX, max || EQUIPO_CODE_MAX);
  if (s.length > m) throw new HttpError(400, `El código del equipo admite como máximo ${m} caracteres`);
  return s;
}
export function cleanEquipoName(v: unknown, uppercase: boolean) {
  let s = str(v, 200).replace(/\s+/g, ' ');
  if (uppercase) s = s.toLocaleUpperCase('es-ES');
  if (!s) throw new HttpError(400, 'El nombre del equipo es obligatorio');
  if (s.length > EQUIPO_NAME_MAX) throw new HttpError(400, `El nombre del equipo admite como máximo ${EQUIPO_NAME_MAX} caracteres`);
  return s;
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

/** Filtro de personal de un responsable: la gente del equipo que valida. */
export const teamFilter = (equipo: string) => `${WF_PERSONAL_COLUMNS.equipo}='${equipo.replace(/'/g, "''")}'`;

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Siguiente código libre: prefijo + 2 caracteres (P01…P09, P0A…PZZ). */
export function nextProfileCode(prefix: string, taken: Set<string>) {
  for (let i = 1; i < ALPHABET.length ** 2; i++) {
    const c = `${prefix}${ALPHABET[Math.floor(i / ALPHABET.length)]}${ALPHABET[i % ALPHABET.length]}`;
    if (!taken.has(c)) return c;
  }
  return null;
}

/** Clave del perfil de una persona: equipo + rol (+ equipo que valida, solo RESPONSABLE). */
export function profileKey(p: Pick<WorkflowPerson, 'equipo' | 'valEquipo' | 'workflowRol'>): Omit<DynProfile, 'code'> {
  return { equipo: p.equipo, rol: p.workflowRol, valEquipo: p.workflowRol === 'RESPONSABLE' ? p.valEquipo : '' };
}
const keyStr = (k: Omit<DynProfile, 'code'>) => `${k.equipo}|${k.rol}|${k.valEquipo}`;

/** Descripción del perfil (WF_DESC): «VENTAS · EMPLEADO», «DIRECCIÓN · RESPONSABLE DE VENTAS». */
export function profileDescription(k: Omit<DynProfile, 'code'>, names: Map<string, string>, max = 60) {
  const n = (c: string) => names.get(c) || c;
  const team = k.equipo ? n(k.equipo) : 'SIN EQUIPO';
  const rol = k.rol === 'RESPONSABLE' && k.valEquipo ? `RESPONSABLE DE ${n(k.valEquipo)}` : k.rol;
  const d = `${team} · ${rol}`;
  return d.length > max ? d.slice(0, max - 1) + '…' : d;
}

export interface WorkflowSyncResult {
  plan: WorkflowPlan;
  created: { code: string; name: string }[];
  updated: string[];
  removed: { code: string; name: string }[];
  /** Personas a las que cambia el perfil (EM_WFOP). */
  assigned: number;
  warnings: string[];
}

/**
 * Calcula los cambios para que cada persona con rol tenga su perfil y cada perfil tenga sus autorizadores de nivel 1.
 * No toca perfiles que no haya creado Prime Suite (los que no están en PS_WFPERFILES), salvo para copiar plantillas.
 */
export function planWorkflow(i: { people: WorkflowPerson[]; equipos: Equipo[]; rows: WorkflowRow[]; dyn: DynProfile[]; settings: WorkflowSettings; descMax?: number | null }): WorkflowSyncResult {
  const rows = new Map(i.rows.map((r) => [val(r, 'WF_CODI'), r]));
  const names = new Map(i.equipos.map((e) => [e.code, e.name]));
  const dynByKey = new Map(i.dyn.map((d) => [keyStr(d), d]));
  const dynCodes = new Set(i.dyn.map((d) => d.code));
  const taken = new Set<string>([...rows.keys(), ...dynCodes]);
  const plan: WorkflowPlan = { insert: [], update: [], remove: [], assign: [] };
  const res: WorkflowSyncResult = { plan, created: [], updated: [], removed: [], assigned: 0, warnings: [] };
  const assign = (p: WorkflowPerson, profile: string) => { if (p.profile !== profile) { plan.assign.push({ employee: p.code, profile }); res.assigned++; } };

  // Validadores de cada equipo: personas en alta con ese equipo en EM_VALEQUIPO.
  const validators = new Map<string, string[]>();
  for (const p of i.people) if (p.active && p.valEquipo) validators.set(p.valEquipo, [...(validators.get(p.valEquipo) || []), p.code]);
  for (const v of validators.values()) v.sort();

  // Personas por perfil deseado.
  const groups = new Map<string, { key: Omit<DynProfile, 'code'>; people: WorkflowPerson[] }>();
  for (const p of i.people) {
    if (!isWfRole(p.workflowRol)) {
      if (p.workflowRol) res.warnings.push(`${p.code} ${p.name}: el rol «${p.workflowRol}» no es EMPLEADO, RESPONSABLE ni RRHH; no se le asigna perfil.`);
      // Sin rol: deja de usar el perfil creado por Prime Suite que tuviera.
      if (dynCodes.has(p.profile)) assign(p, '');
      continue;
    }
    const key = profileKey(p);
    const g = groups.get(keyStr(key)) || { key, people: [] };
    g.people.push(p);
    groups.set(keyStr(key), g);
  }

  const used = new Set<string>();
  const unknownTeams = new Set<string>();
  for (const { key, people } of [...groups.values()].sort((a, b) => keyStr(a.key).localeCompare(keyStr(b.key)))) {
    const label = profileDescription(key, names, 200);
    const niv1 = key.equipo ? (validators.get(key.equipo) || []).join(';') : '';
    for (const t of [key.equipo, key.valEquipo]) if (t && !names.has(t)) unknownTeams.add(t);
    if (!key.equipo) res.warnings.push(`${people.length} persona(s) con rol ${key.rol} sin equipo: nadie valida sus solicitudes.`);
    else if (!niv1) res.warnings.push(`Nadie en alta valida el equipo ${names.get(key.equipo) || key.equipo}: las solicitudes de ${label} no tienen autorizador de nivel 1.`);
    if (key.rol === 'RESPONSABLE' && !key.valEquipo) res.warnings.push(`${people.length} responsable(s) del equipo ${names.get(key.equipo) || key.equipo || '(sin equipo)'} sin equipo que validar: su perfil usa el filtro de personal de la plantilla.`);

    const managed: WorkflowRow = { WF_DESC: profileDescription(key, names, i.descMax || 60), WF_NIV1: niv1 };
    if (key.rol === 'RESPONSABLE' && key.valEquipo) { managed.WF_VFIL = 'S'; managed.WF_FILT = teamFilter(key.valEquipo); }
    if (key.rol === 'RRHH') { managed.WF_VFIL = 'S'; managed.WF_FILT = ''; }

    const existing = dynByKey.get(keyStr(key));
    if (existing && rows.has(existing.code)) {
      const cur = rows.get(existing.code)!;
      const set: WorkflowRow = {};
      for (const [c, v] of Object.entries(managed)) if (val(cur, c) !== (v ?? '')) set[c] = v;
      if (Object.keys(set).length) { plan.update.push({ code: existing.code, set }); res.updated.push(existing.code); }
      used.add(existing.code);
      for (const p of people) assign(p, existing.code);
      continue;
    }
    // Registrado pero alguien borró su fila de WORKFLOW: se da de baja el registro y se crea de nuevo.
    if (existing) plan.remove.push(existing.code);

    const tplCode = i.settings.templates[key.rol as WfRole];
    const tpl = rows.get(tplCode);
    if (!tpl) {
      res.warnings.push(`No existe la plantilla ${tplCode} (${key.rol}) en WORKFLOW: no se ha podido crear el perfil ${label} para ${people.length} persona(s).`);
      continue;
    }
    const code = nextProfileCode(i.settings.prefix, taken);
    if (!code) { res.warnings.push(`No quedan códigos libres con el prefijo ${i.settings.prefix}: no se ha creado el perfil ${label}.`); continue; }
    taken.add(code);
    const row: WorkflowRow = { ...tpl, WF_CODI: code, WF_NIV2: '', WF_NIV3: '', WF_NIV4: '', ...managed };
    // Por defecto, todas las solicitudes con un nivel (las que la plantilla deja vacías).
    for (const r of WF_REQUESTS) if (!val(tpl, r.col)) row[r.col] = '1';
    plan.insert.push({ code, row, key });
    res.created.push({ code, name: String(managed.WF_DESC) });
    used.add(code);
    for (const p of people) assign(p, code);
  }
  if (unknownTeams.size) res.warnings.push(`Equipos que no existen en PS_EQUIPOS: ${[...unknownTeams].join(', ')}.`);
  for (const p of i.people) if (p.active && p.valEquipo && p.valEquipo === p.equipo && isWfRole(p.workflowRol))
    res.warnings.push(`${p.code} ${p.name} valida su propio equipo: aprobará también sus propias solicitudes.`);

  // Perfiles creados por Prime Suite que ya no usa nadie: se borran.
  for (const d of i.dyn) {
    if (used.has(d.code) || plan.remove.includes(d.code)) continue;
    plan.remove.push(d.code);
    if (rows.has(d.code)) res.removed.push({ code: d.code, name: val(rows.get(d.code), 'WF_DESC') });
  }
  return res;
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

/** Script para crear PS_EQUIPOS y PS_WFPERFILES en la base de datos de Evalos 8. */
export function workflowSql(schema = 'dbo') {
  const s = `[${(schema || 'dbo').replace(/]/g, ']]')}]`;
  return `-- Atajos de Evalos (Prime Suite) · Perfiles Workflow
-- Crea las tablas de equipos y de perfiles de Workflow gestionados. Se puede ejecutar varias veces: solo crea lo que falta.
-- Necesita además en PERSONAL las columnas EM_EQUIPO, EM_VALEQUIPO y EM_WORKFLOWROL.
--
-- ${EQUIPOS_TABLE}: equipos de trabajo.
--   EQ_CODI  código del equipo (PERSONAL.EM_EQUIPO y PERSONAL.EM_VALEQUIPO)
--   EQ_DESC  nombre
--
-- ${WFPERFILES_TABLE}: perfiles de WORKFLOW creados por Prime Suite (los demás perfiles no se tocan nunca).
--   WP_CODI      código del perfil (WORKFLOW.WF_CODI)
--   WP_EQUIPO    equipo de las personas que lo tienen
--   WP_ROL       EMPLEADO, RESPONSABLE o RRHH
--   WP_VALEQUIPO equipo que validan (solo RESPONSABLE)

IF OBJECT_ID(N'${s}.[${EQUIPOS_TABLE}]', N'U') IS NULL
BEGIN
  CREATE TABLE ${s}.[${EQUIPOS_TABLE}] (
    EQ_CODI nvarchar(${EQUIPO_CODE_MAX}) NOT NULL,
    EQ_DESC nvarchar(${EQUIPO_NAME_MAX}) NOT NULL,
    CONSTRAINT PK_${EQUIPOS_TABLE} PRIMARY KEY (EQ_CODI)
  );
END;

IF OBJECT_ID(N'${s}.[${WFPERFILES_TABLE}]', N'U') IS NULL
BEGIN
  CREATE TABLE ${s}.[${WFPERFILES_TABLE}] (
    WP_CODI      nvarchar(3)  NOT NULL,
    WP_EQUIPO    nvarchar(${EQUIPO_CODE_MAX}) NOT NULL CONSTRAINT DF_${WFPERFILES_TABLE}_EQUIPO DEFAULT (''),
    WP_ROL       nvarchar(15) NOT NULL,
    WP_VALEQUIPO nvarchar(${EQUIPO_CODE_MAX}) NOT NULL CONSTRAINT DF_${WFPERFILES_TABLE}_VALEQUIPO DEFAULT (''),
    CONSTRAINT PK_${WFPERFILES_TABLE} PRIMARY KEY (WP_CODI)
  );
END;
`;
}
