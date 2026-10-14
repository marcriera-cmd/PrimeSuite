// Tests de Perfiles Workflow 2 (por departamentos): responsables que validan su departamento y los añadidos,
// validadores asignados a mano, perfiles por clave, y cambio de opción activa entre equipos y departamentos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRIME_STORE = 'file';
process.env.PRIME_DATA_DIR = mkdtempSync(join(tmpdir(), 'ps-workflow2-'));

const { planWorkflow2, parseKey, sanitizeValidation, workflow2Sql, deptFilter } = await import('./evalos/workflow2.ts');
const { DEFAULT_WF2_SETTINGS } = await import('./evalos/workflow2.ts');
type Wf2Person = import('./evalos/workflow2.ts').Wf2Person;
type WorkflowRow = import('./evalos/types.ts').WorkflowRow;

const tpl = (code: string, extra: WorkflowRow = {}): WorkflowRow => ({ WF_CODI: code, WF_DESC: `PLANTILLA ${code}`, WF_NIV1: '', WF_NIV2: '', WF_VACA: '', WF_CAHO: '', WF_VFIL: 'N', WF_FILT: '', ...extra });
const ROWS = [tpl('997'), tpl('998', { WF_VFIL: 'S' }), tpl('999', { WF_VFIL: 'S' })];
const DEPTS = [{ code: 'VEN', description: 'VENTAS' }, { code: 'ADM', description: 'ADMINISTRACIÓN' }, { code: 'DIR', description: 'DIRECCIÓN' }];
const P = (code: string, department: string, workflowRol: string, extra: Partial<Wf2Person> = {}): Wf2Person => ({ code, name: `APELLIDO${code.slice(-2)}, NOMBRE`, active: true, department, workflowRol, profile: '', ...extra });
const PEOPLE = [
  P('0000000010', 'VEN', 'EMPLEADO'), P('0000000011', 'VEN', 'EMPLEADO'),
  P('0000000020', 'VEN', 'RESPONSABLE'),                 // jefa de ventas
  P('0000000030', 'ADM', 'EMPLEADO'),
  P('0000000040', 'DIR', 'RESPONSABLE'),                 // director: valida DIR y, añadido, ADM
  P('0000000050', 'ADM', 'RRHH')
];
const plan = (valida: any[] = [], people = PEOPLE, dyn: any[] = [], rows = ROWS) =>
  planWorkflow2({ people, departments: DEPTS, valida, rows, dyn, settings: DEFAULT_WF2_SETTINGS });
const byPerson = (r: ReturnType<typeof plan>) => {
  const prof = new Map(r.plan.insert.map((x) => [x.code, x.row]));
  return (code: string) => prof.get(r.plan.assign.find((a) => a.employee === code)!.profile)!;
};

test('el responsable valida su departamento y los añadidos; ve a su gente', () => {
  const r = plan([{ employee: '0000000040', tipo: 'D', valor: 'ADM' }]);
  const of = byPerson(r);
  assert.equal(of('0000000010').WF_NIV1, '0000000020', 'ventas lo valida la jefa de ventas');
  assert.equal(of('0000000010').WF_DESC, 'VENTAS · EMPLEADO');
  assert.equal(of('0000000010'), of('0000000011'), 'mismo departamento y rol, mismo perfil');
  assert.equal(of('0000000030').WF_NIV1, '0000000040', 'administración la valida el director (departamento añadido)');
  assert.equal(of('0000000050').WF_NIV1, '0000000040', 'RRHH también lo valida el responsable de su departamento');
  assert.equal(of('0000000050').WF_FILT, '', 'RRHH ve a todo el personal');
  const dir = of('0000000040');
  assert.equal(dir.WF_FILT, "EM_DEPA='ADM' OR EM_DEPA='DIR'");
  assert.equal(dir.WF_DESC, 'RESPONSABLE DIRECCIÓN +1 DPTO.');
  assert.equal(of('0000000020').WF_FILT, "EM_DEPA='VEN'");
  assert.equal(of('0000000020').WF_NIV1, '', 'la jefa de ventas no se valida a sí misma');
  assert.ok(r.warnings.some((w) => /0000000020 .*único responsable/.test(w)), 'avisa de que nadie la valida');
  assert.ok(r.created.every((c) => /^Q\d\d$/.test(c.code)), 'códigos Q01, Q02…');
});

test('el validador asignado a mano sustituye al de su departamento', () => {
  const r = plan([{ employee: '0000000020', tipo: 'V', valor: '0000000040' }]);
  const of = byPerson(r);
  assert.equal(of('0000000020').WF_NIV1, '0000000040', 'a la jefa de ventas la valida su superior');
  assert.match(String(of('0000000020').WF_DESC), /RESPONSABLE VENTAS · VALIDA APELLIDO40/);
  assert.ok(!r.warnings.some((w) => /0000000020/.test(w)));
  // Asignaciones a mano de personas que ya no existen: se ignoran.
  const r2 = plan([{ employee: '0000000020', tipo: 'V', valor: '9999999999' }]);
  assert.equal(byPerson(r2)('0000000020').WF_NIV1, '');
});

