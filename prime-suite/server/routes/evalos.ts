// Atajos de Evalos: módulo nativo que trabaja directamente sobre la base de datos de Evalos 8
// (sin EvalosRest ni servicios SOAP). Cada pantalla se puede usar también como widget del Inicio.
import { Router, json, body, HttpError, clientIp } from '../http.ts';
import { Modules, Companies, Categories, audit, id, now, type Module } from '../db.ts';
import { requireUser, moduleRole, type Ctx } from '../access.ts';
import { encryptSecret } from '../crypto.ts';
import { getConfig, putConfig, driverFor, isConfigured } from '../evalos/config.ts';
import { SqlServerDriver, connectionHint, ident } from '../evalos/mssql.ts';
import { DemoDriver, resetDemo } from '../evalos/demo.ts';
import { DEFAULT_MAPPING, type EvalosConfig, type EvalosMapping, type EvalosEngine } from '../evalos/types.ts';

export const EVALOS_CLIENT_ID = 'atajos-evalos';
export const EVALOS_PATH = '/evalos';

/**
 * Pantallas de Atajos de Evalos. Cada una es a la vez una página del módulo y un widget del Inicio.
 * Para añadir una pantalla: añadirla aquí, crear sus rutas /api/evalos/<clave> y registrar su componente en src/pages/evalos/screens.tsx.
 */
export const EVALOS_SCREENS = [
  { key: 'departamentos', title: 'Departamentos', description: 'Consulta, alta y modificación de departamentos y sus empleados', glyph: 'building', widgetSize: 'm' as const }
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
    return json(publicConfig(next, co));
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
}
