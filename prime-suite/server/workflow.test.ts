// Tests de Perfiles Workflow: cálculo de perfiles por equipo y rol, autorizadores de nivel 1, filtros, borrado de los
// perfiles sin uso y validación de los cambios desde la pantalla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './http.ts';
import {
  DEFAULT_WF_SETTINGS, cleanEquipoCode, cleanOrder, nextProfileCode, planWorkflow, profileAlerts, profileDescription, sanitizeProfileEdit, sanitizeWfSettings, workflowSql
} from './evalos/workflow.ts';
import type { DynProfile, WorkflowPerson, WorkflowRow } from './evalos/types.ts';

const tpl = (code: string, extra: WorkflowRow = {}): WorkflowRow => ({
  WF_CODI: code, WF_DESC: `PLANTILLA ${code}`, WF_NIV1: null, WF_NIV2: null, WF_NIV3: null, WF_NIV4: null,
  WF_CAHO: null, WF_OLMA: null, WF_MAHA: null, WF_HDIA: null, WF_DCAB: null, WF_VACA: null, WF_PEIN: null, WF_CAINMA: null, WF_HOIN: null,
  WF_ANUL: '0', WF_ANUL_TIP: '2,3,6,9', WF_VFIL: 'N', WF_FILT: null, WF_WOFL: 'S', ...extra
});
const ROWS = [tpl('997'), tpl('998', { WF_VFIL: 'S' }), tpl('999', { WF_VFIL: 'S', WF_FILT: "EM_CEMP='1'" }), tpl('001', { WF_NIV1: '0000000001' })];
const EQUIPOS = [{ code: 'VENTAS', name: 'VENTAS' }, { code: 'DIR', name: 'DIRECCIÓN' }];
const person = (code: string, extra: Partial<WorkflowPerson> = {}): WorkflowPerson =>
  ({ code, name: `PERSONA ${code}`, active: true, equipo: '', valEquipo: '', workflowRol: '', profile: '', ...extra });
const PEOPLE = [
  person('0000000010', { equipo: 'VENTAS', workflowRol: 'EMPLEADO' }),
  person('0000000011', { equipo: 'VENTAS', workflowRol: 'EMPLEADO' }),
  person('0000000020', { equipo: 'DIR', valEquipo: 'VENTAS', workflowRol: 'RESPONSABLE' }),
  person('0000000030', { equipo: 'DIR', valEquipo: 'DIR', workflowRol: 'RRHH' }),
  person('0000000040', { workflowRol: '', profile: '001' })
];
const plan = (people = PEOPLE, dyn: DynProfile[] = [], rows = ROWS) => planWorkflow({ people, equipos: EQUIPOS, rows, dyn, settings: DEFAULT_WF_SETTINGS });

test('crea un perfil por equipo y rol copiando la plantilla, con los validadores del equipo en el nivel 1', () => {
  const r = plan();
  assert.deepEqual(r.created.map((c) => [c.code, c.name]), [
    ['P01', 'DIR · RESPONSABLE DE VENTAS'.replace('DIR', 'DIRECCIÓN')],
    ['P02', 'DIRECCIÓN · RRHH'],
    ['P03', 'VENTAS · EMPLEADO']
  ]);
  const byCode = new Map(r.plan.insert.map((x) => [x.code, x]));
  const emp = byCode.get('P03')!.row;
  assert.equal(emp.WF_NIV1, '0000000020', 'el responsable que valida VENTAS aprueba a VENTAS');
  assert.equal(emp.WF_NIV2, '');
  assert.equal(emp.WF_VACA, '1', 'las solicitudes vacías en la plantilla se crean con un nivel');
  assert.equal(emp.WF_ANUL, '0', 'lo que trae la plantilla se respeta');
  assert.equal(emp.WF_WOFL, 'S');
  const resp = byCode.get('P01')!.row;
  assert.equal(resp.WF_VFIL, 'S');
  assert.equal(resp.WF_FILT, "EM_EQUIPO='VENTAS'", 'el responsable ve a la gente del equipo que valida');
  assert.equal(resp.WF_NIV1, '0000000030', 'al responsable lo aprueba quien valida su equipo (DIR)');
  assert.equal(byCode.get('P02')!.row.WF_FILT, '', 'RRHH ve a todo el personal');
  assert.deepEqual(byCode.get('P01')!.key, { equipo: 'DIR', rol: 'RESPONSABLE', valEquipo: 'VENTAS' });
  // Asignaciones: las cuatro personas con rol; la que no tiene rol conserva su perfil manual.
  assert.deepEqual(r.plan.assign.map((a) => `${a.employee}=${a.profile}`).sort(),
    ['0000000010=P03', '0000000011=P03', '0000000020=P01', '0000000030=P02']);
  assert.deepEqual(r.plan.remove, []);
  assert.ok(r.warnings.some((w) => /valida su propio equipo/.test(w)), 'RRHH valida DIR y pertenece a DIR');
});

test('al recalcular solo actualiza lo gestionado y conserva niveles 2-4 y el orden de validación', () => {
  const first = plan();
  const rows = [...ROWS, ...first.plan.insert.map((x) => ({ ...x.row, WF_NIV2: '0000000040', WF_VACA: '1,2' }))];
  const dyn = first.plan.insert.map((x) => ({ code: x.code, ...x.key }));
  const people = PEOPLE.map((p) => ({ ...p, profile: first.plan.assign.find((a) => a.employee === p.code)?.profile ?? p.profile }));
  const again = plan(people, dyn, rows);
  assert.deepEqual(again.plan.insert, []);
  assert.deepEqual(again.plan.update, []);
  assert.equal(again.assigned, 0);
  // Llega un segundo validador de VENTAS: cambia solo el nivel 1 del perfil de VENTAS.
  const more = [...people, person('0000000050', { equipo: 'DIR', valEquipo: 'VENTAS', workflowRol: 'RESPONSABLE', profile: 'P01' })];
  const r = plan(more, dyn, rows);
  assert.deepEqual(r.plan.update, [{ code: 'P03', set: { WF_NIV1: '0000000020;0000000050' } }]);
});

