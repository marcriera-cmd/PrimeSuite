// Tests del cliente de EvalosRest y de Atajos de Evalos › Correcciones con conexión (Marcajes por API REST),
// contra un Evalos simulado (token OAuth2 client credentials + Booking/attendance + Report/filter PS_ANOMA + Incidence).
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
const BOOKINGS = [
  { CodeEmployee: '10000001', Date: '20261005', Time: '080200', Installation: 'LOC', Clock: '01', Lector: '01', Incidence: '00', InOut: 'E', HasAnomalies: false, DateTime: '2026-10-05T08:02:00Z' },
  { CodeEmployee: '10000001', Date: '20261005', Time: '170500', Installation: 'LOC', Clock: '01', Lector: '01', Incidence: '00', InOut: 'S', HasAnomalies: false },
  { CodeEmployee: '10000002', Date: '20261006', Time: '075900', Installation: 'LOC', Clock: '01', Lector: '01', Incidence: '00', HasAnomalies: true, DescriptionAnomaly: 'Marcaje impar' }
];
// Forma del listado PS_ANOMA: una fila por empleado y día con contadores (cabeceras del listado).
const REPORT = {
  Columns: ['Código', 'Nombre', 'FECHA', 'RETRASO', 'SALIDA ANTES', 'FUERA DE HORAS', 'AB. INJUSTIFICADO', 'M. IMPARES', 'FES.TRABAJADO', 'VAC.TRABAJADAS'],
  Rows: [
    ['10000001', 'RUIZ, EVA', '05/10/2026', '00:00', '00:00', '00:00', '00:00', 0, 0, 0],
    ['10000002', 'GARCIA, ANA', '06/10/2026', '00:15', '00:00', '00:00', '00:00', 1, 0, 0],
    ['10000003', 'PEREZ, LUIS', '07/10/2026', '00:00', '00:00', '00:00', '08:00', 0, 0, 0]
  ]
};
const posted: any[] = [];
const urls: string[] = [];
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
    if (req.url?.startsWith('/Digitek/EvalosRest133/api/v1/')) {
      auths.push(String(req.headers.authorization));
      urls.push(`${req.method} ${req.url}`);
      if (req.headers.authorization !== `Bearer ${current}` || revoke) {
        revoke = false;
        res.statusCode = 401;
        return res.end(JSON.stringify({ Message: 'Authorization has been denied for this request.' }));
      }
      const path = req.url.slice('/Digitek/EvalosRest133/api/v1'.length);
      if (req.method === 'GET' && path.startsWith('/Booking/attendance?')) return res.end(JSON.stringify(BOOKINGS));
      if (req.method === 'GET' && path.startsWith('/Booking/attendance/10000002?')) return res.end(JSON.stringify(BOOKINGS.filter((b) => b.CodeEmployee === '10000002')));
      if (req.method === 'GET' && path.startsWith('/Report/filter?')) return res.end(JSON.stringify(REPORT));
      if (req.method === 'GET' && path === '/Incidence') return res.end(JSON.stringify([{ Code: '02', Description: 'MEDICO' }, { Code: '00', Description: 'NORMAL' }]));
      if (req.method === 'POST' && path === '/Booking/attendance') {
        const items = JSON.parse(raw);
        posted.push(...items);
        res.statusCode = 201;
        return res.end(JSON.stringify(items.map((x: any) => ({ message: x.Time === '250000' ? 'Hora no válida' : 'OK' }))));
      }
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

const call = async (path: string, init: RequestInit = {}) => {
  const res = await handle(new Request(`${ISS}${path}`, { ...init, headers: { cookie: COOKIE, 'content-type': 'application/json', ...(init.headers || {}) } }));
  return { status: res.status, body: (await res.json()) as any };
};
const readers = () => call('/api/evalos/correcciones/marcajes?from=2026-10-01&to=2026-10-07');

test('sin API REST configurada: error 409 que dice dónde configurarla', async () => {
  await db.Modules.put(evalos8({ apiUrl: `${BASE}/Digitek/EvalosRest133`, tokenUrl: `${BASE}/Digitek/EvalosOAuth/token`, clientId: 'cid' })); // sin secreto
  const r = await readers();
  assert.equal(r.status, 409);
  assert.match(r.body.error || r.body.message, /Integraciones › Evalos8 › API REST/);
});

test('Marcajes: pide el token con client credentials y une marcajes y anomalías PS_ANOMA por empleado y día', async () => {
  await db.Modules.put(evalos8({ apiUrl: `${BASE}/Digitek/EvalosRest133/`, tokenUrl: `${BASE}/Digitek/EvalosOAuth/token`, clientId: 'cid', clientSecretEnc: await encryptSecret('csec') }));
  resetEvalosRestTokens();
  const r = await readers();
  assert.equal(r.status, 200);
  assert.equal(tokenCalls, 1);
  assert.ok(urls.includes('GET /Digitek/EvalosRest133/api/v1/Booking/attendance?dateAdd=01%2F10%2F2026&dateEnd=07%2F10%2F2026'));
  assert.ok(urls.some((u) => decodeURIComponent(u) === "GET /Digitek/EvalosRest133/api/v1/Report/filter?id=PS_ANOMA&dateAdd=01/10/2026&dateEnd=07/10/2026&filter=EM_CODI<>''"), 'filter siempre presente');
  assert.ok(!urls.some((u) => u.includes('/Reader')), 'ya no se llama a GetReaders');
  const m = r.body.marcajes as any[];
  assert.deepEqual(m.map((x) => x.id), ['10000003|2026-10-07', '10000002|2026-10-06', '10000001|2026-10-05']);
  assert.deepEqual(m[2].punches.map((p: any) => `${p.time}${p.type}`), ['08:02E', '17:05S']);
  assert.equal(m[2].status, 'OK');
  assert.equal(m[1].employeeName, 'GARCIA, ANA');
  assert.equal(m[1].status, 'INCIDENCIA');
  assert.deepEqual(m[1].issues, ['Retraso 00:15 · Marcajes impares', 'Marcaje impar']);
  assert.equal(m[0].punches.length, 0);
  assert.deepEqual(m[0].issues, ['Absentismo injustificado 08:00']);
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

test('Marcajes de un empleado: filtra Booking por código y el listado con EM_CODI', async () => {
  urls.length = 0;
  const r = await call('/api/evalos/correcciones/marcajes?from=2026-10-01&to=2026-10-07&employee=10000002');
  assert.equal(r.status, 200);
  assert.ok(urls.some((u) => u.includes('/Booking/attendance/10000002?')));
  assert.ok(urls.some((u) => decodeURIComponent(u).includes("/Report/filter?id=PS_ANOMA&dateAdd=01/10/2026&dateEnd=07/10/2026&filter=EM_CODI='10000002'")));
  assert.deepEqual(r.body.marcajes.map((x: any) => x.id), ['10000002|2026-10-06']);
});

test('Marcajes: periodo y empleado se validan', async () => {
  assert.equal((await call('/api/evalos/correcciones/marcajes?from=2026-10-07&to=2026-10-01')).status, 400);
  assert.equal((await call('/api/evalos/correcciones/marcajes?from=2026-01-01&to=2026-03-01')).status, 400);
  assert.equal((await call("/api/evalos/correcciones/marcajes?from=2026-10-01&to=2026-10-02&employee=1'OR'1")).status, 400);
});

test('Corregir: añade marcajes manuales con POST /Booking/attendance (Debug MAN)', async () => {
  const r = await call('/api/evalos/correcciones/marcajes', { method: 'POST', body: JSON.stringify({ employee: '10000002', date: '2026-10-06', punches: [{ time: '17:00', incidence: '' }, { time: '18:30', incidence: '02' }] }) });
  assert.equal(r.status, 201);
  assert.deepEqual(posted, [
    { CodeEmployee: '10000002', Date: '20261006', Time: '170000', Incidence: '00', Debug: 'MAN' },
    { CodeEmployee: '10000002', Date: '20261006', Time: '183000', Incidence: '02', Debug: 'MAN' }
  ]);
  assert.equal((await call('/api/evalos/correcciones/marcajes', { method: 'POST', body: JSON.stringify({ employee: '10000002', date: '2026-10-06', punches: [{ time: '25:00' }] }) })).status, 400);
});

test('Incidencias para el desplegable', async () => {
  const r = await call('/api/evalos/correcciones/incidencias');
  assert.deepEqual(r.body.items, [{ code: '00', name: 'NORMAL' }, { code: '02', name: 'MEDICO' }]);
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
