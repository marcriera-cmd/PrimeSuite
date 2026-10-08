// Atajos de Evalos · Gestor de teletrabajo.
//
// Evalos 8 no tiene tablas de teletrabajo, así que la planificación, las políticas y los ajustes se guardan
// en Prime Suite (por empresa). De Evalos se leen los empleados, sus departamentos, los festivos del
// calendario elegido y las ausencias, para que los cálculos solo cuenten días realmente laborables.
//
// Conceptos:
//   - Política: cupo de teletrabajo (días u horas) por semana, mes, trimestre o año; días preferentes,
//     mínimo de días presenciales por semana y jornada diaria.
//   - Asignación: política de cada empleado, con vigencia y si tiene firmado el acuerdo de trabajo a distancia.
//   - Plan: por día, Oficina (O), Teletrabajo (T) o Mixto (H + horas de teletrabajo).
//   - Bolsa: cupo del periodo (prorrateado y con arrastre opcional) − consumido − planificado = disponible.
//   - Ley 10/2021: es trabajo a distancia «regular» si supera el 30 % de la jornada en 3 meses; entonces
//     hace falta acuerdo escrito y compensar gastos.
import { rawGet, rawSet } from '../db.ts';

export type DayKind = 'O' | 'T' | 'H';
export type PolicyMode = 'presencial' | 'hibrido' | 'remoto';
export type PolicyUnit = 'days' | 'hours';
export type PolicyPeriod = 'week' | 'month' | 'quarter' | 'year';

export interface TwPolicy {
  id: string;
  name: string;
  mode: PolicyMode;
  unit: PolicyUnit;
  /** Cupo de teletrabajo por periodo (días u horas). Solo para el modo híbrido. */
  amount: number;
  period: PolicyPeriod;
  /** Días preferentes de teletrabajo (1 = lunes … 7 = domingo), para generar el plan. */
  preferredDays: number[];
  /** Días presenciales mínimos por semana (0 = sin mínimo). */
  minOfficeDaysWeek: number;
  /** Horas de la jornada diaria, para pasar de días a horas. */
  hoursPerDay: number;
  color: string;
}

export interface TwAssignment {
  policyId: string;
  from: string;        // AAAA-MM-DD
  to?: string;         // AAAA-MM-DD (vacío = indefinida)
  agreementSigned: boolean;
  agreementDate?: string;
  notes?: string;
}

export interface TwSettings {
  /** Puestos disponibles en la oficina (null = sin límite). */
  officeCapacity: number | null;
  /** Compensación de gastos por día de teletrabajo (€). */
  allowancePerDay: number;
  /** Porcentaje de jornada en 3 meses a partir del cual es trabajo a distancia regular (Ley 10/2021: 30). */
  legalThresholdPct: number;
  /** El cupo no gastado pasa al periodo siguiente (no aplica a periodos semanales). */
  carryOver: boolean;
  maxCarryOver: number;
  /** Calendario de Evalos cuyos festivos no cuentan como laborables. */
  calendarCode?: string;
  /** Días laborables (1 = lunes … 7 = domingo). */
  workDays: number[];
  /** Mínimo de personas en la oficina por departamento y día. */
  minOfficeByDept: Record<string, number>;
  /** Política para los empleados sin asignación. */
  defaultPolicyId?: string;
}

export interface TwConfig {
  settings: TwSettings;
  policies: TwPolicy[];
  assignments: Record<string, TwAssignment>;
}

/** Plan de un mes: empleado → día (AAAA-MM-DD) → 'O' | 'T' | 'H<horas>'. */
export type MonthPlan = Record<string, Record<string, string>>;

