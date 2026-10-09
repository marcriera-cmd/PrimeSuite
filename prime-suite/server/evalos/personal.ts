// Atajos de Evalos · Personal: validación y normalización de la ficha de empleado (tabla PERSONAL).
// Se usa en las rutas antes de llamar al driver; el driver ya recibe los datos limpios.
import { HttpError } from '../http.ts';
import type { HistoryValue, NewNames, OrgKind, ReadmitInput, PersonalInput, PersonalLimits, PersonalLookupKey, PersonalLookups } from './types.ts';
import { ORG_KINDS } from './history.ts';

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Código de empleado: siempre 10 dígitos, con ceros a la izquierda si se escriben menos (la tarjeta, en cleanCard). */
export const CODE_DIGITS = 10;
export function padDigits(v: unknown, label: string, required = true) {
  const s = str(v, 200).replace(/\s+/g, '');
  if (!s) {
    if (required) throw new HttpError(400, `${label} es obligatori${label.startsWith('La') ? 'a' : 'o'}`);
    return '';
  }
  if (!/^\d+$/.test(s)) throw new HttpError(400, `${label} solo admite números (${CODE_DIGITS} dígitos)`);
  if (s.length > CODE_DIGITS) throw new HttpError(400, `${label} admite como máximo ${CODE_DIGITS} dígitos`);
  return s.padStart(CODE_DIGITS, '0');
}

function cleanCode(v: unknown, _upper: boolean, max: number | null) {
  const s = padDigits(v, 'El código');
  if (max && s.length > max) throw new HttpError(400, `El código admite como máximo ${max} caracteres en esta base de datos`);
  return s;
}

const LOOKUP_LABEL: Record<PersonalLookupKey, string> = {
  company: 'La empresa', department: 'El departamento', section: 'La sección', area: 'El área', consultas: 'El perfil de consultas', solicitudes: 'El perfil de solicitudes'
};
const FIELD_LABEL: Partial<Record<keyof PersonalInput, string>> = { name: 'El nombre', card: 'La tarjeta', email: 'El email' };

function validIsoDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Código de tarjeta: obligatorio, letras y números en mayúsculas, 10 caracteres con ceros a la izquierda. */
export function cleanCard(v: unknown, max: number | null) {
  const card = str(v, 200).replace(/\s+/g, '').toUpperCase();
  if (!card) throw new HttpError(400, 'La tarjeta es obligatoria');
  if (!/^[A-Z0-9]+$/.test(card)) throw new HttpError(400, `La tarjeta solo admite letras y números (${CODE_DIGITS} caracteres)`);
  if (card.length > CODE_DIGITS) throw new HttpError(400, `La tarjeta admite como máximo ${CODE_DIGITS} caracteres`);
  const padded = card.padStart(CODE_DIGITS, '0');
  if (max && padded.length > max) throw new HttpError(400, `La tarjeta admite como máximo ${max} caracteres en esta base de datos`);
  return padded;
}

/** Fecha AAAA-MM-DD obligatoria. */
export function cleanIsoDate(v: unknown, label: string) {
  const s = str(v, 10);
  if (!s) throw new HttpError(400, `${label} es obligatoria`);
  if (!validIsoDate(s)) throw new HttpError(400, `${label} no es válida`);
  return s;
}

/** Valida y normaliza una ficha de empleado. Obligatorios: código, nombre y alta; y la tarjeta, solo en el alta. */
export function sanitizePersonal(b: any, opts: { uppercase: boolean; limits: PersonalLimits; lookups: PersonalLookups; code?: string }): PersonalInput {
  const { uppercase, limits, lookups } = opts;
  const len = (k: keyof PersonalInput, v: string) => {
    const max = limits[k];
    if (max && v.length > max) throw new HttpError(400, `${FIELD_LABEL[k] || LOOKUP_LABEL[k as PersonalLookupKey] || 'El campo'} admite como máximo ${max} caracteres`);
    return v;
  };
  const code = opts.code ?? cleanCode(b.code, uppercase, limits.code ?? null);

  let name = str(b.name, 500).replace(/\s+/g, ' ');
  if (uppercase) name = name.toLocaleUpperCase('es-ES');
  if (!name) throw new HttpError(400, 'El nombre es obligatorio');
  len('name', name);

  // La tarjeta solo se pide en el alta; después se gestiona con asignar/desasignar.
  const card = opts.code === undefined ? cleanCard(b.card, limits.card ?? null) : '';

  const email = str(b.email, 300);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'El email no tiene un formato válido');
  len('email', email);

  const hireDate = str(b.hireDate, 10);
  if (!hireDate) throw new HttpError(400, 'La fecha de alta es obligatoria');
  if (!validIsoDate(hireDate)) throw new HttpError(400, 'La fecha de alta no es válida');
  const endDate = str(b.endDate, 10);
  if (endDate && !validIsoDate(endDate)) throw new HttpError(400, 'La fecha de baja no es válida');
  if (endDate && endDate < hireDate) throw new HttpError(400, 'La fecha de baja no puede ser anterior a la de alta');

  // Desplegables: el valor tiene que existir en su tabla de Evalos (si la tabla existe).
  const pick = (k: PersonalLookupKey) => {
    const v = str(b[k], 100);
    if (!v) return '';
    const list = lookups[k];
    // Consultas (KIOSKO) y Solicitudes (WORKFLOW) solo admiten valores ya creados en Evalos.
    if (!list && (k === 'consultas' || k === 'solicitudes')) throw new HttpError(400, `${LOOKUP_LABEL[k]} no se puede asignar: la tabla no existe en esta instalación de Evalos`);
    if (list && !list.some((x) => x.code === v)) throw new HttpError(400, `${LOOKUP_LABEL[k]} ${v} no existe en Evalos`);
    return len(k, v);
  };
  return {
    code, name, card, email, hireDate, endDate,
    company: pick('company'), department: pick('department'), section: pick('section'), area: pick('area'),
    consultas: pick('consultas'), solicitudes: pick('solicitudes')
  };
}

