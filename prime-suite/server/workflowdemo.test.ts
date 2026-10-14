// Perfiles Workflow de punta a punta con el motor de demostración: asignar equipo y rol, recalcular, editar niveles y
// borrar los perfiles que se quedan sin nadie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRIME_STORE = 'file';
process.env.PRIME_DATA_DIR = mkdtempSync(join(tmpdir(), 'ps-workflow-'));

const { DemoDriver } = await import('./evalos/demo.ts');
const { syncWorkflow } = await import('./routes/evalos.ts');

test('asigna perfiles por equipo y rol, conserva lo editado y borra lo que queda sin uso', async () => {
  const d = new DemoDriver('wf-demo');
  const all = await d.listPersonal();
  const [jefa, e1, e2, rrhh] = all.filter((p) => p.active).map((p) => p.code);
  await d.setEmployeesWorkflow([e1, e2], { equipo: 'COMERCIAL', workflowRol: 'EMPLEADO' });
  await d.setEmployeesWorkflow([jefa], { equipo: 'DIRECCION', valEquipo: 'COMERCIAL', workflowRol: 'RESPONSABLE' });
  await d.setEmployeesWorkflow([rrhh], { equipo: 'RRHH', valEquipo: 'DIRECCION', workflowRol: 'RRHH' });

  const r = await syncWorkflow(d, 'wf-demo');
  assert.equal(r.created.length, 3);
  const rows = await d.listWorkflowRows();
  const prof = (code: string) => rows.find((x) => x.WF_CODI === code)!;
  const people = new Map((await d.listPersonal()).map((p) => [p.code, p]));
  const emp = prof(people.get(e1)!.solicitudes);
  assert.equal(people.get(e2)!.solicitudes, people.get(e1)!.solicitudes, 'mismo equipo y rol, mismo perfil');
  assert.equal(emp.WF_NIV1, jefa);
  assert.equal(emp.WF_DESC, 'EQUIPO COMERCIAL · EMPLEADO');
  const resp = prof(people.get(jefa)!.solicitudes);
  assert.equal(resp.WF_FILT, "EM_EQUIPO='COMERCIAL'");
  assert.equal(resp.WF_NIV1, rrhh, 'a la responsable la aprueba quien valida DIRECCIÓN');
  assert.equal(resp.WF_WOFL, 'S', 'permisos copiados de la plantilla 998');
  assert.equal((await d.listDynProfiles()).length, 3);

  // Niveles editados a mano: se conservan al recalcular.
  const code = people.get(e1)!.solicitudes;
  await d.applyWorkflowPlan({ insert: [], update: [{ code, set: { WF_NIV2: rrhh, WF_VACA: '1,2' } }], remove: [], assign: [] });
  const again = await syncWorkflow(d, 'wf-demo');
  assert.equal(again.plan.insert.length + again.plan.update.length + again.plan.assign.length, 0);
  assert.equal((await d.listWorkflowRows()).find((x) => x.WF_CODI === code)!.WF_VACA, '1,2');

  // Los empleados dejan de tener rol: su perfil se borra y se les quita.
  await d.setEmployeesWorkflow([e1, e2], { workflowRol: '' });
  const gone = await syncWorkflow(d, 'wf-demo');
  assert.deepEqual(gone.removed.map((x) => x.code), [code]);
  assert.ok(!(await d.listWorkflowRows()).some((x) => x.WF_CODI === code));
  assert.equal((await d.getPersonal(e1))!.solicitudes, '');

  // Un equipo en uso no se puede borrar.
  await assert.rejects(d.deleteEquipo('DIRECCION'), (e: any) => e.status === 409);
});

