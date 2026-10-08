// Interpretación de las respuestas de EvalosRest para Correcciones › Marcajes.
// Ejecutar con:  npm test   (node --import tsx --test server/*.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normDate, normTime, rowsOf, parseAnomalies, parseBookings, buildMarcajes } from './evalos/marcajesrest.ts';

test('fechas y horas de Evalos', () => {
  assert.equal(normDate('20261005'), '2026-10-05');
  assert.equal(normDate('5/10/2026'), '2026-10-05');
  assert.equal(normDate('2026-10-05T00:00:00'), '2026-10-05');
  assert.equal(normDate('10000001'), '', 'un código de empleado no es una fecha');
  assert.equal(normTime('080200'), '08:02:00');
  assert.equal(normTime('8:02'), '08:02:00');
  assert.equal(normTime('2026-10-05T17:05:09Z'), '17:05:09');
});

test('rowsOf entiende las formas habituales de listado', () => {
  assert.deepEqual(rowsOf([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(rowsOf({ Columns: [{ Name: 'A' }, { Name: 'B' }], Rows: [[1, 2]] }), [{ A: 1, B: 2 }]);
  assert.deepEqual(rowsOf({ Table: [{ x: 'y' }] }), [{ x: 'y' }]);
  assert.deepEqual(rowsOf(JSON.stringify({ Rows: [{ k: 'v' }] })), [{ k: 'v' }]);
});

test('anomalías PS_ANOMA: solo los días con algún contador distinto de cero', () => {
  const a = parseAnomalies([
    { EM_CODI: '10000001', EM_NOMB: 'RUIZ, EVA', FECHA: '02/10/2026', RETRA: '0:00', SAANT: '0:00', FUHOR: 0, ABSIN: '', 'M. IMPARES': 0, NFSTR: '0', NVATR: 0 },
    { EM_CODI: '10000001', EM_NOMB: 'RUIZ, EVA', FECHA: '03/10/2026', RETRA: '0:10', SAANT: '0:00', FUHOR: '1:30', ABSIN: '0:00', 'M. IMPARES': 1, NFSTR: 0, NVATR: 0 },
    { otra: 'fila' }
  ]);
  assert.deepEqual(a, [{ employee: '10000001', employeeName: 'RUIZ, EVA', date: '2026-10-03', text: 'Retraso 0:10 · Fuera de horas 1:30 · Marcajes impares' }]);
});

test('marcajes sin sentido E/S se alternan y se ordenan', () => {
  const b = parseBookings([
    { CodeEmployee: '1', Date: '20261002', Time: '140000', Installation: 'L', Clock: '01' },
    { CodeEmployee: '1', Date: '20261002', Time: '080000', Debug: 'MAN', Incidence: '02' },
    { CodeEmployee: '1', Date: '20261002', Time: '080000', Debug: 'MAN', Incidence: '02' }
  ]);
  const m = buildMarcajes(b, [], new Map([['1', 'UNO']]));
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].punches.map((p) => [p.time, p.type, p.manual, p.incidence]), [['08:00', 'E', true, '02'], ['14:00', 'S', false, '00']]);
  assert.equal(m[0].employeeName, 'UNO');
});
