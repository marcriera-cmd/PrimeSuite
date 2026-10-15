// Cliente de la API REST de Apache Superset (login de servicio, guest tokens, dashboards).
import { HttpError } from './http.ts';
import { safeFetch } from './netguard.ts';
import { decryptSecret } from './crypto.ts';
import type { SupersetServer } from './db.ts';

interface Session {
  access: string;
  exp: number;
}
const sessions = new Map<string, Session>();

const base = (s: SupersetServer) => s.baseUrl.replace(/\/$/, '');

async function call(s: SupersetServer, path: string, init: RequestInit = {}) {
  try {
    const { res } = await safeFetch(base(s) + path, { ...init, timeoutMs: 10000 });
    return res;
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, `No se pudo conectar con Superset (${base(s)})`);
  }
}

async function login(s: SupersetServer, force = false): Promise<string> {
  const cached = sessions.get(s.id);
  if (!force && cached && cached.exp > Date.now()) return cached.access;
  const password = await decryptSecret(s.passwordEnc);
  const res = await call(s, '/api/v1/security/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: s.username, password, provider: s.provider || 'db', refresh: true })
  });
  if (!res.ok) throw new HttpError(502, res.status === 401 ? 'Superset rechazó el usuario o la contraseña' : `Superset respondió ${res.status} al iniciar sesión`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new HttpError(502, 'Superset no devolvió un token de acceso');
  sessions.set(s.id, { access: j.access_token, exp: Date.now() + 10 * 60_000 });
  return j.access_token;
}

async function api<T>(s: SupersetServer, path: string, init: RequestInit & { csrf?: boolean } = {}, retry = true): Promise<T> {
  const token = await login(s);
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json', ...(init.headers as Record<string, string>) };
  if (init.body) headers['content-type'] = 'application/json';
  if (init.csrf) {
    // Algunas instalaciones exigen token CSRF (y su cookie de sesión) también en la API.
    const r = await call(s, '/api/v1/security/csrf_token/', { headers: { authorization: `Bearer ${token}` } });
    if (r.ok) {
      const j = (await r.json()) as { result?: string };
      if (j.result) headers['x-csrftoken'] = j.result;
      const cookies = ((r.headers as any).getSetCookie?.() as string[] | undefined) || [];
      if (cookies.length) headers.cookie = cookies.map((c) => c.split(';')[0]).join('; ');
      headers.referer = base(s);
    }
  }
  const res = await call(s, path, { ...init, headers });
  if (res.status === 401 && retry) {
    sessions.delete(s.id);
    return api<T>(s, path, init, false);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, data?.message ? `Superset: ${typeof data.message === 'string' ? data.message : JSON.stringify(data.message)}` : `Superset respondió ${res.status}`);
  return data as T;
}

export async function testConnection(s: SupersetServer) {
  sessions.delete(s.id);
  await login(s, true);
  const me = await api<{ result?: { username?: string } }>(s, '/api/v1/me/').catch(() => null);
  const list = await api<{ count: number }>(s, `/api/v1/dashboard/?q=${encodeURIComponent('(page_size:1)')}`);
  return { ok: true, user: me?.result?.username || s.username, dashboards: list.count };
}

export interface RemoteDashboard {
  supersetId: number;
  title: string;
  url: string;
  published: boolean;
  changedOn?: string;
  embeddedUuid: string | null;
  allowedDomains: string[];
}

export async function listDashboards(s: SupersetServer): Promise<RemoteDashboard[]> {
  const out: RemoteDashboard[] = [];
  for (let page = 0; page < 10; page++) {
    const q = encodeURIComponent(`(page:${page},page_size:100,order_column:dashboard_title,order_direction:asc)`);
    const r = await api<{ result: any[]; count: number }>(s, `/api/v1/dashboard/?q=${q}`);
    for (const d of r.result) {
      out.push({ supersetId: d.id, title: d.dashboard_title, url: base(s) + (d.url || `/superset/dashboard/${d.id}/`), published: !!d.published, changedOn: d.changed_on_delta_humanized, embeddedUuid: null, allowedDomains: [] });
    }
    if (out.length >= r.count || r.result.length === 0) break;
  }
  // UUID de embebido y dominios permitidos (si ya está activado)
  await Promise.all(
    out.map(async (d) => {
      const e = await getEmbedded(s, d.supersetId);
      d.embeddedUuid = e?.uuid || null;
      d.allowedDomains = e?.allowed_domains || [];
    })
  );
  return out;
}

export async function getEmbedded(s: SupersetServer, supersetId: number): Promise<{ uuid: string; allowed_domains: string[] } | null> {
  try {
    const r = await api<{ result?: { uuid?: string; allowed_domains?: string[] } }>(s, `/api/v1/dashboard/${supersetId}/embedded`);
    return r?.result?.uuid ? { uuid: r.result.uuid, allowed_domains: r.result.allowed_domains || [] } : null;
  } catch {
    return null;
  }
}

const sameOrigin = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

/**
 * Garantiza que el dashboard está embebido y que `portalOrigin` está en sus dominios permitidos.
 * No borra dominios existentes (el portal antiguo sigue funcionando durante la migración).
 */
