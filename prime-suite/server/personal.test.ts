// Tests de la pantalla Personal de Atajos de Evalos: validación de la ficha, driver de demostración
// y SQL que genera el driver de SQL Server sobre la tabla PERSONAL (con la BD simulada).
// Ejecutar con:  npm test   (node --import tsx --test server/*.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRIME_STORE = 'file';
process.env.PRIME_DATA_DIR = mkdtempSync(join(tmpdir(), 'ps-personal-'));

const { sanitizePersonal, sanitizeNewNames, sanitizeOrgValue } = await import('./evalos/personal.ts');
const { DemoDriver } = await import('./evalos/demo.ts');
const { SqlServerDriver } = await import('./evalos/mssql.ts');
const { DEFAULT_MAPPING } = await import('./evalos/types.ts');
const { madridNow, nextCode, prevDay } = await import('./evalos/history.ts');
type Lookups = import('./evalos/types.ts').PersonalLookups;
type ColumnInfo = import('./evalos/types.ts').ColumnInfo;

const LOOKUPS: Lookups = {
  company: [{ code: 'PRI', description: 'PRIMION' }],
  department: [{ code: 'IT', description: 'INFORMÁTICA' }],
  section: [], area: null, consultas: [{ code: '001', description: 'BÁSICA' }], solicitudes: [{ code: '001', description: 'ESTÁNDAR' }]
};
const LIMITS = { code: 50, name: 100, card: 50, email: 100, company: 15, department: 15, section: 15, area: 15, consultas: 3, solicitudes: 3 };
const BASE = { code: 'e01', name: 'garcía  pérez,   ana', card: '1234', email: 'ana@primion.es', hireDate: '2026-10-01', endDate: '', company: 'PRI', department: 'IT', section: '', area: 'LIBRE', consultas: '001', solicitudes: '001' };
const opts = { uppercase: true, limits: LIMITS, lookups: LOOKUPS };
const STAMP = { date: '20261007', time: '1559', user: 'SMO' };

const status = (fn: () => unknown) => {
  try { fn(); return 0; } catch (e: any) { return e.status ?? -1; }
};

test('validación: normaliza código y nombre en mayúsculas', () => {
  const p = sanitizePersonal(BASE, opts);
  assert.equal(p.code, 'E01');
  assert.equal(p.name, 'GARCÍA PÉREZ, ANA');
  assert.equal(p.email, 'ana@primion.es');
  assert.equal(p.area, 'LIBRE'); // sin tabla AREA: texto libre
});

test('validación: código, nombre, tarjeta y alta son obligatorios', () => {
  for (const k of ['code', 'name', 'card', 'hireDate']) assert.equal(status(() => sanitizePersonal({ ...BASE, [k]: '' }, opts)), 400, k);
  assert.equal(status(() => sanitizePersonal({ ...BASE, email: '' }, opts)), 0);
});

test('validación: fechas, email, longitudes y valores de los desplegables', () => {
  assert.equal(status(() => sanitizePersonal({ ...BASE, hireDate: '2026-02-30' }, opts)), 400);
  assert.equal(status(() => sanitizePersonal({ ...BASE, endDate: '2026-09-30' }, opts)), 400); // baja anterior al alta
  assert.equal(status(() => sanitizePersonal({ ...BASE, endDate: '2026-12-31' }, opts)), 0);
  assert.equal(status(() => sanitizePersonal({ ...BASE, email: 'no-es-un-email' }, opts)), 400);
  assert.equal(status(() => sanitizePersonal({ ...BASE, card: 'x'.repeat(51) }, opts)), 400);
  assert.equal(status(() => sanitizePersonal({ ...BASE, department: 'NOEXISTE' }, opts)), 400);
  assert.equal(status(() => sanitizePersonal({ ...BASE, consultas: '' }, opts)), 0);
});

test('validación: al modificar, el código lo fija la URL y la tarjeta no se pide', () => {
  const p = sanitizePersonal({ ...BASE, code: 'OTRO', card: '' }, { ...opts, code: 'E01' });
  assert.equal(p.code, 'E01');
  assert.equal(p.card, '');
});

test('fecha y hora de los cambios en hora de Madrid', () => {
  // 7 oct 2026 13:59 UTC = 15:59 en Madrid (horario de verano); 31 dic 23:30 UTC = 1 ene 00:30
  assert.deepEqual(madridNow(new Date('2026-10-07T13:59:00Z')), { date: '20261007', time: '1559' });
  assert.deepEqual(madridNow(new Date('2026-12-31T23:30:00Z')), { date: '20270101', time: '0030' });
});

test('demo: alta, modificación, tarjeta duplicada y eliminación', async () => {
  const d = new DemoDriver('co-test');
  const emp = sanitizePersonal(BASE, opts);
  await d.createPersonal(emp, STAMP);
  await assert.rejects(d.createPersonal(emp, STAMP), (e: any) => e.status === 409);
  await assert.rejects(d.createPersonal({ ...emp, code: 'E02' }, STAMP), (e: any) => e.status === 409 && /tarjeta 1234/.test(e.message));
  const [a] = await d.personalHistory('E01').then((h) => h.card);
  assert.deepEqual({ value: a.value, from: a.from, to: a.to, type: a.type, user: a.user }, { value: '1234', from: '2026-10-01', to: '', type: 'A', user: 'SMO' });

  const { code: _c, ...rest } = emp;
  await d.updatePersonal('E01', { ...rest, name: 'NUEVO NOMBRE', endDate: '2026-10-02' }, STAMP);
  const got = await d.getPersonal('E01');
  assert.equal(got?.name, 'NUEVO NOMBRE');
  assert.equal(got?.code, 'E01');
  assert.equal(got?.endDate, '2026-10-02');
  assert.equal(got?.active, false);
  assert.ok((await d.listPersonal()).some((x) => x.code === 'E01'));

  await d.deletePersonal('E01');
  assert.equal(await d.getPersonal('E01'), null);
  assert.equal((await d.personalHistory('E01').then((h) => h.card)).length, 0, 'se borran sus asignaciones');
});

