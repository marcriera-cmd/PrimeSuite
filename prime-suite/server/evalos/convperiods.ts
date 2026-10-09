// Atajos de Evalos · Convenios → periodos de vacaciones (VACACIONES) y de límites de incidencia (INCIDENCIALIMITE).
//
// Al entrar una persona en un convenio (o al modificar el convenio) se le crean o actualizan sus periodos:
//  - Periodo: un año desde el día/mes de inicio de la línea del convenio; la fecha fin es el día anterior.
//  - Se genera el periodo en curso (o el primero, si la fecha de alta es futura). Los del año siguiente se crean
//    con el botón «Generar periodos del año siguiente»; al recalcular, los siguientes solo se actualizan si ya existen.
//  - Primer periodo: si el alta cae dentro, empieza en la fecha de alta y el total se prorratea por los días que
//    quedan (días: al medio día más cercano; horas: al minuto).
//  - Antigüedad: años cumplidos al inicio del periodo; se aplica el plus del tramo más alto alcanzado.
//  - Una fila que ya existe (misma persona, tipo/incidencia y FECHAINICIO) se actualiza sin tocar lo ya
//    disfrutado (DIASASIGNADOS, HORASASIGNADAS, VALOR).
//  - Personas de baja: no se les generan periodos. Quitar a alguien del convenio no borra sus periodos.
import type { Convenio, ConvenioPlus, EvalosDriver, IncidenceLimitRow, Personal, StoredIncidenceLimit, StoredVacationPeriod, VacationPeriodRow } from './types.ts';
export type { IncidenceLimitRow, StoredIncidenceLimit, StoredVacationPeriod, VacationPeriodRow };

/** Horas de un día de vacaciones para TOTALHORAS (provisional: luego saldrá de las horas teóricas del turno). */
export const HOURS_PER_DAY = 8;

export interface PeriodAlert { employee: string; text: string }
export interface PeriodSyncResult { created: number; updated: number; alerts: PeriodAlert[]; warnings: string[] }

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
const daysIncl = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY) + 1;

/** Periodo de un año que empieza el día/mes indicado y contiene `ref` (AAAA-MM-DD). */
export function yearPeriod(day: number, month: number, ref: string) {
  const [y, m, d] = ref.split('-').map(Number);
  const start = m > month || (m === month && d >= day) ? y : y - 1;
  return { from: iso(Date.UTC(start, month - 1, day)), to: iso(Date.UTC(start + 1, month - 1, day - 1)) };
}

/** Años cumplidos entre el alta y una fecha (0 si el alta es posterior). */
export function seniorityYears(hire: string, at: string) {
  if (!hire || hire >= at) return 0;
  const [hy, hm, hd] = hire.split('-').map(Number);
  const [y, m, d] = at.split('-').map(Number);
  return Math.max(0, y - hy - (m < hm || (m === hm && d < hd) ? 1 : 0));
}

/** Plus del tramo más alto alcanzado (0 si ninguno). */
export function plusFor(pluses: ConvenioPlus[] = [], years: number) {
  return pluses.filter((p) => years >= p.years).reduce((best, p) => (!best || p.years > best.years ? p : best), null as ConvenioPlus | null)?.value || 0;
}

export interface ComputedPeriod { from: string; to: string; value: number; seniority: number; plus: number; prorated: boolean }

/**
 * Periodo de una línea del convenio para una persona: el que contiene `ref`, recortado a la fecha de alta y con el
 * total prorrateado si el alta cae dentro. null si la persona no está de alta en ningún día del periodo.
 * `unit` D = días (redondeo al medio día) u H = minutos (redondeo al minuto).
 */
export function computePeriod(line: { day: number; month: number; value: number; pluses?: ConvenioPlus[] }, hire: string, ref: string, unit: 'D' | 'H'): ComputedPeriod | null {
  const p = yearPeriod(line.day, line.month, ref);
  if (hire && hire > p.to) return null;
  const seniority = seniorityYears(hire, p.from);
  const plus = plusFor(line.pluses, seniority);
  const full = line.value + plus;
  if (!hire || hire <= p.from) return { ...p, value: full, seniority, plus, prorated: false };
  const raw = (full * daysIncl(hire, p.to)) / daysIncl(p.from, p.to);
  const value = unit === 'D' ? Math.round(raw * 2) / 2 : Math.round(raw);
  return { from: hire, to: p.to, value, seniority, plus, prorated: true };
}

