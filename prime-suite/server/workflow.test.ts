// Tests de Perfiles Workflow (por departamentos): responsables que validan su departamento y los añadidos,
// validadores asignados a mano, perfiles por clave, limpieza de los perfiles de la versión por equipos, rol abreviado
// en EM_WORKFLOWROL y validación de los cambios desde la pantalla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './http.ts';
import {
  DEFAULT_WF_SETTINGS, cleanOrder, deptFilter, nextProfileCode, parseKey, planWorkflow, profileAlerts, roleFromDb, roleToDb,
  sanitizeProfileEdit, sanitizeValidation, sanitizeWfSettings, workflowSql, type WorkflowPerson
} from './evalos/workflow.ts';
import type { WorkflowRow } from './evalos/types.ts';

const tpl = (code: string, extra: WorkflowRow = {}): WorkflowRow => ({ WF_CODI: code, WF_DESC: `PLANTILLA ${code}`, WF_NIV1: '', WF_NIV2: '', WF_VACA: '', WF_CAHO: '', WF_VFIL: 'N', WF_FILT: '', ...extra });
const ROWS = [tpl('997'), tpl('998', { WF_VFIL: 'S' }), tpl('999', { WF_VFIL: 'S' })];
const DEPTS = [{ code: 'VEN', description: 'VENTAS' }, { code: 'ADM', description: 'ADMINISTRACIÓN' }, { code: 'DIR', description: 'DIRECCIÓN' }];
const P = (code: string, department: string, workflowRol: string, extra: Partial<WorkflowPerson> = {}): WorkflowPerson => ({ code, name: `APELLIDO${code.slice(-2)}, NOMBRE`, active: true, department, workflowRol, profile: '', ...extra });
const PEOPLE = [
  P('0000000010', 'VEN', 'EMPLEADO'), P('0000000011', 'VEN', 'EMPLEADO'),
  P('0000000020', 'VEN', 'RESPONSABLE'),                 // jefa de ventas
  P('0000000030', 'ADM', 'EMPLEADO'),
  P('0000000040', 'DIR', 'RESPONSABLE'),                 // director: valida DIR y, añadido, ADM
  P('0000000050', 'ADM', 'RRHH')
];
const plan = (valida: any[] = [], people = PEOPLE, dyn: any[] = [], rows = ROWS, legacy: string[] = []) =>
  planWorkflow({ people, departments: DEPTS, valida, rows, dyn, settings: DEFAULT_WF_SETTINGS, legacy });
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
  assert.match(workflowSql(), /CREATE TABLE \[dbo\]\.\[PS_WF2PERFILES\][\s\S]*CREATE TABLE \[dbo\]\.\[PS_WF2VALIDA\]/);
});


test('quita los perfiles de la versión por equipos: a quien no tiene rol y, sin nadie, se borran', () => {
  const rows = [...ROWS, { WF_CODI: 'P01', WF_DESC: 'VENTAS · EMPLEADO (EQUIPOS)' }, { WF_CODI: 'P02', WF_DESC: 'OTRO' }];
  const people = [...PEOPLE.map((p) => ({ ...p, profile: p.code === '0000000010' ? 'P01' : '' })), P('0000000060', 'VEN', '', { profile: 'P02' }), P('0000000061', 'VEN', '', { profile: '001' })];
  const r = plan([], people, [], rows, ['P01', 'P02']);
  assert.ok(r.plan.assign.some((a) => a.employee === '0000000060' && a.profile === ''), 'sin rol: se le quita el perfil antiguo');
  assert.ok(!r.plan.assign.some((a) => a.employee === '0000000061'), 'un perfil de Evalos (001) no se toca');
  assert.deepEqual(r.plan.removeLegacy, ['P01', 'P02']);
  assert.deepEqual(r.removed.map((x) => x.code), ['P01', 'P02']);
});

test('códigos, orden de validación y cambios del perfil desde la pantalla', () => {
  assert.equal(nextProfileCode('Q', new Set()), 'Q01');
  assert.equal(nextProfileCode('Q', new Set(['Q01', 'Q02'])), 'Q03');
  assert.equal(cleanOrder(' 4, 2 ,1 '), '4,2,1');
  assert.equal(cleanOrder('0'), '0');
  assert.throws(() => cleanOrder('1,1'), /repetirse/);
  assert.throws(() => cleanOrder('5'), /no válido/);
  const known = new Set(['0000000010', '0000000020']);
  const set = sanitizeProfileEdit({ levels: { WF_NIV1: 'X', WF_NIV2: ['0000000010', '0000000010'], WF_NIV3: '' }, orders: { WF_VACA: '1,2', WF_CAHO: '' } }, known);
  assert.deepEqual(set, { WF_NIV2: '0000000010', WF_NIV3: '', WF_CAHO: '', WF_VACA: '1,2' }, 'el nivel 1 no se edita');
  assert.throws(() => sanitizeProfileEdit({ levels: { WF_NIV2: '9999999999' } }, known), HttpError);
  assert.deepEqual(profileAlerts({ WF_NIV1: '0000000010', WF_NIV2: '', WF_VACA: '1,2', WF_CAHO: '0' }), ['Vacaciones: pasa por el nivel 2, que no tiene autorizadores.']);
  assert.equal(sanitizeWfSettings({ templates: { EMPLEADO: '997', RESPONSABLE: '998', RRHH: '999' }, prefix: 'q' }).prefix, 'Q');
  assert.throws(() => sanitizeWfSettings({ templates: { EMPLEADO: 'Q01', RESPONSABLE: '998', RRHH: '999' }, prefix: 'Q' }), /Ninguna plantilla/);
});

test('rol en EM_WORKFLOWROL: completo si cabe, abreviado si la columna es corta, y se lee de las dos formas', () => {
  assert.equal(roleToDb('RESPONSABLE', 15), 'RESPONSABLE');
  assert.equal(roleToDb('RESPONSABLE', 5), 'RESP');
  assert.equal(roleToDb('EMPLEADO', 5), 'EMP');
  assert.throws(() => roleToDb('RESPONSABLE', 3), /Amplía la columna/);
  for (const [v, r] of [['RESP', 'RESPONSABLE'], ['emp', 'EMPLEADO'], ['RESPO', 'RESPONSABLE'], ['RRHH', 'RRHH'], ['', '']]) assert.equal(roleFromDb(v), r, v);
});