export const DEFAULT_POLICIES: TwPolicy[] = [
  { id: 'hibrido-2', name: 'Híbrido · 2 días/semana', mode: 'hibrido', unit: 'days', amount: 2, period: 'week', preferredDays: [1, 5], minOfficeDaysWeek: 3, hoursPerDay: 8, color: '#0E7C66' },
  { id: 'hibrido-8m', name: 'Híbrido · 8 días/mes', mode: 'hibrido', unit: 'days', amount: 8, period: 'month', preferredDays: [1, 3], minOfficeDaysWeek: 2, hoursPerDay: 8, color: '#31506A' },
  { id: 'bolsa-120h', name: 'Bolsa anual · 120 horas', mode: 'hibrido', unit: 'hours', amount: 120, period: 'year', preferredDays: [5], minOfficeDaysWeek: 3, hoursPerDay: 8, color: '#6D28D9' },
  { id: 'remoto', name: 'Teletrabajo completo', mode: 'remoto', unit: 'days', amount: 0, period: 'month', preferredDays: [1, 2, 3, 4, 5], minOfficeDaysWeek: 0, hoursPerDay: 8, color: '#B45309' },
  { id: 'presencial', name: 'Presencial', mode: 'presencial', unit: 'days', amount: 0, period: 'month', preferredDays: [], minOfficeDaysWeek: 0, hoursPerDay: 8, color: '#5C6B78' }
];

export const DEFAULT_SETTINGS: TwSettings = {
  officeCapacity: null,
  allowancePerDay: 0,
  legalThresholdPct: 30,
  carryOver: false,
  maxCarryOver: 0,
  workDays: [1, 2, 3, 4, 5],
  minOfficeByDept: {},
  defaultPolicyId: 'presencial'
};

// ---------- Almacenamiento ----------
const cfgKey = (cid: string) => `telework/${cid}/config`;
const planKey = (cid: string, month: string) => `telework/${cid}/plan/${month}`;

export async function getConfig(cid: string): Promise<TwConfig> {
  const c = await rawGet<TwConfig>(cfgKey(cid));
  return {
    settings: { ...DEFAULT_SETTINGS, ...(c?.settings || {}), minOfficeByDept: { ...(c?.settings?.minOfficeByDept || {}) } },
    policies: c?.policies?.length ? c.policies : DEFAULT_POLICIES.map((p) => ({ ...p })),
    assignments: c?.assignments || {}
  };
}
export async function putConfig(cid: string, c: TwConfig) {
  await rawSet(cfgKey(cid), c);
}

export async function getMonthPlan(cid: string, month: string): Promise<MonthPlan> {
  return (await rawGet<MonthPlan>(planKey(cid, month))) || {};
}
export async function putMonthPlan(cid: string, month: string, p: MonthPlan) {
  await rawSet(planKey(cid, month), p);
}

/** Plan combinado de un rango de meses: empleado → día → código. */
export type PlanIndex = Map<string, Map<string, string>>;
export async function loadPlans(cid: string, fromDate: string, toDate: string): Promise<PlanIndex> {
  const idx: PlanIndex = new Map();
  for (const m of monthsBetween(fromDate, toDate)) {
    const p = await getMonthPlan(cid, m);
    for (const [emp, days] of Object.entries(p)) {
      let e = idx.get(emp);
      if (!e) idx.set(emp, (e = new Map()));
      for (const [d, v] of Object.entries(days)) e.set(d, v);
    }
  }
  return idx;
}

/** Guarda cambios de días (null = borrar). Agrupa por mes. */
export async function savePlanChanges(cid: string, changes: { employee: string; date: string; value: string | null }[]) {
  const byMonth = new Map<string, typeof changes>();
  for (const ch of changes) {
    const m = ch.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(ch);
  }
  for (const [m, list] of byMonth) {
    const p = await getMonthPlan(cid, m);
    for (const ch of list) {
      const e = (p[ch.employee] ||= {});
      if (ch.value === null) delete e[ch.date];
      else e[ch.date] = ch.value;
      if (!Object.keys(e).length) delete p[ch.employee];
    }
    await putMonthPlan(cid, m, p);
  }
}

