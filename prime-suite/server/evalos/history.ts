// Atajos de Evalos · Históricos de la ficha de empleado (tablas HIS_*).
// Tarjeta, empresa, departamento, sección y área se guardan en tramos (alta/baja) con el mismo formato:
//   <P>_PCOD empleado · <P>_CODI valor · <P>_FALT alta · <P>_FBAJ baja ('0' = sin baja) · <P>_TIPO A/B
//   <P>_FECH fecha del cambio · <P>_HORA hora del cambio · <P>_USUA iniciales del usuario de Evalos
// Las tablas MOV_* no se usan.
import { HttpError } from '../http.ts';
import type { HistoryEntry, HistoryKind, PersonalInput } from './types.ts';

export interface HistoryDef {
  /** Tabla de histórico y prefijo de sus columnas. */
  his: string;
  prefix: string;
  /** Campo de la ficha (columna EM_*) que refleja el valor vigente. */
  field: keyof PersonalInput;
  /**
   * true  = el empleado solo puede tener un tramo abierto (empresa, departamento…): al dar de alta otro valor
   *         se cierra el anterior con baja el día antes.
   * false = puede tener varios a la vez (tarjetas), pero un mismo valor no puede estar abierto en dos empleados.
   */
  exclusive: boolean;
  label: string;
}

export const HISTORY: Record<HistoryKind, HistoryDef> = {
  card: { his: 'HIS_TARJETA', prefix: 'HT', field: 'card', exclusive: false, label: 'la tarjeta' },
  company: { his: 'HIS_EMPRESA', prefix: 'HE', field: 'company', exclusive: true, label: 'la empresa' },
  department: { his: 'HIS_DEPMENTO', prefix: 'HD', field: 'department', exclusive: true, label: 'el departamento' },
  section: { his: 'HIS_SECCION', prefix: 'HS', field: 'section', exclusive: true, label: 'la sección' },
  area: { his: 'HIS_AREA', prefix: 'HA', field: 'area', exclusive: true, label: 'el área' }
};
export const HISTORY_KINDS = Object.keys(HISTORY) as HistoryKind[];
export const ORG_KINDS = ['company', 'department', 'section', 'area'] as const;
export const isHistoryKind = (k: string): k is HistoryKind => k in HISTORY;

export const cardDescription = (card: string) => `Tarjeta: ${card}`.slice(0, 60);
export const ymdOf = (iso: string) => iso.replace(/-/g, '');
export const dmy = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
const txt = (v: unknown) => (v == null ? '' : String(v).trim());
export const isoOf = (v: unknown) => {
  const s = txt(v);
  return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
};

/** Día anterior a una fecha AAAA-MM-DD. */
export function prevDay(iso: string) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Fecha (aaaammdd) y hora (hhmm) actuales en la zona horaria de Evalos (por defecto, Madrid). */
export function madridNow(d = new Date(), tz = process.env.EVALOS_TZ || 'Europe/Madrid') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}${parts.month}${parts.day}`, time: `${parts.hour}${parts.minute}` };
}

/** Fila de HIS_* → tramo para la pantalla. "Vigente" = sin baja (vacía o 0) o con baja igual o posterior a hoy. */
export function toEntry(r: { value: string; falt: string; fbaj: string; tipo: string; fech: string; hora: string; usua: string }, today: string): HistoryEntry {
  const fbaj = txt(r.fbaj);
  const open = !fbaj || fbaj === '0';
  const fech = isoOf(r.fech);
  const hora = /^\d{4}$/.test(txt(r.hora)) ? `${txt(r.hora).slice(0, 2)}:${txt(r.hora).slice(2)}` : '';
  return {
    value: txt(r.value), from: isoOf(r.falt), to: open ? '' : isoOf(fbaj), type: txt(r.tipo),
    active: open || fbaj >= today, recordedAt: [fech, hora].filter(Boolean).join(' '), user: txt(r.usua)
  };
}

/**
 * Siguiente código numérico libre para un valor nuevo (empresa, departamento…): el mayor código numérico + 1,
 * respetando los ceros a la izquierda si los códigos existentes los usan ("007" → "008").
 */
export function nextCode(existing: string[], max: number | null): string {
  const nums = existing.map((c) => c.trim()).filter((c) => /^\d+$/.test(c));
  const n = nums.reduce((m, c) => Math.max(m, Number(c)), 0) + 1;
  const width = nums.some((c) => c.length > 1 && c.startsWith('0')) ? Math.max(...nums.map((c) => c.length)) : 0;
  const code = String(n).padStart(width, '0');
  if (max && code.length > max) throw new Error(`No quedan códigos numéricos libres de ${max} caracteres`);
  return code;
}

/**
 * Cambios de la fecha de baja al modificar la ficha. De un empleado ya de baja solo se puede adelantar la baja:
 * retrasarla o quitarla reabriría tramos ya cerrados; para reincorporarlo está «Volver a dar de alta».
 */
export function checkEndChange(code: string, current: string, next: string) {
  if (!current || next === current) return;
  if (!next) throw new HttpError(409, `El empleado ${code} está de baja desde el ${dmy(current)}. Para reincorporarlo usa «Volver a dar de alta».`);
  if (next > current) throw new HttpError(409, `La baja del empleado ${code} es del ${dmy(current)} y solo se puede adelantar. Para reincorporarlo usa «Volver a dar de alta».`);
}

/** Volver a dar de alta: solo a empleados de baja y con una fecha de alta posterior a la baja. */
export function checkReadmit(code: string, currentEnd: string, hireDate: string) {
  if (!currentEnd) throw new HttpError(409, `El empleado ${code} no está de baja.`);
  if (hireDate <= currentEnd) throw new HttpError(409, `La nueva fecha de alta tiene que ser posterior a la baja (${dmy(currentEnd)}).`);
}

