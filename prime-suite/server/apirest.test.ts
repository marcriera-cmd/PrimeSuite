// Tests de Integraciones › API REST: guardado (secreto cifrado y nunca devuelto), prueba de conexión OAuth2
// client credentials contra un servidor de token simulado, y precarga de las URLs en la integración Evalos8.
// Ejecutar con:  npm test   (node --import tsx --test server/*.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Module } from './db.ts';

process.env.PRIME_STORE = 'file';
process.env.PRIME_DATA_DIR = mkdtempSync(join(tmpdir(), 'ps-apirest-'));
process.env.PRIME_ISSUER = 'https://primesuite.test';
process.env.PRIME_ALLOW_PRIVATE_FETCH = '1'; // el servidor de token simulado escucha en 127.0.0.1
const ISS = 'https://primesuite.test';

const { handle } = await import('./app.ts');
const db = await import('./db.ts');
const { createSession, decryptSecret } = await import('./crypto.ts');

// Servidor OAuth2 simulado: acepta client_credentials con id/secret concretos.
const received: URLSearchParams[] = [];
const oauth = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const p = new URLSearchParams(raw);
    received.push(p);
    res.setHeader('content-type', 'application/json');
    if (p.get('grant_type') === 'client_credentials' && p.get('client_id') === 'id-ok' && p.get('client_secret') === 'secreto-ok') {
      res.end(JSON.stringify({ access_token: 'tok-123', token_type: 'bearer', expires_in: 3599 }));
    } else {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'invalid_client' }));
    }
  });
});
await new Promise<void>((r) => oauth.listen(0, '127.0.0.1', r));
const TOKEN_URL = `http://127.0.0.1:${(oauth.address() as AddressInfo).port}/Digitek/EvalosOAuth/token`;

const companyId = db.id();
const superId = db.id();
const adminId = db.id();
await db.Companies.put({ id: companyId, name: 'Digitek', code: 'pri5', enabledModules: [], moduleUrls: {}, createdAt: db.now() });
for (const [id, role] of [[superId, 'superadmin'], [adminId, 'admin']] as const) {
  await db.Users.put({ id, companyId, email: `${role}@digitek.es`, firstName: role, lastName: '', passwordHash: 'x', role, groupIds: [], status: 'active', sessionVersion: 1, createdAt: db.now() });
}
const cookie = async (id: string) => `ps_session=${encodeURIComponent((await createSession('', { id, sessionVersion: 1 })).token)}`;
const SUPER = await cookie(superId);
const ADMIN = await cookie(adminId);

const evalosId = db.id();
const otherId = db.id();
const baseMod = (id: string, clientId: string, name: string): Module => ({
  id, clientId, name, description: '', categoryId: null, initials: 'EV', color: '#243A4D', url: 'https://evalos.test/', openMode: 'iframe',
  authMethod: 'oidc', tokenDelivery: 'fragment', tokenParam: 'prime_token', tokenTtlSec: 60, redirectUris: [], postLogoutRedirectUris: [],
  defaultRole: 'user', widgets: [], enabled: true, order: 50, createdAt: db.now(), updatedAt: db.now()
} as Module);
await db.Modules.put(baseMod(evalosId, 'evalos8', 'Evalos8'));
await db.Modules.put(baseMod(otherId, 'otra', 'Otra'));

