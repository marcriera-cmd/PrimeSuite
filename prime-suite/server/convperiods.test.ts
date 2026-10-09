// Tests del cálculo de periodos de vacaciones y límites de incidencia a partir del convenio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePeriod, currentRef, excessAlerts, nextRef, plusFor, rowsFor, seniorityYears, syncPeriods, yearPeriod } from './evalos/convperiods.ts';
import type { Convenio, Personal } from './evalos/types.ts';

test('periodo de un año: la fecha fin es el día anterior', () => {
  assert.deepEqual(yearPeriod(1, 1, '2026-10-09'), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(yearPeriod(15, 1, '2026-01-10'), { from: '2025-01-15', to: '2026-01-14' });
});

test('antigüedad en años cumplidos y plus del tramo más alto alcanzado', () => {
  assert.equal(seniorityYears('2020-01-01', '2026-01-01'), 6);
  assert.equal(seniorityYears('2020-06-15', '2026-06-14'), 5);
  assert.equal(seniorityYears('2027-06-01', '2027-01-01'), 0);
  const pl = [{ years: 5, value: 1 }, { years: 6, value: 2 }];
  assert.equal(plusFor(pl, 4), 0);
  assert.equal(plusFor(pl, 5), 1);
  assert.equal(plusFor(pl, 9), 2);
});

test('ejemplo 1: alta a mitad de periodo → empieza en el alta y se prorratea (al medio día)', () => {
  const ref = currentRef('2027-06-01', '2026-10-09');
  assert.equal(ref, '2027-06-01');
  const p = computePeriod({ day: 1, month: 1, value: 20 }, '2027-06-01', ref, 'D')!;
  // 20 días × 214 / 365 = 11,73 → 11,5
  assert.deepEqual(p, { from: '2027-06-01', to: '2027-12-31', value: 11.5, seniority: 0, plus: 0, prorated: true });
});

test('ejemplo 2: 20 días + 2 de plus a los 5 años, alta en 2020 → 22 días', () => {
  const p = computePeriod({ day: 1, month: 1, value: 20, pluses: [{ years: 5, value: 2 }] }, '2020-01-01', '2026-10-09', 'D')!;
  assert.deepEqual(p, { from: '2026-01-01', to: '2026-12-31', value: 22, seniority: 6, plus: 2, prorated: false });
});

test('límites en horas: prorrateo al minuto; sin alta en el periodo → null', () => {
  const p = computePeriod({ day: 1, month: 1, value: 1200 }, '2026-07-01', '2026-10-09', 'H')!;
  assert.equal(p.value, Math.round((1200 * 184) / 365));
  assert.equal(computePeriod({ day: 1, month: 1, value: 20 }, '2028-03-01', '2026-10-09', 'D'), null);
});

test('periodo siguiente', () => {
  assert.equal(nextRef({ day: 1, month: 1 }, '2026-10-09'), '2027-01-01');
  const p = computePeriod({ day: 1, month: 1, value: 20, pluses: [{ years: 5, value: 2 }] }, '2022-01-01', nextRef({ day: 1, month: 1 }, '2026-10-09'), 'D')!;
  assert.deepEqual([p.from, p.to, p.value], ['2027-01-01', '2027-12-31', 22]);
});

const CONV: Convenio = {
  code: 'METAL', name: 'METAL', incidenceDay: 1, incidenceMonth: 1,
  vacations: [{ type: 'V26', day: 1, month: 1, days: 20, pluses: [{ years: 5, value: 2 }] }],
  limits: [{ incidence: '001', unit: 'H', value: 1200 }, { incidence: '004', unit: 'D', value: 5 }]
};
const emp = (code: string, hireDate: string, active = true) => ({ code, hireDate, active, name: code, card: '', email: '', endDate: '', company: '', department: '', section: '', area: '', consultas: '', solicitudes: '', convenio: 'METAL' }) as Personal;

test('filas de VACACIONES e INCIDENCIALIMITE de una persona (TOTALHORAS = días × 8)', () => {
  const r = rowsFor(CONV, emp('1', '2019-03-01'), () => '2026-10-09');
  assert.deepEqual(r.vac, [{ employee: '1', type: 'V26', from: '2026-01-01', to: '2026-12-31', days: 22, hours: 176 }]);
  assert.deepEqual(r.inc.map((x) => [x.incidence, x.unit, x.value]), [['001', 'H', 1200], ['004', 'D', 5]]);
});

test('avisos de exceso solo en periodos vigentes', () => {
  const a = excessAlerts(
    [{ employee: '1', type: 'V26', from: '2026-01-01', to: '2026-12-31', days: 20, hours: 160, assignedDays: 22, assignedHours: 0 },
     { employee: '2', type: 'V26', from: '2025-01-01', to: '2025-12-31', days: 20, hours: 160, assignedDays: 30, assignedHours: 0 }],
    [{ employee: '1', incidence: '001', from: '2026-01-01', to: '2026-12-31', unit: 'H', value: 600, used: 615 }], '2026-10-09');
  assert.equal(a.length, 2);
  assert.match(a[0].text, /22 días asignados y solo le corresponden 20/);
  assert.match(a[1].text, /lleva 10:15 h y el límite es 10:00 h/);
});

test('sincronizar: periodo en curso, el siguiente solo si existe, sin bajas, y avisos', async () => {
  const store = { vac: [] as any[], inc: [] as any[] };
  const key = (r: any) => `${r.employee}|${r.type ?? r.incidence}|${r.from}`;
  const upsert = (list: any[], rows: any[]) => {
    let created = 0, updated = 0;
    for (const r of rows) { const i = list.findIndex((x) => key(x) === key(r)); if (i >= 0) { list[i] = { ...list[i], ...r }; updated++; } else { list.push({ assignedDays: 0, assignedHours: 0, used: 0, ...r }); created++; } }
    return { created, updated };
  };
  const drv: any = {
    upsertVacationPeriods: async (rows: any[]) => upsert(store.vac, rows),
    upsertIncidenceLimits: async (rows: any[]) => upsert(store.inc, rows),
    listEmployeePeriods: async (codes: string[], from: string) => ({ vacations: store.vac.filter((v) => codes.includes(v.employee) && v.to >= from), limits: store.inc.filter((l) => codes.includes(l.employee) && l.to >= from) })
  };
  const stamp = { date: '20261009', time: '1500', user: 'SMO' };
  const people = [emp('1', '2019-03-01'), emp('2', '2020-01-01', false)];
  let r = await syncPeriods(drv, CONV, people, 'current', '2026-10-09', stamp);
  assert.deepEqual([r.created, r.updated, store.vac.length, store.inc.length], [3, 0, 1, 2]);
  // Ya disfrutados 23 días y el convenio baja a 18: se actualiza TOTALDIAS sin tocar lo asignado y avisa.
  store.vac[0].assignedDays = 23;
  r = await syncPeriods(drv, { ...CONV, vacations: [{ ...CONV.vacations[0], days: 18 }] }, people, 'current', '2026-10-09', stamp);
  assert.deepEqual([r.created, r.updated, store.vac[0].days, store.vac[0].assignedDays], [0, 3, 20, 23]);
  assert.match(r.alerts[0].text, /23 días asignados y solo le corresponden 20/);
  // Año siguiente.
  r = await syncPeriods(drv, CONV, people, 'next', '2026-10-09', stamp);
  assert.equal(r.created, 3);
  assert.ok(store.vac.some((v) => v.from === '2027-01-01' && v.days === 22));
});