test('demo: asignar y desasignar tarjetas, varias por empleado y sin solapes', async () => {
  const d = new DemoDriver('co-cards');
  const today = madridNow().date;
  const iso = (y: string) => `${y.slice(0, 4)}-${y.slice(4, 6)}-${y.slice(6, 8)}`;
  await d.createPersonal(sanitizePersonal({ ...BASE, code: 'A1', card: 'T1', hireDate: '2026-01-01' }, opts), STAMP);
  await d.createPersonal(sanitizePersonal({ ...BASE, code: 'B1', card: 'T9', hireDate: '2026-01-01' }, opts), STAMP);

  // Segunda tarjeta para A1: EM_TARJ pasa a la más reciente.
  await d.assignHistory('card', 'A1', { code: 'T2' }, '2026-02-01', STAMP);
  assert.equal((await d.getPersonal('A1'))?.card, 'T2');
  assert.equal((await d.personalHistory('A1').then((h) => h.card)).filter((c) => c.active).length, 2);

  // Otro empleado no puede coger una tarjeta vigente; tampoco repetir la misma en el mismo empleado.
  await assert.rejects(d.assignHistory('card', 'B1', { code: 'T1' }, iso(today), STAMP), (e: any) => e.status === 409 && /A1/.test(e.message));
  await assert.rejects(d.assignHistory('card', 'A1', { code: 'T1' }, '2026-03-01', STAMP), (e: any) => e.status === 409);

  // Desasignar T2 con baja ayer: se cierra el tramo (B) y EM_TARJ vuelve a T1.
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  await d.closeHistory('card', 'A1', 'T2', '2026-02-01', yesterday, { ...STAMP, date: today });
  const t2 = (await d.personalHistory('A1').then((h) => h.card)).find((c) => c.value === 'T2')!;
  assert.equal(t2.type, 'B');
  assert.equal(t2.to, yesterday);
  assert.equal(t2.active, false);
  assert.equal((await d.getPersonal('A1'))?.card, 'T1');

  // Una vez cerrada, otro empleado puede tenerla desde hoy.
  await d.assignHistory('card', 'B1', { code: 'T2' }, iso(today), STAMP);
  assert.ok((await d.personalHistory('B1').then((h) => h.card)).some((c) => c.value === 'T2' && c.active));

  // No se puede cerrar dos veces ni con baja anterior al alta.
  await assert.rejects(d.closeHistory('card', 'A1', 'T2', '2026-02-01', yesterday, { ...STAMP, date: today }), (e: any) => e.status === 404);
  await assert.rejects(d.closeHistory('card', 'A1', 'T1', '2026-01-01', '2025-12-31', STAMP), (e: any) => e.status === 400);

  // Al modificar la ficha no se toca la tarjeta.
  const { code: _c, ...rest } = sanitizePersonal({ ...BASE, card: '' }, { ...opts, code: 'A1' });
  await d.updatePersonal('A1', rest, STAMP);
  assert.equal((await d.getPersonal('A1'))?.card, 'T1');
});

test('demo: no deja eliminar a un empleado con marcajes', async () => {
  const d = new DemoDriver('co-test-2');
  const withPunches = (await d.listMarcajes())[0].employee;
  await assert.rejects(d.deletePersonal(withPunches), (e: any) => e.status === 409 && /marcajes/.test(e.message));
});

// ---------- SQL Server simulado ----------
const col = (name: string, type = 'nvarchar', maxLength: number | null = 15, nullable = true): ColumnInfo => ({ name, type, maxLength, nullable, hasDefault: false, identity: false, computed: false });
const PERSONAL_COLS = [
  col('EM_CODI', 'varchar', 50, false), col('EM_NOMB', 'nvarchar', 100), col('EM_TARJ', 'varchar', 50), col('EM_WFEM', 'nvarchar', 100),
  col('EM_FALT', 'nvarchar', 8), col('EM_FBAJ', 'nvarchar', 8), col('EM_CEMP'), col('EM_DEPA'), col('EM_SECC'), col('EM_AREA'),
  col('EM_KOPC', 'nvarchar', 3), col('EM_WFOP', 'nvarchar', 3), col('EM_CACC', 'nvarchar', 3), col('EM_CAUT', 'nvarchar', 3), col('EM_TURN', 'nvarchar', 3),
  col('EM_OBLI', 'int', null, false) // columna obligatoria ajena a la ficha: se rellena con 0
];

const TABLES: Record<string, ColumnInfo[]> = {
  PERSONAL: PERSONAL_COLS,
  TARJETA: [col('TA_CODI', 'nvarchar', 50, false), col('TA_DESC', 'nvarchar', 60)],
  HIS_TARJETA: ['HT_PCOD', 'HT_CODI', 'HT_FALT', 'HT_FBAJ', 'HT_TIPO', 'HT_FECH', 'HT_HORA', 'HT_USUA'].map((n) => col(n, 'nvarchar', 50)),
  DEPMENTO: [col('DP_CODI', 'nvarchar', 15, false), col('DP_DESC', 'nvarchar', 100)],
  HIS_VIGENCIA: ['HV_PCOD', 'HV_FALT', 'HV_FBAJ', 'HV_TIPO', 'HV_FECH', 'HV_HORA', 'HV_USUA'].map((n) => col(n, 'nvarchar', 50)),
  HIS_DEPMENTO: ['HD_PCOD', 'HD_CODI', 'HD_FALT', 'HD_FBAJ', 'HD_TIPO', 'HD_FECH', 'HD_HORA', 'HD_USUA'].map((n) => col(n, 'nvarchar', 50))
};

function fakeSql(handler: (text: string, params: Record<string, unknown>) => { rows?: any[]; affected?: number } | void, employee?: Record<string, unknown>) {
  const drv: any = new SqlServerDriver('Server=x;Database=y', DEFAULT_MAPPING);
  const calls: { text: string; params: Record<string, unknown> }[] = [];
  drv.columns = async (t: { table: string }) => TABLES[t.table] || [];
  drv.inTx = async (fn: any) => fn((text: string, params?: Record<string, unknown>) => drv.query(text, params));
  drv.query = async (text: string, params: Record<string, unknown> = {}) => {
    calls.push({ text, params });
    if (employee && text.startsWith('SELECT p.')) return { rows: [{ code: 'E01', ...employee }], affected: 1 };
    const r = handler(text, params) || {};
    return { rows: r.rows || [], affected: r.affected ?? 1 };
  };
  return { drv, calls };
}

test('SQL Server: el alta escribe la ficha, los valores fijos y las fechas en aaaammdd', async () => {
  const { drv, calls } = fakeSql(() => ({ rows: [] }));
  await drv.createPersonal({ ...sanitizePersonal(BASE, opts), endDate: '2027-01-31' }, STAMP);
  const ins = calls.find((c) => c.text.startsWith('INSERT INTO [PERSONAL]'))!;
  assert.ok(ins, 'debe hacer INSERT');
  const cols = ins.text.match(/\(([^)]*)\) VALUES/)![1].split(', ').map((x) => x.replace(/[[\]]/g, ''));
  const val = (c: string) => ins.params[`v${cols.indexOf(c)}`];
  assert.equal(val('EM_CODI'), 'E01');
  assert.equal(val('EM_FALT'), '20261001');
  assert.equal(val('EM_FBAJ'), '20270131');
  assert.equal(val('EM_SECC'), null); // vacío → NULL
  assert.equal(val('EM_CACC'), '999');
  assert.equal(val('EM_CAUT'), '001');
  assert.equal(val('EM_TURN'), 'DEF');
  assert.equal(val('EM_OBLI'), 0);
  assert.equal(val('EM_TARJ'), '1234');
});