/** Fecha de referencia del periodo en curso: hoy, o la fecha de alta si es futura. */
export const currentRef = (hire: string, today: string) => (hire && hire > today ? hire : today);
/** Fecha de referencia del periodo siguiente al que contiene `ref`. */
export const nextRef = (line: { day: number; month: number }, ref: string) => addDays(yearPeriod(line.day, line.month, ref).to, 1);

/** Filas de VACACIONES e INCIDENCIALIMITE que corresponden a una persona en el periodo que contiene `ref` de cada línea. */
export function rowsFor(conv: Convenio, emp: Pick<Personal, 'code' | 'hireDate'>, refOf: (line: { day: number; month: number }) => string) {
  const vac: VacationPeriodRow[] = [];
  for (const v of conv.vacations) {
    const p = computePeriod({ day: v.day, month: v.month, value: v.days, pluses: v.pluses }, emp.hireDate, refOf(v), 'D');
    if (p) vac.push({ employee: emp.code, type: v.type, from: p.from, to: p.to, days: p.value, hours: Math.round(p.value * HOURS_PER_DAY * 100) / 100 });
  }
  const inc: IncidenceLimitRow[] = [];
  const incLine = { day: conv.incidenceDay, month: conv.incidenceMonth };
  for (const l of conv.limits) {
    const p = computePeriod({ ...incLine, value: l.value, pluses: l.pluses }, emp.hireDate, refOf(incLine), l.unit);
    if (p) inc.push({ employee: emp.code, incidence: l.incidence, from: p.from, to: p.to, unit: l.unit, value: p.value });
  }
  return { vac, inc };
}

const fmt = (d: string) => d.split('-').reverse().join('/');
const fmtNum = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Avisos de periodos vigentes (que acaban hoy o después) con más disfrutado que disponible. */
export function excessAlerts(vac: StoredVacationPeriod[], inc: StoredIncidenceLimit[], today: string): PeriodAlert[] {
  const out: PeriodAlert[] = [];
  for (const v of vac) {
    if (v.to < today) continue;
    if (v.assignedDays > v.days) out.push({ employee: v.employee, text: `Vacaciones ${v.type} (${fmt(v.from)}–${fmt(v.to)}): tiene ${fmtNum(v.assignedDays)} días asignados y solo le corresponden ${fmtNum(v.days)}.` });
    else if (v.hours > 0 && v.assignedHours > v.hours) out.push({ employee: v.employee, text: `Vacaciones ${v.type} (${fmt(v.from)}–${fmt(v.to)}): tiene ${fmtNum(v.assignedHours)} horas asignadas y solo le corresponden ${fmtNum(v.hours)}.` });
  }
  for (const l of inc) {
    if (l.to < today || l.used <= l.value) continue;
    const show = (n: number) => (l.unit === 'D' ? `${fmtNum(n)} días` : `${fmtMin(n)} h`);
    out.push({ employee: l.employee, text: `Incidencia ${l.incidence} (${fmt(l.from)}–${fmt(l.to)}): lleva ${show(l.used)} y el límite es ${show(l.value)}.` });
  }
  return out;
}

/** Operaciones de los motores para los periodos (SQL Server y demostración). */
type PeriodDriver = Required<Pick<EvalosDriver, 'upsertVacationPeriods' | 'upsertIncidenceLimits' | 'listEmployeePeriods'>>;
export function periodDriver(d: EvalosDriver): PeriodDriver | null {
  return d.upsertVacationPeriods && d.upsertIncidenceLimits && d.listEmployeePeriods ? (d as PeriodDriver) : null;
}

