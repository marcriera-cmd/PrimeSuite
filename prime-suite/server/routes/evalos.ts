// Atajos de Evalos: módulo nativo que trabaja directamente sobre la base de datos de Evalos 8
// (sin EvalosRest ni servicios SOAP). Cada pantalla se puede usar también como widget del Inicio.
import { Router, json, body, HttpError, clientIp } from '../http.ts';
import { Modules, Companies, Categories, audit, id, now, type Module } from '../db.ts';
import { requireUser, moduleRole, type Ctx } from '../access.ts';
import { encryptSecret } from '../crypto.ts';
import { getConfig, putConfig, driverFor, isConfigured } from '../evalos/config.ts';
import { SqlServerDriver, connectionHint, ident } from '../evalos/mssql.ts';
import { DemoDriver, resetDemo } from '../evalos/demo.ts';
import { syncCompanyEvalosUsers } from '../evalos/users.ts';
import { DEFAULT_MAPPING, type EvalosDriver, type EvalosConfig, type EvalosMapping, type EvalosEngine } from '../evalos/types.ts';
import { sanitizePersonal, sanitizeNewNames, sanitizeOrgValue, sanitizeReadmit, cleanCard, cleanIsoDate } from '../evalos/personal.ts';
import { HISTORY, isHistoryKind, madridNow } from '../evalos/history.ts';
import { personalDriverFor, stampFor } from '../evalos/employees.ts';
import { loadMarcajes, loadIncidences, insertPunches, cleanRange, cleanEmployeeCode, cleanNewPunches } from '../evalos/marcajesrest.ts';

export const EVALOS_CLIENT_ID = 'atajos-evalos';
export const EVALOS_PATH = '/evalos';

/**
 * Pantallas de Atajos de Evalos. Cada una es a la vez una página del módulo y un widget del Inicio.
 * Para añadir una pantalla: añadirla aquí, crear sus rutas /api/evalos/<clave> y registrar su componente en src/pages/evalos/screens.tsx.
 */