test('SQL Server: el alta crea la tarjeta si no existe y su asignación en HIS_TARJETA', async () => {
  const { drv, calls } = fakeSql(() => ({ rows: [] }));
  await drv.createPersonal(sanitizePersonal(BASE, opts), STAMP);
  const order = calls.map((c) => c.text.replace(/\s+/g, ' ').slice(0, 40));
  const iPers = order.findIndex((t) => t.startsWith('INSERT INTO [PERSONAL]'));
  const iCard = calls.findIndex((c) => /IF NOT EXISTS[\s\S]*INSERT INTO \[TARJETA\] \(\[TA_CODI\], \[TA_DESC\]\)/.test(c.text));
  const iHis = calls.findIndex((c) => c.text.includes('INSERT INTO [HIS_TARJETA]'));
  assert.ok(iPers >= 0 && iCard > iPers && iHis > iCard, order.join(' | '));
  assert.deepEqual(calls[iCard].params, { card: '1234', desc: 'Tarjeta: 1234' });
  assert.match(calls[iHis].text, /VALUES \(@code, @value, @from, '0', 'A', @fech, @hora, @usua\)/);
  assert.deepEqual(calls[iHis].params, { code: 'E01', value: '1234', from: '20261001', fech: '20261007', hora: '1559', usua: 'SMO' });
  // El departamento también abre su tramo desde la fecha de alta (EMPRESA no existe en esta BD simulada: solo EM_CEMP).
  const dep = calls.find((c) => c.text.includes('INSERT INTO [HIS_DEPMENTO] ([HD_PCOD], [HD_CODI], [HD_FALT]'))!;
  assert.deepEqual(dep.params, { code: 'E01', value: 'IT', from: '20261001', fech: '20261007', hora: '1559', usua: 'SMO' });
  assert.ok(!calls.some((c) => c.text.includes('HIS_EMPRESA')));
  // Antes de nada se comprueba que nadie la tenga vigente en la fecha de alta, bloqueando las filas.
  const chk = calls.find((c) => c.text.includes('WITH (UPDLOCK, HOLDLOCK)') && c.text.includes('[HT_PCOD] <> @code'))!;
  assert.equal(chk.params.from, '20261001');
});

test('SQL Server: modificar no toca el código ni los valores fijos', async () => {
  const { drv, calls } = fakeSql(() => ({ rows: [] }), { hireDate: '20261001' });
  const { code: _c, ...rest } = sanitizePersonal(BASE, opts);
  await drv.updatePersonal('E01', rest, STAMP);
  const upd = calls.find((c) => c.text.startsWith('UPDATE'))!;
  const set = upd.text.slice(upd.text.indexOf('SET'), upd.text.indexOf('WHERE'));
  assert.ok(!/EM_CODI|EM_CACC|EM_CAUT|EM_TURN/.test(set), set);
  assert.match(upd.text, /WHERE \[EM_CODI\] = @code/);
  assert.equal(upd.params.code, 'E01');
});

test('SQL Server: tarjeta vigente en otro empleado → 409 y no se inserta nada', async () => {
  const { drv, calls } = fakeSql((text) => (text.includes('[HT_PCOD] <> @code') ? { rows: [{ emp: 'E99', fbaj: '0' }] } : { rows: [] }));
  await assert.rejects(drv.createPersonal(sanitizePersonal(BASE, opts), STAMP), (e: any) => e.status === 409 && /E99 sin fecha de baja/.test(e.message));
  assert.ok(!calls.some((c) => c.text.startsWith('INSERT')));
  const { drv: d2 } = fakeSql((text) => (text.includes('[HT_PCOD] <> @code') ? { rows: [{ emp: 'E98', fbaj: '20261231' }] } : { rows: [{ code: 'E01' }] }));
  await assert.rejects(d2.assignHistory('card', 'E01', { code: '1234' }, '2026-10-07', STAMP), (e: any) => e.status === 409 && /E98 hasta el 31\/12\/2026/.test(e.message));
});

test('SQL Server: modificar no reescribe la tarjeta (EM_TARJ)', async () => {
  const { drv, calls } = fakeSql(() => ({ rows: [] }), { hireDate: '20261001' });
  const { code: _c, ...rest } = sanitizePersonal({ ...BASE, card: 'X' }, opts);
  await drv.updatePersonal('E01', rest, STAMP);
  const upd = calls.find((c) => c.text.startsWith('UPDATE'))!;
  assert.ok(!upd.text.includes('EM_TARJ'), upd.text);
});

test('SQL Server: asignar inserta tramo A y deja EM_TARJ con la vigente más reciente', async () => {
  const { drv, calls } = fakeSql((text) => (text.startsWith('SELECT p.') ? { rows: [{ code: 'E01' }] } : { rows: [] }));
  await drv.assignHistory('card', 'E01', { code: 'T2' }, '2026-10-07', STAMP);
  const his = calls.find((c) => c.text.includes('INSERT INTO [HIS_TARJETA]'))!;
  assert.equal(his.params.from, '20261007');
  const sync = calls.find((c) => c.text.startsWith('UPDATE [PERSONAL] SET [EM_TARJ]'))!;
  assert.ok(sync, 'sincroniza EM_TARJ');
  assert.match(sync.text.replace(/\s+/g, ' '), /ORDER BY CASE WHEN .* THEN 0 ELSE 1 END, h\.\[HT_FALT\] DESC/);
  assert.equal(sync.params.today, '20261007');
});

test('SQL Server: desasignar cierra el tramo con baja, tipo B, fecha, hora e iniciales', async () => {
  const { drv, calls } = fakeSql(() => ({ rows: [], affected: 1 }));
  await drv.closeHistory('card', 'E01', 'T2', '2026-01-01', '2026-10-07', STAMP);
  const upd = calls.find((c) => c.text.startsWith('UPDATE [HIS_TARJETA]'))!;
  assert.match(upd.text, /SET \[HT_FBAJ\] = @to, \[HT_TIPO\] = 'B', \[HT_FECH\] = @fech, \[HT_HORA\] = @hora, \[HT_USUA\] = @usua/);
  assert.match(upd.text, /WHERE \[HT_PCOD\] = @code AND \[HT_CODI\] = @value AND \[HT_FALT\] = @from/);
  assert.equal(upd.params.to, '20261007');
  assert.equal(upd.params.from, '20260101');
  assert.ok(calls.some((c) => c.text.startsWith('UPDATE [PERSONAL] SET [EM_TARJ]')));
  // Si no hay tramo vigente que cerrar → 404
  const { drv: d2 } = fakeSql(() => ({ rows: [], affected: 0 }));
  await assert.rejects(d2.closeHistory('card', 'E01', 'T2', '2026-01-01', '2026-10-07', STAMP), (e: any) => e.status === 404);
});