// ---------- Fechas (AAAA-MM-DD, en UTC para evitar saltos de horario) ----------
const D = (s: string) => new Date(`${s}T00:00:00Z`);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
/** 1 = lunes … 7 = domingo. */
export const weekday = (s: string) => ((D(s).getUTCDay() + 6) % 7) + 1;
export const monthEnd = (m: string) => { const [y, mo] = m.split('-').map(Number); return iso(new Date(Date.UTC(y, mo, 0))); };
export function eachDay(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const end = to.slice(0, 7);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    out.push(k);
    if (k >= end) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function periodBounds(period: PolicyPeriod, date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number);
  if (period === 'week') { const from = addDays(date, 1 - weekday(date)); return { from, to: addDays(from, 6) }; }
  if (period === 'month') { const mm = date.slice(0, 7); return { from: `${mm}-01`, to: monthEnd(mm) }; }
  if (period === 'quarter') {
    const q0 = Math.floor((m - 1) / 3) * 3 + 1;
    const from = `${y}-${String(q0).padStart(2, '0')}-01`;
    return { from, to: monthEnd(`${y}-${String(q0 + 2).padStart(2, '0')}`) };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

// ---------- Códigos de día ----------
export function parseDay(v: string | undefined): { k: DayKind; h: number } | null {
  if (!v) return null;
  if (v === 'O' || v === 'T') return { k: v, h: 0 };
  if (v[0] === 'H') { const h = Number(v.slice(1)); return { k: 'H', h: Number.isFinite(h) ? h : 4 }; }
  return null;
}
export function encodeDay(k: DayKind, h?: number) {
  if (k === 'H') return `H${Math.max(0.5, Math.round((h ?? 4) * 2) / 2)}`;
  return k;
}

// ---------- Cálculos ----------
export interface EmployeeInfo { code: string; name: string; department: string; hireDate?: string; endDate?: string }

export interface CalcCtx {
  today: string;
  settings: TwSettings;
  policies: TwPolicy[];
  assignments: Record<string, TwAssignment>;
  holidays: Set<string>;
  /** Días de ausencia (vacaciones, bajas, permisos) por empleado. */
  absences: Map<string, Set<string>>;
  plans: PlanIndex;
}

/** Estado efectivo de un día: lo planificado o, si no hay plan, el de su política. */
export type EffectiveDay =
  | { k: 'X' }                       // no laborable (fin de semana o festivo)
  | { k: 'F' }                       // festivo
  | { k: 'A' }                       // ausencia
  | { k: 'N' }                       // fuera de contrato o de la asignación
  | { k: DayKind; h: number; planned: boolean };

export function policyFor(ctx: CalcCtx, emp: string, date: string): TwPolicy | null {
  const a = ctx.assignments[emp];
  const byId = (id?: string) => ctx.policies.find((p) => p.id === id) || null;
  // Asignación vigente ese día; si no hay (o está fuera de su vigencia), la política por defecto.
  if (a && a.from <= date && (!a.to || a.to >= date)) return byId(a.policyId);
  return byId(ctx.settings.defaultPolicyId);
}

export function isWorkday(ctx: CalcCtx, date: string) {
  return ctx.settings.workDays.includes(weekday(date)) && !ctx.holidays.has(date);
}

export function effectiveDay(ctx: CalcCtx, e: EmployeeInfo, date: string): EffectiveDay {
  if (!ctx.settings.workDays.includes(weekday(date))) return { k: 'X' };
  if (ctx.holidays.has(date)) return { k: 'F' };
  if ((e.hireDate && date < e.hireDate) || (e.endDate && date > e.endDate)) return { k: 'N' };
  if (ctx.absences.get(e.code)?.has(date)) return { k: 'A' };
  const planned = parseDay(ctx.plans.get(e.code)?.get(date));
  if (planned) return { ...planned, planned: true };
  const p = policyFor(ctx, e.code, date);
  return { k: p?.mode === 'remoto' ? 'T' : 'O', h: 0, planned: false };
}

/** Teletrabajo de un día en la unidad de la política (días u horas). */
function twUnits(d: EffectiveDay, p: TwPolicy) {
  if (!('h' in d)) return 0;
  const hpd = p.hoursPerDay || 8;
  if (d.k === 'T') return p.unit === 'days' ? 1 : hpd;
  if (d.k === 'H') return p.unit === 'days' ? Math.min(1, d.h / hpd) : Math.min(hpd, d.h);
  return 0;
}
/** Horas de teletrabajo de un día. */
function twHours(d: EffectiveDay, hpd: number) {
  if (!('h' in d)) return 0;
  return d.k === 'T' ? hpd : d.k === 'H' ? Math.min(hpd, d.h) : 0;
}
const round = (n: number, step: number) => Math.round(n / step) * step;

export interface Balance {
  policyId: string | null;
  policyName: string;
  mode: PolicyMode | null;
  unit: PolicyUnit;
  period: PolicyPeriod | null;
  from: string;
  to: string;
  /** Cupo del periodo (prorrateado). null = sin límite (teletrabajo completo). */
  allowance: number | null;
  carry: number;
  used: number;
  planned: number;
  available: number | null;
  exceeded: boolean;
}

function usage(ctx: CalcCtx, e: EmployeeInfo, p: TwPolicy, from: string, to: string) {
  let used = 0, planned = 0, covered = 0, total = 0;
  for (const d of eachDay(from, to)) {
    if (!isWorkday(ctx, d)) continue;
    total++;
    const pol = policyFor(ctx, e.code, d);
    if (pol?.id !== p.id) continue;
    const ef = effectiveDay(ctx, e, d);
    if (ef.k === 'N') continue;
    covered++;
    const u = twUnits(ef, p);
    if (d < ctx.today) used += u;
    else planned += u;
  }
  return { used, planned, covered, total };
}

function allowanceOf(p: TwPolicy, covered: number, total: number) {
  if (p.mode === 'presencial') return 0;
  if (p.mode === 'remoto') return null;
  if (!total) return 0;
  return round((p.amount * covered) / total, p.unit === 'days' ? 0.5 : 0.25);
}

/** Bolsa del empleado en el periodo de su política que contiene `date`. */
export function balance(ctx: CalcCtx, e: EmployeeInfo, date: string): Balance {
  const p = policyFor(ctx, e.code, date);
  if (!p) {
    return { policyId: null, policyName: 'Sin política', mode: null, unit: 'days', period: null, from: date, to: date, allowance: 0, carry: 0, used: 0, planned: 0, available: 0, exceeded: false };
  }
  const { from, to } = periodBounds(p.period, date);
  const u = usage(ctx, e, p, from, to);
  const allowance = allowanceOf(p, u.covered, u.total);
  let carry = 0;
  if (allowance !== null && p.mode === 'hibrido' && ctx.settings.carryOver && p.period !== 'week') {
    const prev = periodBounds(p.period, addDays(from, -1));
    const pu = usage(ctx, e, p, prev.from, prev.to);
    const pa = allowanceOf(p, pu.covered, pu.total) ?? 0;
    carry = Math.max(0, Math.min(ctx.settings.maxCarryOver || 0, pa - pu.used - pu.planned));
  }
  const available = allowance === null ? null : round(allowance + carry - u.used - u.planned, 0.25);
  return {
    policyId: p.id, policyName: p.name, mode: p.mode, unit: p.unit, period: p.period, from, to,
    allowance, carry: round(carry, 0.25), used: round(u.used, 0.25), planned: round(u.planned, 0.25),
    available, exceeded: available !== null && available < 0
  };
}

/** Porcentaje de jornada en teletrabajo en los 3 meses que terminan en `monthKey` (Ley 10/2021). */
export function legalShare(ctx: CalcCtx, e: EmployeeInfo, monthKey: string) {
  const [y, m] = monthKey.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 3, 1));
  const from = iso(start);
  const to = monthEnd(monthKey);
  let work = 0, tw = 0;
  for (const d of eachDay(from, to)) {
    const ef = effectiveDay(ctx, e, d);
    if (!('h' in ef)) continue;
    const hpd = policyFor(ctx, e.code, d)?.hoursPerDay || 8;
    work += hpd;
    tw += twHours(ef, hpd);
  }
  return { from, to, pct: work ? Math.round((tw / work) * 1000) / 10 : 0 };
}

