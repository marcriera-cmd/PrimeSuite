// Tests de Convenios: validación del formulario, periodos de un año y script de las tablas PS_CONVENIOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './http.ts';
import { conveniosSql, detectColorFormat, encodeColor, periodAround, sanitizeConvenio, validDayMonth } from './evalos/convenios.ts';
import { evalosColor } from './evalos/mssql.ts';

const base = {
  code: 'ofi', name: '  Convenio   de oficinas ', incidenceDay: 1, incidenceMonth: 9,
  vacations: [{ type: 'V26', day: 1, month: 4, days: 23 }, { type: 'AP', day: 1, month: 1, days: '2,5' }],
  limits: [{ incidence: '003', unit: 'H', value: 1230 }, { incidence: '001', unit: 'D', value: 2.5 }]
};
const opts = { uppercase: true, incidences: new Set(['001', '003']), vacationTypes: new Set(['V26', 'AP']) };
const rejects = (b: any, re: RegExp) => assert.throws(() => sanitizeConvenio(b, opts), (e: any) => e instanceof HttpError && e.status === 400 && re.test(e.message));

test('normaliza el convenio: código en mayúsculas, nombre limpio y límites ordenados', () => {
  const c = sanitizeConvenio(base, opts);
  assert.equal(c.code, 'OFI');
  assert.equal(c.name, 'Convenio de oficinas');
  assert.deepEqual(c.limits.map((l) => l.incidence), ['001', '003']);
  assert.deepEqual(c.limits[1], { incidence: '003', unit: 'H', value: 1230 });
  assert.deepEqual(c.vacations, [{ type: 'V26', day: 1, month: 4, days: 23 }, { type: 'AP', day: 1, month: 1, days: 2.5 }]);
  // Varios periodos del mismo tipo, con inicios distintos.
  const dos = sanitizeConvenio({ ...base, vacations: [{ type: 'V26', day: 1, month: 1, days: 15 }, { type: 'V26', day: 1, month: 7, days: 8 }] }, opts);
  assert.equal(dos.vacations.length, 2);
  assert.deepEqual(sanitizeConvenio({ ...base, vacations: [] }, opts).vacations, []);
});

test('rechaza datos no válidos', () => {
  rejects({ ...base, code: '' }, /código/);
  rejects({ ...base, code: 'DEMASIADOLARGO' }, /10 caracteres/);
  rejects({ ...base, name: ' ' }, /nombre/);
  rejects({ ...base, vacations: [{ type: 'V26', day: 29, month: 2, days: 22 }] }, /periodo de V26 no es una fecha/);
  rejects({ ...base, vacations: [{ type: 'V26', day: 1, month: 6, days: 22 }, { type: 'V26', day: 1, month: 6, days: 3 }] }, /V26 que empieza el 01\/06 está repetido/);
  rejects({ ...base, vacations: [{ type: 'XX', day: 1, month: 1, days: 22 }] }, /no existe en TIPOSVACACIONES/);
  rejects({ ...base, vacations: [{ type: '', day: 1, month: 1, days: 22 }] }, /tipo de vacaciones de la línea 1/);
  rejects({ ...base, vacations: [{ type: 'AP', day: 1, month: 1, days: 22.3 }] }, /medios días/);
  rejects({ ...base, vacations: [{ type: 'AP', day: 1, month: 1, days: 0 }] }, /0,5/);
  rejects({ ...base, incidenceDay: 31, incidenceMonth: 4 }, /incidencias no es una fecha/);
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

test('el script crea las tres tablas solo si no existen, en el esquema indicado', () => {
  const sql = conveniosSql('evalos');
  assert.match(sql, /IF OBJECT_ID\(N'\[evalos\]\.\[PS_CONVENIOS\]', N'U'\) IS NULL/);
  assert.match(sql, /CREATE TABLE \[evalos\]\.\[PS_CONVENIOS_LIMITES\]/);
  assert.match(sql, /CREATE TABLE \[evalos\]\.\[PS_CONVENIOS_VACACIONES\][\s\S]*PRIMARY KEY \(CA_CONV, CA_LINE\)/);
  assert.match(sql, /IF COL_LENGTH\(N'\[evalos\]\.\[PS_CONVENIOS_VACACIONES\]', N'CA_LINE'\) IS NULL/);
  assert.match(conveniosSql("o'x"), /EXEC \(N'WITH n AS \(SELECT CA_LINE[\s\S]*FROM \[o''x\]\.\[PS_CONVENIOS_VACACIONES\]/);
  assert.match(sql, /REFERENCES \[evalos\]\.\[PS_CONVENIOS\] \(CV_CODI\) ON DELETE CASCADE/);
  assert.match(conveniosSql(), /\[dbo\]\.\[PS_CONVENIOS\]/);
  assert.match(conveniosSql('ra]ro'), /\[ra\]\]ro\]/);
});

test('color del tipo de vacaciones en el formato de la tabla, y se lee igual', () => {
  assert.equal(encodeColor('#1565c0', 'hex'), '1565C0');
  assert.equal(encodeColor('#ff0000', 'ole'), 255);
  assert.equal(encodeColor('#0000ff', 'argb'), -16776961);
  assert.equal(encodeColor('rojo', 'hex'), null);
  for (const f of ['hex', 'ole', 'argb'] as const) assert.equal(evalosColor(encodeColor('#2e7d32', f)), '#2e7d32');
  assert.equal(detectColorFormat(true, ['000066', 'FF8800']), 'hex');
  assert.equal(detectColorFormat(true, []), 'hex');
  assert.equal(detectColorFormat(false, [255, 65280]), 'ole');
  assert.equal(detectColorFormat(false, [-16776961]), 'argb');
  assert.equal(detectColorFormat(true, ['255', '16711680']), 'ole');
});
