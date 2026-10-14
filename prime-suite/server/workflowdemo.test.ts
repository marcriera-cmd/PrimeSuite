// Perfiles Workflow de punta a punta con el motor de demostración, y el SQL que genera el motor SQL Server:
// alta de perfiles copiando la plantilla, registro en PS_WF2PERFILES, EM_WFOP, borrado seguro (también de los perfiles
// de la versión por equipos), rol abreviado y creación automática de tablas y columnas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRIME_STORE = 'file';
process.env.PRIME_DATA_DIR = mkdtempSync(join(tmpdir(), 'ps-workflow-'));

const { DemoDriver } = await import('./evalos/demo.ts');
const { syncWorkflow } = await import('./routes/evalos.ts');
const { SqlServerDriver } = await import('./evalos/mssql.ts');
const { DEFAULT_MAPPING } = await import('./evalos/types.ts');
const col = (name: string, maxLength: number | null = 20, nullable = true) => ({ name, type: 'nvarchar', maxLength, nullable, hasDefault: false, identity: false, computed: false });

test('demostración: perfiles por departamento, validador a mano, lo editado se conserva y lo que queda sin nadie se borra', async () => {
  const d = new DemoDriver('wf-demo');
  const people = (await d.listPersonal()).filter((p) => p.active);
  const [jefa, emp] = people.filter((p) => p.department === 'COMERCIAL');
  const sup = people.find((p) => p.department !== 'COMERCIAL')!;
  await d.setEmployeesRole([jefa.code], 'RESPONSABLE');
  await d.setEmployeesRole([emp.code], 'EMPLEADO');
  const r = await syncWorkflow(d, 'wf-demo');
  assert.ok(r.created.length >= 2);
  const e = (await d.getPersonal(emp.code))!;
  assert.match(e.solicitudes, /^Q/);
  const row = (await d.listWorkflowRows()).find((x) => x.WF_CODI === e.solicitudes)!;
  assert.equal(row.WF_NIV1, jefa.code, 'lo valida la responsable de su departamento');
  assert.equal(row.WF_WOFL, 'N', 'permisos copiados de la plantilla 997');

  // Niveles editados a mano: se conservan al recalcular.
  await d.applyWorkflowPlan({ insert: [], update: [{ code: e.solicitudes, set: { WF_NIV2: sup.code, WF_VACA: '1,2' } }], remove: [], assign: [] });
  const again = await syncWorkflow(d, 'wf-demo');
  assert.equal(again.plan.insert.length + again.plan.update.length + again.plan.assign.length, 0);
  assert.equal((await d.listWorkflowRows()).find((x) => x.WF_CODI === e.solicitudes)!.WF_VACA, '1,2');

  // A la responsable la valida a mano su superior.
  await d.setWfValida(jefa.code, 'V', [sup.code]);
  await syncWorkflow(d, 'wf-demo');
  const jefaProfile = (await d.getPersonal(jefa.code))!.solicitudes;
  assert.equal((await d.listWorkflowRows()).find((x) => x.WF_CODI === jefaProfile)!.WF_NIV1, sup.code);

  // Sin rol: su perfil se borra y se le quita.
  await d.setEmployeesRole([emp.code], '');
  const gone = await syncWorkflow(d, 'wf-demo');
  assert.ok(gone.removed.some((x) => x.code === e.solicitudes));
  assert.equal((await d.getPersonal(emp.code))!.solicitudes, '');
});

