// Atajos de Evalos: módulo nativo con las funciones de Evalos 8. Cada pantalla se puede usar también como widget del Inicio.
// Casi todo trabaja directamente sobre la base de datos de Evalos 8 (drivers mssql.ts / demo.ts); Correcciones, con
// conexión real, usa EvalosRest (marcajes, anomalías, ausencias) y los servicios SOAP ServiciosCliente (vacaciones).
import { Router, json, body, HttpError, clientIp } from '../http.ts';
import { Modules, Companies, Categories, audit, id, now, rawGet, rawSet, type Module } from '../db.ts';
import { requireUser, moduleRole, type Ctx } from '../access.ts';
import { encryptSecret } from '../crypto.ts';
import { getConfig, putConfig, driverFor, isConfigured } from '../evalos/config.ts';
import { SqlServerDriver, connectionHint, ident } from '../evalos/mssql.ts';
import { DemoDriver, resetDemo } from '../evalos/demo.ts';
import { syncCompanyEvalosUsers } from '../evalos/users.ts';
import { DEFAULT_MAPPING, type Convenio, type VacationTypesInfo, type EvalosDriver, type EvalosConfig, type EvalosMapping, type EvalosEngine } from '../evalos/types.ts';
import { sanitizePersonal, sanitizeNewNames, sanitizeOrgValue, sanitizeReadmit, cleanCard, cleanIsoDate } from '../evalos/personal.ts';
import { HISTORY, isHistoryKind, madridNow } from '../evalos/history.ts';
import { personalDriverFor, stampFor } from '../evalos/employees.ts';
import { VACATION_TYPE_MAX, conveniosSql, sanitizeConvenio } from '../evalos/convenios.ts';
import { alertsFor, syncPeriods, type PeriodSyncResult } from '../evalos/convperiods.ts';
import {
  DEFAULT_WF_SETTINGS, WF_LEVEL_COLS, WF_REQUESTS, WF_ROLES, cleanEquipoCode, cleanEquipoName, isWfRole, levelCodes, planWorkflow, profileAlerts,
  sanitizeProfileEdit, sanitizeWfSettings, workflowSql, type WorkflowSettings, type WorkflowSyncResult
} from '../evalos/workflow.ts';
import type { Personal, WorkflowPerson } from '../evalos/types.ts';
import { loadMarcajes, NORMAL_INCIDENCE, savePunches, deletePunches, cleanDeleteTimes, saveAbsence, deleteAbsence, assignHoliday, removeHoliday, cleanRange, cleanEmployeeCode, cleanPunchWrites } from '../evalos/marcajesrest.ts';

export const EVALOS_CLIENT_ID = 'atajos-evalos';
export const EVALOS_PATH = '/evalos';

/**
 * Pantallas de Atajos de Evalos. Cada una es a la vez una página del módulo y un widget del Inicio.
 * Para añadir una pantalla: añadirla aquí, crear sus rutas /api/evalos/<clave> y registrar su componente en src/pages/evalos/screens.tsx.
 */
export const EVALOS_SCREENS = [
  { key: 'departamentos', title: 'Departamentos', description: 'Consulta, alta y modificación de departamentos y sus empleados', glyph: 'building', widgetSize: 'm' as const },
  { key: 'personal', title: 'Personal', description: 'Alta, modificación y eliminación de empleados', glyph: 'people', widgetSize: 'm' as const },
  { key: 'calendarios', title: 'Calendarios', description: 'Calendarios laborales y festivos', glyph: 'calendar', widgetSize: 'm' as const },
  { key: 'convenios', title: 'Convenios', description: 'Días de vacaciones y límites de incidencia por convenio', glyph: 'calendar', widgetSize: 'm' as const },
  { key: 'teletrabajo', title: 'Teletrabajo', description: 'Planificación de teletrabajo y presencial, bolsas, aforo de la oficina y acuerdos', glyph: 'globe', widgetSize: 'm' as const },
  { key: 'correcciones', title: 'Correcciones', description: 'Corrige marcajes, resuelve solicitudes y añade ausencias', glyph: 'wrench', widgetSize: 'm' as const },
  { key: 'workflow', title: 'Perfiles Workflow', description: 'Equipos, roles de Workflow y perfiles de solicitudes con sus niveles de aprobación', glyph: 'people', widgetSize: 'm' as const }
];

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const log = (c: Ctx, req: Request, action: string, target?: string, detail?: string) =>
  audit({ actorId: c.user.id, actorEmail: c.user.email, companyId: c.company.id, action, target, detail, ip: clientIp(req) });

/** Garantiza que Atajos de Evalos existe como módulo nativo (también en instalaciones ya creadas). */
export async function ensureEvalosModule(): Promise<Module> {
  const all = await Modules.all();
  let m = all.find((x) => x.clientId === EVALOS_CLIENT_ID);
  if (!m) {
    const people = (await Categories.all()).find((c) => c.name.toUpperCase() === 'PEOPLE');
    m = {
      id: id(), clientId: EVALOS_CLIENT_ID, name: 'Atajos de Evalos', description: 'Funciones principales de Evalos 8, directas sobre su base de datos',
      categoryId: people?.id || null, initials: 'AE', color: '#0E7C66', iconGlyph: 'clock',
      url: EVALOS_PATH, openMode: 'native', authMethod: 'none', tokenDelivery: 'fragment', tokenParam: 'prime_token', tokenTtlSec: 60,
      redirectUris: [], postLogoutRedirectUris: [], defaultRole: 'user', widgets: [], enabled: true, order: 23, createdAt: now(), updatedAt: now()
    };
    await Modules.put(m);
    for (const co of await Companies.all()) {
      co.enabledModules = Array.from(new Set([...co.enabledModules, m.id]));
      await Companies.put(co);
    }
  } else if (m.openMode !== 'native' || m.url !== EVALOS_PATH) {
    m = { ...m, openMode: 'native', url: EVALOS_PATH, authMethod: 'none', updatedAt: now() };
    await Modules.put(m);
  }
  return m;
}

async function evalosAccess(c: Ctx) {
  const module = await ensureEvalosModule();
  const role = moduleRole(c.user, c.company, c.groups, module);
  return {
    module,
    role,
    canEdit: role === 'admin' || role === 'user',
    canDelete: role === 'admin',
    // La conexión a la BD la configuran los administradores del portal (de su empresa; el superadmin, de cualquiera).
    canConfigure: c.user.role === 'admin' || c.user.role === 'superadmin'
  };
}

export async function requireEvalos(req: Request) {
  const c = await requireUser(req);
  const a = await evalosAccess(c);
  if (!a.role) throw new HttpError(403, 'No tienes acceso a Atajos de Evalos');
  return { c, ...a };
}

/** Widgets que publica Atajos de Evalos para el panel de Inicio (uno por pantalla). */
export async function evalosWidgets(c: Ctx) {
  const { module, role } = await evalosAccess(c);
  if (!role) return [];
  return EVALOS_SCREENS.map((s) => ({
    moduleId: module.id, moduleName: module.name, initials: module.initials, color: module.color,
    id: `evalos:${s.key}`, title: s.title, type: 'evalos', screen: s.key, size: s.widgetSize, refreshSec: 300
  }));
}

// ---------- Configuración ----------
async function configCompany(c: Ctx, requested?: unknown) {
  const cid = str(requested, 80);
  if (!cid || cid === c.company.id) return c.company;
  if (c.user.role !== 'superadmin') throw new HttpError(403, 'Solo puedes configurar tu empresa');
  const co = await Companies.get(cid);
  if (!co) throw new HttpError(404, 'Empresa no encontrada');
  return co;
}

function sanitizeMapping(v: any, existing: EvalosMapping): EvalosMapping {
  if (!v || typeof v !== 'object') return existing;
  const idf = (x: unknown, fallback: string, optional = false) => {
    const s = typeof x === 'string' ? x.trim() : fallback;
    if (!s && optional) return '';
    if (s) ident(s, 'columna o tabla');
    return s;
  };
  const d = v.departments || {};
  const e = v.employees || {};
  const h = v.departmentHistory;
  return {
    departments: {
      schema: idf(d.schema, existing.departments.schema || '', true) || undefined,
      table: idf(d.table, existing.departments.table),
      code: idf(d.code, existing.departments.code, true),
      description: idf(d.description, existing.departments.description, true)
    },
    employees: {
      schema: idf(e.schema, existing.employees.schema || '', true) || undefined,
      table: idf(e.table, existing.employees.table),
      code: idf(e.code, existing.employees.code),
      name: idf(e.name, existing.employees.name),
      department: idf(e.department, existing.employees.department),
      endDate: idf(e.endDate, existing.employees.endDate, true)
    },
    departmentHistory: h === null ? null : h && h.table ? { schema: idf(h.schema, '', true) || undefined, table: idf(h.table, ''), department: idf(h.department, '', true) } : existing.departmentHistory ?? null
  };
}