/** Nombre de un valor nuevo (empresa, departamento…): espacios normalizados, mayúsculas si se configura así. */
function cleanName(v: unknown, uppercase: boolean) {
  let s = str(v, 300).replace(/\s+/g, ' ');
  if (uppercase) s = s.toLocaleUpperCase('es-ES');
  if (s.length > 100) throw new HttpError(400, 'El nombre admite como máximo 100 caracteres');
  return s;
}

/** Busca un valor existente por código o por nombre (sin distinguir mayúsculas). */
function findExisting(list: { code: string; description: string }[] | null, text: string) {
  if (!list) return undefined;
  const t = text.toUpperCase();
  return list.find((x) => x.code.toUpperCase() === t) || list.find((x) => x.description.toUpperCase() === t);
}

/**
 * Nombres escritos a mano en el alta para empresa, departamento, sección y área. Si coinciden con un valor
 * existente (por nombre o código) se usa su código en la ficha; si no, se devuelven para crearlos.
 */
export function sanitizeNewNames(raw: any, emp: PersonalInput, opts: { uppercase: boolean; lookups: PersonalLookups }): NewNames {
  const out: NewNames = {};
  for (const k of ORG_KINDS) {
    if (emp[k]) continue;
    const name = cleanName(raw?.[k], opts.uppercase);
    if (!name) continue;
    const hit = findExisting(opts.lookups[k], name);
    if (hit) emp[k] = hit.code;
    else if (!opts.lookups[k]) throw new HttpError(409, `${LOOKUP_LABEL[k]} no se puede crear: la tabla no existe en esta instalación de Evalos.`);
    else out[k] = name;
  }
  return out;
}

/** Valor para cambiar empresa/departamento/sección/área desde la ficha: código existente o nombre nuevo. */
export function sanitizeOrgValue(b: any, k: OrgKind, opts: { uppercase: boolean; lookups: PersonalLookups }): HistoryValue {
  const code = str(b.code, 100);
  if (code) {
    if (opts.lookups[k] && !opts.lookups[k]!.some((x) => x.code === code)) throw new HttpError(400, `${LOOKUP_LABEL[k]} ${code} no existe en Evalos`);
    return { code };
  }
  const name = cleanName(b.name, opts.uppercase);
  if (!name) throw new HttpError(400, `Indica ${LOOKUP_LABEL[k].toLowerCase()}`);
  const hit = findExisting(opts.lookups[k], name);
  return hit ? { code: hit.code } : { name };
}

/**
 * Volver a dar de alta: nueva fecha de alta y tarjeta obligatorias; empresa, departamento, sección y área opcionales
 * (código existente o nombre nuevo, como en el alta).
 */
export function sanitizeReadmit(b: any, opts: { uppercase: boolean; limits: PersonalLimits; lookups: PersonalLookups }): { r: ReadmitInput; newNames: NewNames } {
  const hireDate = cleanIsoDate(b.hireDate, 'La fecha de alta');
  const card = cleanCard(b.card, opts.limits.card ?? null);
  const emp = { code: '', name: '', email: '', endDate: '', consultas: '', solicitudes: '', hireDate, card, company: '', department: '', section: '', area: '' } as PersonalInput;
  for (const k of ORG_KINDS) {
    const v = str(b[k], 100);
    if (!v) continue;
    if (opts.lookups[k] && !opts.lookups[k]!.some((x) => x.code === v)) throw new HttpError(400, `${LOOKUP_LABEL[k]} ${v} no existe en Evalos`);
    emp[k] = v;
  }
  const newNames = sanitizeNewNames(b.newNames, emp, opts);
  return { r: { hireDate, card, company: emp.company, department: emp.department, section: emp.section, area: emp.area }, newNames };
}