test('borra los perfiles que se quedan sin nadie y quita el perfil a quien deja de tener rol', () => {
  const first = plan();
  const rows = [...ROWS, ...first.plan.insert.map((x) => x.row)];
  const dyn = first.plan.insert.map((x) => ({ code: x.code, ...x.key }));
  const people = PEOPLE.map((p) => ({ ...p, profile: first.plan.assign.find((a) => a.employee === p.code)?.profile ?? p.profile }));
  // Los de VENTAS pasan a no tener rol.
  const changed = people.map((p) => (p.equipo === 'VENTAS' ? { ...p, workflowRol: '' } : p));
  const r = plan(changed, dyn, rows);
  assert.deepEqual(r.plan.remove, ['P03']);
  assert.deepEqual(r.removed, [{ code: 'P03', name: 'VENTAS · EMPLEADO' }]);
  assert.deepEqual(r.plan.assign.map((a) => `${a.employee}=${a.profile}`).sort(), ['0000000010=', '0000000011=']);
});

test('las personas de baja no validan, y avisa de equipos sin validador o sin plantilla', () => {
  const people = PEOPLE.map((p) => (p.code === '0000000020' ? { ...p, active: false } : p));
  const r = plan(people);
  const emp = r.plan.insert.find((x) => x.key.equipo === 'VENTAS')!.row;
  assert.equal(emp.WF_NIV1, '');
  assert.ok(r.warnings.some((w) => /Nadie en alta valida el equipo VENTAS/.test(w)));
  const noTpl = plan(PEOPLE, [], ROWS.filter((x) => x.WF_CODI !== '997'));
  assert.ok(noTpl.warnings.some((w) => /No existe la plantilla 997/.test(w)));
  assert.ok(!noTpl.plan.assign.some((a) => a.employee === '0000000010'), 'sin plantilla no se toca su perfil');
});

test('si la fila de un perfil registrado ya no está en WORKFLOW, lo vuelve a crear', () => {
  const r = plan(PEOPLE, [{ code: 'P05', equipo: 'VENTAS', rol: 'EMPLEADO', valEquipo: '' }]);
  assert.ok(r.plan.remove.includes('P05'));
  assert.ok(r.plan.insert.some((x) => x.key.equipo === 'VENTAS' && x.code !== 'P05'));
});

test('códigos de perfil, descripción y equipos', () => {
  assert.equal(nextProfileCode('P', new Set()), 'P01');
  assert.equal(nextProfileCode('P', new Set(['P01', 'P02'])), 'P03');
  assert.equal(nextProfileCode('P', new Set(['P09'].concat(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08']))), 'P0A');
  assert.equal(profileDescription({ equipo: 'X', rol: 'EMPLEADO', valEquipo: '' }, new Map(), 8), 'X · EMP…');
  assert.equal(profileDescription({ equipo: '', rol: 'RRHH', valEquipo: '' }, new Map()), 'SIN EQUIPO · RRHH');
  assert.equal(cleanEquipoCode(' ventas-1 ', null), 'VENTAS-1');
  assert.throws(() => cleanEquipoCode("A'B", null), HttpError);
  assert.throws(() => cleanEquipoCode('ABCDEFGHIJK', 10), /como máximo 10/);
});

test('orden de validación y cambios del perfil desde la pantalla', () => {
  assert.equal(cleanOrder(' 4, 2 ,1 '), '4,2,1');
  assert.equal(cleanOrder('0'), '0');
  assert.equal(cleanOrder(''), '');
  assert.throws(() => cleanOrder('1,1'), /repetirse/);
  assert.throws(() => cleanOrder('5'), /no válido/);
  const known = new Set(['0000000010', '0000000020']);
  const set = sanitizeProfileEdit({ levels: { WF_NIV1: 'X', WF_NIV2: ['0000000010', '0000000010'], WF_NIV3: '' }, orders: { WF_VACA: '1,2', WF_CAHO: '' } }, known);
  assert.deepEqual(set, { WF_NIV2: '0000000010', WF_NIV3: '', WF_CAHO: '', WF_VACA: '1,2' }, 'el nivel 1 no se edita');
  assert.throws(() => sanitizeProfileEdit({ levels: { WF_NIV2: '9999999999' } }, known), /No existe el empleado 9999999999/);
  assert.deepEqual(profileAlerts({ WF_NIV1: '0000000010', WF_NIV2: '', WF_VACA: '1,2', WF_CAHO: '0' }), ['Vacaciones: pasa por el nivel 2, que no tiene autorizadores.']);
});

test('ajustes y script de las tablas', () => {
  assert.deepEqual(sanitizeWfSettings({ templates: { EMPLEADO: '997', RESPONSABLE: '998', RRHH: '999' }, prefix: 'p' }).prefix, 'P');
  assert.throws(() => sanitizeWfSettings({ templates: { EMPLEADO: 'P01', RESPONSABLE: '998', RRHH: '999' }, prefix: 'P' }), /Ninguna plantilla/);
  assert.throws(() => sanitizeWfSettings({ templates: { EMPLEADO: '997' }, prefix: 'P' }), /RESPONSABLE/);
  const sql = workflowSql('dbo');
  assert.match(sql, /CREATE TABLE \[dbo\]\.\[PS_EQUIPOS\]/);
  assert.match(sql, /CREATE TABLE \[dbo\]\.\[PS_WFPERFILES\]/);
  assert.match(sql, /IF OBJECT_ID/);
});
