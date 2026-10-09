// Proxy inverso de 2N Access Commander bajo el mismo origen que Prime Suite (/2n/*).
//
// 2N pone su sesión en una cookie SameSite=Strict, que el navegador no envía dentro de un iframe de
// otro sitio. Sirviendo 2N desde /2n/ en el host de Prime Suite, la cookie pasa a ser first-party:
// se guarda (host-only) para el host del portal y el iframe la envía sin cambiar SameSite.
//
// Variables de entorno:
//   TWON_UPSTREAM         https://95.142.3.48:4322 (destino fijo: no es un proxy abierto)
//   TWON_TLS_FINGERPRINT  huella SHA-256 del certificado de 2N (AA:BB:…). Si está, solo se acepta
//                         ese certificado; si no, se acepta el que presente y se registra su huella.
import { request as httpsRequest } from 'node:https';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { PeerCertificate } from 'node:tls';
import { currentUser } from './access.ts';

export const TWON_PREFIX = '/2n';
const PREFIX = TWON_PREFIX;
const UPSTREAM = new URL(process.env.TWON_UPSTREAM || 'https://95.142.3.48:4322');
const PIN = (process.env.TWON_TLS_FINGERPRINT || '').toUpperCase().replace(/[^0-9A-F]/g, '');
const SHIM_PATH = `${PREFIX}/__ps_2n_shim.js`;
const PRIVATE_COOKIE = /^(ps_|__Host-ps)/;
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'host', 'content-length', 'accept-encoding', 'x-forwarded-for', 'x-forwarded-host',
  'x-forwarded-proto', 'x-real-ip', 'forwarded']);
const DROP_OUT = new Set(['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'x-frame-options',
  'content-security-policy', 'strict-transport-security', 'set-cookie', 'location']);

let loggedFingerprint = false;

export const isTwonPath = (p: string) => p === PREFIX || p.startsWith(`${PREFIX}/`);

export async function handleTwon(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === PREFIX) return redirect(`${PREFIX}/${url.search}`);
  if (url.pathname === SHIM_PATH) return shim();

  // Solo usuarios con sesión de Prime Suite.
  if (!(await currentUser(req).catch(() => null))) {
    return text(401, 'Inicia sesión en Prime Suite para abrir 2N Access Commander.');
  }

  const own = ownOrigin(req);
  const path = url.pathname.slice(PREFIX.length) || '/';
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { if (!HOP.has(k) && k !== 'cookie' && k !== 'origin' && k !== 'referer') headers[k] = v; });
  headers.host = UPSTREAM.host;
  headers['accept-encoding'] = 'identity'; // así podemos reescribir HTML/CSS sin descomprimir
  if (req.headers.has('origin')) headers.origin = UPSTREAM.origin;
  const ref = req.headers.get('referer');
  if (ref) headers.referer = toUpstreamUrl(ref, own);
  const cookie = filterCookies(req.headers.get('cookie'));
  if (cookie) headers.cookie = cookie;

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.from(await req.arrayBuffer());
  if (body) headers['content-length'] = String(body.length);

  let up: { res: IncomingMessage; body: Buffer };
  try {
    up = await send(req.method, `${path}${url.search}`, headers, body);
  } catch (e: any) {
    console.error('[2n-proxy] sin conexión con', UPSTREAM.host, e?.message || e);
    return text(502, `No se puede conectar con 2N (${UPSTREAM.host}): ${e?.message || e}`);
  }

  const out = new Headers();
  for (const [k, v] of Object.entries(up.res.headers)) {
    if (v === undefined || DROP_OUT.has(k)) continue;
    if (Array.isArray(v)) v.forEach((x) => out.append(k, x)); else out.set(k, String(v));
  }
  for (const sc of up.res.headers['set-cookie'] || []) out.append('set-cookie', rewriteSetCookie(sc));
  const loc = up.res.headers.location;
  if (loc) out.set('location', rewriteLocation(loc, own));

  const type = String(up.res.headers['content-type'] || '');
  const status = up.res.statusCode || 502;
  const noBody = req.method === 'HEAD' || status === 204 || status === 304;
  if (!noBody && type.includes('text/html')) {
    out.set('cache-control', 'no-store');
    return new Response(rewriteHtml(up.body.toString('utf8')), { status, headers: out });
  }
  if (!noBody && type.includes('text/css')) {
    return new Response(rewriteCss(up.body.toString('utf8')), { status, headers: out });
  }
  if (path.startsWith('/api/')) out.set('cache-control', 'no-store');
  return new Response(noBody ? null : new Uint8Array(up.body), { status, headers: out });
}

