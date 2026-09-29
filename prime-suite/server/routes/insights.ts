// Prime Insights: módulo nativo para gestionar, asignar y visualizar dashboards de Apache Superset.
import { Router, json, body, HttpError, clientIp } from '../http.ts';
import {
  Modules, Companies, InsightCategories, InsightDashboards, SupersetServers, audit, id, now,
  type InsightDashboard, type Module, type SupersetServer
} from '../db.ts';
import { requireUser, requireAdmin, requireSuper, moduleRole, type Ctx } from '../access.ts';
import { encryptSecret } from '../crypto.ts';
import { testConnection, listDashboards, enableEmbedding, guestToken } from '../superset.ts';

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const log = (c: Ctx, req: Request, action: string, target?: string) =>
  audit({ actorId: c.user.id, actorEmail: c.user.email, companyId: c.company.id, action, target, ip: clientIp(req) });

export const INSIGHTS_CLIENT_ID = 'prime-insights';

/** Garantiza que Prime Insights existe como módulo nativo (también en instalaciones ya creadas). */
export async function ensureInsightsModule(): Promise<Module> {
  const all = await Modules.all();
  let m = all.find((x) => x.clientId === INSIGHTS_CLIENT_ID);
  if (!m) {
    m = {
      id: id(), clientId: INSIGHTS_CLIENT_ID, name: 'Prime Insights', description: 'Dashboards de Superset', categoryId: null, initials: 'PI', color: '#1F5FBF',
      url: '/insights', openMode: 'native', authMethod: 'none', tokenDelivery: 'fragment', tokenParam: 'prime_token', tokenTtlSec: 60,
      redirectUris: [], postLogoutRedirectUris: [], defaultRole: 'user', widgets: [], enabled: true, order: 10, createdAt: now(), updatedAt: now()
    };
    await Modules.put(m);
    for (const co of await Companies.all()) {
      co.enabledModules = Array.from(new Set([...co.enabledModules, m.id]));
      await Companies.put(co);
    }
  } else if (m.openMode !== 'native' || m.url !== '/insights') {
    m = { ...m, openMode: 'native', url: '/insights', authMethod: 'none', description: m.description || 'Dashboards de Superset', enabled: true, updatedAt: now() };
    await Modules.put(m);
  }
  if ((await InsightCategories.all()).length === 0) {
    for (const [i, name] of ['DEMO', 'Evalos', 'Visitas'].entries()) await InsightCategories.put({ id: id(), name, order: i });
  }
  return m;
}

async function insightsAccess(c: Ctx) {
  const m = await ensureInsightsModule();
  const role = moduleRole(c.user, c.company, c.groups, m);
  return { module: m, role };
}

/** ¿Puede este usuario ver este dashboard? */
export function canSee(c: Ctx, d: InsightDashboard) {
  if (c.user.role === 'superadmin') return true;
  if (!d.enabled) return false;
  if (d.companyIds.length && !d.companyIds.includes(c.company.id)) return false;
  if (c.user.role === 'admin') return true;
  return d.groupIds.length === 0 || d.groupIds.some((g) => c.user.groupIds.includes(g));
}

/** Dashboards visibles para el usuario (lo usa también el panel de widgets). */
export async function visibleDashboards(c: Ctx) {
  const { role, module } = await insightsAccess(c);
  if (!role) return { module, list: [] as InsightDashboard[] };
  const list = (await InsightDashboards.all()).filter((d) => canSee(c, d) && (d.enabled || c.user.role === 'superadmin'));
  return { module, list: list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)) };
}

const publicServer = (s: SupersetServer) => ({ id: s.id, name: s.name, baseUrl: s.baseUrl, username: s.username, provider: s.provider, hasPassword: !!s.passwordEnc, updatedAt: s.updatedAt });