export const EVALOS_SCREENS = [
  { key: 'departamentos', title: 'Departamentos', description: 'Consulta, alta y modificación de departamentos y sus empleados', glyph: 'building', widgetSize: 'm' as const },
  { key: 'personal', title: 'Personal', description: 'Alta, modificación y eliminación de empleados', glyph: 'people', widgetSize: 'm' as const },
  { key: 'calendarios', title: 'Calendarios y convenios', description: 'Calendarios laborales, festivos y convenios para el cálculo de vacaciones', glyph: 'calendar', widgetSize: 'm' as const },
  { key: 'correcciones', title: 'Correcciones', description: 'Corrige marcajes, resuelve solicitudes y añade ausencias', glyph: 'wrench', widgetSize: 'm' as const }
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

async function requireEvalos(req: Request) {
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
  const personalDetail = async (driver: Required<EvalosDriver>, code: string) => {
    const e = await driver.getPersonal(code);
    if (!e) throw new HttpError(404, `No existe el empleado ${code}`);
    const [history, periods] = await Promise.all([driver.personalHistory(code), driver.personalPeriods(code)]);
    return { ...e, history, periods };
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
    return json(await driver.getPersonal(emp.code), 201);
  });

  r.put('/api/evalos/personal/:code', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver, config } = await personalDriver(c.company.id);
    if (!(await driver.getPersonal(p.code))) throw new HttpError(404, `No existe el empleado ${p.code}`);
    const [lookups, limits] = await Promise.all([driver.personalLookups(), driver.personalLimits()]);
    // El código no se puede modificar: se ignora el que venga en el cuerpo.
    const { code: _ignored, ...emp } = sanitizePersonal(await body(req), { uppercase: config.uppercase, limits, lookups, code: p.code });
    // Con fecha de baja se cierran también sus tramos (HIS_*): hace falta saber quién y cuándo.
    const stamp = emp.endDate ? await stampFor(driver, c.user.email) : { ...madridNow(), user: '' };
    await driver.updatePersonal(p.code, emp, stamp);
    await log(c, req, 'evalos.personal_updated', p.code, emp.endDate ? `${emp.name} · baja ${emp.endDate} (tramos cerrados)` : emp.name);
    return json(await driver.getPersonal(p.code));
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
    return json(await personalDetail(driver, p.code));
  });

  r.del('/api/evalos/personal/:code', async (req, p) => {
    const { c, canDelete } = await requireEvalos(req);
    if (!canDelete) throw new HttpError(403, 'Solo un administrador de Atajos de Evalos puede eliminar empleados');
    const { driver } = await personalDriver(c.company.id);
    await driver.deletePersonal(p.code);
    await log(c, req, 'evalos.personal_deleted', p.code);
    return json({ ok: true });
  });

  // Las pantallas Calendarios y Correcciones hoy funcionan sobre el motor de demostración.
  const demoOnly = () => new HttpError(501, 'Esta pantalla está disponible en modo demostración. El mapeo a la base de datos real de Evalos 8 se configurará en una versión posterior.', 'demo_only');
  const isoDate = (v: unknown) => { const s = str(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, 'Fecha no válida (AAAA-MM-DD)'); return s; };

  // --- Calendarios ---
  r.get('/api/evalos/calendarios', async (req) => {
    const { c, canEdit, canDelete } = await requireEvalos(req);
    const { driver, config } = await driverFor(c.company.id);
    if (!driver.listCalendars || !driver.listConvenios) throw demoOnly();
    const [calendars, convenios] = await Promise.all([driver.listCalendars(), driver.listConvenios()]);
    return json({ calendars, convenios, canEdit, canDelete, engine: config.engine });
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
    await driver.createCalendar({ code, name, year, convenio: str(b.convenio, 20) || undefined });
    await log(c, req, 'evalos.calendario_created', code, name);
    return json(await driver.getCalendar(code), 201);
  });
  r.put('/api/evalos/calendarios/:code', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const { driver } = await driverFor(c.company.id);
    if (!driver.updateCalendar || !driver.getCalendar) throw demoOnly();
    const b = await body(req);
    await driver.updateCalendar(p.code, { name: b.name !== undefined ? cleanDesc(b.name, false, 60) : undefined, convenio: b.convenio !== undefined ? (str(b.convenio, 20) || '') : undefined });
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
  const sanitizeConvenio = (b: any, config: { uppercase: boolean }) => ({
    code: cleanCode(b.code, config.uppercase, 20),
    name: cleanDesc(b.name, false, 60),
    vacationDays: Math.min(60, Math.max(0, Math.round(Number(b.vacationDays) || 0))),
    hoursYear: Math.min(3000, Math.max(0, Math.round(Number(b.hoursYear) || 0))),
    seniority: Array.isArray(b.seniority)
      ? b.seniority.map((t: any) => ({ years: Math.max(0, Math.round(Number(t.years) || 0)), extraDays: Math.max(0, Math.round(Number(t.extraDays) || 0)) })).filter((t: any) => t.years > 0).slice(0, 10)
      : []
  });
  r.post('/api/evalos/convenios', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol es de solo lectura');
    const { driver, config } = await driverFor(c.company.id);
    if (!driver.saveConvenio) throw demoOnly();
    const conv = sanitizeConvenio(await body(req), config);
    await driver.saveConvenio(conv, true);
    await log(c, req, 'evalos.convenio_created', conv.code, conv.name);
    return json(conv, 201);
  });
  r.put('/api/evalos/convenios/:code', async (req, p) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol es de solo lectura');
    const { driver, config } = await driverFor(c.company.id);
    if (!driver.saveConvenio) throw demoOnly();
    const conv = sanitizeConvenio({ ...(await body(req)), code: p.code }, config);
    await driver.saveConvenio(conv, false);
    await log(c, req, 'evalos.convenio_updated', conv.code);
    return json(conv);
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
  r.post('/api/evalos/vacaciones/calcular', async (req) => {
    const { c } = await requireEvalos(req);
    const { driver } = await driverFor(c.company.id);
    if (!driver.calcVacation) throw demoOnly();
    const b = await body(req);
    const year = Math.min(2100, Math.max(2000, Number(b.year) || new Date().getFullYear()));
    return json(await driver.calcVacation(str(b.convenio, 20), isoDate(b.hireDate), year));
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
    const res = await loadMarcajes({ from, to, employee: employee || undefined, names: new Map(employees.map((e) => [e.code, e.name])), portalOrigin: c.issuer });
    await log(c, req, 'evalos.rest_marcajes', employee || undefined, `${from} – ${to} · ${res.marcajes.length} días · ${res.ms} ms`);
    return json({ ...res, from, to }, 200, { 'cache-control': 'no-store' });
  });
  r.get('/api/evalos/correcciones/incidencias', async (req) => {
    const { c } = await requireEvalos(req);
    return json({ items: await loadIncidences(c.issuer) }, 200, { 'cache-control': 'no-store' });
  });
  r.post('/api/evalos/correcciones/marcajes', async (req) => {
    const { c, canEdit } = await requireEvalos(req);
    if (!canEdit) throw new HttpError(403, 'Tu rol en Atajos de Evalos es de solo lectura');
    const b = await body(req);
    const employee = cleanEmployeeCode(b.employee, true);
    const date = isoDate(b.date);
    const punches = cleanNewPunches(b.punches);
    const r2 = await insertPunches(employee, date, punches, c.issuer);
    await log(c, req, 'evalos.rest_marcajes_insertados', employee, `${date} · ${punches.map((p) => `${p.time}${p.incidence !== '00' ? ` (${p.incidence})` : ''}`).join(', ')}`);
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
