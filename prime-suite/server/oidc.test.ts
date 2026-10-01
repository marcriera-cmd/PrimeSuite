// Tests del flujo OIDC de Prime ID: discovery, flujo híbrido con form_post,
// nonce obligatorio, c_hash/at_hash, rechazo de híbrido no autorizado y flujo code sin regresiones.
// Ejecutar con:  npm test   (node --import tsx --test server/*.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Module } from './db.ts';

// Almacén en ficheros temporal y emisor fijo, ANTES de importar la app.
process.env.PRIME_STORE = 'file';
process.env.PRIME_DATA_DIR = mkdtempSync(join(tmpdir(), 'ps-oidc-'));
process.env.PRIME_ISSUER = 'https://primesuite.netlify.app';
const ISS = 'https://primesuite.netlify.app';

const { handle } = await import('./app.ts');
const db = await import('./db.ts');
const { sha256, createSession, halfHashS256 } = await import('./crypto.ts');
const jose = await import('jose');

const REDIR_EVALOS = 'https://evalos-c.digitekcloud.com:805/Digitek/Evalos8/Account/Login.aspx';
const REDIR_CODE = 'https://app.example.test/cb';
const SECRET = 'test-secret-no-real';

// ---- Semilla de datos ----
const companyId = db.id();
const userId = db.id();
const evalosId = db.id();
const codeOnlyId = db.id();

await db.Companies.put({ id: companyId, name: 'Digitek', code: 'pri5', enabledModules: [evalosId, codeOnlyId], moduleUrls: {}, createdAt: db.now() });
await db.Users.put({
  id: userId, companyId, email: 'marc@digitek.es', firstName: 'Marc', lastName: 'Riera',
  passwordHash: 'x', role: 'user', groupIds: [], status: 'active', sessionVersion: 1, createdAt: db.now()
});

function baseModule(id: string, clientId: string, name: string, redirect: string, extra: Partial<Module>) {
  return {
    id, clientId, name, description: '', categoryId: null, initials: name.slice(0, 2).toUpperCase(), color: '#243A4D',
    url: redirect, openMode: 'tab' as const, authMethod: 'oidc' as const, tokenDelivery: 'fragment' as const, tokenParam: 'prime_token',
    tokenTtlSec: 60, clientSecretHash: sha256(SECRET), redirectUris: [redirect], postLogoutRedirectUris: [],
    defaultRole: 'user' as const, widgets: [], enabled: true, order: 50, createdAt: db.now(), updatedAt: db.now(), ...extra
  };
}
await db.Modules.put(baseModule(evalosId, 'evalos8', 'Evalos8', REDIR_EVALOS, { responseTypes: ['code', 'code id_token', 'code id_token token'], alwaysEmail: true }));
await db.Modules.put(baseModule(codeOnlyId, 'codeonly', 'Code Only', REDIR_CODE, { responseTypes: ['code'] }));

const { token: sessionToken } = await createSession('', { id: userId, sessionVersion: 1 });
const COOKIE = `ps_session=${encodeURIComponent(sessionToken)}`;