/**
 * Crea o actualiza los periodos de las personas indicadas según su convenio.
 *  mode 'current': periodo en curso (y actualiza el siguiente si ya existe).
 *  mode 'next': crea o actualiza el periodo siguiente al que está en curso.
 * Solo personas en alta. Devuelve cuántas filas se han creado/actualizado y los avisos de exceso.
 */
export async function syncPeriods(driver: EvalosDriver, conv: Convenio, employees: Personal[], mode: 'current' | 'next', today: string,
  stamp: { date: string; time: string; user: string }): Promise<PeriodSyncResult> {
  const pd = periodDriver(driver);
  if (!pd) return { created: 0, updated: 0, alerts: [], warnings: ['Este motor no permite generar periodos de vacaciones ni de límites.'] };
  const people = employees.filter((e) => e.active);
  if (!people.length) return { created: 0, updated: 0, alerts: [], warnings: [] };
  const codes = people.map((e) => e.code);
  const existing = await pd.listEmployeePeriods(codes, today);
  const has = {
    vac: new Set(existing.vacations.map((v) => `${v.employee}|${v.type}|${v.from}`)),
    inc: new Set(existing.limits.map((l) => `${l.employee}|${l.incidence}|${l.from}`))
  };
  const vac: VacationPeriodRow[] = [], inc: IncidenceLimitRow[] = [];
  for (const e of people) {
    const cur = (line: { day: number; month: number }) => currentRef(e.hireDate, today);
    const nxt = (line: { day: number; month: number }) => nextRef(line, currentRef(e.hireDate, today));
    if (mode === 'next') {
      const r = rowsFor(conv, e, nxt);
      vac.push(...r.vac); inc.push(...r.inc);
    } else {
      const r = rowsFor(conv, e, cur);
      vac.push(...r.vac); inc.push(...r.inc);
      // El siguiente solo se recalcula si ya se había generado.
      const n = rowsFor(conv, e, nxt);
      vac.push(...n.vac.filter((v) => has.vac.has(`${v.employee}|${v.type}|${v.from}`)));
      inc.push(...n.inc.filter((l) => has.inc.has(`${l.employee}|${l.incidence}|${l.from}`)));
    }
  }
  const warnings: string[] = [];
  let created = 0, updated = 0;
  if (vac.length) {
    try { const r = await pd.upsertVacationPeriods(vac, stamp); created += r.created; updated += r.updated; }
    catch (e: any) { warnings.push(`No se pudieron grabar los periodos de vacaciones: ${e?.message || e}`); }
  }
  if (inc.length) {
    try { const r = await pd.upsertIncidenceLimits(inc); created += r.created; updated += r.updated; }
    catch (e: any) { warnings.push(`No se pudieron grabar los límites de incidencia: ${e?.message || e}`); }
  }
  // Periodos vigentes de tipos o incidencias que el convenio no tiene (p. ej. del convenio anterior): se dejan.
  const types = new Set(conv.vacations.map((v) => v.type)), incs = new Set(conv.limits.map((l) => l.incidence));
  const after = await pd.listEmployeePeriods(codes, today);
  const alerts = excessAlerts(after.vacations, after.limits, today);
  for (const v of after.vacations) if (v.to >= today && !types.has(v.type)) alerts.push({ employee: v.employee, text: `Tiene un periodo de vacaciones ${v.type} (${fmt(v.from)}–${fmt(v.to)}) que no es de este convenio: se ha dejado como estaba.` });
  for (const l of after.limits) if (l.to >= today && !incs.has(l.incidence)) alerts.push({ employee: l.employee, text: `Tiene un límite de la incidencia ${l.incidence} (${fmt(l.from)}–${fmt(l.to)}) que no es de este convenio: se ha dejado como estaba.` });
  return { created, updated, alerts, warnings };
}

/** Avisos vigentes de unas personas (para la ficha de Personal y la pestaña Personal del convenio). */
export async function alertsFor(driver: EvalosDriver, employees: string[], today: string): Promise<PeriodAlert[]> {
  const pd = periodDriver(driver);
  if (!pd || !employees.length) return [];
  const p = await pd.listEmployeePeriods(employees, today);
  return excessAlerts(p.vacations, p.limits, today);
}