const call = (method: string, path: string, c: string, b?: unknown) =>
  handle(new Request(`${ISS}${path}`, { method, headers: { cookie: c, 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }));
const getMod = async (id: string, c = SUPER) => (await call('GET', `/api/admin/modules/${id}`, c)).json() as Promise<any>;

test('Evalos8 trae precargadas las URLs de EvalosRest y de los servicios SOAP, sin credenciales; las demás integraciones no', async () => {
  const m = await getMod(evalosId);
  assert.deepEqual(m.apiRest, {
    apiUrl: 'https://evalos-d.digitekcloud.com/Digitek/EvalosRest133',
    tokenUrl: 'https://evalos-c.digitekcloud.com:813/Digitek/EvalosOAuth/token',
    soapUrl: 'https://evalos-d.digitekcloud.com/Digitek/suiteclient133/servicioscliente.asmx',
    clientId: '', hasSecret: false, updatedAt: m.apiRest.updatedAt, updatedBy: 'Prime Suite'
  });
  assert.equal((await getMod(otherId)).apiRest, undefined);
});

test('la precarga es única: si se borra la sección no vuelve a aparecer', async () => {
  const m = await getMod(otherId);
  await call('PUT', `/api/admin/modules/${evalosId}`, SUPER, { ...(await getMod(evalosId)), apiRest: null });
  assert.equal((await getMod(evalosId)).apiRest, undefined);
  void m;
});

test('guardar: el secreto se cifra, nunca se devuelve y se conserva si no se envía', async () => {
  const body = { ...(await getMod(evalosId)), apiRest: { apiUrl: 'https://evalos-d.digitekcloud.com/Digitek/EvalosRest133/', tokenUrl: TOKEN_URL, clientId: 'id-ok', clientSecret: 'secreto-ok' } };
  const res = await call('PUT', `/api/admin/modules/${evalosId}`, SUPER, body);
  assert.equal(res.status, 200);
  const out: any = await res.json();
  assert.equal(out.apiRest.hasSecret, true);
  assert.equal(out.apiRest.apiUrl, 'https://evalos-d.digitekcloud.com/Digitek/EvalosRest133', 'sin barra final');
  assert.ok(!JSON.stringify(out).includes('secreto-ok'));
  const stored = (await db.Modules.get(evalosId))!.apiRest!;
  assert.ok(stored.clientSecretEnc && !stored.clientSecretEnc.includes('secreto-ok'));
  assert.equal(await decryptSecret(stored.clientSecretEnc!), 'secreto-ok');
  assert.equal(stored.updatedBy, 'superadmin@digitek.es');

  // Guardar otra vez sin secreto: se conserva.
  await call('PUT', `/api/admin/modules/${evalosId}`, SUPER, { ...(await getMod(evalosId)), name: 'Evalos8' });
  assert.equal((await db.Modules.get(evalosId))!.apiRest!.clientSecretEnc, stored.clientSecretEnc);
  // Ni un administrador de empresa lo ve.
  assert.ok(!JSON.stringify(await getMod(evalosId, ADMIN)).includes('clientSecretEnc'));
});

test('probar conexión con el secreto guardado: pide el token con client_credentials y no lo devuelve', async () => {
  const r: any = await (await call('POST', `/api/admin/modules/${evalosId}/apirest/test`, SUPER, {})).json();
  assert.equal(r.ok, true);
  assert.equal(r.expiresIn, 3599);
  assert.ok(!JSON.stringify(r).includes('tok-123'));
  const last = received.at(-1)!;
  assert.equal(last.get('grant_type'), 'client_credentials');
  assert.equal(last.get('client_id'), 'id-ok');
  assert.equal(last.get('client_secret'), 'secreto-ok');
});

test('probar conexión con datos del formulario sin guardar: secreto incorrecto → error claro', async () => {
  const r: any = await (await call('POST', `/api/admin/modules/${evalosId}/apirest/test`, SUPER, { tokenUrl: TOKEN_URL, clientId: 'id-ok', clientSecret: 'malo' })).json();
  assert.equal(r.ok, false);
  assert.match(r.error, /400 · invalid_client/);
  assert.match(r.error, /Client ID y Client Secret/);
});

test('URL token inalcanzable → error de conexión, no excepción', async () => {
  const r: any = await (await call('POST', `/api/admin/modules/${evalosId}/apirest/test`, SUPER, { tokenUrl: 'http://127.0.0.1:1/token', clientId: 'x', clientSecret: 'y' })).json();
  assert.equal(r.ok, false);
  assert.match(r.error, /No se pudo conectar/);
});

test('borrar el secreto, validación de URLs y permisos', async () => {
  await call('PUT', `/api/admin/modules/${evalosId}`, SUPER, { ...(await getMod(evalosId)), apiRest: { ...(await getMod(evalosId)).apiRest, clearSecret: true } });
  assert.equal((await getMod(evalosId)).apiRest.hasSecret, false);
  const bad = await call('PUT', `/api/admin/modules/${evalosId}`, SUPER, { ...(await getMod(evalosId)), apiRest: { apiUrl: 'ftp://x', tokenUrl: TOKEN_URL, clientId: 'a' } });
  assert.equal(bad.status, 400);
  // Solo el superadministrador puede probar o cambiar integraciones.
  assert.equal((await call('POST', `/api/admin/modules/${evalosId}/apirest/test`, ADMIN, {})).status, 403);
  oauth.close();
});