function authorize(params: Record<string, string>, withCookie = true) {
  const qs = new URLSearchParams(params).toString();
  return handle(new Request(`${ISS}/oidc/authorize?${qs}`, { headers: withCookie ? { cookie: COOKIE } : {} }));
}
function parseHiddenInputs(htmlOut: string) {
  const out: Record<string, string> = {};
  for (const m of htmlOut.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) {
    out[m[1]] = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  return out;
}
async function verifyIdToken(idToken: string, audience: string) {
  const jwksJson = await (await handle(new Request(`${ISS}/.well-known/jwks.json`))).json();
  const keyset = jose.createLocalJWKSet(jwksJson as any);
  return jose.jwtVerify(idToken, keyset, { issuer: ISS, audience });
}
// Cálculo independiente de c_hash/at_hash para contrastar con el servidor.
const half = (v: string) => createHash('sha256').update(v, 'ascii').digest().subarray(0, 16).toString('base64url');

test('discovery anuncia híbrido y response_modes', async () => {
  const d: any = await (await handle(new Request(`${ISS}/.well-known/openid-configuration`))).json();
  assert.equal(d.issuer, ISS);
  assert.deepEqual(d.response_types_supported, ['code', 'code id_token', 'code id_token token']);
  assert.deepEqual(d.response_modes_supported, ['query', 'fragment', 'form_post']);
  assert.ok(d.id_token_signing_alg_values_supported.includes('RS256'));
});

test('vector conocido de at_hash (OIDC Core A.3)', () => {
  // access_token de ejemplo del estándar → at_hash esperado con RS256 (SHA-256, 128 bits izq.)
  assert.equal(halfHashS256('jHkWEdUXMU1BwAsC4vtUsZwnNvTIxEl0z9K3vx5KF0Y'), '77QmUPtjPfzWtF2AnpK9RQ');
});

test('flujo híbrido con form_post devuelve form auto-enviado con code, id_token, access_token', async () => {
  const res = await authorize({
    client_id: 'evalos8', redirect_uri: REDIR_EVALOS, response_type: 'code id_token token',
    response_mode: 'form_post', scope: 'openid profile email', state: 'abc', nonce: 'xyz'
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html; charset=utf-8/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('pragma'), 'no-cache');
  const htmlOut = await res.text();
  assert.ok(htmlOut.includes(`<form method="post" action="${REDIR_EVALOS}">`));
  assert.ok(htmlOut.includes('<noscript>'));

  const f = parseHiddenInputs(htmlOut);
  assert.equal(f.state, 'abc');
  assert.equal(f.token_type, 'Bearer');
  assert.equal(f.expires_in, '3600');
  assert.equal(f.scope, 'openid profile email');
  assert.ok(f.code && f.id_token && f.access_token);

  const { payload, protectedHeader } = await verifyIdToken(f.id_token, 'evalos8');
  assert.equal(protectedHeader.alg, 'RS256');
  assert.ok(protectedHeader.kid);
  assert.equal(payload.nonce, 'xyz');
  assert.equal(payload.email, 'marc@digitek.es');
  assert.equal(payload.email_verified, true);
  assert.ok(payload.sub && payload.iat && payload.exp && payload.nbf && payload.auth_time);
  // c_hash y at_hash contrastados con un cálculo independiente
  assert.equal(payload.c_hash, half(f.code));
  assert.equal(payload.at_hash, half(f.access_token));
});

test('email siempre presente aunque solo se pida scope openid (Katana) y access_token válido en userinfo', async () => {
  const res = await authorize({
    client_id: 'evalos8', redirect_uri: REDIR_EVALOS, response_type: 'code id_token token',
    response_mode: 'form_post', scope: 'openid', state: 's2', nonce: 'n2'
  });
  const f = parseHiddenInputs(await res.text());
  const { payload } = await verifyIdToken(f.id_token, 'evalos8');
  assert.equal(payload.email, 'marc@digitek.es'); // alwaysEmail

  const info: any = await (await handle(new Request(`${ISS}/oidc/userinfo`, { headers: { authorization: `Bearer ${f.access_token}` } }))).json();
  assert.equal(info.sub, userId);
  assert.equal(info.email, 'marc@digitek.es');
});

test('nonce es obligatorio en el flujo híbrido', async () => {
  const res = await authorize({
    client_id: 'evalos8', redirect_uri: REDIR_EVALOS, response_type: 'code id_token',
    response_mode: 'form_post', scope: 'openid'
  }); // sin nonce
  const f = parseHiddenInputs(await res.text());
  assert.equal(f.error, 'invalid_request');
});

test('se rechaza el híbrido para un cliente no autorizado', async () => {
  const res = await authorize({
    client_id: 'codeonly', redirect_uri: REDIR_CODE, response_type: 'code id_token',
    response_mode: 'fragment', scope: 'openid', nonce: 'n'
  });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location') || '');
  const hash = new URLSearchParams(loc.hash.slice(1));
  assert.equal(hash.get('error'), 'unauthorized_client');
});

test('el flujo code existente sigue funcionando (authorize + token)', async () => {
  const res = await authorize({
    client_id: 'codeonly', redirect_uri: REDIR_CODE, response_type: 'code',
    scope: 'openid profile email', state: 'st'
  });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location') || '');
  const code = loc.searchParams.get('code');
  assert.ok(code);
  assert.equal(loc.searchParams.get('state'), 'st');
  assert.equal(loc.hash, ''); // code va en query, no en fragmento

  const tok: any = await (await handle(new Request(`${ISS}/oidc/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`codeonly:${SECRET}`).toString('base64') },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIR_CODE }).toString()
  }))).json();
  assert.ok(tok.id_token && tok.access_token);
  assert.equal(tok.token_type, 'Bearer');
  const { payload } = await verifyIdToken(tok.id_token, 'codeonly');
  assert.equal(payload.email, 'marc@digitek.es');

  // el code es de un solo uso
  const reuse: any = await (await handle(new Request(`${ISS}/oidc/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`codeonly:${SECRET}`).toString('base64') },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIR_CODE }).toString()
  }))).json();
  assert.equal(reuse.error, 'invalid_grant');
});