function publicConfig(cfg: EvalosConfig | null, company: { id: string; name: string }) {
  return {
    companyId: company.id,
    companyName: company.name,
    configured: isConfigured(cfg),
    engine: cfg?.engine || 'mssql',
    hasConnection: !!cfg?.connEnc,
    connHint: cfg?.connHint || null,
    mapping: cfg?.mapping || DEFAULT_MAPPING,
    uppercase: cfg?.uppercase ?? true,
    updatedAt: cfg?.updatedAt || null,
    updatedBy: cfg?.updatedBy || null
  };
}

/** Driver para probar/detectar: con la cadena recibida (sin guardar) o con la guardada. */
async function trialDriver(companyId: string, b: any) {
  const stored = await getConfig(companyId);
  const engine: EvalosEngine = b.engine === 'demo' ? 'demo' : b.engine === 'mssql' ? 'mssql' : stored?.engine || 'mssql';
  const mapping = sanitizeMapping(b.mapping, stored?.mapping || DEFAULT_MAPPING);
  if (engine === 'demo') return { driver: new DemoDriver(companyId), mapping };
  const conn = str(b.connectionString, 4000);
  if (conn) return { driver: new SqlServerDriver(conn, mapping), mapping };
  const { driver } = await driverFor(companyId, stored ? { ...stored, engine: 'mssql', mapping } : null);
  return { driver, mapping };
}

