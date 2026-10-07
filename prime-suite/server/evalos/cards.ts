// Atajos de Evalos · Tarjetas: utilidades comunes a los drivers para las asignaciones de tarjeta (HIS_TARJETA).
import type { CardAssignment } from './types.ts';

export const cardDescription = (card: string) => `Tarjeta: ${card}`.slice(0, 60);
export const ymdOf = (iso: string) => iso.replace(/-/g, '');
export const dmy = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
const txt = (v: unknown) => (v == null ? '' : String(v).trim());
const isoOf = (v: unknown) => {
  const s = txt(v);
  return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
};

/** Fecha (aaaammdd) y hora (hhmm) actuales en la zona horaria de Evalos (por defecto, Madrid). */
export function madridNow(d = new Date(), tz = process.env.EVALOS_TZ || 'Europe/Madrid') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}${parts.month}${parts.day}`, time: `${parts.hour}${parts.minute}` };
}

/** Fila de HIS_TARJETA → tramo para la pantalla. "Vigente" = sin baja (vacía o 0) o con baja igual o posterior a hoy. */
export function toAssignment(r: { card: string; falt: string; fbaj: string; tipo: string; fech: string; hora: string; usua: string }, today: string): CardAssignment {
  const fbaj = txt(r.fbaj);
  const open = !fbaj || fbaj === '0';
  const fech = isoOf(r.fech);
  const hora = /^\d{4}$/.test(txt(r.hora)) ? `${txt(r.hora).slice(0, 2)}:${txt(r.hora).slice(2)}` : '';
  return {
    card: txt(r.card), from: isoOf(r.falt), to: open ? '' : isoOf(fbaj), type: txt(r.tipo),
    active: open || fbaj >= today, recordedAt: [fech, hora].filter(Boolean).join(' '), user: txt(r.usua)
  };
}