test('SQL Server: historial de tarjetas, vigencia y registro', async () => {
  const { drv } = fakeSql(() => ({ rows: [
    { value: 'T2', falt: '20261001', fbaj: '0', tipo: 'A', fech: '20261001', hora: '0905', usua: 'SMO' },
    { value: 'T1', falt: '20250101', fbaj: '20250930', tipo: 'B', fech: '20250930', hora: '1800', usua: 'ABC' }
  ] }));
  const [a, b] = await drv.personalHistory('E01').then((h: any) => h.card);
  assert.deepEqual(a, { value: 'T2', from: '2026-10-01', to: '', type: 'A', active: true, recordedAt: '2026-10-01 09:05', user: 'SMO' });
  assert.equal(b.active, false);
  assert.equal(b.to, '2025-09-30');
});

test('SQL Server: no elimina si el empleado tiene marcajes', async () => {
  const { drv, calls } = fakeSql((text) => {
    if (text.includes('INFORMATION_SCHEMA.COLUMNS')) return { rows: [{ t: 'MARCAPRES', c: 'MP_CODI' }, { t: 'PERSONALACCESO', c: 'PA_CODIEMP' }] };
    if (text.includes('UNION ALL') || text.includes('COUNT(*)')) return { rows: [{ what: 'marcajes de presencia', n: 3 }, { what: 'accesos asignados', n: 0 }] };
  });
  await assert.rejects(drv.deletePersonal('E01'), (e: any) => e.status === 409 && /marcajes de presencia \(3\)/.test(e.message));
  assert.ok(!calls.some((c) => c.text.startsWith('DELETE')));
});

test('SQL Server: elimina si no hay datos relacionados', async () => {
  const { drv, calls } = fakeSql((text) => {
    if (text.includes('INFORMATION_SCHEMA.COLUMNS')) return { rows: [{ t: 'MARCAPRES', c: 'MP_CODI' }] };
    if (text.includes('COUNT(*)')) return { rows: [{ what: 'marcajes de presencia', n: 0 }] };
  });
  await drv.deletePersonal('E01');
  const iHis = calls.findIndex((c) => c.text.startsWith('DELETE FROM [HIS_TARJETA] WHERE [HT_PCOD] = @code'));
  const iPer = calls.findIndex((c) => c.text.startsWith('DELETE FROM [PERSONAL] WHERE [EM_CODI] = @code'));
  assert.ok(iHis >= 0 && iPer > iHis, 'borra sus asignaciones y después el empleado');
  assert.ok(!calls.some((c) => c.text.includes('DELETE FROM [TARJETA]')), 'las tarjetas se conservan');
});

test('SQL Server: lectura convierte fechas aaaammdd y calcula activo', async () => {
  const { drv } = fakeSql((text) => (text.startsWith('SELECT') ? { rows: [{ code: 'E01 ', name: 'ANA', hireDate: '20261001', endDate: null, active: 1 }] } : undefined));
  const [e] = await drv.listPersonal();
  assert.equal(e.code, 'E01');
  assert.equal(e.hireDate, '2026-10-01');
  assert.equal(e.endDate, '');
  assert.equal(e.active, true);
});

// ---------- Organización: empresa, departamento, sección y área ----------

test('códigos automáticos y día anterior', () => {
  assert.equal(nextCode([], 15), '1');
  assert.equal(nextCode(['ADMIN', 'RRHH'], 15), '1');
  assert.equal(nextCode(['1', '2', '10', 'X'], 15), '11');
  assert.equal(nextCode(['001', '007'], 15), '008');
  assert.throws(() => nextCode(['99'], 2));
  assert.equal(prevDay('2026-03-01'), '2026-02-28');
  assert.equal(prevDay('2026-01-01'), '2025-12-31');
});

test('validación: nombres escritos en el alta → código existente o nombre nuevo', () => {
  const emp = sanitizePersonal({ ...BASE, company: '', department: '' }, opts);
  const names = sanitizeNewNames({ company: 'primion', department: '  logística   norte ' }, emp, { uppercase: true, lookups: LOOKUPS });
  assert.equal(emp.company, 'PRI'); // coincide con el nombre de una existente
  assert.deepEqual(names, { department: 'LOGÍSTICA NORTE' });
  assert.deepEqual(sanitizeOrgValue({ name: 'informática' }, 'department', { uppercase: true, lookups: LOOKUPS }), { code: 'IT' });
  assert.deepEqual(sanitizeOrgValue({ name: 'Nuevo' }, 'department', { uppercase: true, lookups: LOOKUPS }), { name: 'NUEVO' });
  assert.equal(status(() => sanitizeOrgValue({ code: 'XX' }, 'department', { uppercase: true, lookups: LOOKUPS })), 400);
});

test('demo: alta con un departamento nuevo lo crea y abre su tramo', async () => {
  const d = new DemoDriver('co-org-1');
  const emp = sanitizePersonal({ ...BASE, code: 'N1', card: 'C-N1', company: '', department: '', section: '', area: '' }, opts);
  await d.createPersonal(emp, STAMP, { department: 'CALIDAD' });
  const dep = (await d.personalLookups()).department!.find((x) => x.description === 'CALIDAD')!;
  assert.ok(dep, 'se crea en DEPMENTO');
  assert.equal((await d.getPersonal('N1'))?.department, dep.code);
  const [t] = (await d.personalHistory('N1')).department;
  assert.deepEqual({ value: t.value, from: t.from, to: t.to, type: t.type }, { value: dep.code, from: '2026-10-01', to: '', type: 'A' });
});