// ---------- Validación de datos de Evalos ----------
function cleanCode(v: unknown, upper: boolean, max: number | null) {
  let s = str(v, 200);
  if (upper) s = s.toUpperCase();
  if (!s) throw new HttpError(400, 'El código es obligatorio');
  if (/[\u0000-\u001f'"]/.test(s)) throw new HttpError(400, 'El código contiene caracteres no permitidos');
  if (max && s.length > max) throw new HttpError(400, `El código admite como máximo ${max} caracteres`);
  return s;
}
function cleanDesc(v: unknown, upper: boolean, max: number | null) {
  let s = str(v, 500).replace(/\s+/g, ' ');
  if (upper) s = s.toLocaleUpperCase('es-ES');
  if (!s) throw new HttpError(400, 'La descripción es obligatoria');
  if (max && s.length > max) throw new HttpError(400, `La descripción admite como máximo ${max} caracteres`);
  return s;
}

// ---------- Perfiles Workflow: ajustes y recálculo ----------
const wfSettingsKey = (companyId: string) => `evalos-workflow/${companyId}`;
export async function getWfSettings(companyId: string): Promise<WorkflowSettings> {
  const s = await rawGet<WorkflowSettings>(wfSettingsKey(companyId));
  return s ? { templates: { ...DEFAULT_WF_SETTINGS.templates, ...s.templates }, prefix: s.prefix || DEFAULT_WF_SETTINGS.prefix } : DEFAULT_WF_SETTINGS;
}
const toWfPerson = (p: Personal): WorkflowPerson => ({ code: p.code, name: p.name, active: p.active, equipo: p.equipo || '', valEquipo: p.valEquipo || '', workflowRol: p.workflowRol || '', profile: p.solicitudes || '' });
const workflowCapable = (d: EvalosDriver) => !!(d.listWorkflowRows && d.applyWorkflowPlan && d.listPersonal && d.listEquipos && d.listDynProfiles && d.workflowColumns);
/** Un recálculo cada vez por empresa: dos a la vez podrían elegir el mismo código de perfil. */
const wfQueue = new Map<string, Promise<unknown>>();
/** Calcula y aplica los perfiles de Workflow de toda la empresa (WORKFLOW, PS_WFPERFILES y EM_WFOP). */
export function syncWorkflow(driver: EvalosDriver, companyId: string): Promise<WorkflowSyncResult> {
  const run = async () => {
    if (!workflowCapable(driver)) throw new HttpError(501, 'Este motor de base de datos no admite Perfiles Workflow.');
    const [people, equipos, rows, dyn, cols, settings] = await Promise.all([
      driver.listPersonal!(), driver.listEquipos!(), driver.listWorkflowRows!(), driver.listDynProfiles!(), driver.workflowColumns!(), getWfSettings(companyId)
    ]);
    const res = planWorkflow({ people: people.map(toWfPerson), equipos, rows, dyn, settings, descMax: cols.workflow.WF_DESC });
    await driver.applyWorkflowPlan!(res.plan);
    return res;
  };
  const prev = wfQueue.get(companyId) || Promise.resolve();
  const next = prev.catch(() => undefined).then(run);
  wfQueue.set(companyId, next.catch(() => undefined));
  return next;
}
/** Recálculo tras un cambio en Personal: nunca hace fallar la operación principal (los errores vuelven como avisos). */
async function syncWorkflowSafe(driver: EvalosDriver, companyId: string): Promise<WorkflowSyncResult | null> {
  if (!workflowCapable(driver)) return null;
  try { return await syncWorkflow(driver, companyId); }
  catch (e: any) {
    if (e instanceof HttpError && e.code === 'workflow_missing') return null;
    return { plan: { insert: [], update: [], remove: [], assign: [] }, created: [], updated: [], removed: [], assigned: 0, warnings: [`No se pudieron recalcular los perfiles de Workflow: ${e?.message || e}`] };
  }
}
/** Resumen para la respuesta (sin el plan). */
const syncSummary = (r: WorkflowSyncResult | null) => (r ? { created: r.created, updated: r.updated, removed: r.removed, assigned: r.assigned, warnings: r.warnings } : null);
const syncDetail = (r: WorkflowSyncResult) =>
  [r.created.length && `creados: ${r.created.map((x) => x.code).join(', ')}`, r.updated.length && `actualizados: ${r.updated.join(', ')}`,
    r.removed.length && `borrados: ${r.removed.map((x) => x.code).join(', ')}`, r.assigned && `${r.assigned} persona(s) con perfil nuevo`].filter(Boolean).join(' · ') || 'sin cambios';

export function evalosRoutes(r: Router) {
  r.get('/api/evalos/me', async (req) => {
    const c = await requireUser(req);
    const a = await evalosAccess(c);
    if (!a.role) throw new HttpError(403, 'No tienes acceso a Atajos de Evalos');
    const cfg = await getConfig(c.company.id);
    return json({
      role: a.role, canEdit: a.canEdit, canDelete: a.canDelete, canConfigure: a.canConfigure,
      configured: isConfigured(cfg), engine: cfg?.engine || null, connHint: cfg?.connHint || null,
      screens: EVALOS_SCREENS
    });
  });

  // --- Configuración (administradores) ---
  r.get('/api/evalos/config', async (req) => {
    const { c, canConfigure } = await requireEvalos(req);
    if (!canConfigure) throw new HttpError(403, 'Requiere permisos de administrador');
    const co = await configCompany(c, new URL(req.url).searchParams.get('companyId'));
    const companies = c.user.role === 'superadmin' ? (await Companies.all()).map((x) => ({ id: x.id, name: x.name, code: x.code })).sort((a, b) => a.name.localeCompare(b.name)) : undefined;
    return json({ ...publicConfig(await getConfig(co.id), co), companies });
  });

  r.put('/api/evalos/config', async (req) => {
    const { c, canConfigure } = await requireEvalos(req);
    if (!canConfigure) throw new HttpError(403, 'Requiere permisos de administrador');
    const b = await body(req);
    const co = await configCompany(c, b.companyId);
    const existing = await getConfig(co.id);
    const engine: EvalosEngine = b.engine === 'demo' ? 'demo' : 'mssql';
    const next: EvalosConfig = {
      companyId: co.id,
      engine,
      connEnc: existing?.connEnc,
      connHint: existing?.connHint,
      mapping: sanitizeMapping(b.mapping, existing?.mapping || DEFAULT_MAPPING),
      uppercase: b.uppercase !== undefined ? !!b.uppercase : existing?.uppercase ?? true,
      updatedAt: now(),
      updatedBy: c.user.email
    };
    const conn = str(b.connectionString, 4000);
    if (conn) {
      if (!/=/.test(conn) || !/;|=/.test(conn)) throw new HttpError(400, 'La cadena de conexión no tiene un formato válido (ej. Server=servidor,1433;Database=EVALOS;User Id=usuario;Password=…;Encrypt=true;TrustServerCertificate=true)');
      next.connEnc = await encryptSecret(conn);
      next.connHint = connectionHint(conn);
    }
    if (b.clearConnection) {
      next.connEnc = undefined;
      next.connHint = undefined;
    }
    if (engine === 'mssql' && !next.connEnc) throw new HttpError(400, 'Introduce la cadena de conexión a la base de datos de Evalos 8');
    await putConfig(next);
    await log(c, req, 'evalos.config_updated', co.name, conn ? 'cadena de conexión cambiada' : undefined);
    // Con la conexión activa, se dan de alta en Evalos 8 los usuarios del portal que estaban pendientes.
    const userSync = engine === 'mssql' ? await syncCompanyEvalosUsers(co.id, { id: c.user.id, email: c.user.email }) : null;
    return json({ ...publicConfig(next, co), userSync });
  });

  r.post('/api/evalos/config/test', async (req) => {
    const { c, canConfigure } = await requireEvalos(req);
    if (!canConfigure) throw new HttpError(403, 'Requiere permisos de administrador');
    const b = await body(req);
    const co = await configCompany(c, b.companyId);
    const { driver, mapping } = await trialDriver(co.id, b);
    const started = Date.now();
    const info = await driver.info();
    // Si ya hay tabla de departamentos configurada, se comprueba también que se puede leer.
    let departments: number | null = null;
    let mappingError: string | null = null;
    if (mapping.departments.table && mapping.departments.code && mapping.departments.description) {
      try {
        departments = (await driver.listDepartments()).length;
      } catch (e: any) {
        mappingError = e.message;
      }
    }
    return json({ ok: true, ms: Date.now() - started, info, departments, mappingError });
  });

  r.post('/api/evalos/config/detect', async (req) => {
    const { c, canConfigure } = await requireEvalos(req);
    if (!canConfigure) throw new HttpError(403, 'Requiere permisos de administrador');
    const b = await body(req);
    const co = await configCompany(c, b.companyId);
    const { driver } = await trialDriver(co.id, b);
    return json(await driver.detect());
  });

  // Exportación del esquema de la BD (solo estructura, sin datos) para preparar el mapeo de las pantallas.
  r.post('/api/evalos/config/schema', async (req) => {
    const { c, canConfigure } = await requireEvalos(req);
    if (!canConfigure) throw new HttpError(403, 'Requiere permisos de administrador');
    const b = await body(req);
    const co = await configCompany(c, b.companyId);
    const { driver } = (await trialDriver(co.id, { ...b, engine: 'mssql' })) as { driver: EvalosDriver };
    if (!driver.schema) throw new HttpError(400, 'La exportación del esquema solo está disponible con SQL Server');
    const s = await driver.schema({ samples: !!b.samples });
    await log(c, req, 'evalos.schema_exported', co.name, `${s.tables.length} tablas${b.samples ? ' · con filas de ejemplo' : ''}`);
    return json(s);
  });

  r.post('/api/evalos/config/reset-demo', async (req) => {
    const { c, canConfigure } = await requireEvalos(req);
    if (!canConfigure) throw new HttpError(403, 'Requiere permisos de administrador');
    const co = await configCompany(c, (await body(req)).companyId);
    await resetDemo(co.id);
    return json({ ok: true });
  });

  // --- Departamentos ---
  r.get('/api/evalos/departamentos', async (req) => {
    const { c, canEdit, canDelete } = await requireEvalos(req);
    const { driver, config } = await driverFor(c.company.id);
    const [items, limits] = await Promise.all([driver.listDepartments(), driver.departmentLimits().catch(() => ({ code: null, description: null }))]);
    return json({ items, limits, canEdit, canDelete, uppercase: config.uppercase, engine: config.engine });
  });

  r.get('/api/evalos/departamentos/:code', async (req, p) => {
    const { c } = await requireEvalos(req);
    const { driver } = await driverFor(c.company.id);
    const d = await driver.getDepartment(p.code);
    if (!d) throw new HttpError(404, `No existe el departamento ${p.code}`);
    return json({ ...d, employeesList: await driver.departmentEmployees(p.code) });
  });

  r.post('/api/evalos/departamentos', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver, config } = await driverFor(c.company.id);
    const b = await body(req);
    const lim = await driver.departmentLimits().catch(() => ({ code: null, description: null }));
    const code = cleanCode(b.code, config.uppercase, lim.code);
    const description = cleanDesc(b.description, config.uppercase, lim.description);
    await driver.createDepartment(code, description);
    await log(c, req, 'evalos.departamento_created', code, description);
    return json(await driver.getDepartment(code), 201);
  });

  r.put('/api/evalos/departamentos/:code', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver, config } = await driverFor(c.company.id);
    const b = await body(req);
    const lim = await driver.departmentLimits().catch(() => ({ code: null, description: null }));
    const description = cleanDesc(b.description, config.uppercase, lim.description);
    await driver.updateDepartment(p.code, description);
    await log(c, req, 'evalos.departamento_updated', p.code, description);
    return json(await driver.getDepartment(p.code));
  });

  r.del('/api/evalos/departamentos/:code', async (req, p) => {
    const { c, canDelete } = await requireEvalos(req);
    if (!canDelete) throw new HttpError(403, 'Solo un administrador de Atajos de Evalos puede eliminar departamentos');
    const { driver } = await driverFor(c.company.id);
    await driver.deleteDepartment(p.code);
    await log(c, req, 'evalos.departamento_deleted', p.code);
    return json({ ok: true });
  });

  // --- Personal ---
  const personalDriver = personalDriverFor;
  /** Hoy (Madrid) en AAAA-MM-DD. */
  const todayIso = () => { const d = madridNow().date; return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`; };
  /** Fecha, hora e iniciales en Evalos de quien hace el cambio (FECHA, HORA, USUARIO de VACACIONES). */
  const periodStamp = async (driver: EvalosDriver, email: string) => ({ ...madridNow(), user: driver.userInitials ? await driver.userInitials(email).catch(() => '') : '' });
  /**
   * Genera o actualiza los periodos (VACACIONES, INCIDENCIALIMITE) de las personas de un convenio. No falla la
   * operación principal: los errores vuelven como avisos.
   */
  const convenioPeriods = async (driver: EvalosDriver, code: string, email: string, only?: string[], mode: 'current' | 'next' = 'current'): Promise<PeriodSyncResult> => {
    try {
      if (!driver.getConvenio || !driver.listPersonal) return { created: 0, updated: 0, alerts: [], warnings: [] };
      const conv = await driver.getConvenio(code);
      if (!conv) return { created: 0, updated: 0, alerts: [], warnings: [] };
      const people = (await driver.listPersonal()).filter((p) => p.convenio === code && (!only || only.includes(p.code)));
      return await syncPeriods(driver, conv, people, mode, todayIso(), await periodStamp(driver, email));
    } catch (e: any) {
      return { created: 0, updated: 0, alerts: [], warnings: [`No se pudieron generar los periodos: ${e?.message || e}`] };
    }
  };
  const personalDetail = async (driver: Required<EvalosDriver>, code: string) => {
    const e = await driver.getPersonal(code);
    if (!e) throw new HttpError(404, `No existe el empleado ${code}`);
    const [history, periods, periodAlerts] = await Promise.all([
      driver.personalHistory(code), driver.personalPeriods(code), alertsFor(driver, [code], todayIso()).catch(() => [])
    ]);
    return { ...e, history, periods, periodAlerts: periodAlerts.map((a) => a.text) };
  };

  r.get('/api/evalos/personal', async (req) => {
    const { c, canEdit, canDelete } = await requireEvalos(req);
    const { driver, config } = await personalDriver(c.company.id);
    const [items, lookups, limits] = await Promise.all([driver.listPersonal(), driver.personalLookups(), driver.personalLimits()]);
    return json({ items, lookups, limits, canEdit, canDelete, uppercase: config.uppercase, engine: config.engine });
  });

  r.get('/api/evalos/personal/:code', async (req, p) => {
    const { c } = await requireEvalos(req);
    const { driver } = await personalDriver(c.company.id);
    return json(await personalDetail(driver, p.code));
  });

  r.post('/api/evalos/personal', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver, config } = await personalDriver(c.company.id);
    const [lookups, limits] = await Promise.all([driver.personalLookups(), driver.personalLimits()]);
    const b = await body(req);
    const emp = sanitizePersonal(b, { uppercase: config.uppercase, limits, lookups });
    const newNames = sanitizeNewNames(b.newNames, emp, { uppercase: config.uppercase, lookups });
    await driver.createPersonal(emp, await stampFor(driver, c.user.email), newNames);
    await log(c, req, 'evalos.personal_created', emp.code, `${emp.name} · tarjeta ${emp.card}`);
    // Con convenio: se le crean sus periodos de vacaciones y límites.
    const periodSync = emp.convenio ? await convenioPeriods(driver, emp.convenio, c.user.email, [emp.code]) : null;
    // Con rol o equipo que valida: se le asigna su perfil de Workflow (y se recalculan los autorizadores).
    const workflowSync = emp.workflowRol || emp.valEquipo ? await syncWorkflowSafe(driver, c.company.id) : null;
    if (workflowSync && (workflowSync.created.length || workflowSync.removed.length || workflowSync.assigned)) await log(c, req, 'evalos.workflow_recalculado', emp.code, syncDetail(workflowSync));
    return json({ ...(await driver.getPersonal(emp.code)), periodSync, workflowSync: syncSummary(workflowSync) }, 201);
  });

  r.put('/api/evalos/personal/:code', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver, config } = await personalDriver(c.company.id);
    const before = await driver.getPersonal(p.code);
    if (!before) throw new HttpError(404, `No existe el empleado ${p.code}`);
    const [lookups, limits] = await Promise.all([driver.personalLookups(), driver.personalLimits()]);
    const raw = await body(req);
    // Equipo, equipo que valida y rol: si no vienen en el cuerpo se conservan (otros formularios no los envían).
    for (const k of ['equipo', 'valEquipo', 'workflowRol'] as const) if (raw[k] === undefined) raw[k] = before[k];
    // Con rol de Workflow, el perfil de solicitudes (EM_WFOP) lo calcula Perfiles Workflow: no se cambia a mano.
    if (raw.workflowRol && before.workflowRol) raw.solicitudes = before.solicitudes;
    // El código no se puede modificar: se ignora el que venga en el cuerpo.
    const { code: _ignored, ...emp } = sanitizePersonal(raw, { uppercase: config.uppercase, limits, lookups, code: p.code });
    // Con fecha de baja se cierran también sus tramos (HIS_*): hace falta saber quién y cuándo.
    const stamp = emp.endDate ? await stampFor(driver, c.user.email) : { ...madridNow(), user: '' };
    await driver.updatePersonal(p.code, emp, stamp);
    await log(c, req, 'evalos.personal_updated', p.code, emp.endDate ? `${emp.name} · baja ${emp.endDate} (tramos cerrados)` : emp.name);
    // Cambio de convenio: se crean o actualizan sus periodos con el convenio nuevo (y avisa si tiene más disfrutado).
    const periodSync = emp.convenio && emp.convenio !== before.convenio ? await convenioPeriods(driver, emp.convenio, c.user.email, [p.code]) : null;
    // Cambio de equipo, de equipo que valida, de rol o de baja (deja de validar): se recalculan los perfiles de Workflow.
    const wfChanged = emp.equipo !== before.equipo || emp.valEquipo !== before.valEquipo || emp.workflowRol !== before.workflowRol
      || (emp.endDate !== before.endDate && !!(before.valEquipo || before.workflowRol));
    const workflowSync = wfChanged ? await syncWorkflowSafe(driver, c.company.id) : null;
    if (workflowSync && (workflowSync.created.length || workflowSync.removed.length || workflowSync.assigned || workflowSync.updated.length)) await log(c, req, 'evalos.workflow_recalculado', p.code, syncDetail(workflowSync));
    return json({ ...(await driver.getPersonal(p.code)), periodSync, workflowSync: syncSummary(workflowSync) });
  });

  // Históricos del empleado (HIS_TARJETA, HIS_EMPRESA, HIS_DEPMENTO, HIS_SECCION, HIS_AREA): abrir y cerrar tramos.
  // :kind = card | company | department | section | area
  const historyKind = (k: string) => {
    if (!isHistoryKind(k)) throw new HttpError(404, 'Histórico no válido');
    return k;
  };

  r.post('/api/evalos/personal/:code/historial/:kind', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const kind = historyKind(p.kind);
    const { driver, config } = await personalDriver(c.company.id);
    const b = await body(req);
    const from = cleanIsoDate(b.from, 'La fecha de alta');
    const value = kind === 'card'
      ? { code: cleanCard(b.code, (await driver.personalLimits()).card ?? null) }
      : sanitizeOrgValue(b, kind, { uppercase: config.uppercase, lookups: await driver.personalLookups() });
    await driver.assignHistory(kind, p.code, value, from, await stampFor(driver, c.user.email));
    await log(c, req, `evalos.historial_${kind}_alta`, p.code, `${'code' in value ? value.code : `nuevo «${value.name}»`} desde ${from}`);
    return json(await personalDetail(driver, p.code), 201);
  });

  r.post('/api/evalos/personal/:code/historial/:kind/cerrar', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const kind = historyKind(p.kind);
    const { driver } = await personalDriver(c.company.id);
    const b = await body(req);
    const value = str(b.value, 100);
    if (!value) throw new HttpError(400, `Indica ${HISTORY[kind].label}`);
    const from = cleanIsoDate(b.from, 'La fecha de alta del tramo');
    const to = cleanIsoDate(b.to, 'La fecha de baja');
    if (to < from) throw new HttpError(400, 'La fecha de baja no puede ser anterior a la de alta del tramo');
    await driver.closeHistory(kind, p.code, value, from, to, await stampFor(driver, c.user.email));
    await log(c, req, `evalos.historial_${kind}_baja`, p.code, `${value} hasta ${to}`);
    return json(await personalDetail(driver, p.code));
  });

  // Volver a dar de alta a un empleado de baja: nuevo periodo (HIS_VIGENCIA) y asignaciones desde la nueva fecha.
  r.post('/api/evalos/personal/:code/readmitir', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver, config } = await personalDriver(c.company.id);
    const [lookups, limits] = await Promise.all([driver.personalLookups(), driver.personalLimits()]);
    const { r: input, newNames } = sanitizeReadmit(await body(req), { uppercase: config.uppercase, limits, lookups });
    await driver.readmitPersonal(p.code, input, await stampFor(driver, c.user.email), newNames);
    await log(c, req, 'evalos.personal_readmitido', p.code, `alta ${input.hireDate} · tarjeta ${input.card}`);
    const again = await driver.getPersonal(p.code);
    if (again?.valEquipo) await syncWorkflowSafe(driver, c.company.id);
    return json(await personalDetail(driver, p.code));
  });

  r.del('/api/evalos/personal/:code', async (req, p) => {
    const { c, canDelete } = await requireEvalos(req);
    if (!canDelete) throw new HttpError(403, 'Solo un administrador de Atajos de Evalos puede eliminar empleados');
    const { driver } = await personalDriver(c.company.id);
    const gone = await driver.getPersonal(p.code);
    await driver.deletePersonal(p.code);
    await log(c, req, 'evalos.personal_deleted', p.code);
    // Si tenía rol o validaba un equipo: su perfil puede quedarse sin nadie y cambian los autorizadores.
    if (gone && (gone.workflowRol || gone.valEquipo)) await syncWorkflowSafe(driver, c.company.id);
    return json({ ok: true });
  });

  // Las pantallas Calendarios y Correcciones hoy funcionan sobre el motor de demostración.
  const demoOnly = () => new HttpError(501, 'Esta pantalla está disponible en modo demostración. El mapeo a la base de datos real de Evalos 8 se configurará en una versión posterior.', 'demo_only');
  const isoDate = (v: unknown) => { const s = str(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, 'Fecha no válida (AAAA-MM-DD)'); return s; };

  // --- Calendarios ---
  r.get('/api/evalos/calendarios', async (req) => {
    const { c, canEdit, canDelete } = await requireEvalos(req);
    const { driver, config } = await driverFor(c.company.id);
    if (!driver.listCalendars) throw demoOnly();
    return json({ calendars: await driver.listCalendars(), canEdit, canDelete, engine: config.engine });
  });
  r.get('/api/evalos/calendarios/:code', async (req, p) => {
    const { c } = await requireEvalos(req);
    const { driver } = await driverFor(c.company.id);
    if (!driver.getCalendar) throw demoOnly();
    const cal = await driver.getCalendar(p.code);
    if (!cal) throw new HttpError(404, `No existe el calendario ${p.code}`);
    return json(cal);
  });
  r.post('/api/evalos/calendarios', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver, config } = await driverFor(c.company.id);
    if (!driver.createCalendar || !driver.getCalendar) throw demoOnly();
    const b = await body(req);
    const code = cleanCode(b.code, config.uppercase, 20);
    const name = cleanDesc(b.name, false, 60);
    const year = Math.min(2100, Math.max(2000, Number(b.year) || new Date().getFullYear()));
    await driver.createCalendar({ code, name, year });
    await log(c, req, 'evalos.calendario_created', code, name);
    return json(await driver.getCalendar(code), 201);
  });
  r.put('/api/evalos/calendarios/:code', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver } = await driverFor(c.company.id);
    if (!driver.updateCalendar || !driver.getCalendar) throw demoOnly();
    const b = await body(req);
    await driver.updateCalendar(p.code, { name: b.name !== undefined ? cleanDesc(b.name, false, 60) : undefined });
    await log(c, req, 'evalos.calendario_updated', p.code);
    return json(await driver.getCalendar(p.code));
  });
  r.del('/api/evalos/calendarios/:code', async (req, p) => {
    const { c, canDelete } = await requireEvalos(req);
    if (!canDelete) throw new HttpError(403, 'Solo un administrador puede eliminar calendarios');
    const { driver } = await driverFor(c.company.id);
    if (!driver.deleteCalendar) throw demoOnly();
    await driver.deleteCalendar(p.code);
    await log(c, req, 'evalos.calendario_deleted', p.code);
    return json({ ok: true });
  });
  r.post('/api/evalos/calendarios/:code/festivos', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol es de solo lectura');
    const { driver } = await driverFor(c.company.id);
    if (!driver.addHoliday || !driver.getCalendar) throw demoOnly();
    const b = await body(req);
    const type = ['NACIONAL', 'AUTONOMICO', 'LOCAL', 'EMPRESA'].includes(b.type) ? b.type : 'EMPRESA';
    await driver.addHoliday(p.code, { date: isoDate(b.date), type, description: cleanDesc(b.description, false, 60) });
    await log(c, req, 'evalos.festivo_added', p.code, String(b.date));
    return json(await driver.getCalendar(p.code), 201);
  });
  r.del('/api/evalos/calendarios/:code/festivos/:date', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol es de solo lectura');
    const { driver } = await driverFor(c.company.id);
    if (!driver.deleteHoliday || !driver.getCalendar) throw demoOnly();
    await driver.deleteHoliday(p.code, p.date);
    return json(await driver.getCalendar(p.code));
  });

  // --- Convenios ---
  // Tablas PS_CONVENIOS, PS_CONVENIOS_VACACIONES, PS_CONVENIOS_LIMITES y PS_CONVENIOS_PLUSES en la BD de Evalos 8
  // (o datos de demostración).
  // Si faltan las tablas, la pantalla muestra el script para crearlas en vez de un error.
  const convenioIncidences = async (driver: EvalosDriver) =>
    (driver.listIncidences ? await driver.listIncidences() : []).filter((x) => x.code !== NORMAL_INCIDENCE.code);
  r.get('/api/evalos/convenios', async (req) => {
    const { c, canEdit, canDelete } = await requireEvalos(req);
    const { driver, config } = await driverFor(c.company.id);
    if (!driver.listConvenios) throw demoOnly();
    let convenios: Convenio[], missing = '';
    try { convenios = await driver.listConvenios(); }
    catch (e: any) {
      if (e instanceof HttpError && e.code === 'convenios_missing') { convenios = []; missing = e.message; }
      else throw e;
    }
    let incidences: { code: string; name: string; type?: string }[] = [], incidencesError = '';
    try { incidences = await convenioIncidences(driver); } catch (e: any) { incidencesError = e?.message || String(e); }
    let vacationTypes: VacationTypesInfo = { items: [], codeMax: 3, nameMax: 40, numericCode: false, hasColor: false }, vacationTypesError = '';
    try { if (driver.listVacationTypes) vacationTypes = await driver.listVacationTypes(); } catch (e: any) { vacationTypesError = e?.message || String(e); }
    const linkable = driver.conveniosLinkable ? await driver.conveniosLinkable().catch(() => false) : false;
    return json({
      convenios, incidences, incidencesError, vacationTypes, vacationTypesError, linkable, canEdit, canDelete, engine: config.engine,
      missing: missing ? { message: missing, script: driver.conveniosScript ? driver.conveniosScript() : conveniosSql() } : null
    }, 200, { 'cache-control': 'no-store' });
  });
  // Personal para la ventana del convenio: todos los empleados con su convenio actual (EM_CONV).
  r.get('/api/evalos/convenios/personal', async (req) => {
    const { c } = await requireEvalos(req);
    const { driver } = await driverFor(c.company.id);
    if (!driver.listPersonal) throw demoOnly();
    const [all, lookups] = await Promise.all([driver.listPersonal(), driver.personalLookups ? driver.personalLookups().catch(() => null) : null]);
    const items = all.map((p) => ({ code: p.code, name: p.name, company: p.company, department: p.department, section: p.section, area: p.area, convenio: p.convenio, active: p.active }));
    // Nombres de empresa, departamento, sección y área (para mostrarlos y para incluir personal en bloque).
    const org = { company: lookups?.company || [], department: lookups?.department || [], section: lookups?.section || [], area: lookups?.area || [] };
    return json({ items, org }, 200, { 'cache-control': 'no-store' });
  });
  /**
   * Deja en el convenio exactamente a los empleados indicados (EM_CONV): asigna a los nuevos (si estaban en otro
   * convenio, se cambian a este) y quita a los que ya no están. Devuelve cuántos se han añadido y quitado.
   */
  const syncConvenioEmployees = async (driver: EvalosDriver, code: string, wanted: unknown) => {
    if (!Array.isArray(wanted)) return null;
    if (!driver.setEmployeesConvenio || !driver.listPersonal) throw demoOnly();
    const all = await driver.listPersonal();
    const exists = new Set(all.map((p) => p.code));
    const want = new Set<string>();
    for (const w of wanted) {
      const e = str(w, 50);
      if (!e) continue;
      if (!exists.has(e)) throw new HttpError(400, `No existe el empleado ${e}`);
      want.add(e);
    }
    const current = all.filter((p) => p.convenio === code).map((p) => p.code);
    const add = [...want].filter((e) => !current.includes(e));
    const remove = current.filter((e) => !want.has(e));
    if (add.length) await driver.setEmployeesConvenio(add, code);
    if (remove.length) await driver.setEmployeesConvenio(remove, '');
    return { added: add.length, removed: remove.length };
  };
  const saveConvenioRoute = async (req: Request, code: string | null) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver, config } = await driverFor(c.company.id);
    if (!driver.saveConvenio || !driver.getConvenio) throw demoOnly();
    const b = await body(req);
    const known = await convenioIncidences(driver).catch(() => null);
    const types = driver.listVacationTypes ? await driver.listVacationTypes().catch(() => null) : null;
    const conv = sanitizeConvenio(code ? { ...b, code } : b, {
      uppercase: config.uppercase,
      incidences: known ? new Set(known.map((x) => x.code)) : undefined,
      vacationTypes: types ? new Set(types.items.map((x) => x.code)) : undefined
    });
    // Última modificación como en Evalos: fecha, hora e iniciales del usuario (USUARIOS).
    const user = driver.userInitials ? await driver.userInitials(c.user.email).catch(() => '') : '';
    await driver.saveConvenio(conv, !code, { ...madridNow(), user });
    const people = await syncConvenioEmployees(driver, conv.code, b.employees);
    // Periodos en curso de todas sus personas (los nuevos se crean; los de quien ya estaba se recalculan).
    const periodSync = await convenioPeriods(driver, conv.code, c.user.email);
    await log(c, req, code ? 'evalos.convenio_updated' : 'evalos.convenio_created', conv.code,
      `${conv.name} · vacaciones: ${conv.vacations.map((v) => `${v.type} ${v.days} d desde ${v.day}/${v.month}`).join(', ') || 'ninguna'} · ${conv.limits.length} límite(s) desde ${conv.incidenceDay}/${conv.incidenceMonth}` +
      (people && (people.added || people.removed) ? ` · personal: +${people.added} −${people.removed}` : '') +
      ` · periodos: ${periodSync.created} nuevos, ${periodSync.updated} actualizados`);
    return json({ ...(await driver.getConvenio(conv.code)), periodSync }, code ? 200 : 201);
  };
  r.post('/api/evalos/convenios', (req) => saveConvenioRoute(req, null));
  r.put('/api/evalos/convenios/:code', (req, p) => saveConvenioRoute(req, p.code));
  // Alta de un tipo de vacaciones en TIPOSVACACIONES desde la ventana del convenio.
  // Devuelve la fila tal como ha quedado («Ver respuesta») y las columnas obligatorias que se han rellenado.
  r.post('/api/evalos/tiposvacaciones', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver, config } = await driverFor(c.company.id);
    if (!driver.createVacationType) throw demoOnly();
    const b = await body(req);
    let code = str(b.code, 20);
    if (config.uppercase) code = code.toUpperCase();
    if (!code) throw new HttpError(400, 'Indica el código del tipo de vacaciones');
    if (code.length > VACATION_TYPE_MAX || !/^[A-Za-z0-9_.-]+$/.test(code)) throw new HttpError(400, `El código admite letras y números, como máximo ${VACATION_TYPE_MAX}`);
    const name = cleanDesc(b.name, config.uppercase, 100);
    if (!name) throw new HttpError(400, 'Indica la descripción del tipo de vacaciones');
    const color = /^#[0-9a-f]{6}$/i.test(String(b.color || '')) ? String(b.color) : undefined;
    const res = await driver.createVacationType({ code, name, color });
    await log(c, req, 'evalos.tipovacaciones_created', code, `${name}${res.filled.length ? ` · rellenadas: ${res.filled.join(', ')}` : ''}`);
    return json(res, 201);
  });
  // «Generar periodos del año siguiente» para todas las personas en alta del convenio.
  r.post('/api/evalos/convenios/:code/siguiente', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver } = await driverFor(c.company.id);
    if (!driver.getConvenio || !(await driver.getConvenio(p.code))) throw new HttpError(404, `No existe el convenio ${p.code}`);
    const res = await convenioPeriods(driver, p.code, c.user.email, undefined, 'next');
    await log(c, req, 'evalos.convenio_periodos_siguientes', p.code, `${res.created} nuevos, ${res.updated} actualizados`);
    return json(res);
  });
  // Avisos vigentes de las personas del convenio (más días u horas disfrutados que disponibles).
  r.get('/api/evalos/convenios/:code/avisos', async (req, p) => {
    const { c } = await requireEvalos(req);
    const { driver } = await driverFor(c.company.id);
    if (!driver.listPersonal) throw demoOnly();
    const codes = (await driver.listPersonal()).filter((x) => x.convenio === p.code).map((x) => x.code);
    let alerts: { employee: string; text: string }[] = [], error = '';
    try { alerts = await alertsFor(driver, codes, todayIso()); } catch (e: any) { error = e?.message || String(e); }
    return json({ alerts, error }, 200, { 'cache-control': 'no-store' });
  });
  r.del('/api/evalos/convenios/:code', async (req, p) => {
    const { c, canDelete } = await requireEvalos(req);
    if (!canDelete) throw new HttpError(403, 'Solo un administrador puede eliminar convenios');
    const { driver } = await driverFor(c.company.id);
    if (!driver.deleteConvenio) throw demoOnly();
    await driver.deleteConvenio(p.code);
    await log(c, req, 'evalos.convenio_deleted', p.code);
    return json({ ok: true });
  });

  // --- Perfiles Workflow ---
  // Equipos (PS_EQUIPOS), rol y equipo de cada persona (EM_EQUIPO, EM_VALEQUIPO, EM_WORKFLOWROL) y perfiles de WORKFLOW
  // calculados a partir de ellos (registrados en PS_WFPERFILES). Si faltan las tablas, la pantalla muestra el script.
  const workflowDriver = async (companyId: string) => {
    const { driver, config } = await driverFor(companyId);
    if (!workflowCapable(driver)) throw demoOnly();
    return { driver, config };
  };
  /** Vista completa de la pantalla: equipos, personas, perfiles, ajustes y los cambios pendientes de aplicar. */
  r.get('/api/evalos/workflow', async (req) => {
    const { c, canEdit, canDelete, canConfigure } = await requireEvalos(req);
    const { driver, config } = await workflowDriver(c.company.id);
    const settings = await getWfSettings(c.company.id);
    const base = { canEdit, canDelete, canConfigure: canConfigure || canDelete, engine: config.engine, settings, roles: WF_ROLES, requests: WF_REQUESTS, levelCols: WF_LEVEL_COLS };
    let equipos, rows, dyn, cols;
    try {
      [equipos, rows, dyn, cols] = await Promise.all([driver.listEquipos!(), driver.listWorkflowRows!(), driver.listDynProfiles!(), driver.workflowColumns!()]);
    } catch (e: any) {
      if (e instanceof HttpError && e.code === 'workflow_missing') {
        return json({ ...base, missing: { message: e.message, script: driver.workflowScript ? driver.workflowScript() : workflowSql() } }, 200, { 'cache-control': 'no-store' });
      }
      throw e;
    }
    const [people, lookups] = await Promise.all([driver.listPersonal!(), driver.personalLookups ? driver.personalLookups().catch(() => null) : null]);
    const missingColumns = (Object.entries(cols.personal) as [string, number | null | undefined][]).filter(([, v]) => v === undefined)
      .map(([k]) => ({ equipo: 'EM_EQUIPO', valEquipo: 'EM_VALEQUIPO', workflowRol: 'EM_WORKFLOWROL' } as Record<string, string>)[k]);
    const preview = planWorkflow({ people: people.map(toWfPerson), equipos, rows, dyn, settings, descMax: cols.workflow.WF_DESC });
    const dynBy = new Map(dyn.map((d) => [d.code, d]));
    const count = new Map<string, number>();
    for (const p of people) if (p.solicitudes) count.set(p.solicitudes, (count.get(p.solicitudes) || 0) + 1);
    const templates = new Set(Object.values(settings.templates));
    const profiles = rows.map((r) => {
      const code = String(r.WF_CODI ?? '').trim();
      const levels = Object.fromEntries(WF_LEVEL_COLS.map((k) => [k, levelCodes(r[k])]));
      const orders = Object.fromEntries(WF_REQUESTS.map((x) => [x.col, String(r[x.col] ?? '').trim()]));
      return {
        code, name: String(r.WF_DESC ?? '').trim(), dyn: dynBy.get(code) || null, template: templates.has(code),
        levels, orders, filter: String(r.WF_FILT ?? '').trim(), people: count.get(code) || 0, alerts: dynBy.has(code) ? profileAlerts(r) : []
      };
    });
    return json({
      ...base, missing: null, missingColumns, equipos, profiles,
      people: people.map((p) => ({ code: p.code, name: p.name, active: p.active, email: p.email, company: p.company, department: p.department, section: p.section, area: p.area, equipo: p.equipo, valEquipo: p.valEquipo, workflowRol: p.workflowRol, profile: p.solicitudes })),
      org: { company: lookups?.company || [], department: lookups?.department || [], section: lookups?.section || [], area: lookups?.area || [] },
      limits: cols.personal,
      pending: { created: preview.created, updated: preview.updated, removed: preview.removed, assigned: preview.assigned, warnings: preview.warnings }
    }, 200, { 'cache-control': 'no-store' });
  });

  const saveEquipoRoute = async (req: Request, code: string | null) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver, config } = await workflowDriver(c.company.id);
    const b = await body(req);
    const cols = await driver.workflowColumns!();
    const e = { code: code ?? cleanEquipoCode(b.code, Math.min(...[cols.personal.equipo, cols.personal.valEquipo].filter((x): x is number => typeof x === 'number'), 20)), name: cleanEquipoName(b.name, config.uppercase) };
    await driver.saveEquipo!(e, !code);
    await log(c, req, code ? 'evalos.equipo_updated' : 'evalos.equipo_created', e.code, e.name);
    // Cambia el nombre: cambia la descripción de sus perfiles.
    const workflowSync = code ? await syncWorkflow(driver, c.company.id) : null;
    return json({ equipo: e, workflowSync: syncSummary(workflowSync) }, code ? 200 : 201);
  };
  r.post('/api/evalos/workflow/equipos', (req) => saveEquipoRoute(req, null));
  r.put('/api/evalos/workflow/equipos/:code', (req, p) => saveEquipoRoute(req, p.code));
  r.del('/api/evalos/workflow/equipos/:code', async (req, p) => {
    const { c, canDelete } = await requireEvalos(req);
    if (!canDelete) throw new HttpError(403, 'Solo un administrador de Atajos de Evalos puede eliminar equipos');
    const { driver } = await workflowDriver(c.company.id);
    await driver.deleteEquipo!(p.code);
    await log(c, req, 'evalos.equipo_deleted', p.code);
    return json({ ok: true });
  });

  /** Asignación en bloque: equipo, equipo que valida y/o rol de varias personas; después se recalculan los perfiles. */
  r.put('/api/evalos/workflow/personas', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver } = await workflowDriver(c.company.id);
    const b = await body(req);
    const [people, equipos] = await Promise.all([driver.listPersonal!(), driver.listEquipos!()]);
    const exists = new Set(people.map((p) => p.code));
    const employees = Array.isArray(b.employees) ? [...new Set<string>(b.employees.map((x: unknown) => str(x, 20)).filter(Boolean))] : [];
    if (!employees.length) throw new HttpError(400, 'Elige al menos una persona');
    for (const e of employees) if (!exists.has(e)) throw new HttpError(400, `No existe el empleado ${e}`);
    const teams = new Set(equipos.map((e) => e.code));
    const patch: { equipo?: string; valEquipo?: string; workflowRol?: string } = {};
    for (const k of ['equipo', 'valEquipo'] as const) {
      if (b[k] === undefined || b[k] === null) continue;
      const v = str(b[k], 40).toUpperCase();
      if (v && !teams.has(v)) throw new HttpError(400, `No existe el equipo ${v}`);
      patch[k] = v;
    }
    if (b.workflowRol !== undefined && b.workflowRol !== null) {
      const v = str(b.workflowRol, 30).toUpperCase();
      if (v && !isWfRole(v)) throw new HttpError(400, `El rol tiene que ser ${WF_ROLES.join(', ')} o ninguno`);
      patch.workflowRol = v;
    }
    if (!Object.keys(patch).length) throw new HttpError(400, 'Indica qué quieres cambiar: equipo, equipo que valida o rol');
    const changed = await driver.setEmployeesWorkflow!(employees, patch);
    const res = await syncWorkflow(driver, c.company.id);
    await log(c, req, 'evalos.workflow_personas', `${changed} persona(s)`,
      `${Object.entries(patch).map(([k, v]) => `${k} = ${v || '(ninguno)'}`).join(', ')} · ${syncDetail(res)}`);
    return json({ changed, workflowSync: syncSummary(res) });
  });

  /** Niveles 2 a 4 y orden de validación de cada solicitud de un perfil creado por Prime Suite. */
  r.put('/api/evalos/workflow/perfiles/:code', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver } = await workflowDriver(c.company.id);
    const [dyn, people] = await Promise.all([driver.listDynProfiles!(), driver.listPersonal!()]);
    if (!dyn.some((d) => d.code === p.code)) throw new HttpError(409, `El perfil ${p.code} no lo ha creado Prime Suite: se edita en Evalos (Seguridad y perfiles › Workflow).`);
    const set = sanitizeProfileEdit(await body(req), new Set(people.map((x) => x.code)));
    if (!Object.keys(set).length) throw new HttpError(400, 'No hay cambios');
    await driver.applyWorkflowPlan!({ insert: [], update: [{ code: p.code, set }], remove: [], assign: [] });
    await log(c, req, 'evalos.workflow_perfil_updated', p.code, Object.entries(set).map(([k, v]) => `${k}=${v || '(vacío)'}`).join(', '));
    const row = (await driver.listWorkflowRows!()).find((r) => String(r.WF_CODI).trim() === p.code);
    return json({ ok: true, alerts: row ? profileAlerts(row) : [] });
  });

  /** Aplica los cambios pendientes (perfiles nuevos, autorizadores, borrados y asignaciones). */
  r.post('/api/evalos/workflow/recalcular', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver } = await workflowDriver(c.company.id);
    const res = await syncWorkflow(driver, c.company.id);
    await log(c, req, 'evalos.workflow_recalculado', undefined, syncDetail(res));
    return json({ workflowSync: syncSummary(res) });
  });

  /** Plantilla de cada rol y prefijo de los códigos (administradores). */
  r.put('/api/evalos/workflow/ajustes', async (req) => {
    const { c, canDelete, canConfigure } = await requireEvalos(req);
    if (!canDelete && !canConfigure) throw new HttpError(403, 'Solo un administrador puede cambiar los ajustes de Perfiles Workflow');
    const { driver } = await workflowDriver(c.company.id);
    const s = sanitizeWfSettings(await body(req));
    const rows = await driver.listWorkflowRows!();
    const codes = new Set(rows.map((r) => String(r.WF_CODI).trim()));
    const missing = Object.entries(s.templates).filter(([, t]) => !codes.has(t)).map(([r, t]) => `${t} (${r})`);
    if (missing.length) throw new HttpError(400, `No existen en WORKFLOW: ${missing.join(', ')}`);
    const dyn = await driver.listDynProfiles!();
    if (Object.values(s.templates).some((t) => dyn.some((d) => d.code === t))) throw new HttpError(400, 'Una plantilla no puede ser un perfil creado por Prime Suite');
    await rawSet(wfSettingsKey(c.company.id), s);
    await log(c, req, 'evalos.workflow_ajustes', undefined, `plantillas ${Object.entries(s.templates).map(([r, t]) => `${r}=${t}`).join(', ')} · prefijo ${s.prefix}`);
    return json(s);
  });

  // --- Correcciones ---
  // Con conexión real (motor SQL Server), Marcajes trabaja con la API REST de Evalos 8 (EvalosRest):
  // anomalías del listado PS_ANOMA (Report/filter), marcajes de Booking/attendance y alta de marcajes manuales (POST).
  const restNames = async (companyId: string) => {
    try {
      const { driver } = await driverFor(companyId);
      const list = driver.listPersonal ? await driver.listPersonal() : [];
      return list.map((p) => ({ code: p.code, name: p.name, active: p.active }));
    } catch { return []; }
  };
  r.get('/api/evalos/correcciones/marcajes', async (req) => {
    const { c } = await requireEvalos(req);
    const u = new URL(req.url);
    const { from, to } = cleanRange(u.searchParams.get('from'), u.searchParams.get('to'));
    const employee = cleanEmployeeCode(u.searchParams.get('employee') || '');
    const employees = await restNames(c.company.id);
    // Descripción y color de turnos, vacaciones e incidencias (GESTURNO, TIPOSVACACIONES, INCIDENC).
    let labels = null, labelsError = '';
    try { const { driver } = await driverFor(c.company.id); labels = driver.dayLabels ? await driver.dayLabels() : null; }
    catch (e: any) { labelsError = e?.message || String(e); }
    const res = await loadMarcajes({ from, to, employee: employee || undefined, names: new Map(employees.map((e) => [e.code, e.name])), employees: employees.filter((e) => e.active).map((e) => e.code), known: employees.map((e) => e.code), labels, portalOrigin: c.issuer });
    if (labelsError) res.warnings.push(`No se pudieron leer las descripciones y colores de turnos, vacaciones e incidencias: ${labelsError}`);
    await log(c, req, 'evalos.rest_marcajes', employee || undefined, `${from} – ${to} · ${res.marcajes.length} días · ${res.ms} ms`);
    return json({ ...res, from, to }, 200, { 'cache-control': 'no-store' });
  });
  r.get('/api/evalos/correcciones/incidencias', async (req) => {
    const { c } = await requireEvalos(req);
    // Lista de la tabla INCIDENC (BD de Evalos); la 000 «Entrada / Salida» no está en la tabla y va siempre la primera.
    // ?tipo=A → solo absentismos (para asignar ausencias), sin la 000.
    const { driver } = await driverFor(c.company.id);
    const tipo = (new URL(req.url).searchParams.get('tipo') || '').trim().toUpperCase();
    if (tipo && !/^[A-Z]$/.test(tipo)) throw new HttpError(400, 'Tipo de incidencia no válido');
    const list = driver.listIncidences ? await driver.listIncidences(tipo || undefined) : [];
    const items = tipo ? list : [{ code: NORMAL_INCIDENCE.code, name: NORMAL_INCIDENCE.name }, ...list.filter((x) => x.code !== NORMAL_INCIDENCE.code)];
    return json({ items }, 200, { 'cache-control': 'no-store' });
  });
  // Ausencia del día seleccionado (absentismo de fichero, PUT /Absence con desde = hasta = ese día).
  // --- Vacaciones del día (servicios SOAP de Evalos) ---
  // Tipos de vacaciones (TIPOSVACACIONES de la BD) para el combo.
  r.get('/api/evalos/correcciones/tiposvacaciones', async (req) => {
    const { c } = await requireEvalos(req);
    const { driver } = await driverFor(c.company.id);
    const labels = driver.dayLabels ? await driver.dayLabels() : null;
    const items = (labels?.holidays || []).map(({ code, name }) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
    return json({ items }, 200, { 'cache-control': 'no-store' });
  });
  // Asignar (o cambiar) las vacaciones del día: AsignarDiaVacaciones; si ya tenía otro tipo, antes BorrarVacaciones.
  r.post('/api/evalos/correcciones/vacaciones', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const b = await body(req);
    const employee = cleanEmployeeCode(b.employee, true);
    const date = isoDate(b.date);
    const type = str(b.type, 10);
    if (b.replace) await removeHoliday(employee, date, c.issuer);
    const r2 = await assignHoliday(employee, date, type, c.issuer);
    await log(c, req, 'evalos.soap_vacaciones_asignadas', employee, `${date} · tipo ${type}`);
    return json({ ok: true, ...r2 }, 201);
  });
  r.del('/api/evalos/correcciones/vacaciones', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const b = await body(req);
    const employee = cleanEmployeeCode(b.employee, true);
    const date = isoDate(b.date);
    const r2 = await removeHoliday(employee, date, c.issuer);
    await log(c, req, 'evalos.soap_vacaciones_quitadas', employee, date);
    return json({ ok: true, ...r2 });
  });

  // Quitar la ausencia del día (DELETE /Absence/{empleado}?dateAdd=).
  r.del('/api/evalos/correcciones/ausencias', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const b = await body(req);
    const employee = cleanEmployeeCode(b.employee, true);
    const date = isoDate(b.date);
    const r2 = await deleteAbsence(employee, date, c.issuer);
    await log(c, req, 'evalos.rest_ausencia_quitada', employee, date);
    return json({ ok: true, ...r2 });
  });
  r.post('/api/evalos/correcciones/ausencias', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const b = await body(req);
    const employee = cleanEmployeeCode(b.employee, true);
    const date = isoDate(b.date);
    const incidence = str(b.incidence, 5);
    const r2 = await saveAbsence(employee, date, incidence, str(b.description, 40), c.issuer);
    await log(c, req, 'evalos.rest_ausencia_asignada', employee, `${date} · incidencia ${incidence}`);
    return json({ ok: true, ...r2 }, 201);
  });
  r.del('/api/evalos/correcciones/marcajes', async (req) => {
    const { c, canDelete } = await requireEvalos(req);
    if (!canDelete) throw new HttpError(403, 'Solo un administrador de Atajos de Evalos puede eliminar marcajes');
    const b = await body(req);
    const employee = cleanEmployeeCode(b.employee, true);
    const date = isoDate(b.date);
    const times = cleanDeleteTimes(b.times);
    const r2 = await deletePunches(employee, date, times, c.issuer);
    await log(c, req, 'evalos.rest_marcajes_eliminados', employee, `${date} · ${times.join(', ')}`);
    return json({ ok: true, ...r2 });
  });
  r.post('/api/evalos/correcciones/marcajes', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const b = await body(req);
    const employee = cleanEmployeeCode(b.employee, true);
    const date = isoDate(b.date);
    const punches = cleanPunchWrites(b.punches);
    const r2 = await savePunches(employee, date, punches, c.issuer);
    await log(c, req, 'evalos.rest_marcajes_grabados', employee, `${date} · ${punches.map((p) => `${p.original ? `${p.original}→` : '+'}${p.time} (${p.incidence})`).join(', ')}`);
    return json({ ok: true, ...r2 }, 201);
  });

  r.get('/api/evalos/correcciones', async (req) => {
    const { c, canEdit, canDelete } = await requireEvalos(req);
    const { driver, config } = await driverFor(c.company.id);
    // Con conexión real los datos salen de EvalosRest (rutas /api/evalos/correcciones/marcajes).
    if (config.engine !== 'demo') {
      return json({ mode: 'rest', employees: (await restNames(c.company.id)).filter((e) => e.active).map(({ code, name }) => ({ code, name })), canEdit, canDelete, engine: config.engine });
    }
    if (!driver.listMarcajes || !driver.listSolicitudes || !driver.listAusencias) throw demoOnly();
    const [marcajes, solicitudes, ausencias, employees] = await Promise.all([
      driver.listMarcajes(), driver.listSolicitudes(), driver.listAusencias(), driver.listEmployees ? driver.listEmployees() : Promise.resolve([])
    ]);
    return json({ marcajes, solicitudes, ausencias, employees, canEdit, canDelete, engine: config.engine });
  });
  r.put('/api/evalos/marcajes/:id', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol es de solo lectura');
    const { driver } = await driverFor(c.company.id);
    if (!driver.updateMarcaje) throw demoOnly();
    const b = await body(req);
    const punches = Array.isArray(b.punches)
      ? b.punches.map((x: any) => ({ time: /^\d{2}:\d{2}$/.test(String(x.time)) ? String(x.time) : '00:00', type: x.type === 'S' ? 'S' as const : 'E' as const })).slice(0, 20)
      : [];
    await driver.updateMarcaje(p.id, punches);
    await log(c, req, 'evalos.marcaje_updated', p.id);
    return json({ ok: true });
  });
  r.post('/api/evalos/marcajes/:id/resolver', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol es de solo lectura');
    const { driver } = await driverFor(c.company.id);
    if (!driver.resolveMarcaje) throw demoOnly();
    await driver.resolveMarcaje(p.id);
    await log(c, req, 'evalos.marcaje_resolved', p.id);
    return json({ ok: true });
  });
  r.post('/api/evalos/solicitudes/:id/decidir', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol es de solo lectura');
    const { driver } = await driverFor(c.company.id);
    if (!driver.decideSolicitud) throw demoOnly();
    const approve = !!(await body(req)).approve;
    await driver.decideSolicitud(p.id, approve);
    await log(c, req, approve ? 'evalos.solicitud_aprobada' : 'evalos.solicitud_rechazada', p.id);
    return json({ ok: true });
  });
  r.post('/api/evalos/ausencias', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol es de solo lectura');
    const { driver } = await driverFor(c.company.id);
    if (!driver.createAusencia) throw demoOnly();
    const b = await body(req);
    await driver.createAusencia({ employee: str(b.employee, 40), type: cleanDesc(b.type, false, 40), from: isoDate(b.from), to: isoDate(b.to), reason: str(b.reason, 200) || undefined });
    await log(c, req, 'evalos.ausencia_created', str(b.employee, 40));
    return json({ ok: true }, 201);
  });
  r.del('/api/evalos/ausencias/:id', async (req, p) => {
    const { c, canDelete } = await requireEvalos(req);
    if (!canDelete) throw new HttpError(403, 'Solo un administrador puede eliminar ausencias');
    const { driver } = await driverFor(c.company.id);
    if (!driver.deleteAusencia) throw demoOnly();
    await driver.deleteAusencia(p.id);
    await log(c, req, 'evalos.ausencia_deleted', p.id);
    return json({ ok: true });
  });
}
