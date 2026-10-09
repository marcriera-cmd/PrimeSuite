// Tests de Convenios: validación del formulario, periodos de un año y script de las tablas PS_CONVENIOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './http.ts';
import { conveniosSql, periodAround, sanitizeConvenio, validDayMonth } from './evalos/convenios.ts';

const base = {
  code: 'ofi', name: '  Convenio   de oficinas ', vacationDay: 1, vacationMonth: 1, vacationDays: 23, incidenceDay: 1, incidenceMonth: 9,
  limits: [{ incidence: '003', unit: 'H', value: 1230 }, { incidence: '001', unit: 'D', value: 2.5 }]
};
const opts = { uppercase: true, incidences: new Set(['001', '003']) };
const rejects = (b: any, re: RegExp) => assert.throws(() => sanitizeConvenio(b, opts), (e: any) => e instanceof HttpError && e.status === 400 && re.test(e.message));

test('normaliza el convenio: código en mayúsculas, nombre limpio y límites ordenados', () => {
  const c = sanitizeConvenio(base, opts);
  assert.equal(c.code, 'OFI');
  assert.equal(c.name, 'Convenio de oficinas');
  assert.deepEqual(c.limits.map((l) => l.incidence), ['001', '003']);
  assert.deepEqual(c.limits[1], { incidence: '003', unit: 'H', value: 1230 });
  assert.equal(sanitizeConvenio({ ...base, vacationDays: '22,5' }, opts).vacationDays, 22.5);
});

test('rechaza datos no válidos', () => {
  rejects({ ...base, code: '' }, /código/);
  rejects({ ...base, code: 'DEMASIADOLARGO' }, /10 caracteres/);
  rejects({ ...base, name: ' ' }, /nombre/);
  rejects({ ...base, vacationDay: 29, vacationMonth: 2 }, /vacaciones no es una fecha/);
  rejects({ ...base, incidenceDay: 31, incidenceMonth: 4 }, /incidencias no es una fecha/);
  rejects({ ...base, vacationDays: 22.3 }, /medios días/);
  rejects({ ...base, vacationDays: -1 }, /entre 0/);
  rejects({ ...base, limits: [{ incidence: '001', unit: 'D', value: 1 }, { incidence: '001', unit: 'H', value: 60 }] }, /repetida/);
  rejects({ ...base, limits: [{ incidence: '999', unit: 'D', value: 1 }] }, /no existe en la tabla INCIDENC/);
  rejects({ ...base, limits: [{ incidence: '001', unit: 'X', value: 1 }] }, /días u horas/);
  rejects({ ...base, limits: [{ incidence: '001', unit: 'D', value: 0 }] }, /0,5/);
  rejects({ ...base, limits: [{ incidence: '003', unit: 'H', value: 90.5 }] }, /horas/);
});

test('sin lista de incidencias no se comprueba que existan', () => {
  const c = sanitizeConvenio({ ...base, limits: [{ incidence: 'ZZZ', unit: 'D', value: 1 }] }, { uppercase: false });
  assert.equal(c.code, 'ofi');
  assert.equal(c.limits[0].incidence, 'ZZZ');
});

test('día/mes de inicio: febrero solo hasta el 28', () => {
  assert.equal(validDayMonth(28, 2), true);
  assert.equal(validDayMonth(29, 2), false);
  assert.equal(validDayMonth(31, 12), true);
  assert.equal(validDayMonth(31, 11), false);
  assert.equal(validDayMonth(1, 13), false);
});

test('periodo de un año que contiene la fecha de referencia', () => {
  assert.deepEqual(periodAround(1, 1, '2026-10-09'), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(periodAround(1, 9, '2026-10-09'), { from: '2026-09-01', to: '2027-08-31' });
  assert.deepEqual(periodAround(1, 11, '2026-10-09'), { from: '2025-11-01', to: '2026-10-31' });
  assert.deepEqual(periodAround(9, 10, '2026-10-09'), { from: '2026-10-09', to: '2027-10-08' });
  assert.deepEqual(periodAround(1, 3, '2028-02-29'), { from: '2027-03-01', to: '2028-02-29' });
});

test('el script crea las dos tablas solo si no existen, en el esquema indicado', () => {
  const sql = conveniosSql('evalos');
  assert.match(sql, /IF OBJECT_ID\(N'\[evalos\]\.\[PS_CONVENIOS\]', N'U'\) IS NULL/);
  assert.match(sql, /CREATE TABLE \[evalos\]\.\[PS_CONVENIOS_LIMITES\]/);
  assert.match(sql, /REFERENCES \[evalos\]\.\[PS_CONVENIOS\] \(CV_CODI\) ON DELETE CASCADE/);
  assert.match(conveniosSql(), /\[dbo\]\.\[PS_CONVENIOS\]/);
  assert.match(conveniosSql('ra]ro'), /\[ra\]\]ro\]/);
});