test('al recalcular conserva los perfiles y lo editado; un nuevo responsable solo cambia el nivel 1', () => {
  const first = plan();
  const rows = [...ROWS, ...first.plan.insert.map((x) => ({ ...x.row, WF_NIV2: '0000000050', WF_VACA: '1,2' }))];
  const dyn = first.plan.insert.map((x) => ({ code: x.code, clave: (x.key as any).clave }));
  const people = PEOPLE.map((p) => ({ ...p, profile: first.plan.assign.find((a) => a.employee === p.code)?.profile ?? '' }));
  const again = plan([], people, dyn, rows);
  assert.deepEqual([again.plan.insert, again.plan.update, again.plan.remove, again.assigned], [[], [], [], 0]);
  const ventas = people.find((p) => p.code === '0000000010')!.profile;
  const more = [...people, P('0000000021', 'VEN', 'RESPONSABLE')];
  const r = plan([], more, dyn, rows);
  assert.ok(r.plan.update.some((u) => u.code === ventas && u.set.WF_NIV1 === '0000000020;0000000021'));
  // La jefa de ventas ya no es la única: la valida el otro responsable (perfil propio por excluirse a sí misma).
  const jefaProfile = people.find((p) => p.code === '0000000020')!.profile;
  assert.deepEqual(r.plan.update.find((u) => u.code === jefaProfile)?.set, { WF_NIV1: '0000000021' }, 'su perfil se conserva y solo cambia el nivel 1');
  const nuevo = r.plan.insert.find((x) => r.plan.assign.some((a) => a.employee === '0000000021' && a.profile === x.code));
  assert.equal(nuevo?.row.WF_NIV1, '0000000020', 'y al nuevo responsable lo valida ella');
  // Quitar roles: los perfiles sin nadie se borran.
  const none = plan([], people.map((p) => ({ ...p, workflowRol: '' })), dyn, rows);
  assert.equal(none.plan.remove.length, dyn.length);
  assert.equal(none.removed.length, dyn.length);
});

test('validación manual, filtros y script', () => {
  const ok = sanitizeValidation({ manual: ['0000000040', '0000000040'], depts: ['adm'] }, { people: new Set(['0000000020', '0000000040']), departments: new Set(['ADM']), code: '0000000020' });
  assert.deepEqual(ok, { manual: ['0000000040'], depts: ['ADM'] });
  assert.throws(() => sanitizeValidation({ manual: ['0000000020'] }, { people: new Set(['0000000020']), departments: null, code: '0000000020' }), /a sí misma/);
  assert.throws(() => sanitizeValidation({ depts: ['XX'] }, { people: new Set(), departments: new Set(['ADM']), code: '1' }), /No existe el departamento XX/);
  assert.equal(deptFilter(["A'B"]), "EM_DEPA='A''B'");
  assert.equal(parseKey('no json'), null);
  assert.match(workflow2Sql(), /CREATE TABLE \[dbo\]\.\[PS_WF2PERFILES\][\s\S]*CREATE TABLE \[dbo\]\.\[PS_WF2VALIDA\]/);
});

test('demostración: cambiar de opción activa pasa a la gente a los perfiles de la otra y borra los que quedan sin nadie', async () => {
  const { DemoDriver } = await import('./evalos/demo.ts');
  const { syncWorkflow, syncWorkflow2, getWfMode } = await import('./routes/evalos.ts');
  const { rawSet } = await import('./db.ts');
  const d = new DemoDriver('wf2-demo');
  const people = (await d.listPersonal()).filter((p) => p.active);
  const [jefa, emp] = people.filter((p) => p.department === 'COMERCIAL');
  await d.setEmployeesWorkflow([jefa.code], { workflowRol: 'RESPONSABLE', equipo: 'COMERCIAL', valEquipo: 'COMERCIAL' });
  await d.setEmployeesWorkflow([emp.code], { workflowRol: 'EMPLEADO', equipo: 'COMERCIAL' });
  await syncWorkflow(d, 'wf2-demo');
  assert.match((await d.getPersonal(emp.code))!.solicitudes, /^P/);
  assert.equal(await getWfMode('wf2-demo'), 'equipos');

  await rawSet('evalos-workflow-mode/wf2-demo', { mode: 'departamentos' });
  const r = await syncWorkflow2(d, 'wf2-demo');
  const e = (await d.getPersonal(emp.code))!;
  assert.match(e.solicitudes, /^Q/);
  const row = (await d.listWorkflowRows()).find((x) => x.WF_CODI === e.solicitudes)!;
  assert.equal(row.WF_NIV1, jefa.code, 'lo valida la responsable de su departamento');
  assert.ok(r.created.length >= 2);
  // Asignación manual: a la responsable la valida otra persona.
  const sup = people.find((p) => p.department !== 'COMERCIAL')!;
  await d.setWfValida(jefa.code, 'V', [sup.code]);
  await syncWorkflow2(d, 'wf2-demo');
  const jefaProfile = (await d.getPersonal(jefa.code))!.solicitudes;
  const jr = (await d.listWorkflowRows()).find((x) => x.WF_CODI === jefaProfile)!;
  assert.equal(jr.WF_NIV1, sup.code);
});