function send(method: string, path: string, headers: Record<string, string>, body?: Buffer) {
  return new Promise<{ res: IncomingMessage; body: Buffer }>((resolve, reject) => {
    const tls = UPSTREAM.protocol === 'https:';
    const r = (tls ? httpsRequest : httpRequest)({
      host: UPSTREAM.hostname, port: UPSTREAM.port || (tls ? 443 : 80), method, path, headers,
      timeout: 30_000,
      // Certificado de una IP: normalmente autofirmado. Se valida por huella si TWON_TLS_FINGERPRINT está definida.
      ...(tls ? {
        rejectUnauthorized: false,
        checkServerIdentity: (_h: string, cert: PeerCertificate) => {
          const fp = (cert.fingerprint256 || '').toUpperCase().replace(/[^0-9A-F]/g, '');
          if (PIN && fp !== PIN) return new Error('El certificado de 2N no coincide con TWON_TLS_FINGERPRINT');
          if (!PIN && !loggedFingerprint) {
            loggedFingerprint = true;
            console.warn(`[2n-proxy] certificado de 2N aceptado sin fijar. Huella SHA-256: ${cert.fingerprint256} (ponla en TWON_TLS_FINGERPRINT)`);
          }
          return undefined;
        }
      } : {})
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ res, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    r.on('timeout', () => r.destroy(new Error('tiempo de espera agotado')));
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

// ---------------- Reescrituras ----------------

/** Conserva SameSite/Secure/HttpOnly; acota Path a /2n y quita Domain (sigue siendo host-only). */
export function rewriteSetCookie(sc: string): string {
  const [nameValue, ...attrs] = sc.split(';').map((p) => p.trim()).filter(Boolean);
  let path = '/';
  const kept: string[] = [];
  for (const a of attrs) {
    const key = a.split('=')[0].trim().toLowerCase();
    if (key === 'domain') continue;
    if (key === 'path') { path = a.slice(a.indexOf('=') + 1).trim() || '/'; continue; }
    kept.push(a);
  }
  return [nameValue, `Path=${PREFIX}${path.startsWith('/') ? path : `/${path}`}`, ...kept].join('; ');
}

export function filterCookies(header: string | null): string {
  if (!header) return '';
  return header.split(';').map((c) => c.trim()).filter((c) => c && !PRIVATE_COOKIE.test(c.split('=')[0])).join('; ');
}

export function rewriteLocation(loc: string, _own?: string): string {
  try {
    const u = new URL(loc, UPSTREAM);
    if (u.origin !== UPSTREAM.origin) return loc;
    return `${PREFIX}${u.pathname}${u.search}${u.hash}`; // relativo: no depende de cabeceras X-Forwarded
  } catch { return loc; }
}

function toUpstreamUrl(ref: string, own: string): string {
  try {
    const u = new URL(ref);
    if (u.host !== own || !u.pathname.startsWith(`${PREFIX}/`)) return `${UPSTREAM.origin}/`;
    return `${UPSTREAM.origin}${u.pathname.slice(PREFIX.length)}${u.search}`;
  } catch { return `${UPSTREAM.origin}/`; }
}

export function rewriteHtml(html: string): string {
  html = html.replace(new RegExp(escapeRe(UPSTREAM.origin), 'g'), PREFIX);
  html = html.replace(/(\s(?:src|href|action)=["'])\/(?!\/|2n\/)/gi, `$1${PREFIX}/`);
  const base = `<base href="${PREFIX}/">`;
  html = /<base\s[^>]*href=/i.test(html)
    ? html.replace(/<base\s[^>]*href=["'][^"']*["'][^>]*>/i, base)
    : html.replace(/<head[^>]*>/i, (m) => `${m}${base}`);
  return html.replace(base, `${base}<script src="${SHIM_PATH}"></script>`);
}

export function rewriteCss(css: string): string {
  return css.replace(new RegExp(escapeRe(UPSTREAM.origin), 'g'), PREFIX).replace(/url\((['"]?)\/(?!\/|2n\/)/g, `url($1${PREFIX}/`);
}

/** Corrige en el navegador las URLs absolutas (/api/v3/…) que el SPA monte en tiempo de ejecución. */
function shim(): Response {
  const js = `(()=>{const P=${JSON.stringify(PREFIX)},U=${JSON.stringify(UPSTREAM.origin)},O=location.origin;
const fix=(u)=>{try{const s=String(u);if(s.startsWith(U))return P+s.slice(U.length);
const a=new URL(s,document.baseURI);if(a.origin!==O||a.pathname===P||a.pathname.startsWith(P+'/'))return s;
if(s.startsWith('/')||s.startsWith(O+'/'))return O+P+a.pathname+a.search+a.hash;return s;}catch(e){return u}};
const xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...r){return xo.call(this,m,fix(u),...r)};
const f=window.fetch;window.fetch=function(i,init){if(i instanceof Request){const n=fix(i.url);if(n!==i.url)i=new Request(n,i)}else i=fix(i);return f.call(this,i,init)};
if(window.EventSource){const E=window.EventSource;const N=function(u,o){return new E(fix(u),o)};N.prototype=E.prototype;window.EventSource=N}
})();`;
  return new Response(js, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Host con el que el navegador ve el portal (el TLS lo termina el proxy de delante). */
function ownOrigin(req: Request): string {
  return (req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host).split(',')[0].trim();
}

const redirect = (to: string) => new Response(null, { status: 308, headers: { location: to } });
const text = (status: number, msg: string) => new Response(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
