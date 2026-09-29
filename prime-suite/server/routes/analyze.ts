// Análisis automático de una URL y lectura del manifiesto prime-app.json.
import { HttpError } from '../http.ts';
import { safeFetch } from '../netguard.ts';
import type { AuthMethod, OpenMode, TokenDelivery, WidgetDef } from '../db.ts';

export interface Check {
  level: 'ok' | 'warn' | 'info';
  title: string;
  detail: string;
}

export interface PrimeAppManifest {
  name?: string;
  description?: string;
  auth?: {
    methods?: AuthMethod[];
    redirect_uris?: string[];
    post_logout_redirect_uris?: string[];
    initiate_login_uri?: string;
    token_delivery?: TokenDelivery;
    token_param?: string;
  };
  widgets?: Partial<WidgetDef>[];
}

const WIDGET_TYPES = ['kpi', 'list', 'chart', 'iframe'];

export function normalizeWidgets(list: unknown, base: string): WidgetDef[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((w: any) => w && typeof w.id === 'string' && WIDGET_TYPES.includes(w.type))
    .slice(0, 20)
    .map((w: any) => ({
      id: String(w.id).slice(0, 60),
      title: String(w.title || w.id).slice(0, 80),
      type: w.type,
      endpoint: w.endpoint ? new URL(String(w.endpoint), base).toString() : undefined,
      size: ['s', 'm', 'l'].includes(w.size) ? w.size : 'm',
      refreshSec: Math.min(3600, Math.max(15, Number(w.refreshSec ?? w.refresh ?? 300) || 300))
    }));
}

export async function fetchManifest(url: string, portalOrigin: string): Promise<{ manifest: PrimeAppManifest; url: string } | null> {
  try {
    const { res, finalUrl } = await safeFetch(url, { headers: { accept: 'application/json' }, portalOrigin, timeoutMs: 5000 });
    if (!res.ok) return null;
    const m = (await res.json()) as PrimeAppManifest;
    return m && typeof m === 'object' ? { manifest: m, url: finalUrl } : null;
  } catch {
    return null;
  }
}

function resolveList(list: string[] | undefined, base: string) {
  return (list || []).map((u) => new URL(u, base).toString());
}

