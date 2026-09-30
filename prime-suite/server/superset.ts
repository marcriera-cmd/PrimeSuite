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
