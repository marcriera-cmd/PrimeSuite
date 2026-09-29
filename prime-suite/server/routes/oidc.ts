// Prime ID: proveedor OpenID Connect + emisión y canje de Prime Tokens.
import { Router, json, redirect, html, body, HttpError, cookie, isSecure, origin, clientIp } from '../http.ts';
import { Users, Companies, Groups, Modules, findModuleByClientId, audit, putTemp, takeTemp, markOnce, getSettings, id, type Group, type Module, type User } from '../db.ts';
import { jwks, sign, verify, randomToken, sha256, pkceS256, SESSION_COOKIE } from '../crypto.ts';
import { currentUser, requireUser, moduleRole, claimsFor, launchUrl, abs } from '../access.ts';

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
  return html(`<!doctype html><meta charset="utf-8"><title>Prime ID</title><body style="font-family:system-ui;background:#F4F3F0;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#fff;border:1px solid #E3E1DC;border-radius:14px;padding:32px;max-width:460px"><h1 style="font-size:20px;margin:0 0 8px">${esc(title)}</h1><p style="color:#5E5B66;margin:0">${esc(msg)}</p></div>`, 400);
}

function withParams(url: string, params: Record<string, string | undefined>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
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
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
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
    const back = (params: Record<string, string | undefined>) => redirect(withParams(q.redirect_uri, { ...params, state: q.state, iss }));

    if (q.response_type !== 'code') return back({ error: 'unsupported_response_type' });
    const scope = (q.scope || 'openid').split(/\s+/).filter((s) => SCOPES.includes(s));
    if (!scope.includes('openid')) return back({ error: 'invalid_scope', error_description: 'Falta el scope openid' });
    if (!m.clientSecretHash && !q.code_challenge) return back({ error: 'invalid_request', error_description: 'PKCE obligatorio para clientes públicos' });
    if (q.code_challenge && q.code_challenge_method !== 'S256') return back({ error: 'invalid_request', error_description: 'Solo se admite S256' });

    const ctx = await currentUser(req);
    if (!ctx || q.prompt === 'login') {
      if (q.prompt === 'none') return back({ error: 'login_required' });
      const next = new URL(req.url);
      next.searchParams.delete('prompt');
      return redirect(`/login?next=${encodeURIComponent(next.pathname + next.search)}`);
    }
    const role = moduleRole(ctx.user, ctx.company, ctx.groups, m);
    if (!role) {
      await audit({ actorId: ctx.user.id, actorEmail: ctx.user.email, companyId: ctx.company.id, action: 'oidc.access_denied', target: m.name });
      return back({ error: 'access_denied', error_description: 'No tienes acceso a esta aplicación' });
    }
    const code = randomToken(24);
    const rec: CodeRecord = { clientId: m.clientId, redirectUri: q.redirect_uri, userId: ctx.user.id, scope, nonce: q.nonce, codeChallenge: q.code_challenge, authTime: Math.floor(Date.now() / 1000) };
    await putTemp('codes', sha256(code), rec, 120);
    await audit({ actorId: ctx.user.id, actorEmail: ctx.user.email, companyId: ctx.company.id, action: 'oidc.authorized', target: m.name, ip: clientIp(req) });
    return back({ code });
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
    const claims = claimsFor(user, company, groups, role, rec.scope);
    const idToken = await sign({ ...claims, nonce: rec.nonce, auth_time: rec.authTime, sid: String(user.sessionVersion) }, { issuer: iss, audience: m.clientId, subject: user.id, ttlSec: 3600 });
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
      return json({ sub: user.id, ...claimsFor(user, company, groups, moduleRole(user, company, groups, m), scope) }, 200, CORS);
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