export async function analyzeUrl(raw: string, portalOrigin: string) {
  const checks: Check[] = [];
  let res: Response;
  let finalUrl: string;
  try {
    ({ res, finalUrl } = await safeFetch(raw, { headers: { 'user-agent': 'PrimeSuite-Analyzer/2.0', accept: 'text/html,*/*' }, portalOrigin, timeoutMs: 8000 }));
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'No se pudo conectar con la URL');
  }
  const u = new URL(finalUrl);
  checks.push(u.protocol === 'https:' ? { level: 'ok', title: 'Conexión HTTPS', detail: 'La aplicación responde por HTTPS.' } : { level: 'warn', title: 'Sin HTTPS', detail: 'Los navegadores bloquearán el iframe y las cookies seguras.' });
  checks.push(res.ok ? { level: 'ok', title: `Responde ${res.status}`, detail: finalUrl } : { level: 'warn', title: `Responde ${res.status}`, detail: 'Revisa que la URL sea la página de entrada de la app.' });

  const text = (res.headers.get('content-type') || '').includes('html') ? (await res.text()).slice(0, 300_000) : '';
  const title = text.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]?.trim();
  const iconHref = text.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1] || text.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*icon/i)?.[1];
  const favicon = iconHref ? new URL(iconHref, finalUrl).toString() : `${u.origin}/favicon.ico`;
  if (title) checks.push({ level: 'ok', title: 'Título detectado', detail: title });

  // ¿Se puede embeber?
  const xfo = (res.headers.get('x-frame-options') || '').toUpperCase();
  const csp = res.headers.get('content-security-policy') || '';
  const fa = csp.match(/frame-ancestors([^;]*)/i)?.[1]?.trim();
  let embeddable = true;
  if (xfo.includes('DENY') || xfo.includes('SAMEORIGIN')) {
    embeddable = u.origin === portalOrigin;
    checks.push({ level: embeddable ? 'ok' : 'warn', title: embeddable ? 'Embebible (mismo dominio)' : 'No se puede embeber en iframe', detail: `X-Frame-Options: ${xfo}` });
  } else if (fa !== undefined) {
    embeddable = fa.includes('*') || fa.includes(portalOrigin) || (fa.includes("'self'") && u.origin === portalOrigin);
    checks.push({ level: embeddable ? 'ok' : 'warn', title: embeddable ? 'Permite ser embebida' : 'CSP bloquea el iframe', detail: `frame-ancestors ${fa || "'none'"}` });
  } else {
    checks.push({ level: 'ok', title: 'Se puede embeber en iframe', detail: 'No envía X-Frame-Options ni frame-ancestors.' });
  }

  // Cookies SameSite (una cookie Lax/Strict no viaja dentro de un iframe de otro dominio).
  const cookies = (res.headers as any).getSetCookie?.() as string[] | undefined;
  const badCookies = (cookies || []).filter((c) => !/samesite=none/i.test(c));
  if (badCookies.length && u.origin !== portalOrigin) {
    checks.push({ level: 'warn', title: 'Cookies sin SameSite=None', detail: `${badCookies.length} cookie(s) no funcionarán dentro de un iframe; se recomienda abrir en pestaña.` });
  }

  // Manifiesto Prime (integración en un clic).
  const candidates = [new URL('prime-app.json', finalUrl.endsWith('/') ? finalUrl : finalUrl.replace(/[^/]*$/, '')).toString(), `${u.origin}/.well-known/prime-app.json`];
  let manifest: { manifest: PrimeAppManifest; url: string } | null = null;
  for (const c of candidates) {
    manifest = await fetchManifest(c, portalOrigin);
    if (manifest) break;
  }
  if (manifest) checks.push({ level: 'ok', title: 'Manifiesto Prime encontrado', detail: `${manifest.url} · autenticación y widgets se configuran solos.` });
  else checks.push({ level: 'info', title: 'Sin manifiesto prime-app.json', detail: 'Puedes configurar la autenticación y los widgets a mano.' });

  // SAML (informativo: el conector SAML está en la hoja de ruta).
  let saml = false;
  for (const p of ['/saml/metadata', '/saml2/metadata', '/Saml2/Metadata']) {
    try {
      const { res: r } = await safeFetch(u.origin + p, { portalOrigin, timeoutMs: 3000 });
      if (r.ok && /EntityDescriptor/.test(await r.text())) {
        saml = true;
        break;
      }
    } catch {}
  }
  if (saml) checks.push({ level: 'info', title: 'La app admite SAML 2.0', detail: 'El conector SAML llegará en la siguiente versión; mientras, usa OIDC o Prime Token si la app lo permite.' });

  const methods = manifest?.manifest.auth?.methods || [];
  const authMethod: AuthMethod = methods.includes('oidc') ? 'oidc' : methods.includes('prime_token') ? 'prime_token' : 'none';
  if (authMethod === 'none') checks.push({ level: 'info', title: 'Sin SSO detectado', detail: 'La app se abrirá con su propio login hasta que implemente OIDC o Prime Token (SDK disponible).' });
  const openMode: OpenMode = embeddable && !(badCookies.length && u.origin !== portalOrigin) ? 'iframe' : 'tab';
  const mbase = manifest?.url || finalUrl;
  const name = manifest?.manifest.name || title || u.hostname;

  return {
    finalUrl,
    checks,
    favicon,
    embeddable,
    saml,
    manifestUrl: manifest?.url,
    suggestion: {
      name,
      description: manifest?.manifest.description || '',
      initials: name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
      url: finalUrl,
      openMode,
      authMethod,
      redirectUris: resolveList(manifest?.manifest.auth?.redirect_uris, mbase),
      postLogoutRedirectUris: resolveList(manifest?.manifest.auth?.post_logout_redirect_uris, mbase),
      initiateLoginUri: manifest?.manifest.auth?.initiate_login_uri ? new URL(manifest.manifest.auth.initiate_login_uri, mbase).toString() : undefined,
      tokenDelivery: manifest?.manifest.auth?.token_delivery || 'fragment',
      tokenParam: manifest?.manifest.auth?.token_param || 'prime_token',
      widgets: normalizeWidgets(manifest?.manifest.widgets, mbase)
    }
  };
}