export interface Alert { level: 'warn' | 'bad' | 'info'; employee?: string; date?: string; text: string }

export interface EmployeeMonth {
  code: string;
  name: string;
  department: string;
  policyId: string | null;
  days: Record<string, EffectiveDay>;
  balance: Balance;
  legalPct: number;
  agreementSigned: boolean;
  /** Días (equivalentes) de teletrabajo y oficina del mes. */
  twDays: number;
  officeDays: number;
  compensation: number;
  alerts: Alert[];
}

/** Todo lo que necesita la vista de un mes. */
export function monthView(ctx: CalcCtx, employees: EmployeeInfo[], monthKey: string) {
  const from = `${monthKey}-01`;
  const to = monthEnd(monthKey);
  const days = eachDay(from, to);
  const refDate = ctx.today.slice(0, 7) === monthKey ? ctx.today : from;
  const occupancy: Record<string, { office: number; remote: number; absent: number }> = {};
  for (const d of days) occupancy[d] = { office: 0, remote: 0, absent: 0 };
  const deptPresence: Record<string, Record<string, number>> = {};
  const rows: EmployeeMonth[] = [];
  const alerts: Alert[] = [];

  for (const e of employees) {
    const row: EmployeeMonth = {
      code: e.code, name: e.name, department: e.department, policyId: policyFor(ctx, e.code, refDate)?.id || null,
      days: {}, balance: balance(ctx, e, refDate), legalPct: 0, agreementSigned: !!ctx.assignments[e.code]?.agreementSigned,
      twDays: 0, officeDays: 0, compensation: 0, alerts: []
    };
    for (const d of days) {
      const ef = effectiveDay(ctx, e, d);
      row.days[d] = ef;
      if (!('h' in ef)) { if (ef.k === 'A') occupancy[d].absent++; continue; }
      const hpd = policyFor(ctx, e.code, d)?.hoursPerDay || 8;
      const twd = twHours(ef, hpd) / hpd;
      row.twDays += twd;
      row.officeDays += 1 - twd;
      if (ef.k === 'T') occupancy[d].remote++;
      else {
        occupancy[d].office++;
        const dp = (deptPresence[e.department || '—'] ||= {});
        dp[d] = (dp[d] || 0) + 1;
      }
    }
    row.twDays = round(row.twDays, 0.5);
    row.officeDays = round(row.officeDays, 0.5);
    row.compensation = Math.round(row.twDays * (ctx.settings.allowancePerDay || 0) * 100) / 100;

    // Alertas del empleado
    if (row.balance.exceeded) {
      row.alerts.push({ level: 'bad', employee: e.code, text: `Supera su bolsa de teletrabajo en ${Math.abs(row.balance.available!)} ${row.balance.unit === 'days' ? 'día(s)' : 'hora(s)'}` });
    }
    const legal = legalShare(ctx, e, monthKey);
    row.legalPct = legal.pct;
    if (legal.pct >= ctx.settings.legalThresholdPct && !row.agreementSigned) {
      row.alerts.push({ level: 'warn', employee: e.code, text: `Teletrabajo regular (${legal.pct} % en 3 meses ≥ ${ctx.settings.legalThresholdPct} %) sin acuerdo de trabajo a distancia firmado (Ley 10/2021)` });
    }
    const pol = policyFor(ctx, e.code, refDate);
    if (pol && pol.minOfficeDaysWeek > 0) {
      for (let w = addDays(from, 1 - weekday(from)); w <= to; w = addDays(w, 7)) {
        let office = 0, avail = 0;
        for (const d of eachDay(w, addDays(w, 6))) {
          const ef = effectiveDay(ctx, e, d);
          if (!('h' in ef)) continue;
          avail++;
          if (ef.k !== 'T') office++;
        }
        const need = Math.min(pol.minOfficeDaysWeek, avail);
        if (avail && office < need) {
          row.alerts.push({ level: 'warn', employee: e.code, date: w, text: `Semana del ${w.split('-').reverse().join('/')}: ${office} día(s) presencial(es), mínimo ${need}` });
        }
      }
    }
    alerts.push(...row.alerts);
    rows.push(row);
  }

  // Aforo de la oficina y cobertura por departamento
  const cap = ctx.settings.officeCapacity;
  for (const d of days) {
    if (!isWorkday(ctx, d)) continue;
    if (cap !== null && cap > 0 && occupancy[d].office > cap) {
      alerts.push({ level: 'bad', date: d, text: `${d.split('-').reverse().join('/')}: ${occupancy[d].office} personas en la oficina para ${cap} puestos` });
    }
    for (const [dept, min] of Object.entries(ctx.settings.minOfficeByDept)) {
      if (!min) continue;
      const hasPeople = employees.some((e) => e.department === dept);
      if (!hasPeople) continue;
      const n = deptPresence[dept]?.[d] || 0;
      if (n < min) alerts.push({ level: 'warn', date: d, text: `${d.split('-').reverse().join('/')}: ${n} persona(s) de ${dept} en la oficina (mínimo ${min})` });
    }
  }

  return { month: monthKey, days, rows, occupancy, alerts };
}