test('SQL Server: aplica el plan en WORKFLOW, PS_WF2PERFILES y EM_WFOP, y solo borra perfiles de Prime Suite sin nadie', async () => {
  const TABLES: Record<string, any[]> = {
    WORKFLOW: [col('WF_CODI', 3, false), col('WF_DESC', 60), col('WF_NIV1', 25), col('WF_VACA', 7), col('WF_WOFL', 1)],
    PS_WF2PERFILES: [col('WQ_CODI', 3, false), col('WQ_CLAVE', 2000, false)],
    PS_WF2VALIDA: [col('WV_EMPL'), col('WV_TIPO', 1), col('WV_VALOR')],
    PS_WFPERFILES: [col('WP_CODI', 3, false)],
    PERSONAL: [col('EM_CODI', 10, false), col('EM_NOMB', 60), col('EM_FBAJ', 8), col('EM_WFOP', 3), col('EM_WORKFLOWROL', 15)]
  };
  const drv: any = new SqlServerDriver('Server=x;Database=y', DEFAULT_MAPPING);
  const calls: { text: string; params: Record<string, unknown> }[] = [];
  let stillUsed = 0;
  drv.columns = async (t: { table: string }) => TABLES[t.table] || [];
  drv.inTx = async (fn: any) => fn((text: string, params?: Record<string, unknown>) => drv.query(text, params));
  drv.query = async (text: string, params: Record<string, unknown> = {}) => {
    calls.push({ text, params });
    if (/SELECT COUNT\(\*\) AS n FROM \[WORKFLOW\]/.test(text)) return { rows: [{ n: 0 }], affected: 0 };
    if (/SELECT COUNT\(\*\) AS n FROM \[PS_WF2PERFILES\]/.test(text)) return { rows: [{ n: params.c === 'X99' ? 0 : 1 }], affected: 0 };
    if (/SELECT COUNT\(\*\) AS n FROM \[PS_WFPERFILES\]/.test(text)) return { rows: [{ n: 1 }], affected: 0 };
    if (/SELECT COUNT\(\*\) AS n FROM \[PERSONAL\]/.test(text)) return { rows: [{ n: stillUsed }], affected: 0 };
    return { rows: [], affected: 1 };
  };
  await drv.applyWorkflowPlan({
    insert: [{ code: 'Q01', row: { WF_CODI: 'Q01', WF_DESC: 'VENTAS · EMPLEADO', WF_NIV1: '0000000020', WF_VACA: '1', WF_WOFL: 'N', WF_OTRA: 'x' }, key: { clave: '{"r":"EMPLEADO","d":"VEN","v":[],"m":[]}' } }],
    update: [{ code: 'Q02', set: { WF_NIV1: '0000000020;0000000050' } }],
    assign: [{ employee: '0000000010', profile: 'Q01' }, { employee: '0000000040', profile: '' }],
    remove: ['Q03', 'X99'],
    removeLegacy: ['P01']
  });
  const ins = calls.find((c) => c.text.startsWith('INSERT INTO [WORKFLOW]'))!;
  assert.match(ins.text, /\(\[WF_CODI\], \[WF_DESC\], \[WF_NIV1\], \[WF_VACA\], \[WF_WOFL\]\)/, 'solo columnas que existen en la tabla');
  assert.deepEqual(Object.values(ins.params), ['Q01', 'VENTAS · EMPLEADO', '0000000020', '1', 'N']);
  assert.deepEqual(calls.find((c) => c.text.startsWith('INSERT INTO [PS_WF2PERFILES]'))!.params, { c: 'Q01', k: '{"r":"EMPLEADO","d":"VEN","v":[],"m":[]}' });
  assert.ok(calls.some((c) => c.text === 'UPDATE [WORKFLOW] SET [WF_NIV1] = @v0 WHERE WF_CODI = @code' && c.params.v0 === '0000000020;0000000050'));
  assert.deepEqual(calls.filter((c) => c.text.startsWith('UPDATE [PERSONAL] SET [EM_WFOP]')).map((c) => [c.params.e, c.params.p]), [['0000000010', 'Q01'], ['0000000040', null]]);
  assert.deepEqual(calls.filter((c) => c.text.startsWith('DELETE FROM [WORKFLOW]')).map((c) => c.params.c), ['Q03', 'P01'], 'X99 no es de Prime Suite: no se borra; P01 sí (versión por equipos)');
  assert.ok(calls.some((c) => c.text.startsWith('DELETE FROM [PS_WFPERFILES]') && c.params.c === 'P01'));
  stillUsed = 2;
  await assert.rejects(drv.applyWorkflowPlan({ insert: [], update: [], assign: [], remove: ['Q03'] }), (e: any) => e.status === 409 && /todavía lo tienen 2/.test(e.message));
  await assert.rejects(drv.applyWorkflowPlan({ insert: [], update: [{ code: 'Q02', set: { WF_NIV1: '0000000020;0000000050;0000000060' } }], assign: [], remove: [] }), (e: any) => e.status === 409 && /WF_NIV1 admite 25/.test(e.message));
});