test('demo: cambiar de departamento cierra el anterior el día antes; solo uno vigente', async () => {
  const d = new DemoDriver('co-org-2');
  const deps = (await d.personalLookups()).department!;
  const [d1, d2, d3] = deps.map((x) => x.code);
  await d.createPersonal(sanitizePersonal({ ...BASE, code: 'O1', card: 'C-O1', department: '', hireDate: '2026-01-01' }, opts), STAMP);
  await d.assignHistory('department', 'O1', { code: d1 }, '2026-01-01', STAMP);
  await assert.rejects(d.assignHistory('department', 'O1', { code: d1 }, '2026-05-01', STAMP), (e: any) => e.status === 409 && /ya está/.test(e.message));
  await assert.rejects(d.assignHistory('department', 'O1', { code: d2 }, '2026-01-01', STAMP), (e: any) => e.status === 409 && /posterior/.test(e.message));

  await d.assignHistory('department', 'O1', { code: d2 }, '2026-06-01', STAMP);
  const h = (await d.personalHistory('O1')).department;
  const old = h.find((x) => x.value === d1)!;
  const cur = h.find((x) => x.value === d2)!;
  assert.equal(old.to, '2026-05-31');
  assert.equal(old.type, 'B');
  assert.equal(old.active, false);
  assert.equal(cur.to, '');
  assert.equal(h.filter((x) => !x.to).length, 1, 'un único tramo abierto');
  assert.equal((await d.getPersonal('O1'))?.department, d2);

  // Un nombre nuevo desde la ficha también se crea.
  await d.assignHistory('department', 'O1', { name: 'I+D' }, '2026-09-01', STAMP);
  const nuevo = (await d.personalLookups()).department!.find((x) => x.description === 'I+D')!;
  assert.equal((await d.getPersonal('O1'))?.department, nuevo.code);
  assert.equal((await d.personalHistory('O1')).department.find((x) => x.value === d2)!.to, '2026-08-31');

  // Quitar: cierra el vigente y deja el campo vacío.
  await d.closeHistory('department', 'O1', nuevo.code, '2026-09-01', '2026-09-15', { ...STAMP, date: '20261007' });
  assert.equal((await d.getPersonal('O1'))?.department, '');
  void d3;
});

test('demo: varios empleados pueden compartir departamento (a diferencia de las tarjetas)', async () => {
  const d = new DemoDriver('co-org-3');
  const dep = (await d.personalLookups()).department![0].code;
  const o = { ...opts, lookups: await d.personalLookups() };
  await d.createPersonal(sanitizePersonal({ ...BASE, code: 'S1', card: 'C-S1', company: '', area: '', department: dep }, o), STAMP);
  await d.createPersonal(sanitizePersonal({ ...BASE, code: 'S2', card: 'C-S2', company: '', area: '', department: dep }, o), STAMP);
  assert.equal((await d.personalHistory('S2')).department[0].value, dep);
});

test('SQL Server: cambiar de departamento cierra el abierto el día antes, abre el nuevo y actualiza EM_DEPA', async () => {
  const { drv, calls } = fakeSql((text) => {
    if (text.startsWith('SELECT p.')) return { rows: [{ code: 'E01' }] };
    if (text.includes('FROM [HIS_DEPMENTO] WITH (UPDLOCK, HOLDLOCK)')) return { rows: [{ value: 'IT', falt: '20260101' }] };
    return { rows: [] };
  });
  await drv.assignHistory('department', 'E01', { code: 'RRHH' }, '2026-10-07', STAMP);
  const close = calls.find((c) => c.text.startsWith('UPDATE [HIS_DEPMENTO]'))!;
  assert.match(close.text, /SET \[HD_FBAJ\] = @to, \[HD_TIPO\] = 'B'/);
  assert.equal(close.params.to, '20261006');
  const iClose = calls.indexOf(close);
  const iIns = calls.findIndex((c) => c.text.startsWith('INSERT INTO [HIS_DEPMENTO]'));
  const iSync = calls.findIndex((c) => c.text.startsWith('UPDATE [PERSONAL] SET [EM_DEPA]'));
  assert.ok(iClose < iIns && iIns < iSync, 'cierra, abre y sincroniza en ese orden');
  assert.equal(calls[iIns].params.value, 'RRHH');
});

test('SQL Server: no deja abrir un tramo anterior o igual al vigente', async () => {
  const { drv, calls } = fakeSql((text) => {
    if (text.startsWith('SELECT p.')) return { rows: [{ code: 'E01' }] };
    if (text.includes('FROM [HIS_DEPMENTO] WITH (UPDLOCK, HOLDLOCK)')) return { rows: [{ value: 'IT', falt: '20261007' }] };
    return { rows: [] };
  });
  await assert.rejects(drv.assignHistory('department', 'E01', { code: 'RRHH' }, '2026-10-07', STAMP), (e: any) => e.status === 409 && /posterior/.test(e.message));
  assert.ok(!calls.some((c) => c.text.startsWith('UPDATE') || c.text.startsWith('INSERT')));
});

test('SQL Server: un departamento nuevo se crea con el siguiente código libre', async () => {
  const { drv, calls } = fakeSql((text) => {
    if (text.startsWith('SELECT p.')) return { rows: [{ code: 'E01' }] };
    if (text.includes('FROM [DEPMENTO] WITH (UPDLOCK, HOLDLOCK)')) return { rows: [{ code: '001', description: 'ADMIN' }, { code: '007', description: 'RRHH' }] };
    return { rows: [] };
  });
  await drv.assignHistory('department', 'E01', { name: 'CALIDAD' }, '2026-10-07', STAMP);
  const ins = calls.find((c) => c.text.startsWith('INSERT INTO [DEPMENTO]'))!;
  assert.deepEqual(ins.params, { code: '008', name: 'CALIDAD' });
  assert.equal(calls.find((c) => c.text.startsWith('INSERT INTO [HIS_DEPMENTO]'))!.params.value, '008');
  // Si ya existe con ese nombre, se reutiliza.
  const { drv: d2, calls: c2 } = fakeSql((text) => {
    if (text.startsWith('SELECT p.')) return { rows: [{ code: 'E01' }] };
    if (text.includes('FROM [DEPMENTO] WITH (UPDLOCK, HOLDLOCK)')) return { rows: [{ code: '007', description: 'Calidad' }] };
    return { rows: [] };
  });
  await d2.assignHistory('department', 'E01', { name: 'CALIDAD' }, '2026-10-07', STAMP);
  assert.ok(!c2.some((c) => c.text.startsWith('INSERT INTO [DEPMENTO]')));
  assert.equal(c2.find((c) => c.text.startsWith('INSERT INTO [HIS_DEPMENTO]'))!.params.value, '007');
});

test('SQL Server: modificar la ficha no toca tarjeta ni organización', async () => {
  const { drv, calls } = fakeSql(() => ({ rows: [] }), { hireDate: '20261001' });
  const { code: _c, ...rest } = sanitizePersonal(BASE, opts);
  await drv.updatePersonal('E01', rest, STAMP);
  const set = calls.find((c) => c.text.startsWith('UPDATE'))!.text;
  assert.ok(!/EM_TARJ|EM_CEMP|EM_DEPA|EM_SECC|EM_AREA/.test(set), set);
  assert.match(set, /EM_NOMB/);
});

test('SQL Server: eliminar borra también sus históricos de organización', async () => {
  const { drv, calls } = fakeSql((text) => (text.includes('INFORMATION_SCHEMA.COLUMNS') ? { rows: [] } : undefined));
  await drv.deletePersonal('E01');
  assert.ok(calls.some((c) => c.text === 'DELETE FROM [HIS_DEPMENTO] WHERE [HD_PCOD] = @code'));
  assert.ok(!calls.some((c) => c.text.includes('DELETE FROM [DEPMENTO]')));
});

