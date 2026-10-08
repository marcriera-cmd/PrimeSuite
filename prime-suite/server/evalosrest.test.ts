// Tests del cliente de EvalosRest y de la prueba GetReaders de Atajos de Evalos › Correcciones,
// contra un Evalos simulado (token OAuth2 client credentials + GET /api/v1/Reader).
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
process.env.PRIME_DATA_DIR = mkdtempSync(join(tmpdir(), 'ps-evalosrest-'));
process.env.PRIME_ISSUER = 'https://primesuite.test';
process.env.PRIME_ALLOW_PRIVATE_FETCH = '1';
const ISS = 'https://primesuite.test';

const { handle } = await import('./app.ts');
const db = await import('./db.ts');
const { createSession, encryptSecret } = await import('./crypto.ts');
const { resetEvalosRestTokens } = await import('./evalosrest.ts');

// Evalos simulado
let tokenCalls = 0;
let revoke = false;          // el siguiente GET con el token actual devuelve 401
let current = '';
const auths: string[] = [];
const READERS = [
  { Installation: '001', Clock: '01', Lector: '1', Description: 'ENTRADA PRINCIPAL', Ip: '10.0.0.5' },
  { Installation: '001', Clock: '02', Lector: '1', Description: 'COMEDOR', Ip: '10.0.0.6' }
];
const srv = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/Digitek/EvalosOAuth/token') {
      const p = new URLSearchParams(raw);
      if (p.get('grant_type') !== 'client_credentials' || p.get('client_id') !== 'cid' || p.get('client_secret') !== 'csec') {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'invalid_client' }));
      }
      tokenCalls++;
      current = `tok-${tokenCalls}`;
      return res.end(JSON.stringify({ access_token: current, token_type: 'bearer', expires_in: 3599 }));
    }
    if (req.url === '/Digitek/EvalosRest133/api/v1/Reader') {
      auths.push(String(req.headers.authorization));
      if (req.headers.authorization !== `Bearer ${current}` || revoke) {
        revoke = false;
        res.statusCode = 401;
        return res.end(JSON.stringify({ Message: 'Authorization has been denied for this request.' }));
      }
      return res.end(JSON.stringify(READERS));
    }
    res.statusCode = 404;
    res.end('{}');
  });
});
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;

const companyId = db.id();
const userId = db.id();
await db.Companies.put({ id: companyId, name: 'Digitek', code: 'pri5', enabledModules: [], moduleUrls: {}, createdAt: db.now() });
await db.Users.put({ id: userId, companyId, email: 'super@digitek.es', firstName: 'Super', lastName: '', passwordHash: 'x', role: 'superadmin', groupIds: [], status: 'active', sessionVersion: 1, createdAt: db.now() });
const COOKIE = `ps_session=${encodeURIComponent((await createSession('', { id: userId, sessionVersion: 1 })).token)}`;

const evalosId = db.id();
const evalos8 = (apiRest?: Module['apiRest']): Module => ({
  id: evalosId, clientId: 'evalos8', name: 'Evalos8', description: '', categoryId: null, initials: 'EV', color: '#243A4D', url: `${BASE}/`, openMode: 'iframe',
  authMethod: 'oidc', tokenDelivery: 'fragment', tokenParam: 'prime_token', tokenTtlSec: 60, redirectUris: [], postLogoutRedirectUris: [],
  defaultRole: 'user', widgets: [], enabled: true, order: 50, createdAt: db.now(), updatedAt: db.now(), apiRest
} as Module);

const readers = async () => {
  const res = await handle(new Request(`${ISS}/api/evalos/rest/readers`, { headers: { cookie: COOKIE } }));
  return { status: res.status, body: (await res.json()) as any };
};

test('sin API REST configurada: error 409 que dice dónde configurarla', async () => {
  await db.Modules.put(evalos8({ apiUrl: `${BASE}/Digitek/EvalosRest133`, tokenUrl: `${BASE}/Digitek/EvalosOAuth/token`, clientId: 'cid' })); // sin secreto
  const r = await readers();
  assert.equal(r.status, 409);
  assert.match(r.body.error || r.body.message, /Integraciones › Evalos8 › API REST/);
});

test('GetReaders: pide el token con client credentials y devuelve los terminales', async () => {
  await db.Modules.put(evalos8({ apiUrl: `${BASE}/Digitek/EvalosRest133/`, tokenUrl: `${BASE}/Digitek/EvalosOAuth/token`, clientId: 'cid', clientSecretEnc: await encryptSecret('csec') }));
  resetEvalosRestTokens();
  const r = await readers();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, READERS);
  assert.equal(r.body.url, `${BASE}/Digitek/EvalosRest133/api/v1/Reader`);
  assert.equal(tokenCalls, 1);
  assert.ok(!JSON.stringify(r.body).includes('tok-'), 'el token no llega al navegador');
});

test('el token se reutiliza entre llamadas', async () => {
  await readers();
  await readers();
  assert.equal(tokenCalls, 1);
});

test('ante un 401 pide un token nuevo y reintenta una vez', async () => {
  revoke = true;
  const r = await readers();
  assert.equal(r.status, 200);
  assert.equal(tokenCalls, 2);
  assert.deepEqual(auths.slice(-2), ['Bearer tok-1', 'Bearer tok-2']);
});

test('credenciales incorrectas: error claro', async () => {
  await db.Modules.put(evalos8({ apiUrl: `${BASE}/Digitek/EvalosRest133`, tokenUrl: `${BASE}/Digitek/EvalosOAuth/token`, clientId: 'cid', clientSecretEnc: await encryptSecret('mal') }));
  const r = await readers();
  assert.equal(r.status, 502);
  assert.match(r.body.error || r.body.message, /no ha dado el token \(400 · invalid_client\)/);
});

test('URL API mal: 404 con pista', async () => {
  await db.Modules.put(evalos8({ apiUrl: `${BASE}/Digitek/Otra`, tokenUrl: `${BASE}/Digitek/EvalosOAuth/token`, clientId: 'cid', clientSecretEnc: await encryptSecret('csec') }));
  resetEvalosRestTokens();
  const r = await readers();
  assert.equal(r.status, 502);
  assert.match(r.body.error || r.body.message, /respondió 404.*Revisa la URL API/);
  srv.close();
});