/** Resumen anual por empleado (informe). */
export function yearReport(ctx: CalcCtx, employees: EmployeeInfo[], year: number) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  return employees.map((e) => {
    let tw = 0, office = 0, twHrs = 0, workHrs = 0, absent = 0;
    for (const d of eachDay(from, to)) {
      const ef = effectiveDay(ctx, e, d);
      if (ef.k === 'A') { absent++; continue; }
      if (!('h' in ef)) continue;
      const hpd = policyFor(ctx, e.code, d)?.hoursPerDay || 8;
      const h = twHours(ef, hpd);
      tw += h / hpd;
      office += 1 - h / hpd;
      twHrs += h;
      workHrs += hpd;
    }
    const p = policyFor(ctx, e.code, ctx.today.startsWith(String(year)) ? ctx.today : to);
    return {
      code: e.code, name: e.name, department: e.department,
      policy: p?.name || 'Sin política',
      twDays: round(tw, 0.5), officeDays: round(office, 0.5), absentDays: absent,
      twHours: round(twHrs, 0.25), pct: workHrs ? Math.round((twHrs / workHrs) * 1000) / 10 : 0,
      compensation: Math.round(round(tw, 0.5) * (ctx.settings.allowancePerDay || 0) * 100) / 100,
      agreementSigned: !!ctx.assignments[e.code]?.agreementSigned,
      agreementDate: ctx.assignments[e.code]?.agreementDate || ''
    };
  });
}

