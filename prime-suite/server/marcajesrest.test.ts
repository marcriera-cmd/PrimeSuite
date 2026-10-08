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

test('anomalías PS_ANOMA: el título de la columna, cuando vale 1 o no es cero', () => {
  const a = parseAnomalies([
    { 'Código': '10101010', Nombre: 'MARC RIERA', FECHA: '08/10/2026', RETRASO: '-', 'SALIDA ANTES': '-', 'FUERA DE HORAS': '-', 'AB. INJUSTIFICADO': '-', 'M. IMPARES': '', 'FES.TRABAJADO': '', 'VAC.TRABAJADAS': '' },
    { 'Código': '43699738', Nombre: 'SERGIO MONDELO', FECHA: '08/10/2026', RETRASO: '-', 'SALIDA ANTES': '-', 'FUERA DE HORAS': '-', 'AB. INJUSTIFICADO': '-', 'M. IMPARES': '1', 'FES.TRABAJADO': '', 'VAC.TRABAJADAS': '' },
    { 'Código': '1', Nombre: 'X', FECHA: '07/10/2026', RETRASO: '00:20', 'SALIDA ANTES': '0:00', 'M. IMPARES': 0, 'FES.TRABAJADO': 1 },
    { otra: 'fila' }
  ]);
  assert.deepEqual(a, [
    { employee: '43699738', employeeName: 'SERGIO MONDELO', date: '2026-10-08', items: ['M. IMPARES'] },
    { employee: '1', employeeName: 'X', date: '2026-10-07', items: ['RETRASO', 'FES.TRABAJADO'] }
  ]);
});

test('el listado con columnas CAnnn y cabeceras se lee por la cabecera', () => {
  const data = { Columns: [{ Name: 'CA001', Header: 'Código' }, { Name: 'CA002', Header: 'Nombre' }, { Name: 'CA003', Header: 'FECHA' }, { Name: 'CA008', Header: 'M. IMPARES' }], Rows: [{ CA001: '9', CA002: 'Y', CA003: '08/10/2026', CA008: 1 }] };
  assert.deepEqual(parseAnomalies(data), [{ employee: '9', employeeName: 'Y', date: '2026-10-08', items: ['M. IMPARES'] }]);
  assert.deepEqual(parseAnomalies([['Código', 'Nombre', 'FECHA', 'M. IMPARES'], ['9', 'Y', '08/10/2026', '1']]), [{ employee: '9', employeeName: 'Y', date: '2026-10-08', items: ['M. IMPARES'] }]);
});

test('formato real de Report/filter: header + body con columns por Number', () => {
  const cell = (n: number, v: string) => ({ Number: String(n), Value: v });
  const titles = ['TIPO', 'CÓDIGO', 'NOMBRE', 'FECHA', 'RETRASO', 'SALIDA ANTES', 'FUERA DE HORAS', 'AB. INJUSTIFICADO', 'M. IMPARES', 'FES.TRABAJADO', 'VAC.TRABAJADAS'];
  const row = (n: number, vals: string[]) => ({ RowNumber: String(n), columns: vals.map((v, i) => cell(i + 1, v)) });
  const data = {
    Name: 'PS_ANOMA', ReportNumber: 'x', ReportError: '',
    header: titles.map((t, i) => cell(i + 1, t)),
    body: [
      row(1, ['DT', '10101010', 'MARC RIERA', '02/10/2026', '   -   ', '   -   ', '   -   ', '   -   ', '', '', '']),
      row(2, ['', '10101010', 'MARC RIERA', '05/10/2026', '   -   ', '   -   ', '   -   ', '   -   ', '1', '', '']),
      row(3, ['', '43699738', 'SERGIO MONDELO', '08/10/2026', '   -   ', '   -   ', '   -   ', '   -   ', '1', '', ''])
    ]
  };
  assert.deepEqual(parseAnomalies(data), [
    { employee: '10101010', employeeName: 'MARC RIERA', date: '2026-10-05', items: ['M. IMPARES'] },
    { employee: '43699738', employeeName: 'SERGIO MONDELO', date: '2026-10-08', items: ['M. IMPARES'] }
  ]);
});

test('payload de modificación: manual cambia la hora; terminal conserva hora y terminal', async () => {
  const { bookingPayload } = await import('./evalos/marcajesrest.ts');
  assert.deepEqual(bookingPayload('1', '2026-10-08', [
    { time: '10:50', incidence: '000', original: '10:46:12', ref: { debug: 'MAN' } },
    { time: '17:00', incidence: '000' }
  ]), [
    { CodeEmployee: '1', Date: '20261008', Time: '105000', Incidence: '000', Debug: 'MAN' },
    { CodeEmployee: '1', Date: '20261008', Time: '170000', Incidence: '000', Debug: 'MAN' }
  ]);
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

test('todos los días del periodo aparecen, aunque no tengan marcajes ni anomalías', async () => {
  const { buildMarcajes: build } = await import('./evalos/marcajesrest.ts');
  const b = parseBookings([{ CodeEmployee: '1', Date: '20261002', Time: '080000', Installation: 'L' }]);
  const m = build(b, [{ employee: '3', date: '2026-10-01', items: ['M. IMPARES'] }], new Map([['1', 'UNO'], ['2', 'DOS']]), { from: '2026-10-01', to: '2026-10-03', employees: ['1', '2'] });
  assert.equal(m.length, 7, 'empleados 1 y 2 × 3 días + el día con anomalía del empleado 3');
  assert.equal(m.find((x) => x.id === '2|2026-10-02')!.punches.length, 0);
  assert.equal(m.find((x) => x.id === '3|2026-10-01')!.status, 'INCIDENCIA');
  assert.deepEqual([...new Set(m.map((x) => x.date))], ['2026-10-03', '2026-10-02', '2026-10-01']);
});

test('el día muestra una sola cosa: ausencia > vacaciones > turno, con descripción y color', async () => {
  const { dayInfo } = await import('./evalos/marcajesrest.ts');
  const labels = { shifts: [{ code: 'DEF', name: 'TURNO GENERAL', color: '#000066' }], holidays: [{ code: 'V1', name: 'VACACIONES', color: '#ff0000' }], absences: [{ code: '003', name: 'MEDICO', color: null }] };
  assert.deepEqual(dayInfo({ schedule: 'DEF', absence: '003', holiday: 'V1' }, labels), { kind: 'absence', code: '003', name: 'MEDICO', color: null });
  assert.deepEqual(dayInfo({ schedule: 'DEF', holiday: 'V1' }, labels), { kind: 'holiday', code: 'V1', name: 'VACACIONES', color: '#ff0000' });
  assert.deepEqual(dayInfo({ schedule: 'DEF' }, labels), { kind: 'shift', code: 'DEF', name: 'TURNO GENERAL', color: '#000066' });
  assert.deepEqual(dayInfo({ schedule: 'XX' }, labels), { kind: 'shift', code: 'XX', name: 'XX', color: null });
  assert.equal(dayInfo({}, labels), undefined);
});
