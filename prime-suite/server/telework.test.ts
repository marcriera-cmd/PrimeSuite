// Tests del gestor de teletrabajo (cálculo de bolsas, arrastre, Ley 10/2021, aforo y patrones).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POLICIES, DEFAULT_SETTINGS, balance, checkChanges, monthView, patternChanges, periodBounds, policyPattern, weekday, yearReport,
  type CalcCtx, type EmployeeInfo, type PlanIndex, type TwSettings
} from './evalos/telework.ts';

const emp = (code: string, department = 'IT'): EmployeeInfo => ({ code, name: code, department });
function ctx(over: Omit<Partial<CalcCtx>, 'settings'> & { settings?: Partial<TwSettings> } = {}): CalcCtx {
  return {
    today: '2026-10-15',
    policies: DEFAULT_POLICIES,
    assignments: {},
    holidays: new Set(),
    absences: new Map(),
    plans: new Map(),
    ...over,
    settings: { ...DEFAULT_SETTINGS, ...(over.settings || {}) }
  };
}
const plan = (o: Record<string, Record<string, string>>): PlanIndex => new Map(Object.entries(o).map(([e, d]) => [e, new Map(Object.entries(d))]));

test('días de la semana y periodos', () => {
  assert.equal(weekday('2026-10-12'), 1); // lunes
  assert.equal(weekday('2026-10-18'), 7);
  assert.deepEqual(periodBounds('week', '2026-10-15'), { from: '2026-10-12', to: '2026-10-18' });
  assert.deepEqual(periodBounds('quarter', '2026-11-03'), { from: '2026-10-01', to: '2026-12-31' });
});

test('bolsa semanal: consumido, planificado y exceso', () => {
  const c = ctx({
    assignments: { A: { policyId: 'hibrido-2', from: '2026-01-01', agreementSigned: true } },
    plans: plan({ A: { '2026-10-12': 'T', '2026-10-13': 'T', '2026-10-16': 'T' } })
  });
  const b = balance(c, emp('A'), '2026-10-15');
  assert.equal(b.allowance, 2);
  assert.equal(b.used, 2);      // lunes y martes ya pasaron
  assert.equal(b.planned, 1);   // viernes
  assert.equal(b.available, -1);
  assert.equal(b.exceeded, true);
});

test('bolsa mensual prorrateada por alta a mitad de mes', () => {
  const c = ctx({ assignments: { A: { policyId: 'hibrido-8m', from: '2026-10-16', agreementSigned: false } } });
  const b = balance(c, emp('A'), '2026-10-20');
  // octubre 2026: 22 laborables; del 16 (viernes) al 31 hay 11 → 8 × 11/22 = 4
  assert.equal(b.allowance, 4);
});

test('bolsa en horas con días mixtos y arrastre', () => {
  const c = ctx({
    settings: { carryOver: true, maxCarryOver: 16 },
    assignments: { A: { policyId: 'hibrido-8m', from: '2026-01-01', agreementSigned: true } },
    plans: plan({ A: { '2026-09-01': 'T', '2026-09-02': 'T', '2026-10-05': 'H4' } })
  });
  const b = balance(c, emp('A'), '2026-10-15');
  assert.equal(b.carry, 6);      // septiembre: 8 − 2 = 6 (máximo 16)
  assert.equal(b.used, 0.5);     // medio día
  assert.equal(b.available, 13.5);
});

test('teletrabajo completo no tiene límite y presencial tiene cupo 0', () => {
  const c = ctx({ assignments: { R: { policyId: 'remoto', from: '2026-01-01', agreementSigned: true } } });
  assert.equal(balance(c, emp('R'), '2026-10-15').allowance, null);
  assert.equal(balance(c, emp('P'), '2026-10-15').allowance, 0);
});