// ---------- Baja del empleado: cierra todas sus asignaciones ----------

test('demo: al dar de baja al empleado se cierran todos sus tramos con la fecha de baja', async () => {
  const d = new DemoDriver('co-baja-1');
  const o = { ...opts, lookups: await d.personalLookups() };
  const dep = o.lookups.department![0].code;
  await d.createPersonal(sanitizePersonal({ ...BASE, code: 'B1', card: 'CB1', company: '', area: '', department: dep, hireDate: '2026-01-01' }, o), STAMP);
  await d.assignHistory('card', 'B1', { code: 'CB2' }, '2026-02-01', STAMP);
  await d.assignHistory('card', 'B1', { code: 'CB3' }, '2026-03-01', STAMP);
  await d.closeHistory('card', 'B1', 'CB3', '2026-03-01', '2026-12-31', STAMP); // cerrada después de la baja → se acorta
  await d.closeHistory('card', 'B1', 'CB2', '2026-02-01', '2026-02-15', STAMP); // cerrada antes → no se toca

  const { code: _c, ...rest } = sanitizePersonal({ ...BASE, company: '', area: '', department: '', endDate: '2026-09-30', hireDate: '2026-01-01' }, { ...o, code: 'B1' });
  await d.updatePersonal('B1', rest, { date: '20261007', time: '1630', user: 'SMO' });
  const h = await d.personalHistory('B1');
  const card = (v: string) => h.card.find((x) => x.value === v)!;
  assert.equal(card('CB1').to, '2026-09-30');
  assert.equal(card('CB1').type, 'B');
  assert.equal(card('CB3').to, '2026-09-30');
  assert.equal(card('CB2').to, '2026-02-15');
  assert.equal(h.department[0].to, '2026-09-30');
  assert.equal(h.department[0].user, 'SMO');
  assert.ok([...h.card, ...h.department].every((x) => x.to), 'no queda ningún tramo abierto');
  // Los campos EM_* conservan el último valor.
  assert.equal((await d.getPersonal('B1'))?.department, dep);
  // La tarjeta queda libre para otro empleado desde el día siguiente.
  await d.createPersonal(sanitizePersonal({ ...BASE, code: 'B2', card: 'CB1', company: '', area: '', department: '', hireDate: '2026-10-01' }, o), STAMP);
});

test('demo: no deja dar de baja antes de un tramo que empieza después', async () => {
  const d = new DemoDriver('co-baja-2');
  const o = { ...opts, lookups: await d.personalLookups() };
  await d.createPersonal(sanitizePersonal({ ...BASE, code: 'B3', card: 'CB30', company: '', area: '', department: '', hireDate: '2026-01-01' }, o), STAMP);
  await d.assignHistory('card', 'B3', { code: 'CB31' }, '2026-11-01', STAMP);
  const { code: _c, ...rest } = sanitizePersonal({ ...BASE, company: '', area: '', department: '', endDate: '2026-10-15', hireDate: '2026-01-01' }, { ...o, code: 'B3' });
  await assert.rejects(d.updatePersonal('B3', rest, STAMP), (e: any) => e.status === 409 && /CB31/.test(e.message));
  assert.equal((await d.personalHistory('B3')).card.find((x) => x.value === 'CB30')!.to, '', 'no se ha cerrado nada');
});

test('demo: alta con fecha de baja deja sus tramos cerrados', async () => {
  const d = new DemoDriver('co-baja-3');
  const o = { ...opts, lookups: await d.personalLookups() };
  await d.createPersonal(sanitizePersonal({ ...BASE, code: 'B4', card: 'CB40', company: '', area: '', department: '', hireDate: '2026-01-01', endDate: '2026-06-30' }, o), STAMP);
  const [t] = (await d.personalHistory('B4')).card;
  assert.deepEqual({ from: t.from, to: t.to, type: t.type }, { from: '2026-01-01', to: '2026-06-30', type: 'B' });
});

test('SQL Server: la baja cierra los tramos abiertos de todos los históricos en la misma transacción', async () => {
  const { drv, calls } = fakeSql(() => ({ rows: [], affected: 1 }), { hireDate: '20261001' });
  let inTx = 0;
  const orig = drv.inTx;
  drv.inTx = async (fn: any) => { inTx++; return orig(fn); };
  const { code: _c, ...rest } = sanitizePersonal({ ...BASE, endDate: '2026-10-31' }, opts);
  await drv.updatePersonal('E01', rest, STAMP);
  assert.equal(inTx, 1);
  const upd = calls.filter((c) => /^UPDATE \[HIS_(TARJETA|DEPMENTO)\]/.test(c.text));
  assert.equal(upd.length, 2, 'tarjetas y departamento (los que existen en la BD simulada)');
  const vig = calls.find((c) => c.text.startsWith('UPDATE [HIS_VIGENCIA]'))!;
  assert.match(vig.text, /SET \[HV_FBAJ\] = @end, \[HV_TIPO\] = 'B'/);
  assert.equal(vig.params.end, '20261031');
  const dep = upd.find((c) => c.text.includes('HIS_DEPMENTO'))!;
  assert.match(dep.text.replace(/\s+/g, ' '), /SET \[HD_FBAJ\] = @end, \[HD_TIPO\] = 'B', \[HD_FECH\] = @fech, \[HD_HORA\] = @hora, \[HD_USUA\] = @usua WHERE \[HD_PCOD\] = @code AND \(\(\[HD_FBAJ\] IS NULL OR LTRIM\(RTRIM\(\[HD_FBAJ\]\)\) IN \('', '0'\)\) OR \[HD_FBAJ\] > @end\)/);
  assert.deepEqual(dep.params, { code: 'E01', end: '20261031', fech: '20261007', hora: '1559', usua: 'SMO' });
  // Sin fecha de baja no se toca ningún histórico.
  const { drv: d2, calls: c2 } = fakeSql(() => ({ rows: [], affected: 1 }), { hireDate: '20261001' });
  const { code: _c2, ...rest2 } = sanitizePersonal(BASE, opts);
  await d2.updatePersonal('E01', rest2, STAMP);
  assert.ok(!c2.some((c) => c.text.includes('HIS_')), 'sin baja nueva no se toca ningún histórico');
});

