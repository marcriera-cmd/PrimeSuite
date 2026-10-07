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

const { sanitizePersonal } = await import('./evalos/personal.ts');
const { DemoDriver } = await import('./evalos/demo.ts');
const { SqlServerDriver } = await import('./evalos/mssql.ts');
const { DEFAULT_MAPPING } = await import('./evalos/types.ts');
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

test('validación: al modificar, el código lo fija la URL y no el cuerpo', () => {
  const p = sanitizePersonal({ ...BASE, code: 'OTRO' }, { ...opts, code: 'E01' });
  assert.equal(p.code, 'E01');
});

test('demo: alta, modificación, tarjeta duplicada y eliminación', async () => {
  const d = new DemoDriver('co-test');
  const emp = sanitizePersonal(BASE, opts);
  await d.createPersonal(emp);
  await assert.rejects(d.createPersonal(emp), (e: any) => e.status === 409);
  await assert.rejects(d.createPersonal({ ...emp, code: 'E02' }), (e: any) => e.status === 409 && /tarjeta/.test(e.message));

  const { code: _c, ...rest } = emp;
  await d.updatePersonal('E01', { ...rest, name: 'NUEVO NOMBRE', endDate: '2026-10-02' });
  const got = await d.getPersonal('E01');
  assert.equal(got?.name, 'NUEVO NOMBRE');
  assert.equal(got?.code, 'E01');
  assert.equal(got?.endDate, '2026-10-02');
  assert.equal(got?.active, false);
  assert.ok((await d.listPersonal()).some((x) => x.code === 'E01'));

  await d.deletePersonal('E01');
  assert.equal(await d.getPersonal('E01'), null);
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

function fakeSql(handler: (text: string, params: Record<string, unknown>) => { rows?: any[]; affected?: number } | void) {
  const drv: any = new SqlServerDriver('Server=x;Database=y', DEFAULT_MAPPING);
  const calls: { text: string; params: Record<string, unknown> }[] = [];
  drv.columns = async (t: { table: string }) => (t.table === 'PERSONAL' ? PERSONAL_COLS : []);
  drv.query = async (text: string, params: Record<string, unknown> = {}) => {
    calls.push({ text, params });
    const r = handler(text, params) || {};
    return { rows: r.rows || [], affected: r.affected ?? 1 };
  };
  return { drv, calls };
}

test('SQL Server: el alta escribe la ficha, los valores fijos y las fechas en aaaammdd', async () => {
  const { drv, calls } = fakeSql(() => ({ rows: [] }));
  await drv.createPersonal({ ...sanitizePersonal(BASE, opts), endDate: '2027-01-31' });
  const ins = calls.find((c) => c.text.startsWith('INSERT'))!;
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
});

test('SQL Server: modificar no toca el código ni los valores fijos', async () => {
  const { drv, calls } = fakeSql(() => ({ rows: [] }));
  const { code: _c, ...rest } = sanitizePersonal(BASE, opts);
  await drv.updatePersonal('E01', rest);
  const upd = calls.find((c) => c.text.startsWith('UPDATE'))!;
  const set = upd.text.slice(upd.text.indexOf('SET'), upd.text.indexOf('WHERE'));
  assert.ok(!/EM_CODI|EM_CACC|EM_CAUT|EM_TURN/.test(set), set);
  assert.match(upd.text, /WHERE \[EM_CODI\] = @code/);
  assert.equal(upd.params.code, 'E01');
});

test('SQL Server: tarjeta repetida en otro empleado → 409', async () => {
  const { drv } = fakeSql((text) => (/EM_TARJ\] = @card/.test(text) ? { rows: [{ code: 'E99' }] } : { rows: [] }));
  await assert.rejects(drv.createPersonal(sanitizePersonal(BASE, opts)), (e: any) => e.status === 409 && /E99/.test(e.message));
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
  assert.ok(calls.some((c) => c.text.startsWith('DELETE FROM [PERSONAL] WHERE [EM_CODI] = @code')));
});

test('SQL Server: lectura convierte fechas aaaammdd y calcula activo', async () => {
  const { drv } = fakeSql((text) => (text.startsWith('SELECT') ? { rows: [{ code: 'E01 ', name: 'ANA', hireDate: '20261001', endDate: null, active: 1 }] } : undefined));
  const [e] = await drv.listPersonal();
  assert.equal(e.code, 'E01');
  assert.equal(e.hireDate, '2026-10-01');
  assert.equal(e.endDate, '');
  assert.equal(e.active, true);
});