test('Ley 10/2021: aviso si ≥30 % en 3 meses sin acuerdo', () => {
  const c = ctx({ assignments: { R: { policyId: 'remoto', from: '2026-01-01', agreementSigned: false } } });
  const v = monthView(c, [emp('R')], '2026-10');
  assert.equal(v.rows[0].legalPct, 100);
  assert.ok(v.rows[0].alerts.some((a) => /Ley 10\/2021/.test(a.text)));
  const c2 = ctx({ assignments: { R: { policyId: 'remoto', from: '2026-01-01', agreementSigned: true } } });
  assert.ok(!monthView(c2, [emp('R')], '2026-10').rows[0].alerts.some((a) => /Ley 10\/2021/.test(a.text)));
});

test('aforo, ausencias, festivos y mínimo presencial', () => {
  const c = ctx({
    settings: { officeCapacity: 1, minOfficeByDept: { IT: 2 } },
    holidays: new Set(['2026-10-12']),
    absences: new Map([['B', new Set(['2026-10-14'])]]),
    assignments: { A: { policyId: 'hibrido-2', from: '2026-01-01', agreementSigned: true } },
    plans: plan({ A: { '2026-10-19': 'T', '2026-10-20': 'T', '2026-10-21': 'T' } })
  });
  const v = monthView(c, [emp('A'), emp('B')], '2026-10');
  assert.equal(v.rows[0].days['2026-10-12'].k, 'F');
  assert.equal(v.rows[1].days['2026-10-14'].k, 'A');
  assert.equal(v.occupancy['2026-10-13'].office, 2);
  assert.ok(v.alerts.some((a) => /puestos/.test(a.text)));                  // 2 personas para 1 puesto
  assert.ok(v.alerts.some((a) => /mínimo 2/.test(a.text)));                 // día con 1 de IT
  assert.ok(v.rows[0].alerts.some((a) => /mínimo 3/.test(a.text)));         // semana del 19: 2 presenciales
});

test('patrón desde la política: respeta lo ya planificado salvo que se sobrescriba', () => {
  const p = DEFAULT_POLICIES.find((x) => x.id === 'hibrido-2')!;
  const pat = policyPattern(p);
  assert.equal(pat['1'], 'T');
  assert.equal(pat['2'], 'O');
  const c = ctx({ plans: plan({ A: { '2026-10-19': 'O' } }) });
  const ch = patternChanges(c, [emp('A')], '2026-10-19', '2026-10-25', pat, false);
  assert.equal(ch.length, 4); // lun ya planificado; sáb y dom no laborables
  assert.equal(patternChanges(c, [emp('A')], '2026-10-19', '2026-10-25', pat, true).length, 5);
});

test('informe anual y compensación', () => {
  const c = ctx({ settings: { allowancePerDay: 3.5 }, plans: plan({ A: { '2026-03-02': 'T', '2026-03-03': 'H4' } }) });
  const r = yearReport(c, [emp('A')], 2026)[0];
  assert.equal(r.twDays, 1.5);
  assert.equal(r.compensation, 5.25);
});

test('comprobar cambios: avisa al superar la bolsa y el mínimo presencial, no si mejora', () => {
  const c = ctx({
    assignments: { A: { policyId: 'hibrido-2', from: '2026-01-01', agreementSigned: true } },
    plans: plan({ A: { '2026-10-19': 'T', '2026-10-20': 'T' } })
  });
  const w = checkChanges(c, [emp('A')], [{ employee: 'A', date: '2026-10-21', value: 'T' }]);
  assert.ok(w.some((x) => x.kind === 'quota' && /de más/.test(x.text)));
  assert.ok(w.some((x) => x.kind === 'minOffice'));
  assert.equal(checkChanges(c, [emp('A')], [{ employee: 'A', date: '2026-10-20', value: 'O' }]).length, 0);
});

test('comprobar cambios: aforo', () => {
  const c = ctx({ settings: { officeCapacity: 1 }, assignments: { A: { policyId: 'hibrido-2', from: '2026-01-01', agreementSigned: true } }, plans: plan({ A: { '2026-10-21': 'T' } }) });
  const w = checkChanges(c, [emp('A'), emp('B')], [{ employee: 'A', date: '2026-10-21', value: 'O' }]);
  assert.ok(w.some((x) => x.kind === 'capacity'));
});