test('SQL Server: aplica el plan en WORKFLOW, PS_WFPERFILES y EM_WFOP, y solo borra perfiles de Prime Suite sin nadie', async () => {
  const { SqlServerDriver } = await import('./evalos/mssql.ts');
  const { DEFAULT_MAPPING } = await import('./evalos/types.ts');
  const col = (name: string, type = 'nvarchar', maxLength: number | null = 50, nullable = true) => ({ name, type, maxLength, nullable, hasDefault: false, identity: false, computed: false });
  const TABLES: Record<string, any[]> = {
    WORKFLOW: [col('WF_CODI', 'nvarchar', 3, false), col('WF_DESC', 'nvarchar', 60), col('WF_NIV1', 'nvarchar', 25), col('WF_VACA', 'nvarchar', 7), col('WF_WOFL', 'nvarchar', 1)],
    PS_EQUIPOS: [col('EQ_CODI', 'nvarchar', 20, false), col('EQ_DESC', 'nvarchar', 60, false)],
    PS_WFPERFILES: [col('WP_CODI', 'nvarchar', 3, false), col('WP_EQUIPO'), col('WP_ROL'), col('WP_VALEQUIPO')],
    PERSONAL: [col('EM_CODI', 'nvarchar', 10, false), col('EM_NOMB', 'nvarchar', 60), col('EM_FBAJ', 'nvarchar', 8), col('EM_WFOP', 'nvarchar', 3), col('EM_EQUIPO', 'nvarchar', 20), col('EM_VALEQUIPO', 'nvarchar', 20), col('EM_WORKFLOWROL', 'nvarchar', 15)]
  };
  const drv: any = new SqlServerDriver('Server=x;Database=y', DEFAULT_MAPPING);
  const calls: { text: string; params: Record<string, unknown> }[] = [];
  let stillUsed = 0;
  drv.columns = async (t: { table: string }) => TABLES[t.table] || [];
  drv.inTx = async (fn: any) => fn((text: string, params?: Record<string, unknown>) => drv.query(text, params));
  drv.query = async (text: string, params: Record<string, unknown> = {}) => {
    calls.push({ text, params });
    if (/SELECT COUNT\(\*\) AS n FROM \[WORKFLOW\]/.test(text)) return { rows: [{ n: 0 }], affected: 0 };
    if (/SELECT COUNT\(\*\) AS n FROM \[PS_WFPERFILES\]/.test(text)) return { rows: [{ n: params.c === 'X99' ? 0 : 1 }], affected: 0 };
    if (/SELECT COUNT\(\*\) AS n FROM \[PERSONAL\]/.test(text)) return { rows: [{ n: stillUsed }], affected: 0 };
    return { rows: [], affected: 1 };
  };
  await drv.applyWorkflowPlan({
    insert: [{ code: 'P01', row: { WF_CODI: 'P01', WF_DESC: 'VENTAS · EMPLEADO', WF_NIV1: '0000000020', WF_VACA: '1', WF_WOFL: 'N', WF_OTRA: 'x' }, key: { equipo: 'VENTAS', rol: 'EMPLEADO', valEquipo: '' } }],
    update: [{ code: 'P02', set: { WF_NIV1: '0000000020;0000000050' } }],
    assign: [{ employee: '0000000010', profile: 'P01' }, { employee: '0000000040', profile: '' }],
    remove: ['P03', 'X99']
  });
  const ins = calls.find((c) => c.text.startsWith('INSERT INTO [WORKFLOW]'))!;
  assert.match(ins.text, /\(\[WF_CODI\], \[WF_DESC\], \[WF_NIV1\], \[WF_VACA\], \[WF_WOFL\]\)/, 'solo columnas que existen en la tabla');
  assert.deepEqual(Object.values(ins.params), ['P01', 'VENTAS · EMPLEADO', '0000000020', '1', 'N']);
  const reg = calls.find((c) => c.text.startsWith('INSERT INTO [PS_WFPERFILES]'))!;
  assert.deepEqual(reg.params, { c: 'P01', e: 'VENTAS', r: 'EMPLEADO', v: '' });
  assert.ok(calls.some((c) => c.text === 'UPDATE [WORKFLOW] SET [WF_NIV1] = @v0 WHERE WF_CODI = @code' && c.params.v0 === '0000000020;0000000050'));
  const asg = calls.filter((c) => c.text.startsWith('UPDATE [PERSONAL] SET [EM_WFOP]'));
  assert.deepEqual(asg.map((c) => [c.params.e, c.params.p]), [['0000000010', 'P01'], ['0000000040', null]], 'sin perfil = NULL');
  const dels = calls.filter((c) => c.text.startsWith('DELETE FROM [WORKFLOW]')).map((c) => c.params.c);
  assert.deepEqual(dels, ['P03'], 'X99 no es de Prime Suite: no se borra');

  // Un perfil que todavía tiene alguien no se borra.
  stillUsed = 2;
  await assert.rejects(drv.applyWorkflowPlan({ insert: [], update: [], assign: [], remove: ['P03'] }), (e: any) => e.status === 409 && /todavía lo tienen 2/.test(e.message));
  // Un autorizador de más no se corta: se rechaza.
  await assert.rejects(drv.applyWorkflowPlan({ insert: [], update: [{ code: 'P02', set: { WF_NIV1: '0000000020;0000000050;0000000060' } }], assign: [], remove: [] }), (e: any) => e.status === 409 && /WF_NIV1 admite 25/.test(e.message));
});

test('SQL Server: con EM_WORKFLOWROL de 5 caracteres guarda el rol abreviado junto con el equipo', async () => {
  const { SqlServerDriver } = await import('./evalos/mssql.ts');
  const { DEFAULT_MAPPING } = await import('./evalos/types.ts');
  const col = (name: string, maxLength = 20) => ({ name, type: 'nvarchar', maxLength, nullable: true, hasDefault: false, identity: false, computed: false });
  const drv: any = new SqlServerDriver('Server=x;Database=y', DEFAULT_MAPPING);
  const calls: { text: string; params: Record<string, unknown> }[] = [];
  drv.columns = async (t: { table: string }) => (t.table === 'PERSONAL' ? [col('EM_CODI', 10), col('EM_EQUIPO', 10), col('EM_VALEQUIPO', 10), col('EM_WORKFLOWROL', 5)] : []);
  drv.inTx = async (fn: any) => fn((text: string, params?: Record<string, unknown>) => drv.query(text, params));
  drv.query = async (text: string, params: Record<string, unknown> = {}) => { calls.push({ text, params }); return { rows: [], affected: 1 }; };
  await drv.setEmployeesWorkflow(['0000000006'], { equipo: 'E1', workflowRol: 'RESPONSABLE', valEquipo: 'E2' });
  const up = calls.find((c) => c.text.startsWith('UPDATE [PERSONAL]'))!;
  assert.match(up.text, /\[EM_EQUIPO\] = @s0, \[EM_WORKFLOWROL\] = @s1, \[EM_VALEQUIPO\] = @s2/);
  assert.deepEqual([up.params.s0, up.params.s1, up.params.s2, up.params.e0], ['E1', 'RESP', 'E2', '0000000006']);
});
