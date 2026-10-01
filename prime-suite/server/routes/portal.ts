// Portal del usuario: aplicaciones accesibles, panel de widgets y datos de widgets.
import { Router, json, body, HttpError } from '../http.ts';
import { Categories, Modules, getDashboard, putDashboard, type DashboardItem } from '../db.ts';
import { requireUser, accessibleModules, moduleRole, abs } from '../access.ts';
import { issueAccessToken } from './oidc.ts';
import { safeFetch } from '../netguard.ts';
import { ensureInsightsModule, visibleDashboards } from './insights.ts';
import { ensureEvalosModule, evalosWidgets } from './evalos.ts';

export function portalRoutes(r: Router) {
  r.get('/api/portal/apps', async (req) => {
    const c = await requireUser(req);
    await ensureInsightsModule();
    await ensureEvalosModule();
    const cats = (await Categories.all()).filter((x) => x.enabled).sort((a, b) => a.order - b.order);
    const mods = await accessibleModules(c);
    return json({
      categories: cats,
      apps: mods.map(({ m, role }) => ({
        id: m.id, name: m.name, description: m.description, initials: m.initials, color: m.color, iconUrl: m.iconUrl, iconGlyph: m.iconGlyph, categoryId: m.categoryId,
        openMode: m.openMode, authMethod: m.authMethod, role, widgets: m.widgets.length,
        // Los módulos nativos se abren en su ruta interna del portal.
        nativeUrl: m.openMode === 'native' ? m.url : undefined
      }))
    });
  });

  r.get('/api/dashboard', async (req) => {
    const c = await requireUser(req);
    const mods = await accessibleModules(c);
    const catalog: any[] = mods.flatMap(({ m }) => m.widgets.map((w) => ({ moduleId: m.id, moduleName: m.name, initials: m.initials, color: m.color, ...w })));
    // Cada dashboard de Prime Insights marcado como widget aparece automáticamente en el catálogo.
    const insights = await visibleDashboards(c);
    for (const d of insights.list.filter((d) => d.enabled && d.showAsWidget && d.embeddedUuid && d.serverId)) {
      catalog.push({ moduleId: insights.module.id, moduleName: insights.module.name, initials: insights.module.initials, color: insights.module.color, id: `insight:${d.id}`, title: d.name, type: 'superset', size: 'l', refreshSec: 3600, dashboardId: d.id });
    }
    // Cada pantalla de Atajos de Evalos se ofrece como widget.
    catalog.push(...(await evalosWidgets(c)));
    let items = await getDashboard(c.user.id);
    if (!items) items = catalog.slice(0, 6).map((w) => ({ moduleId: w.moduleId, widgetId: w.id, size: w.size }));
    const valid = items.filter((i) => catalog.some((w) => w.moduleId === i.moduleId && w.id === i.widgetId));
    return json({ items: valid, catalog });
  });

  r.put('/api/dashboard', async (req) => {
    const c = await requireUser(req);
    const b = await body<{ items: DashboardItem[] }>(req);
    if (!Array.isArray(b.items) || b.items.length > 40) throw new HttpError(400, 'Formato de panel no válido');
    const items = b.items.map((i) => ({ moduleId: String(i.moduleId), widgetId: String(i.widgetId), size: (['s', 'm', 'l'].includes(i.size) ? i.size : 'm') as DashboardItem['size'] }));
    await putDashboard(c.user.id, items);
    return json({ ok: true });
  });

  r.get('/api/widgets/data', async (req) => {
    const c = await requireUser(req);
    const q = new URL(req.url).searchParams;
    const m = await Modules.get(String(q.get('moduleId')));
    if (!m || !moduleRole(c.user, c.company, c.groups, m)) throw new HttpError(403, 'Sin acceso al módulo');
    const w = m.widgets.find((x) => x.id === q.get('widgetId'));
    if (!w) throw new HttpError(404, 'Widget no encontrado');
    if (w.type === 'iframe') return json({ url: abs(w.endpoint || m.url, c.issuer) });
    if (!w.endpoint) throw new HttpError(400, 'El widget no tiene endpoint');
    const token = await issueAccessToken(c.issuer, c.user, m, ['openid', 'profile', 'email', 'tenant', 'roles'], 300);
    try {
      const { res } = await safeFetch(abs(w.endpoint, c.issuer), {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'x-prime-tenant': c.company.code },
        portalOrigin: c.issuer,
        timeoutMs: 6000
      });
      if (!res.ok) return json({ error: `La aplicación respondió ${res.status}` }, 502);
      const text = await res.text();
      if (text.length > 200_000) return json({ error: 'Respuesta demasiado grande' }, 502);
      return json(JSON.parse(text), 200, { 'cache-control': `private, max-age=${Math.min(w.refreshSec, 60)}` });
    } catch (e: any) {
      if (e instanceof HttpError) throw e;
      return json({ error: 'No se pudo obtener el widget' }, 502);
    }
  });
}
