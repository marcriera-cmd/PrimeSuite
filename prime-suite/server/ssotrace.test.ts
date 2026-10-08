// Tests del log de inicio de sesión (depuración de SSO): qué pasos se apuntan, que no se guardan secretos ni tokens,
// que solo funciona con la casilla activada y quién puede verlo.
// Ejecutar con:  npm test   (node --import tsx --test server/*.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Module } from './db.ts';

process.env.PRIME_STORE = 'file';
process.env.PRIME_DATA_DIR = mkdtempSync(join(tmpdir(), 'ps-ssotrace-'));
process.env.PRIME_ISSUER = 'https://primesuite.test';
const ISS = 'https://primesuite.test';

const { handle } = await import('./app.ts');
const db = await import('./db.ts');
const { sha256, createSession } = await import('./crypto.ts');
const { ssoTrace, readTrace } = await import('./ssotrace.ts');

const SECRET = 'secreto-de-prueba';
const REDIR = 'https://evalos-d.digitekcloud.com/Digitek/MyEvalosLogin133/Account/Login.aspx';
const companyId = db.id();
const userId = db.id();
const otherId = db.id();
const adminId = db.id();
const myId = db.id();
const pubId = db.id();
const offId = db.id();
const ptId = db.id();

await db.Companies.put({ id: companyId, name: 'Digitek', code: 'pri5', enabledModules: [myId, pubId, offId, ptId], moduleUrls: {}, createdAt: db.now() });
const mkUser = (id: string, email: string, role: 'user' | 'superadmin') => db.Users.put({
  id, companyId, email, firstName: 'Ana', lastName: 'García', passwordHash: 'x', role, groupIds: [], status: 'active', sessionVersion: 1, createdAt: db.now()
});
await mkUser(userId, 'ana@digitek.es', 'user');
await mkUser(otherId, 'luis@digitek.es', 'user');
await mkUser(adminId, 'admin@digitek.es', 'superadmin');

function mod(id: string, clientId: string, extra: Partial<Module>): Module {
  return {
    id, clientId, name: clientId, description: '', categoryId: null, initials: 'MY', color: '#243A4D', url: REDIR, openMode: 'iframe', authMethod: 'oidc',
    tokenDelivery: 'fragment', tokenParam: 'prime_token', tokenTtlSec: 60, clientSecretHash: sha256(SECRET), redirectUris: [REDIR], postLogoutRedirectUris: [],
    responseTypes: ['code', 'code id_token', 'code id_token token'], alwaysEmail: true, defaultRole: 'user', widgets: [], enabled: true, order: 50,
    createdAt: db.now(), updatedAt: db.now(), ssoDebug: true, ...extra
  } as Module;
}
await db.Modules.put(mod(myId, 'myevalos', {}));
await db.Modules.put(mod(pubId, 'publica', { clientSecretHash: undefined }));
await db.Modules.put(mod(offId, 'sinlog', { ssoDebug: false }));
await db.Modules.put(mod(ptId, 'conprime', { authMethod: 'prime_token', redirectUris: [] }));

const cookieFor = async (id: string) => `ps_session=${encodeURIComponent((await createSession('', { id, sessionVersion: 1 })).token)}`;
const ANA = await cookieFor(userId);
const LUIS = await cookieFor(otherId);
const ADMIN = await cookieFor(adminId);

const authorize = (params: Record<string, string>, cookie?: string) =>
  handle(new Request(`${ISS}/oidc/authorize?${new URLSearchParams(params)}`, { headers: cookie ? { cookie } : {} }));
