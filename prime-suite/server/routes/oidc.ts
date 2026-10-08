// Prime ID: proveedor OpenID Connect + emisión y canje de Prime Tokens.
import { Router, json, redirect, html, body, HttpError, cookie, isSecure, origin, clientIp } from '../http.ts';
import { Users, Companies, Groups, Modules, findModuleByClientId, audit, putTemp, takeTemp, markOnce, getSettings, id, type Company, type Group, type Module, type ModuleRole, type User } from '../db.ts';
import { jwks, sign, verify, randomToken, sha256, pkceS256, halfHashS256, SESSION_COOKIE } from '../crypto.ts';
import { currentUser, requireUser, moduleRole, claimsFor, launchUrl, abs } from '../access.ts';
import { autoLoginActive, resolveCredentials, buildLaunch } from '../autologin.ts';

const SCOPES = ['openid', 'profile', 'email', 'tenant', 'roles'];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

interface CodeRecord {
  clientId: string;
  redirectUri: string;
  userId: string;
  scope: string[];
  nonce?: string;
  codeChallenge?: string;
  authTime: number;
}

function errorPage(title: string, msg: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return html(`<!doctype html><meta charset="utf-8"><title>Prime ID</title><link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet"><body style="font-family:'Open Sans',system-ui,sans-serif;color:#243A4D;background:radial-gradient(circle at 15% 0%,#E7EDF2 0,transparent 45%),#F4F6F8;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#fff;border:1px solid #E1E7EC;border-radius:18px;padding:32px;max-width:460px"><div style="color:#243A4D;margin:0 0 14px"><svg height="26" viewBox="0 0 148 40" fill="currentColor" style="display:block"><path d="M75.8163 12.4905C71.4069 12.4905 68.0962 15.7109 68.0962 19.9848C68.0962 24.2587 71.4069 27.5394 75.8163 27.5394C80.2256 27.5394 83.5665 24.2888 83.5665 19.9848C83.5665 15.6808 80.2407 12.4905 75.8163 12.4905ZM75.8163 24.7553C73.2429 24.7553 71.3167 22.7087 71.3167 19.9999C71.3167 17.2911 73.258 15.2896 75.8163 15.2896C78.3746 15.2896 80.3611 17.3061 80.3611 19.9999C80.3611 22.6936 78.4047 24.7553 75.8163 24.7553Z"/><path d="M31.5124 14.8381V27.2384H30.3837C29.0143 27.2384 28.3672 26.6064 28.3672 25.2369V12.8216H29.4959C30.8653 12.8216 31.5124 13.4687 31.5124 14.8381Z"/><path d="M31.8429 8.93896C31.8429 9.99238 30.9851 10.8502 29.9317 10.8502C28.8783 10.8502 28.0205 9.99238 28.0205 8.93896C28.0205 7.88553 28.8783 7.0127 29.9317 7.0127C30.9851 7.0127 31.8429 7.87048 31.8429 8.93896Z"/><path d="M64.7859 14.8381V27.2384H63.6573C62.2878 27.2384 61.6558 26.6064 61.6558 25.2369V12.8216H62.7844C64.1539 12.8216 64.7859 13.4687 64.7859 14.8381Z"/><path d="M65.1168 8.93896C65.1168 9.99238 64.259 10.8502 63.2056 10.8502C62.1521 10.8502 61.2793 9.99238 61.2793 8.93896C61.2793 7.88553 62.1371 7.0127 63.2056 7.0127C64.274 7.0127 65.1168 7.87048 65.1168 8.93896Z"/><path d="M57.4571 18.0737V27.2384H56.2983C54.9288 27.2384 54.2968 26.6064 54.2968 25.2369V18.7509C54.2968 17.0804 52.9424 15.711 51.2569 15.711C49.5714 15.711 48.217 17.0654 48.217 18.7509V27.2384H47.0432C45.6738 27.2384 45.0267 26.6064 45.0267 25.2369V18.7509C45.0267 17.0804 43.6572 15.711 41.9868 15.711C40.3163 15.711 38.9469 17.0654 38.9469 18.7509V27.2384H35.7866V12.8216H36.8099C37.9537 12.8216 38.6008 13.258 38.7362 14.1008C39.5187 13.3032 40.7227 12.5808 42.1824 12.5808C43.6422 12.5808 45.5684 13.5289 46.6218 15.41C47.6602 13.6493 49.5413 12.5808 51.6181 12.5808C54.7031 12.5808 57.2464 15.0037 57.427 18.0586H57.442L57.4571 18.0737Z"/><path d="M25.4027 16.027C24.3643 15.7863 21.8361 16.1775 21.7609 18.7358V27.2234H18.6006V12.8066H19.6691C20.3613 12.8066 20.8429 12.9721 21.1589 13.3182C21.3545 13.5139 21.4749 13.7848 21.5201 14.1008C22.9046 12.5658 25.3876 12.8066 25.3876 12.8066V16.012L25.4027 16.027Z"/><path d="M98.9014 27.2385H97.7426C96.3732 27.2385 95.7411 26.5914 95.7411 25.2219V18.7509C95.7411 17.0805 94.3867 15.711 92.7012 15.711C91.0157 15.711 89.6613 17.0654 89.6613 18.7509V27.2385H86.5161V12.8216H87.5846C88.2768 12.8216 88.7584 12.9872 89.0744 13.3333C89.2701 13.5289 89.3905 13.7998 89.4356 14.1158C90.3987 13.1226 91.6327 12.5959 93.0473 12.5959C96.2528 12.5959 98.8562 15.2144 98.8562 18.4048V27.2385H98.9014Z"/><path d="M7.96087 12.4905C6.09481 12.4905 4.33408 13.0924 2.94959 14.2061C2.85929 13.2881 2.19714 12.8216 1.00828 12.8216H0V32.7162H3.16027V26.2903C3.16027 26.185 3.16027 26.0796 3.16027 25.9743C4.49962 26.9976 6.1851 27.5544 7.96087 27.5544C12.3853 27.5544 15.696 24.3039 15.696 19.9999C15.696 15.6959 12.3702 12.5055 7.96087 12.5055V12.4905ZM7.96087 24.7553C5.38751 24.7553 3.4462 22.7087 3.4462 19.9999C3.4462 17.2911 5.38751 15.2896 7.96087 15.2896C10.5342 15.2896 12.4906 17.3061 12.4906 19.9999C12.4906 22.6936 10.5493 24.7553 7.96087 24.7553Z"/><path d="M147.584 20.0151L127.6 40L123.07 35.4703C123.07 35.4703 123.085 35.4552 123.1 35.4402L136.809 21.7306C137.773 20.7675 137.773 19.2175 136.809 18.2694L123.1 4.55982C123.1 4.55982 123.085 4.54477 123.07 4.52972L127.6 0L147.584 19.985V20.0151Z"/><path d="M118.209 27.5394C122.365 27.5394 125.733 24.1706 125.733 20.015C125.733 15.8594 122.365 12.4905 118.209 12.4905C114.053 12.4905 110.685 15.8594 110.685 20.015C110.685 24.1706 114.053 27.5394 118.209 27.5394Z"/></svg></div><h1 style="font-size:20px;margin:0 0 8px;color:#243A4D">${esc(title)}</h1><p style="color:#5C6B78;margin:0">${esc(msg)}</p></div>`, 400);
}