test('SQL Server: rol abreviado con EM_WORKFLOWROL de 5 caracteres', async () => {
  const drv: any = new SqlServerDriver('Server=x;Database=y', DEFAULT_MAPPING);
  const calls: { text: string; params: Record<string, unknown> }[] = [];
  drv.columns = async (t: { table: string }) => (t.table === 'PERSONAL' ? [col('EM_CODI', 10), col('EM_WORKFLOWROL', 5)] : []);
  drv.inTx = async (fn: any) => fn((text: string, params?: Record<string, unknown>) => drv.query(text, params));
  drv.query = async (text: string, params: Record<string, unknown> = {}) => { calls.push({ text, params }); return { rows: [], affected: 1 }; };
  await drv.setEmployeesRole(['0000000006'], 'RESPONSABLE');
  const up = calls.find((c) => c.text.startsWith('UPDATE [PERSONAL]'))!;
  assert.deepEqual([up.params.r, up.params.e0], ['RESP', '0000000006']);
});

test('SQL Server: si faltan tablas o columnas las crea y sigue; si no puede, explica el permiso', async () => {
  const tables: Record<string, any[]> = { WORKFLOW: [col('WF_CODI', 3)], PERSONAL: [col('EM_CODI', 10), col('EM_WFOP', 3)] };
  const drv: any = new SqlServerDriver('Server=x;Database=y', DEFAULT_MAPPING);
  const ddl: string[] = [];
  let canCreate = true;
  drv.columns = async (t: { table: string }) => tables[t.table] || [];
  drv.query = async (text: string) => {
    if (/CREATE TABLE|ALTER TABLE/.test(text)) {
      if (!canCreate) throw new Error('CREATE TABLE permission denied in database');
      ddl.push(text);
      if (text.includes('CREATE TABLE')) { tables.PS_WF2PERFILES = [col('WQ_CODI', 3), col('WQ_CLAVE', 2000)]; tables.PS_WF2VALIDA = [col('WV_EMPL'), col('WV_TIPO', 1), col('WV_VALOR')]; }
      if (text.includes('COL_LENGTH') && text.includes('EM_WORKFLOWROL')) tables.PERSONAL = [...tables.PERSONAL, col('EM_WORKFLOWROL', 15)];
    }
    return { rows: [], affected: 0 };
  };
  assert.deepEqual(await drv.listDynProfiles(), []);
  assert.ok(ddl.some((t) => /CREATE TABLE \[dbo\]\.\[PS_WF2PERFILES\]/.test(t)), 'crea las tablas');
  assert.ok(ddl.some((t) => /ALTER TABLE \[PERSONAL\] ADD \[EM_WORKFLOWROL\] nvarchar\(15\) NULL/.test(t)), 'añade la columna');
  ddl.length = 0;
  await drv.listWfValida();
  assert.equal(ddl.length, 0, 'si ya existe todo no vuelve a lanzar nada');
  assert.deepEqual(await drv.listLegacyProfiles(), [], 'sin la tabla de la versión por equipos no hay nada que limpiar (y no se crea)');
  delete tables.PS_WF2PERFILES; canCreate = false; drv.colCache.clear();
  await assert.rejects(drv.listDynProfiles(), (e: any) => e.status === 409 && e.code === 'workflow_missing' && /db_ddladmin/.test(e.message));
});
