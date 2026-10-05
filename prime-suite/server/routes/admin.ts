// API de administración: empresas, usuarios, grupos, categorías, integraciones, identidad y auditoría.
import { Router, json, body, HttpError, origin, clientIp } from '../http.ts';
import {
  Companies, Users, Groups, Categories, Modules, audit, listAudit, getSettings, putSettings, findUserByLogin, id, now,
  type Company, type User, type Group, type Category, type Module, type ModuleRole, type Settings, type WidgetDef
} from '../db.ts';
import { requireAdmin, requireSuper, assertCompanyScope, publicUser, moduleRole, abs, type Ctx } from '../access.ts';
import { hashPassword, randomToken, sha256, keyRing, rotateKeys } from '../crypto.ts';
import { validPassword, PASSWORD_RULE } from './auth.ts';
import { analyzeUrl, fetchManifest, normalizeWidgets } from './analyze.ts';

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ROLES: ModuleRole[] = ['admin', 'user', 'viewer'];
const log = (c: Ctx, req: Request, action: string, target?: string, detail?: string) =>
  audit({ actorId: c.user.id, actorEmail: c.user.email, companyId: c.company.id, action, target, detail, ip: clientIp(req) });

function publicModule(m: Module) {
  const { clientSecretHash, ...rest } = m;
  return { ...rest, hasSecret: !!clientSecretHash };
}