function withParams(url: string, params: Record<string, string | undefined>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

// response_type soportados, en forma canónica (partes ordenadas alfabéticamente).
const SUPPORTED_RT = ['code', 'code id_token', 'code id_token token'];
const canonRT = (v?: string) => (v || '').trim().split(/\s+/).filter(Boolean).sort().join(' ');

const htmlEsc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Devuelve la respuesta de authorize según el response_mode solicitado.
// - form_post: HTML con auto-submit (lo que usa Evalos8/Katana), valores escapados y <noscript>.
// - fragment: parámetros en el # de la redirect_uri. - query: parámetros en el ? (solo flujo code).
function authorizeResponse(mode: string, redirectUri: string, params: Record<string, string | undefined>) {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') clean[k] = v;
  if (mode === 'form_post') {
    const nonce = randomToken(8);
    const inputs = Object.entries(clean).map(([k, v]) => `<input type="hidden" name="${htmlEsc(k)}" value="${htmlEsc(v)}">`).join('');
    const page = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Prime ID</title></head>`
      + `<body onload="document.forms[0].submit()"><form method="post" action="${htmlEsc(redirectUri)}">${inputs}`
      + `<noscript><p>Continúa para volver a la aplicación.</p><button type="submit">Continuar</button></noscript></form>`
      + `<script nonce="${nonce}">document.forms[0].submit();</script></body></html>`;
    return new Response(page, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', pragma: 'no-cache', 'content-security-policy': `script-src 'nonce-${nonce}'` } });
  }
  if (mode === 'fragment') {
    const u = new URL(redirectUri);
    u.hash = new URLSearchParams(clean).toString();
    return redirect(u.toString());
  }
  return redirect(withParams(redirectUri, clean));
}

// Construye un id_token firmado (RS256). Incluye nonce, auth_time, nbf, sid y, en el
// flujo híbrido, c_hash (del code) y at_hash (del access_token). Respeta los scopes y,
// si el cliente tiene alwaysEmail, incluye email/email_verified aunque no se pida el scope.
async function buildIdToken(
  iss: string, m: Module, user: User, company: Company, groups: Group[], role: ModuleRole | null, scope: string[],
  o: { nonce?: string; authTime: number; code?: string; accessToken?: string }
) {
  const claims = claimsFor(user, company, groups, role, scope) as Record<string, unknown>;
  if (m.alwaysEmail && claims.email === undefined) { claims.email = user.email; claims.email_verified = true; }
  const now = Math.floor(Date.now() / 1000);
  const extra: Record<string, unknown> = { auth_time: o.authTime, nbf: now, sid: String(user.sessionVersion) };
  if (o.nonce) extra.nonce = o.nonce;
  if (o.code) extra.c_hash = halfHashS256(o.code);
  if (o.accessToken) extra.at_hash = halfHashS256(o.accessToken);
  return sign({ ...claims, ...extra }, { issuer: iss, audience: m.clientId, subject: user.id, ttlSec: 3600 });
}

async function loadGroups(u: User) {
  return (await Promise.all(u.groupIds.map((g) => Groups.get(g)))).filter(Boolean) as Group[];
}

async function clientAuth(req: Request, b: Record<string, string>) {
  let clientId = b.client_id;
  let secret = b.client_secret;
  const h = req.headers.get('authorization');
  if (h?.startsWith('Basic ')) {
    const [cid, sec] = Buffer.from(h.slice(6), 'base64').toString().split(':');
    clientId = decodeURIComponent(cid);
    secret = decodeURIComponent(sec || '');
  }
  const m = clientId ? await findModuleByClientId(clientId) : null;
  if (!m || m.authMethod !== 'oidc' || !m.enabled) throw new HttpError(401, 'invalid_client');
  if (m.clientSecretHash) {
    if (!secret || sha256(secret) !== m.clientSecretHash) throw new HttpError(401, 'invalid_client');
  }
  return m;
}

export async function issueAccessToken(issuer: string, user: User, m: Module, scope: string[], ttlSec = 3600) {
  const company = await Companies.get(user.companyId);
  const groups = await loadGroups(user);
  const role = company ? moduleRole(user, company, groups, m) : null;
  const claims = company ? claimsFor(user, company, groups, role, scope) : {};
  return sign({ ...claims, scope: scope.join(' '), client_id: m.clientId }, { issuer, audience: m.clientId, subject: user.id, ttlSec, typ: 'at+jwt', jti: id() });
}

export function oidcRoutes(r: Router) {
  for (const p of ['/oidc/token', '/oidc/userinfo', '/api/sso/redeem', '/.well-known/jwks.json', '/.well-known/openid-configuration']) {
    r.on('OPTIONS', p, async () => new Response(null, { status: 204, headers: CORS }));
  }

  r.get('/.well-known/openid-configuration', async (req) => {
    const iss = origin(req);
    return json(
      {
        issuer: iss,
        authorization_endpoint: `${iss}/oidc/authorize`,
        token_endpoint: `${iss}/oidc/token`,
        userinfo_endpoint: `${iss}/oidc/userinfo`,
        end_session_endpoint: `${iss}/oidc/logout`,
        jwks_uri: `${iss}/.well-known/jwks.json`,
        response_types_supported: ['code', 'code id_token', 'code id_token token'],
        response_modes_supported: ['query', 'fragment', 'form_post'],
        grant_types_supported: ['authorization_code', 'implicit'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        scopes_supported: SCOPES,
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        code_challenge_methods_supported: ['S256'],
        claims_supported: ['sub', 'name', 'given_name', 'family_name', 'preferred_username', 'email', 'email_verified', 'tenant', 'company_id', 'company_name', 'roles', 'groups', 'portal_role'],
        prime_token_redeem_endpoint: `${iss}/api/sso/redeem`
      },
      200,
      { ...CORS, 'cache-control': 'public, max-age=300' }
    );
  });

  r.get('/.well-known/jwks.json', async () => json(await jwks(), 200, { ...CORS, 'cache-control': 'public, max-age=300' }));

  r.get('/oidc/authorize', async (req) => {
    const iss = origin(req);
    const q = Object.fromEntries(new URL(req.url).searchParams);
    const m = q.client_id ? await findModuleByClientId(q.client_id) : null;
    if (!m || m.authMethod !== 'oidc' || !m.enabled) return errorPage('Aplicación desconocida', 'El client_id no corresponde a ninguna integración OIDC activa.');
    const allowed = m.redirectUris.map((u) => abs(u, iss));
    if (!q.redirect_uri || !allowed.includes(q.redirect_uri)) return errorPage('redirect_uri no permitida', 'Añade esta URL de retorno en la integración desde Administración › Integraciones.');

    const rt = canonRT(q.response_type);
    const parts = rt ? rt.split(' ') : [];
    const includesIdToken = parts.includes('id_token');
    const includesToken = parts.includes('token');
    // response_mode: por defecto query para el flujo code y fragment para el híbrido.
    let mode = q.response_mode || (includesIdToken ? 'fragment' : 'query');
    if (!['query', 'fragment', 'form_post'].includes(mode)) mode = includesIdToken ? 'fragment' : 'query';
    const respond = (params: Record<string, string | undefined>) => authorizeResponse(mode, q.redirect_uri, { ...params, state: q.state, iss });

    if (!SUPPORTED_RT.includes(rt)) return respond({ error: 'unsupported_response_type' });
    const allowedRT = m.responseTypes && m.responseTypes.length ? m.responseTypes : ['code'];
    if (rt !== 'code' && !allowedRT.includes(rt)) return respond({ error: 'unauthorized_client', error_description: 'El cliente no tiene permitido este response_type' });
    if (mode === 'query' && includesIdToken) return respond({ error: 'invalid_request', error_description: 'response_mode=query no permitido cuando se devuelve id_token o token' });

    const scope = (q.scope || 'openid').split(/\s+/).filter((s) => SCOPES.includes(s));
    if (!scope.includes('openid')) return respond({ error: 'invalid_scope', error_description: 'Falta el scope openid' });
    if (!m.clientSecretHash && !q.code_challenge) return respond({ error: 'invalid_request', error_description: 'PKCE obligatorio para clientes públicos' });
    if (q.code_challenge && q.code_challenge_method !== 'S256') return respond({ error: 'invalid_request', error_description: 'Solo se admite S256' });
    // Si se devuelve id_token desde authorize, el nonce es obligatorio (OIDC Core 3.3.2.11).
    if (includesIdToken && !q.nonce) return respond({ error: 'invalid_request', error_description: 'nonce es obligatorio en el flujo híbrido' });

    const ctx = await currentUser(req);
    if (!ctx || q.prompt === 'login') {
      if (q.prompt === 'none') return respond({ error: 'login_required' });
      const next = new URL(req.url);
      next.searchParams.delete('prompt');
      return redirect(`/login?next=${encodeURIComponent(next.pathname + next.search)}`);
    }
    const role = moduleRole(ctx.user, ctx.company, ctx.groups, m);
    if (!role) {
      await audit({ actorId: ctx.user.id, actorEmail: ctx.user.email, companyId: ctx.company.id, action: 'oidc.access_denied', target: m.name });
      return respond({ error: 'access_denied', error_description: 'No tienes acceso a esta aplicación' });
    }

    const authTime = Math.floor(Date.now() / 1000);
    const code = randomToken(24);
    const rec: CodeRecord = { clientId: m.clientId, redirectUri: q.redirect_uri, userId: ctx.user.id, scope, nonce: q.nonce, codeChallenge: q.code_challenge, authTime };
    await putTemp('codes', sha256(code), rec, 120);
    await audit({ actorId: ctx.user.id, actorEmail: ctx.user.email, companyId: ctx.company.id, action: 'oidc.authorized', target: m.name, detail: rt !== 'code' ? `response_type=${rt}` : undefined, ip: clientIp(req) });

    const params: Record<string, string | undefined> = { code };
    if (includesIdToken) {
      let accessToken: string | undefined;
      if (includesToken) {
        accessToken = await issueAccessToken(iss, ctx.user, m, scope);
        params.access_token = accessToken;
        params.token_type = 'Bearer';
        params.expires_in = '3600';
        params.scope = scope.join(' ');
      }
      params.id_token = await buildIdToken(iss, m, ctx.user, ctx.company, ctx.groups, role, scope, { nonce: q.nonce, authTime, code, accessToken });
    }
    return respond(params);
  });

  r.post('/oidc/token', async (req) => {
    const iss = origin(req);
    const fail = (error: string, status = 400, desc?: string) => json({ error, error_description: desc }, status, CORS);
    const b = await body<Record<string, string>>(req);
    let m: Module;
    try {
      m = await clientAuth(req, b);
    } catch {
      return fail('invalid_client', 401);
    }
    if (b.grant_type !== 'authorization_code') return fail('unsupported_grant_type');
    const rec = b.code ? await takeTemp<CodeRecord>('codes', sha256(b.code)) : null;
    if (!rec || rec.clientId !== m.clientId || rec.redirectUri !== b.redirect_uri) return fail('invalid_grant');
    if (rec.codeChallenge && (!b.code_verifier || pkceS256(b.code_verifier) !== rec.codeChallenge)) return fail('invalid_grant', 400, 'PKCE no válido');
    const user = await Users.get(rec.userId);
    const company = user && (await Companies.get(user.companyId));
    if (!user || !company || user.status !== 'active') return fail('invalid_grant');
    const groups = await loadGroups(user);
    const role = moduleRole(user, company, groups, m);
    if (!role) return fail('access_denied', 403);
    const idToken = await buildIdToken(iss, m, user, company, groups, role, rec.scope, { nonce: rec.nonce, authTime: rec.authTime });
    const accessToken = await issueAccessToken(iss, user, m, rec.scope);
    await audit({ actorId: user.id, actorEmail: user.email, companyId: company.id, action: 'oidc.token_issued', target: m.name });
    return json({ access_token: accessToken, id_token: idToken, token_type: 'Bearer', expires_in: 3600, scope: rec.scope.join(' ') }, 200, CORS);
  });

  const userinfo = async (req: Request) => {
    const iss = origin(req);
    const h = req.headers.get('authorization') || '';
    if (!h.startsWith('Bearer ')) return json({ error: 'invalid_token' }, 401, { ...CORS, 'www-authenticate': 'Bearer' });
    try {
      const p = await verify(h.slice(7), { issuer: iss, typ: 'at+jwt' });
      const user = await Users.get(String(p.sub));
      const company = user && (await Companies.get(user.companyId));
      const m = await findModuleByClientId(String(p.client_id));
      if (!user || !company || !m || user.status !== 'active') throw new Error();
      const groups = await loadGroups(user);
      const scope = String(p.scope || '').split(' ');
      const claims = claimsFor(user, company, groups, moduleRole(user, company, groups, m), scope) as Record<string, unknown>;
      if (m.alwaysEmail && claims.email === undefined) { claims.email = user.email; claims.email_verified = true; }
      return json({ sub: user.id, ...claims }, 200, CORS);
    } catch {
      return json({ error: 'invalid_token' }, 401, { ...CORS, 'www-authenticate': 'Bearer error="invalid_token"' });
    }
  };
  r.get('/oidc/userinfo', userinfo);
  r.post('/oidc/userinfo', userinfo);

  r.get('/oidc/logout', async (req) => {
    const iss = origin(req);
    const q = Object.fromEntries(new URL(req.url).searchParams);
    let clientId = q.client_id;
    if (!clientId && q.id_token_hint) {
      try {
        const p = await verify(q.id_token_hint, { issuer: iss });
        clientId = String(Array.isArray(p.aud) ? p.aud[0] : p.aud);
      } catch {}
    }
    const ctx = await currentUser(req);
    if (ctx && (await getSettings()).singleLogout) {
      ctx.user.sessionVersion += 1;
      await Users.put(ctx.user);
      await audit({ actorId: ctx.user.id, actorEmail: ctx.user.email, companyId: ctx.company.id, action: 'oidc.logout', target: clientId });
    }
    let target = '/login';
    if (q.post_logout_redirect_uri && clientId) {
      const m = await findModuleByClientId(clientId);
      if (m && m.postLogoutRedirectUris.map((u) => abs(u, iss)).includes(q.post_logout_redirect_uri)) target = withParams(q.post_logout_redirect_uri, { state: q.state });
    }
    return redirect(target, { 'set-cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecure(req) }) });
  });

  // ---- Lanzamiento de módulos desde el portal ----
  r.post('/api/sso/launch', async (req) => {
    const ctx = await requireUser(req);
    const iss = ctx.issuer;
    const { moduleId } = await body(req);
    const m = await Modules.get(String(moduleId));
    if (!m) throw new HttpError(404, 'Módulo no encontrado');
    const role = moduleRole(ctx.user, ctx.company, ctx.groups, m);
    if (!role) throw new HttpError(403, 'No tienes acceso a este módulo');
    const url = launchUrl(m, ctx.company, ctx.user, iss);
    const base = { moduleId: m.id, name: m.name, openMode: m.openMode, authMethod: m.authMethod, role };
    if (m.openMode === 'native') return json({ ...base, url: m.url });

    if (m.authMethod === 'prime_token') {
      const jti = id();
      const claims = claimsFor(ctx.user, ctx.company, ctx.groups, role);
      const token = await sign(claims, { issuer: iss, audience: m.clientId, subject: ctx.user.id, ttlSec: m.tokenTtlSec || 60, jti, typ: 'prime+jwt' });
      await audit({ actorId: ctx.user.id, actorEmail: ctx.user.email, companyId: ctx.company.id, action: 'sso.prime_token_issued', target: m.name, detail: `jti=${jti}` });
      const p = m.tokenParam || 'prime_token';
      if (m.tokenDelivery === 'form_post') return json({ ...base, url, formPost: { action: url, fields: { [p]: token } }, expiresIn: m.tokenTtlSec });
      if (m.tokenDelivery === 'query') return json({ ...base, url: withParams(url, { [p]: token }), expiresIn: m.tokenTtlSec });
      const u = new URL(url);
      u.hash = `${p}=${encodeURIComponent(token)}`;
      return json({ ...base, url: u.toString(), expiresIn: m.tokenTtlSec });
    }
    if (m.authMethod === 'oidc' && m.initiateLoginUri) {
      // OIDC "third-party initiated login": la app arranca el flujo contra Prime ID sin pedir credenciales.
      const u = withParams(abs(m.initiateLoginUri, iss), { iss, target_link_uri: url, client_id: m.clientId, login_hint: ctx.user.email });
      await audit({ actorId: ctx.user.id, actorEmail: ctx.user.email, companyId: ctx.company.id, action: 'sso.oidc_launch', target: m.name });
      return json({ ...base, url: u });
    }
    // Sin SSO con inicio de sesión automático: credenciales guardadas (del usuario o compartidas).
    if (autoLoginActive(m)) {
      const al = m.autoLogin!;
      const creds = await resolveCredentials(m, ctx.user.id);
      if (!creds) return json({ ...base, url, autoLogin: { mode: al.credentials, missing: true } });
      await audit({ actorId: ctx.user.id, actorEmail: ctx.user.email, companyId: ctx.company.id, action: 'sso.autologin', target: m.name, detail: al.credentials === 'shared' ? 'cuenta compartida' : `usuario ${creds.username}` });
      const out = buildLaunch(al, creds);
      return json({ ...base, url: out.url || url, formPost: out.formPost, autoLogin: { mode: al.credentials, missing: false, username: al.credentials === 'user' ? creds.username : undefined } }, 200, { 'cache-control': 'no-store' });
    }
    return json({ ...base, url });
  });

  // Canje de un Prime Token por parte de la aplicación (valida firma, audiencia y un solo uso).
  r.post('/api/sso/redeem', async (req) => {
    const iss = origin(req);
    const b = await body(req);
    try {
      const p = await verify(String(b.token || ''), { issuer: iss, typ: 'prime+jwt', audience: b.audience ? String(b.audience) : undefined });
      if ((await getSettings()).oneTimeTokens) {
        const first = await markOnce('jti', String(p.jti), 600);
        if (!first) return json({ valid: false, error: 'token_already_used' }, 400, CORS);
      }
      return json({ valid: true, claims: p }, 200, CORS);
    } catch (e: any) {
      return json({ valid: false, error: 'invalid_token', detail: e?.code || e?.message }, 400, CORS);
    }
  });
}