function dashboardFrom(b: any, existing?: InsightDashboard): Omit<InsightDashboard, 'id' | 'createdAt' | 'updatedAt'> {
  const name = str(b.name, 120) || existing?.name;
  if (!name) throw new HttpError(400, 'El nombre es obligatorio');
  const embeddedUuid = b.embeddedUuid !== undefined ? str(b.embeddedUuid, 60) || undefined : existing?.embeddedUuid;
  const dashboardUrl = b.dashboardUrl !== undefined ? str(b.dashboardUrl, 500) || undefined : existing?.dashboardUrl;
  if (embeddedUuid && !/^[0-9a-fA-F-]{32,40}$/.test(embeddedUuid)) throw new HttpError(400, 'El UUID de embebido no tiene un formato válido');
  if (dashboardUrl && !/^https?:\/\//.test(dashboardUrl)) throw new HttpError(400, 'La URL del dashboard debe empezar por https://');
  if (!embeddedUuid && !dashboardUrl) throw new HttpError(400, 'Indica el UUID de embebido o la URL del dashboard');
  const arr = (v: unknown, def: string[]) => (Array.isArray(v) ? v.map(String).slice(0, 200) : def);
  return {
    serverId: b.serverId !== undefined ? b.serverId || null : existing?.serverId ?? null,
    name,
    description: b.description !== undefined ? str(b.description, 500) : existing?.description,
    categoryId: b.categoryId !== undefined ? b.categoryId || null : existing?.categoryId ?? null,
    supersetId: b.supersetId !== undefined ? Number(b.supersetId) || undefined : existing?.supersetId,
    embeddedUuid,
    dashboardUrl,
    order: Number.isFinite(Number(b.order)) ? Number(b.order) : existing?.order ?? 50,
    enabled: b.enabled !== undefined ? !!b.enabled : existing?.enabled ?? true,
    showAsWidget: b.showAsWidget !== undefined ? !!b.showAsWidget : existing?.showAsWidget ?? false,
    companyIds: arr(b.companyIds, existing?.companyIds || []),
    groupIds: arr(b.groupIds, existing?.groupIds || []),
    rlsClause: b.rlsClause !== undefined ? str(b.rlsClause, 500) || undefined : existing?.rlsClause
  };
}

const sqlEsc = (v: string) => v.replace(/'/g, "''");

export function insightsRoutes(r: Router) {
  // ---------- Vista del usuario ----------
  r.get('/api/insights/me', async (req) => {
    const c = await requireUser(req);
    const { role } = await insightsAccess(c);
    if (!role) throw new HttpError(403, 'No tienes acceso a Prime Insights');
    const { list } = await visibleDashboards(c);
    const cats = (await InsightCategories.all()).sort((a, b) => a.order - b.order);
    return json({
      canManage: c.user.role === 'superadmin',
      categories: cats,
      dashboards: list.map((d) => ({ id: d.id, name: d.name, description: d.description, categoryId: d.categoryId, embedded: !!(d.embeddedUuid && d.serverId), dashboardUrl: d.dashboardUrl, enabled: d.enabled, showAsWidget: d.showAsWidget }))
    });
  });

  r.post('/api/insights/dashboards/:id/guest-token', async (req, p) => {
    const c = await requireUser(req);
    const { role } = await insightsAccess(c);
    const d = await InsightDashboards.get(p.id);
    if (!role || !d || !canSee(c, d)) throw new HttpError(403, 'No tienes acceso a este dashboard');
    if (!d.embeddedUuid || !d.serverId) throw new HttpError(400, 'Este dashboard no tiene configurado el embebido');
    const s = await SupersetServers.get(d.serverId);
    if (!s) throw new HttpError(400, 'Servidor Superset no encontrado');
    const rls = d.rlsClause
      ? [{ clause: d.rlsClause.replaceAll('{tenant}', sqlEsc(c.company.code)).replaceAll('{email}', sqlEsc(c.user.email)).replaceAll('{company_id}', sqlEsc(c.company.id)) }]
      : [];
    const token = await guestToken(s, d.embeddedUuid, { username: c.user.email, first_name: c.user.firstName, last_name: c.user.lastName || '-' }, rls);
    await log(c, req, 'insights.dashboard_viewed', d.name);
    return json({ token, supersetDomain: s.baseUrl.replace(/\/$/, ''), embeddedUuid: d.embeddedUuid });
  });

  // ---------- Administración ----------
  r.get('/api/insights/admin', async (req) => {
    const c = await requireAdmin(req);
    await ensureInsightsModule();
    const [servers, cats, dashboards] = await Promise.all([SupersetServers.all(), InsightCategories.all(), InsightDashboards.all()]);
    const list = c.user.role === 'superadmin' ? dashboards : dashboards.filter((d) => !d.companyIds.length || d.companyIds.includes(c.company.id));
    return json({
      canEdit: c.user.role === 'superadmin',
      servers: servers.map(publicServer),
      categories: cats.sort((a, b) => a.order - b.order),
      dashboards: list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    });
  });

  // Servidores
  const serverFrom = async (b: any, existing?: SupersetServer) => {
    const baseUrl = (str(b.baseUrl, 300) || existing?.baseUrl || '').replace(/\/$/, '');
    if (!/^https?:\/\/[^/]+/.test(baseUrl)) throw new HttpError(400, 'URL base no válida (ej. https://superset.empresa.com)');
    const username = str(b.username, 120) || existing?.username || '';
    if (!username) throw new HttpError(400, 'El usuario de servicio es obligatorio');
    let passwordEnc = existing?.passwordEnc || '';
    if (typeof b.password === 'string' && b.password) passwordEnc = await encryptSecret(b.password);
    if (!passwordEnc) throw new HttpError(400, 'La contraseña es obligatoria');
    return { name: str(b.name, 80) || existing?.name || new URL(baseUrl).hostname, baseUrl, username, passwordEnc, provider: (b.provider === 'ldap' ? 'ldap' : existing?.provider || 'db') as 'db' | 'ldap' };
  };
  r.post('/api/insights/servers', async (req) => {
    const c = await requireSuper(req);
    const s: SupersetServer = { id: id(), createdAt: now(), updatedAt: now(), ...(await serverFrom(await body(req))) };
    await SupersetServers.put(s);
    await log(c, req, 'insights.server_created', s.name);
    return json(publicServer(s), 201);
  });
  r.put('/api/insights/servers/:id', async (req, p) => {
    const c = await requireSuper(req);
    const s = await SupersetServers.get(p.id);
    if (!s) throw new HttpError(404, 'Servidor no encontrado');
    const updated = { ...s, ...(await serverFrom(await body(req), s)), updatedAt: now() };
    await SupersetServers.put(updated);
    await log(c, req, 'insights.server_updated', s.name);
    return json(publicServer(updated));
  });
  r.del('/api/insights/servers/:id', async (req, p) => {
    const c = await requireSuper(req);
    if ((await InsightDashboards.all()).some((d) => d.serverId === p.id)) throw new HttpError(409, 'Hay dashboards que usan este servidor');
    const s = await SupersetServers.get(p.id);
    await SupersetServers.del(p.id);
    await log(c, req, 'insights.server_deleted', s?.name);
    return json({ ok: true });
  });
  r.post('/api/insights/servers/:id/test', async (req, p) => {
    await requireSuper(req);
    const s = await SupersetServers.get(p.id);
    if (!s) throw new HttpError(404, 'Servidor no encontrado');
    return json(await testConnection(s));
  });
  r.get('/api/insights/servers/:id/discover', async (req, p) => {
    await requireSuper(req);
    const s = await SupersetServers.get(p.id);
    if (!s) throw new HttpError(404, 'Servidor no encontrado');
    const remote = await listDashboards(s);
    const existing = (await InsightDashboards.all()).filter((d) => d.serverId === s.id);
    return json(remote.map((d) => ({ ...d, imported: existing.some((e) => e.supersetId === d.supersetId || (d.embeddedUuid && e.embeddedUuid === d.embeddedUuid)) })));
  });
  r.post('/api/insights/servers/:id/import', async (req, p) => {
    const c = await requireSuper(req);
    const s = await SupersetServers.get(p.id);
    if (!s) throw new HttpError(404, 'Servidor no encontrado');
    const b = await body(req);
    const items: any[] = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
    const created: InsightDashboard[] = [];
    const errors: string[] = [];
    for (const it of items) {
      let uuid: string | undefined = it.embeddedUuid || undefined;
      if (!uuid && b.enableEmbed) {
        try {
          uuid = await enableEmbedding(s, Number(it.supersetId), [c.issuer]);
        } catch (e: any) {
          errors.push(`${it.title}: ${e.message}`);
        }
      }
      const d: InsightDashboard = {
        id: id(), serverId: s.id, name: str(it.title, 120) || `Dashboard ${it.supersetId}`, categoryId: b.categoryId || null,
        supersetId: Number(it.supersetId), embeddedUuid: uuid, dashboardUrl: str(it.url, 500) || undefined,
        order: 50 + created.length, enabled: true, showAsWidget: !!b.showAsWidget, companyIds: Array.isArray(b.companyIds) ? b.companyIds : [], groupIds: [],
        createdAt: now(), updatedAt: now()
      };
      await InsightDashboards.put(d);
      created.push(d);
    }
    await log(c, req, 'insights.dashboards_imported', `${created.length} de ${s.name}`);
    return json({ created: created.length, errors });
  });

  // Dashboards
  r.post('/api/insights/dashboards', async (req) => {
    const c = await requireSuper(req);
    const d: InsightDashboard = { id: id(), createdAt: now(), updatedAt: now(), ...dashboardFrom(await body(req)) };
    await InsightDashboards.put(d);
    await log(c, req, 'insights.dashboard_created', d.name);
    return json(d, 201);
  });
  r.put('/api/insights/dashboards/:id', async (req, p) => {
    const c = await requireSuper(req);
    const d = await InsightDashboards.get(p.id);
    if (!d) throw new HttpError(404, 'Dashboard no encontrado');
    const updated = { ...d, ...dashboardFrom(await body(req), d), updatedAt: now() };
    await InsightDashboards.put(updated);
    await log(c, req, 'insights.dashboard_updated', d.name);
    return json(updated);
  });
  r.del('/api/insights/dashboards/:id', async (req, p) => {
    const c = await requireSuper(req);
    const d = await InsightDashboards.get(p.id);
    await InsightDashboards.del(p.id);
    await log(c, req, 'insights.dashboard_deleted', d?.name);
    return json({ ok: true });
  });
  r.post('/api/insights/dashboards/:id/enable-embed', async (req, p) => {
    const c = await requireSuper(req);
    const d = await InsightDashboards.get(p.id);
    if (!d || !d.serverId || !d.supersetId) throw new HttpError(400, 'El dashboard necesita servidor e id de Superset');
    const s = await SupersetServers.get(d.serverId);
    if (!s) throw new HttpError(400, 'Servidor no encontrado');
    d.embeddedUuid = await enableEmbedding(s, d.supersetId, [c.issuer]);
    d.updatedAt = now();
    await InsightDashboards.put(d);
    await log(c, req, 'insights.embed_enabled', d.name);
    return json(d);
  });

  // Categorías
  r.post('/api/insights/categories', async (req) => {
    const c = await requireSuper(req);
    const b = await body(req);
    if (!str(b.name)) throw new HttpError(400, 'El nombre es obligatorio');
    const cat = { id: id(), name: str(b.name, 60), order: Number(b.order) || 0 };
    await InsightCategories.put(cat);
    await log(c, req, 'insights.category_created', cat.name);
    return json(cat, 201);
  });
  r.put('/api/insights/categories/:id', async (req, p) => {
    await requireSuper(req);
    const cat = await InsightCategories.get(p.id);
    if (!cat) throw new HttpError(404, 'Categoría no encontrada');
    const b = await body(req);
    const updated = { ...cat, name: str(b.name, 60) || cat.name, order: Number.isFinite(Number(b.order)) ? Number(b.order) : cat.order };
    await InsightCategories.put(updated);
    return json(updated);
  });
  r.del('/api/insights/categories/:id', async (req, p) => {
    await requireSuper(req);
    for (const d of (await InsightDashboards.all()).filter((d) => d.categoryId === p.id)) {
      d.categoryId = null;
      await InsightDashboards.put(d);
    }
    await InsightCategories.del(p.id);
    return json({ ok: true });
  });
}
