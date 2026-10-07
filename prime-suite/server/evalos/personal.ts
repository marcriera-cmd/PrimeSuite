// Atajos de Evalos · Personal: validación y normalización de la ficha de empleado (tabla PERSONAL).
// Se usa en las rutas antes de llamar al driver; el driver ya recibe los datos limpios.
import { HttpError } from '../http.ts';
import type { PersonalInput, PersonalLimits, PersonalLookupKey, PersonalLookups } from './types.ts';

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanCode(v: unknown, upper: boolean, max: number | null) {
  let s = str(v, 200);
  if (upper) s = s.toUpperCase();
  if (!s) throw new HttpError(400, 'El código es obligatorio');
  if (/[\u0000-\u001f'"]/.test(s)) throw new HttpError(400, 'El código contiene caracteres no permitidos');
  if (max && s.length > max) throw new HttpError(400, `El código admite como máximo ${max} caracteres`);
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

/** Valida y normaliza una ficha de empleado. Campos obligatorios: código, nombre, alta y tarjeta. */
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

  const card = str(b.card, 200);
  if (!card) throw new HttpError(400, 'La tarjeta es obligatoria');
  if (/[\u0000-\u001f'"\s]/.test(card)) throw new HttpError(400, 'La tarjeta contiene caracteres no permitidos');
  len('card', card);

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
    if (list && !list.some((x) => x.code === v)) throw new HttpError(400, `${LOOKUP_LABEL[k]} ${v} no existe en Evalos`);
    return len(k, v);
  };
  return {
    code, name, card, email, hireDate, endDate,
    company: pick('company'), department: pick('department'), section: pick('section'), area: pick('area'),
    consultas: pick('consultas'), solicitudes: pick('solicitudes')
  };
}