// Valida el icono: data URL de imagen (PNG/SVG/JPG/WEBP/GIF) hasta ~200 KB, URL https, vacío (lo borra) o sin cambios.
function sanitizeIcon(v: unknown, existing?: string): string | undefined {
  if (v === undefined) return existing;
  if (v === null || v === '') return undefined;
  const s = String(v);
  if (/^data:image\/(png|jpeg|jpg|webp|svg\+xml|gif);base64,/.test(s)) {
    if (s.length > 300_000) throw new HttpError(400, 'El icono es demasiado grande (máximo ~200 KB)');
    return s;
  }
  if (/^https:\/\//.test(s)) return s.slice(0, 500);
  throw new HttpError(400, 'El icono debe ser una imagen PNG, SVG, JPG o WEBP');
}

// response_type permitidos por cliente. 'code' siempre presente; el resto, del conjunto soportado.
const SUPPORTED_RESPONSE_TYPES = ['code', 'code id_token', 'code id_token token'];
function sanitizeResponseTypes(v: unknown, existing?: string[]): string[] {
  if (v === undefined) return existing && existing.length ? existing : ['code'];
  const canon = (s: string) => s.trim().split(/\s+/).filter(Boolean).sort().join(' ');
  const set = new Set(['code']);
  if (Array.isArray(v)) for (const x of v) { const c = canon(String(x)); if (SUPPORTED_RESPONSE_TYPES.includes(c)) set.add(c); }
  return SUPPORTED_RESPONSE_TYPES.filter((t) => set.has(t));
}

// Claves válidas de la galería de iconos integrados (deben coincidir con APP_GLYPHS del front).
const APP_GLYPH_KEYS = new Set(['bars', 'people', 'clock', 'doc', 'lock', 'shield', 'spark', 'pie', 'gear', 'calendar', 'mail', 'building', 'key', 'camera', 'car', 'cloud', 'database', 'bell', 'chat', 'map', 'wrench', 'badge', 'fingerprint', 'chart', 'globe']);
function sanitizeGlyph(v: unknown, existing?: string): string | undefined {
  if (v === undefined) return existing;
  if (v === null || v === '') return undefined;
  const s = String(v);
  return APP_GLYPH_KEYS.has(s) ? s : existing;
}

function sanitizeModule(b: any, existing?: Module): Omit<Module, 'id' | 'createdAt' | 'updatedAt' | 'clientSecretHash'> {
  const name = str(b.name, 80) || existing?.name;
  if (!name) throw new HttpError(400, 'El nombre es obligatorio');
  const url = str(b.url, 500) || existing?.url;
  if (!url) throw new HttpError(400, 'La URL es obligatoria');
  if (!/^(https?:\/\/|\/)/.test(url)) throw new HttpError(400, 'La URL debe empezar por https:// (o / para rutas del propio portal)');
  const clientId = (str(b.clientId, 60) || existing?.clientId || name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const pick = <T extends string>(v: unknown, opts: T[], def: T) => (opts.includes(v as T) ? (v as T) : def);
  const list = (v: unknown, def: string[] = []) => (Array.isArray(v) ? v.map((x) => str(x, 500)).filter(Boolean).slice(0, 20) : def);
  return {
    clientId,
    name,
    description: b.description !== undefined ? str(b.description, 300) : existing?.description || '',
    categoryId: b.categoryId !== undefined ? b.categoryId || null : existing?.categoryId ?? null,
    initials: (str(b.initials, 3) || existing?.initials || name.split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2)).toUpperCase(),
    color: /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : existing?.color || '#243A4D',
    iconUrl: sanitizeIcon(b.iconUrl, existing?.iconUrl),
    iconGlyph: sanitizeGlyph(b.iconGlyph, existing?.iconGlyph),
    url,
    openMode: existing?.openMode === 'native' ? 'native' : pick(b.openMode, ['iframe', 'tab', 'fullscreen'], existing?.openMode || 'iframe'),
    authMethod: pick(b.authMethod, ['oidc', 'prime_token', 'none'], existing?.authMethod || 'none'),
    tokenDelivery: pick(b.tokenDelivery, ['fragment', 'query', 'form_post'], existing?.tokenDelivery || 'fragment'),
    tokenParam: str(b.tokenParam, 40).replace(/[^a-zA-Z0-9_-]/g, '') || existing?.tokenParam || 'prime_token',
    tokenTtlSec: Math.min(3600, Math.max(10, Number(b.tokenTtlSec ?? existing?.tokenTtlSec ?? 60) || 60)),
    redirectUris: list(b.redirectUris, existing?.redirectUris),
    postLogoutRedirectUris: list(b.postLogoutRedirectUris, existing?.postLogoutRedirectUris),
    initiateLoginUri: b.initiateLoginUri !== undefined ? str(b.initiateLoginUri, 500) || undefined : existing?.initiateLoginUri,
    responseTypes: sanitizeResponseTypes(b.responseTypes, existing?.responseTypes),
    alwaysEmail: b.alwaysEmail !== undefined ? !!b.alwaysEmail : existing?.alwaysEmail,
    defaultRole: b.defaultRole === null || b.defaultRole === '' ? null : pick(b.defaultRole, ROLES, existing?.defaultRole ?? 'user'),
    manifestUrl: b.manifestUrl !== undefined ? str(b.manifestUrl, 500) || undefined : existing?.manifestUrl,
    widgets: b.widgets !== undefined ? sanitizeWidgets(b.widgets) : existing?.widgets || [],
    enabled: b.enabled !== undefined ? !!b.enabled : existing?.enabled ?? true,
    order: Number.isFinite(Number(b.order)) ? Number(b.order) : existing?.order ?? 50
  };
}

function sanitizeWidgets(list: unknown): WidgetDef[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((w: any) => w && str(w.id, 60) && ['kpi', 'list', 'chart', 'iframe'].includes(w.type))
    .slice(0, 20)
    .map((w: any) => ({
      id: str(w.id, 60).replace(/[^a-zA-Z0-9_-]/g, '-'),
      title: str(w.title, 80) || str(w.id, 60),
      type: w.type,
      endpoint: str(w.endpoint, 500) || undefined,
      size: ['s', 'm', 'l'].includes(w.size) ? w.size : 'm',
      refreshSec: Math.min(3600, Math.max(15, Number(w.refreshSec) || 300))
    }));
}

async function assertUniqueClientId(clientId: string, exceptId?: string) {
  const clash = (await Modules.all()).find((m) => m.clientId === clientId && m.id !== exceptId);
  if (clash) throw new HttpError(409, `El identificador "${clientId}" ya lo usa ${clash.name}`);
}

function sanitizeRoles(v: any): Record<string, ModuleRole> {
  const out: Record<string, ModuleRole> = {};
  if (v && typeof v === 'object') for (const [k, r] of Object.entries(v)) if (ROLES.includes(r as ModuleRole)) out[k] = r as ModuleRole;
  return out;
}

export function adminRoutes(r: Router) {

  // Copia de seguridad / migración (solo superadmin). Exporta TODO el almacén a un JSON
  // y permite reimportarlo en otra instalación (p. ej. migrar desde Netlify a un servidor propio).
  r.get('/api/admin/backup', async (req) => {
    await requireSuper(req);
    const { store } = await import('../store.ts');
    const kv = store();
    const keys = await kv.keys('');
    const data: Record<string, unknown> = {};
    for (const k of keys) data[k] = await kv.get(k);
    const payload = JSON.stringify({ format: 'prime-suite-backup', version: 1, exportedAt: now(), count: keys.length, data });
    return new Response(payload, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="prime-suite-backup-${new Date().toISOString().slice(0, 10)}.json"`, 'cache-control': 'no-store' } });
  });

  r.post('/api/admin/restore', async (req) => {
    const c = await requireSuper(req);
    const b = await body<{ format?: string; data?: Record<string, unknown> }>(req);
    if (!b || b.format !== 'prime-suite-backup' || !b.data || typeof b.data !== 'object') throw new HttpError(400, 'El fichero no es una copia de seguridad de Prime Suite válida.');
    const { store } = await import('../store.ts');
    const kv = store();
    let n = 0;
    for (const [k, v] of Object.entries(b.data)) { await kv.set(k, v); n++; }
    await log(c, req, 'admin.restore', undefined, `${n} registros importados`);
    return json({ ok: true, imported: n });
  });
  // ---------- Empresas ----------
  r.get('/api/admin/companies', async (req) => {
    const c = await requireAdmin(req);
    const all = c.user.role === 'superadmin' ? await Companies.all() : [c.company];
    const users = await Users.all();
    return json(all.sort((a, b) => a.name.localeCompare(b.name)).map((co) => ({ ...co, userCount: users.filter((u) => u.companyId === co.id).length })));
  });

  const companyFrom = (b: any, existing?: Company): Omit<Company, 'id' | 'createdAt'> => {
    const code = str(b.code, 32).toLowerCase() || existing?.code || '';
    if (!str(b.name) && !existing) throw new HttpError(400, 'El nombre es obligatorio');
    if (!/^[a-z0-9-]{2,32}$/.test(code)) throw new HttpError(400, 'Código de empresa: 2-32 caracteres en minúsculas, números o guiones');
    const moduleUrls: Record<string, string> = {};
    if (b.moduleUrls && typeof b.moduleUrls === 'object') for (const [k, v] of Object.entries(b.moduleUrls)) if (str(v, 500)) moduleUrls[k] = str(v, 500);
    return {
      name: str(b.name) || existing!.name,
      code,
      taxId: b.taxId !== undefined ? str(b.taxId, 40) : existing?.taxId,
      email: b.email !== undefined ? str(b.email, 120) : existing?.email,
      enabledModules: Array.isArray(b.enabledModules) ? b.enabledModules.map(String) : existing?.enabledModules || [],
      moduleUrls: b.moduleUrls !== undefined ? moduleUrls : existing?.moduleUrls || {}
    };
  };

  r.post('/api/admin/companies', async (req) => {
    const c = await requireSuper(req);
    const data = companyFrom(await body(req));
    if ((await Companies.all()).some((x) => x.code === data.code)) throw new HttpError(409, 'Ya existe una empresa con ese código');
    const co: Company = { id: id(), createdAt: now(), ...data };
    await Companies.put(co);
    await log(c, req, 'company.created', co.name);
    return json(co, 201);
  });

  r.get('/api/admin/companies/:id', async (req, p) => {
    const c = await requireAdmin(req);
    assertCompanyScope(c, p.id);
    const co = await Companies.get(p.id);
    if (!co) throw new HttpError(404, 'Empresa no encontrada');
    return json(co);
  });

  r.put('/api/admin/companies/:id', async (req, p) => {
    const c = await requireSuper(req);
    const co = await Companies.get(p.id);
    if (!co) throw new HttpError(404, 'Empresa no encontrada');
    const data = companyFrom(await body(req), co);
    if ((await Companies.all()).some((x) => x.code === data.code && x.id !== co.id)) throw new HttpError(409, 'Ya existe una empresa con ese código');
    const updated = { ...co, ...data };
    await Companies.put(updated);
    await log(c, req, 'company.updated', co.name);
    return json(updated);
  });

  r.del('/api/admin/companies/:id', async (req, p) => {
    const c = await requireSuper(req);
    if (p.id === c.company.id) throw new HttpError(400, 'No puedes eliminar tu propia empresa');
    if ((await Users.all()).some((u) => u.companyId === p.id)) throw new HttpError(409, 'La empresa tiene usuarios; elimínalos o muévelos primero');
    const co = await Companies.get(p.id);
    await Companies.del(p.id);
    for (const g of (await Groups.all()).filter((g) => g.companyId === p.id)) await Groups.del(g.id);
    await log(c, req, 'company.deleted', co?.name);
    return json({ ok: true });
  });

  // ---------- Usuarios ----------
  r.get('/api/admin/users', async (req) => {
    const c = await requireAdmin(req);
    const q = new URL(req.url).searchParams;
    const companyId = c.user.role === 'superadmin' ? q.get('companyId') : c.company.id;
    const status = q.get('status');
    const [users, groups, companies] = await Promise.all([Users.all(), Groups.all(), Companies.all()]);
    const list = users
      .filter((u) => (!companyId || u.companyId === companyId) && (!status || u.status === status))
      .sort((a, b) => a.firstName.localeCompare(b.firstName))
      .map((u) => ({
        ...publicUser(u),
        companyName: companies.find((x) => x.id === u.companyId)?.name,
        groups: u.groupIds.map((gid) => groups.find((g) => g.id === gid)?.name).filter(Boolean)
      }));
    return json(list);
  });

  const userFrom = async (c: Ctx, b: any, existing?: User) => {
    const companyId = c.user.role === 'superadmin' ? str(b.companyId) || existing?.companyId || c.company.id : c.company.id;
    if (!(await Companies.get(companyId))) throw new HttpError(400, 'Empresa no válida');
    const email = (str(b.email, 160) || existing?.email || '').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Email no válido');
    const other = await findUserByLogin(email);
    if (other && other.id !== existing?.id) throw new HttpError(409, 'Ya existe un usuario con ese email');
    const username = b.username !== undefined ? str(b.username, 60) || undefined : existing?.username;
    if (username) {
      const u2 = await findUserByLogin(username);
      if (u2 && u2.id !== existing?.id) throw new HttpError(409, 'Nombre de usuario en uso');
    }
    let role = (['superadmin', 'admin', 'user'].includes(b.role) ? b.role : existing?.role || 'user') as User['role'];
    if (role === 'superadmin' && c.user.role !== 'superadmin') throw new HttpError(403, 'Solo un superadministrador puede crear superadministradores');
    if (existing?.role === 'superadmin' && c.user.role !== 'superadmin') throw new HttpError(403, 'No puedes modificar a un superadministrador');
    const groups = await Groups.all();
    const groupIds = Array.isArray(b.groupIds)
      ? b.groupIds.map(String).filter((gid: string) => groups.some((g) => g.id === gid && (g.companyId === companyId || g.companyId === null)))
      : existing?.groupIds || [];
    const status = (['active', 'pending', 'disabled'].includes(b.status) ? b.status : existing?.status || 'active') as User['status'];
    return {
      companyId, email, username, role, groupIds, status,
      firstName: str(b.firstName, 80) || existing?.firstName || '',
      lastName: b.lastName !== undefined ? str(b.lastName, 80) : existing?.lastName || ''
    };
  };

  r.post('/api/admin/users', async (req) => {
    const c = await requireAdmin(req);
    const b = await body(req);
    const data = await userFrom(c, b);
    if (!data.firstName) throw new HttpError(400, 'El nombre es obligatorio');
    if (!validPassword(b.password)) throw new HttpError(400, PASSWORD_RULE);
    const u: User = { id: id(), ...data, passwordHash: await hashPassword(b.password), sessionVersion: 1, createdAt: now() };
    await Users.put(u);
    await log(c, req, 'user.created', u.email);
    return json(publicUser(u), 201);
  });

  r.get('/api/admin/users/:id', async (req, p) => {
    const c = await requireAdmin(req);
    const u = await Users.get(p.id);
    if (!u) throw new HttpError(404, 'Usuario no encontrado');
    assertCompanyScope(c, u.companyId);
    const company = (await Companies.get(u.companyId))!;
    const groups = (await Groups.all()).filter((g) => u.groupIds.includes(g.id));
    const mods = (await Modules.all()).sort((a, b) => a.order - b.order);
    const access = mods.map((m) => ({ moduleId: m.id, name: m.name, initials: m.initials, color: m.color, authMethod: m.authMethod, role: moduleRole(u, company, groups, m), enabledForCompany: company.enabledModules.includes(m.id) }));
    return json({ user: publicUser(u), company: { id: company.id, name: company.name, code: company.code }, groups: groups.map((g) => ({ id: g.id, name: g.name })), access });
  });

  r.put('/api/admin/users/:id', async (req, p) => {
    const c = await requireAdmin(req);
    const u = await Users.get(p.id);
    if (!u) throw new HttpError(404, 'Usuario no encontrado');
    assertCompanyScope(c, u.companyId);
    const b = await body(req);
    const data = await userFrom(c, b, u);
    if (u.id === c.user.id && (data.role !== u.role || data.status !== 'active')) throw new HttpError(400, 'No puedes cambiar tu propio rol ni desactivarte');
    const updated: User = { ...u, ...data };
    if (b.password) {
      if (!validPassword(b.password)) throw new HttpError(400, PASSWORD_RULE);
      updated.passwordHash = await hashPassword(b.password);
      updated.sessionVersion += 1;
    }
    if (data.status !== 'active' || data.role !== u.role) updated.sessionVersion += 1;
    await Users.put(updated);
    await log(c, req, 'user.updated', u.email, b.password ? 'contraseña restablecida' : undefined);
    return json(publicUser(updated));
  });

  r.post('/api/admin/users/:id/approve', async (req, p) => {
    const c = await requireAdmin(req);
    const u = await Users.get(p.id);
    if (!u) throw new HttpError(404, 'Usuario no encontrado');
    assertCompanyScope(c, u.companyId);
    u.status = 'active';
    await Users.put(u);
    await log(c, req, 'user.approved', u.email);
    return json(publicUser(u));
  });

  r.post('/api/admin/users/:id/revoke-sessions', async (req, p) => {
    const c = await requireAdmin(req);
    const u = await Users.get(p.id);
    if (!u) throw new HttpError(404, 'Usuario no encontrado');
    assertCompanyScope(c, u.companyId);
    u.sessionVersion += 1;
    await Users.put(u);
    await log(c, req, 'user.sessions_revoked', u.email);
    return json({ ok: true });
  });

  r.del('/api/admin/users/:id', async (req, p) => {
    const c = await requireAdmin(req);
    const u = await Users.get(p.id);
    if (!u) throw new HttpError(404, 'Usuario no encontrado');
    assertCompanyScope(c, u.companyId);
    if (u.id === c.user.id) throw new HttpError(400, 'No puedes eliminar tu propio usuario');
    if (u.role === 'superadmin' && c.user.role !== 'superadmin') throw new HttpError(403, 'No puedes eliminar a un superadministrador');
    await Users.del(u.id);
    await log(c, req, 'user.deleted', u.email);
    return json({ ok: true });
  });

  // ---------- Grupos ----------
  r.get('/api/admin/groups', async (req) => {
    const c = await requireAdmin(req);
    const q = new URL(req.url).searchParams;
    const companyId = c.user.role === 'superadmin' ? q.get('companyId') : c.company.id;
    const users = await Users.all();
    const list = (await Groups.all())
      .filter((g) => !companyId || g.companyId === companyId || g.companyId === null)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => ({ ...g, memberCount: users.filter((u) => u.groupIds.includes(g.id)).length }));
    return json(list);
  });

  const groupFrom = (c: Ctx, b: any, existing?: Group) => {
    let companyId: string | null = existing ? existing.companyId : c.company.id;
    if (c.user.role === 'superadmin' && b.companyId !== undefined) companyId = b.companyId || null;
    const name = str(b.name, 80) || existing?.name;
    if (!name) throw new HttpError(400, 'El nombre es obligatorio');
    return { companyId, name, description: b.description !== undefined ? str(b.description, 200) : existing?.description, moduleRoles: b.moduleRoles !== undefined ? sanitizeRoles(b.moduleRoles) : existing?.moduleRoles || {} };
  };

  r.post('/api/admin/groups', async (req) => {
    const c = await requireAdmin(req);
    const data = groupFrom(c, await body(req));
    if (data.companyId === null && c.user.role !== 'superadmin') throw new HttpError(403, 'Solo un superadministrador crea grupos globales');
    const g: Group = { id: id(), createdAt: now(), ...data };
    await Groups.put(g);
    await log(c, req, 'group.created', g.name);
    return json(g, 201);
  });

  r.put('/api/admin/groups/:id', async (req, p) => {
    const c = await requireAdmin(req);
    const g = await Groups.get(p.id);
    if (!g) throw new HttpError(404, 'Grupo no encontrado');
    if (g.companyId === null) { if (c.user.role !== 'superadmin') throw new HttpError(403, 'Grupo global'); } else assertCompanyScope(c, g.companyId);
    const updated = { ...g, ...groupFrom(c, await body(req), g) };
    await Groups.put(updated);
    await log(c, req, 'group.updated', g.name);
    return json(updated);
  });

  r.del('/api/admin/groups/:id', async (req, p) => {
    const c = await requireAdmin(req);
    const g = await Groups.get(p.id);
    if (!g) throw new HttpError(404, 'Grupo no encontrado');
    if (g.companyId === null) { if (c.user.role !== 'superadmin') throw new HttpError(403, 'Grupo global'); } else assertCompanyScope(c, g.companyId);
    for (const u of (await Users.all()).filter((u) => u.groupIds.includes(g.id))) {
      u.groupIds = u.groupIds.filter((x) => x !== g.id);
      await Users.put(u);
    }
    await Groups.del(g.id);
    await log(c, req, 'group.deleted', g.name);
    return json({ ok: true });
  });

  // ---------- Categorías ----------
  r.get('/api/admin/categories', async (req) => {
    await requireAdmin(req);
    return json((await Categories.all()).sort((a, b) => a.order - b.order));
  });
  const catFrom = (b: any, e?: Category) => ({
    name: (str(b.name, 40) || e?.name || '').toUpperCase(),
    color: /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : e?.color || '#52525B',
    order: Number.isFinite(Number(b.order)) ? Number(b.order) : e?.order ?? 99,
    enabled: b.enabled !== undefined ? !!b.enabled : e?.enabled ?? true
  });
  r.post('/api/admin/categories', async (req) => {
    const c = await requireSuper(req);
    const data = catFrom(await body(req));
    if (!data.name) throw new HttpError(400, 'El nombre es obligatorio');
    const cat: Category = { id: id(), ...data };
    await Categories.put(cat);
    await log(c, req, 'category.created', cat.name);
    return json(cat, 201);
  });
  r.put('/api/admin/categories/:id', async (req, p) => {
    const c = await requireSuper(req);
    const cat = await Categories.get(p.id);
    if (!cat) throw new HttpError(404, 'Categoría no encontrada');
    const updated = { ...cat, ...catFrom(await body(req), cat) };
    await Categories.put(updated);
    await log(c, req, 'category.updated', cat.name);
    return json(updated);
  });
  r.del('/api/admin/categories/:id', async (req, p) => {
    const c = await requireSuper(req);
    const cat = await Categories.get(p.id);
    for (const m of (await Modules.all()).filter((m) => m.categoryId === p.id)) {
      m.categoryId = null;
      await Modules.put(m);
    }
    await Categories.del(p.id);
    await log(c, req, 'category.deleted', cat?.name);
    return json({ ok: true });
  });

  // ---------- Integraciones (módulos) ----------
  r.get('/api/admin/modules', async (req) => {
    await requireAdmin(req);
    const companies = await Companies.all();
    const mods = (await Modules.all()).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return json(mods.map((m) => ({ ...publicModule(m), companyCount: companies.filter((co) => co.enabledModules.includes(m.id)).length })));
  });

  r.get('/api/admin/modules/:id', async (req, p) => {
    const c = await requireAdmin(req);
    const m = await Modules.get(p.id);
    if (!m) throw new HttpError(404, 'Integración no encontrada');
    const companies = await Companies.all();
    return json({
      ...publicModule(m),
      resolvedUrl: abs(m.url, c.issuer),
      companies: companies.map((co) => ({ id: co.id, name: co.name, code: co.code, enabled: co.enabledModules.includes(m.id), url: co.moduleUrls?.[m.id] || '' }))
    });
  });

  const saveCompanies = async (m: Module, list: any) => {
    if (!Array.isArray(list)) return;
    for (const co of await Companies.all()) {
      const entry = list.find((x: any) => x.id === co.id);
      if (!entry) continue;
      const on = !!entry.enabled;
      co.enabledModules = on ? Array.from(new Set([...co.enabledModules, m.id])) : co.enabledModules.filter((x) => x !== m.id);
      co.moduleUrls = { ...(co.moduleUrls || {}) };
      if (str(entry.url, 500)) co.moduleUrls[m.id] = str(entry.url, 500);
      else delete co.moduleUrls[m.id];
      await Companies.put(co);
    }
  };

  r.post('/api/admin/modules', async (req) => {
    const c = await requireSuper(req);
    const b = await body(req);
    const data = sanitizeModule(b);
    await assertUniqueClientId(data.clientId);
    const m: Module = { id: id(), createdAt: now(), updatedAt: now(), ...data };
    let secret: string | undefined;
    if (m.authMethod === 'oidc' && b.confidential) {
      secret = randomToken(32);
      m.clientSecretHash = sha256(secret);
    }
    await Modules.put(m);
    await saveCompanies(m, b.companies ?? [{ id: c.company.id, enabled: true }]);
    await log(c, req, 'module.created', m.name, `auth=${m.authMethod}`);
    return json({ ...publicModule(m), clientSecret: secret }, 201);
  });

  r.put('/api/admin/modules/:id', async (req, p) => {
    const c = await requireSuper(req);
    const m = await Modules.get(p.id);
    if (!m) throw new HttpError(404, 'Integración no encontrada');
    const b = await body(req);
    const data = sanitizeModule(b, m);
    await assertUniqueClientId(data.clientId, m.id);
    const updated: Module = { ...m, ...data, updatedAt: now() };
    if (updated.authMethod !== 'oidc') delete updated.clientSecretHash;
    await Modules.put(updated);
    await saveCompanies(updated, b.companies);
    await log(c, req, 'module.updated', m.name);
    return json(publicModule(updated));
  });

  r.post('/api/admin/modules/:id/secret', async (req, p) => {
    const c = await requireSuper(req);
    const m = await Modules.get(p.id);
    if (!m) throw new HttpError(404, 'Integración no encontrada');
    const b = await body(req);
    let secret: string | undefined;
    if (b.remove) delete m.clientSecretHash;
    else {
      secret = randomToken(32);
      m.clientSecretHash = sha256(secret);
    }
    m.updatedAt = now();
    await Modules.put(m);
    await log(c, req, b.remove ? 'module.secret_removed' : 'module.secret_rotated', m.name);
    return json({ clientSecret: secret });
  });

  r.del('/api/admin/modules/:id', async (req, p) => {
    const c = await requireSuper(req);
    const m = await Modules.get(p.id);
    if (!m) throw new HttpError(404, 'Integración no encontrada');
    for (const co of (await Companies.all()).filter((co) => co.enabledModules.includes(m.id))) {
      co.enabledModules = co.enabledModules.filter((x) => x !== m.id);
      await Companies.put(co);
    }
    for (const g of (await Groups.all()).filter((g) => g.moduleRoles[m.id])) {
      delete g.moduleRoles[m.id];
      await Groups.put(g);
    }
    await Modules.del(m.id);
    await log(c, req, 'module.deleted', m.name);
    return json({ ok: true });
  });

  r.post('/api/admin/analyze', async (req) => {
    const c = await requireSuper(req);
    const b = await body(req);
    const url = abs(str(b.url, 500), c.issuer);
    const result = await analyzeUrl(url, c.issuer);
    await log(c, req, 'module.analyzed', result.finalUrl);
    return json(result);
  });

  r.post('/api/admin/manifest', async (req) => {
    const c = await requireSuper(req);
    const b = await body(req);
    const url = abs(str(b.url, 500), c.issuer);
    const m = await fetchManifest(url, c.issuer);
    if (!m) throw new HttpError(400, 'No se encontró un prime-app.json válido en esa URL');
    return json({ url: m.url, manifest: m.manifest, widgets: normalizeWidgets(m.manifest.widgets, m.url) });
  });

  // ---------- Identidad ----------
  r.get('/api/admin/identity', async (req) => {
    const c = await requireAdmin(req);
    const iss = origin(req);
    const ring = await keyRing();
    const mods = await Modules.all();
    const count = (a: string) => mods.filter((m) => m.authMethod === a && m.enabled).length;
    return json({
      issuer: iss,
      endpoints: [
        { key: 'Emisor (issuer)', value: iss },
        { key: 'Descubrimiento OIDC', value: `${iss}/.well-known/openid-configuration` },
        { key: 'Claves públicas (JWKS)', value: `${iss}/.well-known/jwks.json` },
        { key: 'Autorización', value: `${iss}/oidc/authorize` },
        { key: 'Token', value: `${iss}/oidc/token` },
        { key: 'UserInfo', value: `${iss}/oidc/userinfo` },
        { key: 'Cierre de sesión', value: `${iss}/oidc/logout` },
        { key: 'Canje de Prime Token', value: `${iss}/api/sso/redeem` }
      ],
      keys: [{ kid: ring.current.kid, createdAt: ring.current.createdAt, current: true }, ...ring.previous.map((k) => ({ kid: k.kid, createdAt: k.createdAt, current: false }))],
      connectors: { oidc: count('oidc'), prime_token: count('prime_token'), none: count('none') },
      settings: await getSettings(),
      canEdit: c.user.role === 'superadmin'
    });
  });

  r.post('/api/admin/identity/rotate', async (req) => {
    const c = await requireSuper(req);
    const ring = await rotateKeys();
    await log(c, req, 'identity.keys_rotated', ring.current.kid);
    return json({ ok: true, kid: ring.current.kid });
  });

  r.put('/api/admin/settings', async (req) => {
    const c = await requireSuper(req);
    const b = await body(req);
    const cur = await getSettings();
    const s: Settings = {
      sessionHours: Math.min(72, Math.max(1, Number(b.sessionHours ?? cur.sessionHours) || 8)),
      mfaAdmins: b.mfaAdmins !== undefined ? !!b.mfaAdmins : cur.mfaAdmins,
      singleLogout: b.singleLogout !== undefined ? !!b.singleLogout : cur.singleLogout,
      oneTimeTokens: b.oneTimeTokens !== undefined ? !!b.oneTimeTokens : cur.oneTimeTokens,
      keyRotationDays: Math.min(365, Math.max(7, Number(b.keyRotationDays ?? cur.keyRotationDays) || 90)),
      allowSelfRegistration: b.allowSelfRegistration !== undefined ? !!b.allowSelfRegistration : cur.allowSelfRegistration
    };
    await putSettings(s);
    await log(c, req, 'identity.settings_updated');
    return json(s);
  });

  // ---------- Auditoría ----------
  r.get('/api/admin/audit', async (req) => {
    const c = await requireAdmin(req);
    const limit = Math.min(500, Number(new URL(req.url).searchParams.get('limit')) || 200);
    return json(await listAudit(limit, c.user.role === 'superadmin' ? null : c.company.id));
  });
}