test('SQL Server: la baja se rechaza si hay tramos que empiezan después', async () => {
  const { drv, calls } = fakeSql((text) => (text.includes('[HT_FALT] > @end') ? { rows: [{ value: 'T9', falt: '20261101' }] } : { rows: [], affected: 1 }), { hireDate: '20261001' });
  const { code: _c, ...rest } = sanitizePersonal({ ...BASE, endDate: '2026-10-31' }, opts);
  await assert.rejects(drv.updatePersonal('E01', rest, STAMP), (e: any) => e.status === 409 && /la tarjeta T9 \(desde el 01\/11\/2026\)/.test(e.message));
  assert.ok(!calls.some((c) => /^UPDATE \[HIS_/.test(c.text)));
});

// ---------- Periodos de alta (HIS_VIGENCIA) y volver a dar de alta ----------

test('reglas: la baja de un empleado de baja solo se puede adelantar; readmisión posterior a la baja', async () => {
  const { checkEndChange, checkReadmit } = await import('./evalos/history.ts');
  assert.doesNotThrow(() => checkEndChange('E', '', '2026-10-01'));
  assert.doesNotThrow(() => checkEndChange('E', '2026-10-01', '2026-09-01'));
  assert.doesNotThrow(() => checkEndChange('E', '2026-10-01', '2026-10-01'));
  assert.throws(() => checkEndChange('E', '2026-10-01', ''), /Volver a dar de alta/);
  assert.throws(() => checkEndChange('E', '2026-10-01', '2026-10-02'), /adelantar/);
  assert.throws(() => checkReadmit('E', '', '2026-10-02'), /no está de baja/);
  assert.throws(() => checkReadmit('E', '2026-10-01', '2026-10-01'), /posterior/);
  assert.doesNotThrow(() => checkReadmit('E', '2026-10-01', '2026-10-02'));
});

test('demo: alta, baja y readmisión con formulario vacío', async () => {
  const d = new DemoDriver('co-readmit');
  const o = { ...opts, lookups: await d.personalLookups() };
  const [dep1, dep2] = o.lookups.department!.map((x) => x.code);
  await d.createPersonal(sanitizePersonal({ ...BASE, code: 'R1', card: 'CR1', company: '', area: '', department: dep1, hireDate: '2025-01-01' }, o), STAMP);
  assert.deepEqual((await d.personalPeriods('R1')).map((p) => [p.from, p.to, p.type]), [['2025-01-01', '', 'A']]);

  const base = { ...BASE, company: '', area: '', department: '', hireDate: '2025-01-01' };
  const { code: _a, ...baja } = sanitizePersonal({ ...base, endDate: '2025-12-31' }, { ...o, code: 'R1' });
  await d.updatePersonal('R1', baja, STAMP);
  assert.deepEqual((await d.personalPeriods('R1')).map((p) => [p.from, p.to, p.type]), [['2025-01-01', '2025-12-31', 'B']]);
  // Ya de baja: no se puede quitar ni retrasar la baja.
  const { code: _b, ...sinBaja } = sanitizePersonal(base, { ...o, code: 'R1' });
  await assert.rejects(d.updatePersonal('R1', sinBaja, STAMP), (e: any) => e.status === 409 && /Volver a dar de alta/.test(e.message));
  await assert.rejects(d.readmitPersonal('R1', { hireDate: '2025-12-31', card: 'CR2', company: '', department: '', section: '', area: '' }, STAMP), (e: any) => e.status === 409);

  // Readmisión: nuevo periodo y asignaciones nuevas desde la fecha (las anteriores siguen cerradas).
  await d.readmitPersonal('R1', { hireDate: '2026-03-01', card: 'CR2', company: '', department: dep2, section: '', area: '' }, STAMP, { area: 'ZONA SUR' });
  const e = (await d.getPersonal('R1'))!;
  assert.equal(e.hireDate, '2026-03-01');
  assert.equal(e.endDate, '');
  assert.equal(e.active, true);
  assert.equal(e.card, 'CR2');
  assert.equal(e.department, dep2);
  assert.equal(e.company, '', 'formulario vacío: lo que no se indica queda vacío');
  const periods = await d.personalPeriods('R1');
  assert.deepEqual(periods.map((p) => [p.from, p.to, p.type]), [['2026-03-01', '', 'A'], ['2025-01-01', '2025-12-31', 'B']]);
  const h = await d.personalHistory('R1');
  assert.deepEqual(h.card.map((x) => [x.value, x.from, x.to]), [['CR2', '2026-03-01', ''], ['CR1', '2025-01-01', '2025-12-31']]);
  assert.deepEqual(h.department.map((x) => [x.value, x.from, x.to]), [[dep2, '2026-03-01', ''], [dep1, '2025-01-01', '2025-12-31']]);
  const sur = (await d.personalLookups()).area!.find((x) => x.description === 'ZONA SUR')!;
  assert.equal(h.area[0].value, sur.code, 'el área nueva se crea');
  await assert.rejects(d.readmitPersonal('R1', { hireDate: '2026-05-01', card: 'X', company: '', department: '', section: '', area: '' }, STAMP), (e: any) => /no está de baja/.test(e.message));
});

test('SQL Server: el alta abre el periodo en HIS_VIGENCIA', async () => {
  const { drv, calls } = fakeSql(() => ({ rows: [] }));
  await drv.createPersonal(sanitizePersonal(BASE, opts), STAMP);
  const v = calls.find((c) => c.text.startsWith('INSERT INTO [HIS_VIGENCIA]'))!;
  assert.match(v.text, /VALUES \(@code, @from, '0', 'A', @fech, @hora, @usua\)/);
  assert.equal(v.params.from, '20261001');
});

test('SQL Server: readmitir abre periodo y tramos nuevos, deja EM_FBAJ vacía y en una transacción', async () => {
  const { drv, calls } = fakeSql(() => ({ rows: [], affected: 0 }), { hireDate: '20250101', endDate: '20251231' });
  let inTx = 0;
  const orig = drv.inTx;
  drv.inTx = async (fn: any) => { inTx++; return orig(fn); };
  await drv.readmitPersonal('E01', { hireDate: '2026-03-01', card: 'T5', company: '', department: 'IT', section: '', area: '' }, STAMP);
  assert.equal(inTx, 1);
  const upd = calls.find((c) => c.text.startsWith('UPDATE [PERSONAL] SET'))!;
  const cols = [...upd.text.matchAll(/\[(EM_\w+)\] = @(v\d+)/g)].reduce((m, [, c, p]) => ({ ...m, [c]: upd.params[p] }), {} as Record<string, unknown>);
  assert.deepEqual(cols, { EM_FALT: '20260301', EM_FBAJ: null, EM_TARJ: 'T5', EM_CEMP: null, EM_DEPA: 'IT', EM_SECC: null, EM_AREA: null });
  const iUpd = calls.indexOf(upd);
  const vig = calls.findIndex((c) => c.text.startsWith('INSERT INTO [HIS_VIGENCIA]') && c.params.from === '20260301');
  const card = calls.findIndex((c) => c.text.startsWith('INSERT INTO [HIS_TARJETA]') && c.params.value === 'T5' && c.params.from === '20260301');
  const dep = calls.findIndex((c) => c.text.startsWith('INSERT INTO [HIS_DEPMENTO]') && c.params.value === 'IT' && c.params.from === '20260301');
  assert.ok(vig > iUpd && card > iUpd && dep > iUpd, calls.map((c) => c.text.slice(0, 30)).join(' | '));
  // Antes se aseguran cerrados los tramos anteriores a la fecha de baja.
  assert.ok(calls.some((c, i) => i < iUpd && c.text.startsWith('UPDATE [HIS_TARJETA]') && c.params.end === '20251231'));
});

test('SQL Server: readmitir rechaza a un empleado activo o una fecha no posterior a la baja', async () => {
  const { drv } = fakeSql(() => ({ rows: [] }), { hireDate: '20250101', endDate: null });
  await assert.rejects(drv.readmitPersonal('E01', { hireDate: '2026-03-01', card: 'T5', company: '', department: '', section: '', area: '' }, STAMP), (e: any) => e.status === 409 && /no está de baja/.test(e.message));
  const { drv: d2, calls } = fakeSql(() => ({ rows: [] }), { hireDate: '20250101', endDate: '20251231' });
  await assert.rejects(d2.readmitPersonal('E01', { hireDate: '2025-12-31', card: 'T5', company: '', department: '', section: '', area: '' }, STAMP), (e: any) => e.status === 409 && /posterior/.test(e.message));
  assert.ok(!calls.some((c) => c.text.startsWith('UPDATE') || c.text.startsWith('INSERT')));
});

test('validación: consultas y solicitudes solo admiten valores existentes de KIOSKO y WORKFLOW', () => {
  assert.equal(sanitizePersonal(BASE, opts).consultas, '001');
  assert.equal(status(() => sanitizePersonal({ ...BASE, consultas: '999' }, opts)), 400);
  assert.equal(status(() => sanitizePersonal({ ...BASE, solicitudes: 'XX' }, opts)), 400);
  const sinTabla = { ...opts, lookups: { ...LOOKUPS, consultas: null } };
  assert.equal(status(() => sanitizePersonal({ ...BASE, consultas: '001' }, sinTabla)), 400);
  assert.equal(status(() => sanitizePersonal({ ...BASE, consultas: '' }, sinTabla)), 0);
});

// ---------- Alta de usuario del portal como empleado y acceso a Evalos (USUARIOS) por rol ----------

test('usuarios: alta como empleado vinculado y sincronización de nombre y email', async () => {
  const { putConfig } = await import('./evalos/config.ts');
  const { createLinkedEmployee, syncLinkedEmployee, employeeFormInfo } = await import('./evalos/employees.ts');
  await putConfig({ companyId: 'co-users', engine: 'demo', mapping: DEFAULT_MAPPING, uppercase: true, updatedAt: '' } as any);
  const info = await employeeFormInfo('co-users');
  assert.equal(info.configured, true);
  assert.ok(info.configured && info.lookups.department!.length > 0);

  const code = await createLinkedEmployee('co-users', 'admin@primion.es',
    { code: 'u01', card: 'CU01', hireDate: '2026-10-07', newNames: { department: 'Soporte' } }, 'Ana García Pérez', 'ana@primion.es');
  assert.equal(code, 'U01');
  const d = new DemoDriver('co-users');
  const e = (await d.getPersonal('U01'))!;
  assert.equal(e.name, 'ANA GARCÍA PÉREZ');
  assert.equal(e.email, 'ana@primion.es');
  assert.equal(e.card, 'CU01');
  const dep = (await d.personalLookups()).department!.find((x) => x.description === 'SOPORTE')!;
  assert.equal(e.department, dep.code, 'el departamento escrito se crea');
  assert.equal((await d.personalPeriods('U01')).length, 1);

  // Faltan datos de empleado → no se crea nada.
  await assert.rejects(createLinkedEmployee('co-users', 'admin@primion.es', { code: 'U02', hireDate: '2026-10-07' }, 'Luis', 'luis@primion.es'), (e: any) => e.status === 400 && /tarjeta/.test(e.message));
  assert.equal(await d.getPersonal('U02'), null);

  await syncLinkedEmployee('co-users', 'U01', 'Ana García López', 'ana.garcia@primion.es');
  const e2 = (await d.getPersonal('U01'))!;
  assert.equal(e2.name, 'ANA GARCÍA LÓPEZ');
  assert.equal(e2.email, 'ana.garcia@primion.es');
});

test('usuarios: sin conexión con Evalos el formulario no ofrece el alta como empleado', async () => {
  const { employeeFormInfo } = await import('./evalos/employees.ts');
  assert.deepEqual(await employeeFormInfo('co-sin-evalos'), { configured: false });
});

test('usuarios: solo los roles distintos de «Usuario» tienen acceso a Evalos (USUARIOS)', async () => {
  const { wantsEvalosAccess, deprovisionEvalosUser } = await import('./evalos/users.ts');
  assert.equal(wantsEvalosAccess({ role: 'user' }), false);
  assert.equal(wantsEvalosAccess({ role: 'admin' }), true);
  assert.equal(wantsEvalosAccess({ role: 'superadmin' }), true);
  // Al bajar a «Usuario» se le quita el acceso (en demo no hay tabla USUARIOS real: solo se limpia el enlace).
  const db = await import('./db.ts');
  const u = { id: db.id(), companyId: 'co-users', email: 'jefe@primion.es', firstName: 'Jefe', lastName: '', passwordHash: 'x', role: 'user', groupIds: [], status: 'active', sessionVersion: 1, createdAt: '', evalos: { initials: 'JEF', at: '' } } as any;
  await db.Users.put(u);
  const after = await deprovisionEvalosUser(u, null);
  assert.equal(after.evalos, undefined);
  assert.equal((await db.Users.get(u.id))?.evalos, undefined);
});


test('SQL Server: incidencias de INCIDENC (código y descripción) para Correcciones', async () => {
  TABLES.INCIDENC = [col('IN_CODI', 'nvarchar', 3, false), col('IN_DESC', 'nvarchar', 40)];
  const { drv, calls } = fakeSql((text) => (text.includes('FROM [INCIDENC]') ? { rows: [{ code: '002 ', name: 'MEDICO ' }, { code: '001', name: 'ASUNTOS PROPIOS' }] } : { rows: [] }));
  assert.deepEqual(await drv.listIncidences(), [{ code: '002', name: 'MEDICO' }, { code: '001', name: 'ASUNTOS PROPIOS' }]);
  assert.match(calls[0].text, /SELECT RTRIM\(\[IN_CODI\]\) AS code, RTRIM\(ISNULL\(\[IN_DESC\], ''\)\) AS name FROM \[INCIDENC\] ORDER BY \[IN_CODI\]/);
  delete TABLES.INCIDENC;
});