/**
 * Cambios para aplicar un patrón semanal entre dos fechas.
 * pattern: día de la semana (1–7) → 'O' | 'T' | 'H<h>' | null (no tocar). Respeta festivos, ausencias y fines de semana.
 */
export function patternChanges(ctx: CalcCtx, employees: EmployeeInfo[], from: string, to: string, pattern: Record<string, string | null>, overwrite: boolean) {
  const out: { employee: string; date: string; value: string | null }[] = [];
  for (const e of employees) {
    for (const d of eachDay(from, to)) {
      const v = pattern[String(weekday(d))];
      if (v === undefined || v === null) continue;
      const ef = effectiveDay(ctx, e, d);
      if (!('h' in ef)) continue;
      if (ef.planned && !overwrite) continue;
      out.push({ employee: e.code, date: d, value: v === 'clear' ? null : v });
    }
  }
  return out;
}

/** Patrón semanal a partir de la política del empleado (días preferentes = teletrabajo). */
export function policyPattern(p: TwPolicy | null): Record<string, string | null> {
  const pat: Record<string, string | null> = {};
  for (let i = 1; i <= 7; i++) {
    if (!p || p.mode === 'presencial') pat[i] = 'O';
    else if (p.mode === 'remoto') pat[i] = 'T';
    else pat[i] = p.preferredDays.includes(i) ? 'T' : 'O';
  }
  return pat;
}