export async function ensureEmbedding(s: SupersetServer, supersetId: number, portalOrigin: string) {
  const cur = await getEmbedded(s, supersetId);
  const existing = cur?.allowed_domains || [];
  const allowed = existing.some((d) => sameOrigin(d, portalOrigin));
  if (cur?.uuid && allowed) return { uuid: cur.uuid, allowedDomains: existing, changed: false };
  const merged = allowed ? existing : [...existing, portalOrigin];
  const r = await api<{ result?: { uuid?: string } }>(s, `/api/v1/dashboard/${supersetId}/embedded`, {
    method: 'POST',
    csrf: true,
    body: JSON.stringify({ allowed_domains: merged })
  });
  if (!r?.result?.uuid) throw new HttpError(502, 'Superset no devolvió el UUID de embebido');
  return { uuid: r.result.uuid, allowedDomains: merged, changed: true };
}

export async function guestToken(
  s: SupersetServer,
  embeddedUuid: string,
  user: { username: string; first_name: string; last_name: string },
  rls: { clause: string }[]
) {
  const r = await api<{ token?: string }>(s, '/api/v1/security/guest_token/', {
    method: 'POST',
    csrf: true,
    body: JSON.stringify({ user, resources: [{ type: 'dashboard', id: embeddedUuid }], rls })
  });
  if (!r?.token) throw new HttpError(502, 'Superset no devolvió el guest token');
  return r.token;
}

// ---------- Resumen del dashboard para el widget del Inicio ----------
// En vez de incrustar el dashboard (iframe apretado), se leen los datos de sus gráficos por la API
// y el portal pinta una representación pequeña y nativa: unos KPIs y un mini-gráfico de barras.

export interface DashboardSummary {
  kpis: { label: string; value: string }[];
  chart?: { title: string; series: { label: string; value: number }[] };
}

interface ChartBlock { data?: Record<string, unknown>[]; colnames?: string[]; coltypes?: number[] }

/** Formatea un número al estilo español (miles con '.', decimales con ','), compacto para miles/millones.
 *  Agrupa a mano para no depender de los datos de locale (ICU) del Node del servidor. */
export function fmtNum(n: number): string {
  const grp = (x: number, dec: number) => {
    const [i, d] = x.toFixed(dec).split('.');
    const int = i.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (x < 0 ? '-' : '') + (d && Number(d) ? `${int},${d}` : int);
  };
  const a = Math.abs(n);
  if (a >= 1e6) return grp(n / 1e6, 1) + ' M';
  if (a >= 1e4) return grp(n / 1e3, 1) + ' k';
  return grp(n, a < 10 && !Number.isInteger(n) ? 2 : 0);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const numify = (v: unknown): number | null => {
  if (isNum(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^\d.-]/g, '');
    if (!/\d/.test(cleaned)) return null;
    const n = Number(cleaned);
    return isFinite(n) ? n : null;
  }
  return null;
};
const isMeta = (c: string) => c.startsWith('__'); // __timestamp y columnas internas de Superset

/** De un gráfico (tipo + bloque de datos) saca un KPI o una serie categórica, si se puede. */
export function extractChart(viz: string, name: string, block: ChartBlock | undefined):
  { kpi?: { label: string; value: string }; series?: { label: string; value: number }[] } {
  const rows = block?.data;
  if (!Array.isArray(rows) || rows.length === 0) return {};
  const cols = (block?.colnames && block.colnames.length ? block.colnames : Object.keys(rows[0])).filter((c) => !isMeta(c));

  // Big Number → KPI: primer valor numérico de la primera fila (ignorando columnas internas).
  if (/big_number|^number$/i.test(viz) || rows.length === 1) {
    for (const c of cols) { const n = numify(rows[0][c]); if (n !== null) return { kpi: { label: name, value: fmtNum(n) } }; }
  }

  // Serie categórica: una columna de texto (dimensión) + una numérica (métrica).
  const metric = cols.find((c) => rows.slice(0, 5).every((r) => numify(r[c]) !== null));
  const dim = cols.find((c) => c !== metric && rows.slice(0, 5).some((r) => typeof r[c] === 'string'));
  if (metric && dim) {
    const series = rows
      .map((r) => ({ label: String(r[dim] ?? '—'), value: numify(r[metric]) ?? 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    if (series.length) return { series };
  }
  return {};
}

/** Lee los gráficos del dashboard y devuelve KPIs + un mini-gráfico para el widget. */
export async function dashboardSummary(s: SupersetServer, supersetId: number): Promise<DashboardSummary> {
  const r = await api<{ result?: any[] }>(s, `/api/v1/dashboard/${supersetId}/charts`);
  const charts = (r?.result || []).slice(0, 12);
  const kpis: { label: string; value: string }[] = [];
  let chart: DashboardSummary['chart'] | undefined;

  for (const c of charts) {
    if (kpis.length >= 4 && chart) break;
    const pk = c.id ?? c.form_data?.slice_id;
    if (!pk) continue;
    const viz = String(c.viz_type || c.form_data?.viz_type || '');
    const name = String(c.slice_name || c.form_data?.slice_name || 'Métrica');
    let block: ChartBlock | undefined;
    try {
      const d = await api<{ result?: ChartBlock[] }>(s, `/api/v1/chart/${pk}/data/?format=json&type=full`);
      block = d?.result?.[0];
    } catch { continue; }
    const got = extractChart(viz, name, block);
    if (got.kpi && kpis.length < 4) kpis.push(got.kpi);
    else if (got.series && !chart) chart = { title: name, series: got.series };
  }
  return { kpis, chart };
}