const hidden = (html: string) => Object.fromEntries([...html.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const trace = async (moduleId: string, cookie: string, q = '') => (await handle(new Request(`${ISS}/api/sso/trace/${moduleId}?${q}`, { headers: { cookie } }))).json() as Promise<any>;

const KATANA = { client_id: 'myevalos', redirect_uri: REDIR, response_type: 'code id_token token', response_mode: 'form_post', scope: 'openid', state: 's', nonce: 'n' };

test('login correcto: pasos con el usuario identificado y los datos enviados, sin tokens ni secretos', async () => {
  const res = await authorize(KATANA, ANA);
  const f = hidden(await res.text());
  assert.ok(f.id_token);
  // La app canjea el code con su secreto.
  await handle(new Request(`${ISS}/oidc/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: f.code, redirect_uri: REDIR, client_id: 'myevalos', client_secret: SECRET }).toString()
  }));
  const ev = await readTrace(myId);
  const titles = ev.map((e) => e.title);
  assert.ok(titles.includes('La app pide iniciar sesión (authorize)'));
  assert.ok(titles.includes('Petición válida'));
  assert.ok(titles.includes('Usuario identificado en Prime ID'));
  assert.ok(titles.includes('Datos del usuario en el id_token'));
  assert.ok(titles.includes('Se devuelve el login a la app'));
  assert.ok(titles.includes('La app canjea el code y recibe los datos del usuario'));
  const idt = ev.find((e) => e.title === 'Datos del usuario en el id_token')!;
  assert.equal(idt.data!.email, 'ana@digitek.es');
  assert.equal(idt.data!.sub, userId);
  assert.equal(idt.data!.aud, 'myevalos');
  assert.equal(idt.data!.nonce, '(presente)');
  const raw = JSON.stringify(ev);
  assert.ok(!raw.includes(f.id_token) && !raw.includes(f.code) && !raw.includes(f.access_token), 'no se guardan tokens ni code');
  assert.ok(!raw.includes(SECRET), 'no se guarda el secreto');
});

test('cliente público sin PKCE: el log explica el error y cómo arreglarlo', async () => {
  await authorize({ ...KATANA, client_id: 'publica' }, ANA);
  const err = (await readTrace(pubId)).find((e) => e.status === 'error')!;
  assert.match(err.title, /invalid_request/);
  assert.match(err.detail!, /PKCE obligatorio/);
  assert.match(err.detail!, /Generar secreto/);
});

test('redirect_uri distinta: se apunta la recibida y las configuradas', async () => {
  await authorize({ ...KATANA, redirect_uri: 'http://evalos-d.digitekcloud.com/MyEvalosLogin133/Account/Login.aspx' }, ANA);
  const err = (await readTrace(myId)).filter((e) => e.title === 'redirect_uri no permitida').pop()!;
  assert.equal(err.data!.recibida, 'http://evalos-d.digitekcloud.com/MyEvalosLogin133/Account/Login.aspx');
  assert.deepEqual(err.data!.configuradas, [REDIR]);
});

test('secreto incorrecto al canjear: invalid_client en el log', async () => {
  const f = hidden(await (await authorize(KATANA, ANA)).text());
  await handle(new Request(`${ISS}/oidc/token`, {
    method: 'POST', headers: { authorization: `Basic ${Buffer.from('myevalos:otro').toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: f.code, redirect_uri: REDIR }).toString()
  }));
  const e = (await readTrace(myId)).pop()!;
  assert.match(e.title, /invalid_client/);
  assert.equal(e.data!.autenticacion, 'client_secret_basic');
});

test('sin sesión: se apunta como anónimo y se ve solo desde que se abrió la app', async () => {
  const since = new Date(Date.now() - 1000).toISOString();
  const res = await authorize(KATANA);
  assert.equal(res.status, 302);
  const mine = await trace(myId, ANA, `since=${encodeURIComponent(since)}`);
  const anon = mine.events.find((e: any) => e.title === 'No hay sesión en Prime ID');
  assert.ok(anon);
  assert.equal(anon.userId, null);
});

test('con la casilla desactivada no se apunta nada', async () => {
  await authorize({ ...KATANA, client_id: 'sinlog' }, ANA);
  assert.equal((await readTrace(offId)).length, 0);
  assert.deepEqual(await trace(offId, ANA), { enabled: false, events: [] });
});

test('cada usuario ve solo sus pasos; el superadministrador ve todos', async () => {
  await authorize(KATANA, LUIS);
  const ana = await trace(myId, ANA);
  assert.ok(ana.events.length > 0);
  assert.ok(ana.events.every((e: any) => e.userId === userId || e.userId === null));
  assert.ok(!JSON.stringify(ana.events).includes('luis@digitek.es'));
  const all = await trace(myId, ADMIN, 'all=1');
  assert.ok(all.events.some((e: any) => e.userEmail === 'luis@digitek.es'));
  // Un usuario normal no puede pedir los de todos.
  const tried = await trace(myId, ANA, 'all=1');
  assert.ok(!JSON.stringify(tried.events).includes('luis@digitek.es'));
});

test('Prime Token: el lanzamiento apunta el token emitido y el lanzamiento avisa al portal', async () => {
  const r: any = await (await handle(new Request(`${ISS}/api/sso/launch`, {
    method: 'POST', headers: { cookie: ANA, 'content-type': 'application/json' }, body: JSON.stringify({ moduleId: ptId })
  }))).json();
  assert.equal(r.ssoDebug, true);
  const ev = await readTrace(ptId);
  const emitted = ev.find((e) => e.title === 'Prime Token emitido')!;
  assert.equal(emitted.data!.email, 'ana@digitek.es');
  assert.equal(emitted.data!.aud, 'conprime');
  const token = decodeURIComponent(new URL(r.url).hash.split('=')[1]);
  assert.ok(!JSON.stringify(ev).includes(token));
  // Canje por la app
  await handle(new Request(`${ISS}/api/sso/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }));
  assert.ok((await readTrace(ptId)).some((e) => e.title === 'La app canjea el Prime Token'));
});

test('los datos sensibles se ocultan aunque lleguen en el paso', async () => {
  await ssoTrace({ id: myId, ssoDebug: true }, { channel: 'app', status: 'info', title: 'prueba', data: { client_secret: 'x', password: 'y', id_token: 'z', email: 'a@b.c' } });
  const e = (await readTrace(myId)).pop()!;
  assert.deepEqual(e.data, { client_secret: '(oculto)', password: '(oculto)', id_token: '(oculto)', email: 'a@b.c' });
});
