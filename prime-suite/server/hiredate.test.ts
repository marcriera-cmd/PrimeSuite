// Corrección de la fecha de alta de un empleado: los tramos que empezaban en la fecha antigua pasan a la nueva
// (vigencia, tarjeta y organización), con sus comprobaciones; y los periodos del convenio se recalculan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRIME_STORE = 'file';
process.env.PRIME_DATA_DIR = mkdtempSync(join(tmpdir(), 'ps-hiredate-'));

const { DemoDriver } = await import('./evalos/demo.ts');
const { syncPeriods } = await import('./evalos/convperiods.ts');

const STAMP = { date: '20261014', time: '1400', user: 'SMO' };
const input = (o: Record<string, string> = {}) => ({
  code: '0000000901', name: 'PRUEBA, ANA', card: '00000ABC01', email: '', hireDate: '2026-06-01', endDate: '',
  company: 'PRIMION', department: 'D001', section: 'OFI', area: '', consultas: '', solicitudes: '', convenio: 'OFI', ...o
}) as any;

async function fresh(id: string) {
  const d = new DemoDriver(id);
  const dep = (await d.listDepartments())[0].code;
  await d.createPersonal(input({ department: dep }), STAMP);
  return { d, dep };
}

test('demo: adelantar la fecha de alta mueve vigencia, tarjeta y organización', async () => {
  const { d } = await fresh('hire-1');
  const { code, ...rest } = input();
  const cur = (await d.getPersonal(code))!;
  const r = await d.updatePersonal(code, { ...rest, department: cur.department, hireDate: '2026-02-01' }, STAMP);
  assert.deepEqual(r && r.movedTramos, ['periodo de alta', 'tarjeta', 'empresa', 'departamento', 'sección']);
  const h = await d.personalHistory(code);
  assert.equal(h.card[0].from, '2026-02-01');
  assert.equal(h.department[0].from, '2026-02-01');
  assert.equal((await d.personalPeriods(code))[0].from, '2026-02-01');
  assert.equal((await d.getPersonal(code))!.hireDate, '2026-02-01');
});

test('demo: retrasar la fecha de alta con un cambio de departamento por medio → 409 y no cambia nada', async () => {
  const { d } = await fresh('hire-2');
  const { code, ...rest } = input();
  const other = (await d.listDepartments())[1].code;
  await d.assignHistory('department', code, { code: other }, '2026-07-01', STAMP);
  const cur = (await d.getPersonal(code))!;
  await assert.rejects(d.updatePersonal(code, { ...rest, department: cur.department, hireDate: '2026-08-01' }, STAMP), /antes de la nueva fecha de alta/);
  assert.equal((await d.getPersonal(code))!.hireDate, '2026-06-01');
  assert.equal((await d.personalHistory(code)).card[0].from, '2026-06-01');
});

test('demo: adelantar la fecha de alta con la tarjeta en manos de otro empleado esos días → 409', async () => {
  const d = new DemoDriver('hire-3');
  const dep = (await d.listDepartments())[0].code;
  // Otro empleado tuvo la misma tarjeta de enero a marzo; la nuestra empieza en junio.
  await d.createPersonal(input({ code: '0000000902', hireDate: '2026-01-01', endDate: '2026-03-31', department: dep }), STAMP);
  await d.createPersonal(input({ department: dep }), STAMP);
  const { code, ...rest } = input();
  await assert.rejects(d.updatePersonal(code, { ...rest, department: dep, hireDate: '2026-02-01' }, STAMP), /La tarjeta 00000ABC01 la tenía el empleado 0000000902/);
  // Adelantarla solo hasta abril sí se puede.
  const r = await d.updatePersonal(code, { ...rest, department: dep, hireDate: '2026-04-01' }, STAMP);
  assert.ok(r && r.movedTramos.includes('tarjeta'));
});

test('demo: periodos del convenio tras corregir la fecha de alta', async () => {
  const { d } = await fresh('hire-4');
  const conv = (await d.getConvenio('OFI'))!;
  const { code, ...rest } = input();
  await syncPeriods(d, conv, [(await d.getPersonal(code))!], 'current', '2026-10-14', STAMP);
  let p = await d.listEmployeePeriods([code], '2026-01-01');
  const v = p.vacations.find((x) => x.type === 'V26')!;
  assert.equal(v.from, '2026-06-01');
  const cur = (await d.getPersonal(code))!;
  await d.updatePersonal(code, { ...rest, department: cur.department, hireDate: '2026-01-01' }, STAMP);
  await syncPeriods(d, conv, [(await d.getPersonal(code))!], 'current', '2026-10-14', STAMP, { from: '2026-06-01', to: '2026-01-01' });
  p = await d.listEmployeePeriods([code], '2026-01-01');
  assert.deepEqual(p.vacations.filter((x) => x.type === 'V26').map((x) => [x.from, x.days]), [['2026-01-01', conv.vacations.find((x) => x.type === 'V26')!.days]]);
});
