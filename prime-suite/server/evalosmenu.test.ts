// Atajos de Evalos · Configuración › Menú: opciones visibles por empresa.
// Ejecutar con:  npm test   (node --import tsx --test server/*.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRIME_STORE = 'file';
process.env.PRIME_DATA_DIR = mkdtempSync(join(tmpdir(), 'ps-evalosmenu-'));
process.env.PRIME_ISSUER = 'https://primesuite.test';
const ISS = 'https://primesuite.test';

const { handle } = await import('./app.ts');
const db = await import('./db.ts');
const { createSession } = await import('./crypto.ts');
const { EVALOS_SCREENS } = await import('./routes/evalos.ts');

const companyId = db.id();
const userId = db.id();
await db.Companies.put({ id: companyId, name: 'Digitek', code: 'pri5', enabledModules: [], moduleUrls: {}, createdAt: db.now() });
await db.Users.put({ id: userId, companyId, email: 'super@digitek.es', firstName: 'Super', lastName: '', passwordHash: 'x', role: 'superadmin', groupIds: [], status: 'active', sessionVersion: 1, createdAt: db.now() });
const COOKIE = `ps_session=${encodeURIComponent((await createSession('', { id: userId, sessionVersion: 1 })).token)}`;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await handle(new Request(`${ISS}${path}`, { method, headers: { cookie: COOKIE, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
};

test('por defecto el menú muestra todas las opciones', async () => {
  const me = await call('GET', '/api/evalos/me');
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.deepEqual(me.body.screens.map((s: any) => s.key), EVALOS_SCREENS.map((s) => s.key));
});

test('ocultar opciones: no salen en el menú; las claves desconocidas se ignoran', async () => {
  const r = await call('PUT', '/api/evalos/config', { companyId, engine: 'demo', hiddenScreens: ['correcciones', 'teletrabajo', 'no-existe'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.hiddenScreens.sort(), ['correcciones', 'teletrabajo']);
  const me = await call('GET', '/api/evalos/me');
  const keys = me.body.screens.map((s: any) => s.key);
  assert.ok(!keys.includes('correcciones') && !keys.includes('teletrabajo'));
  assert.equal(keys.length, EVALOS_SCREENS.length - 2);
});

test('guardar sin el campo conserva las opciones ocultas; con lista vacía se vuelven a mostrar todas', async () => {
  await call('PUT', '/api/evalos/config', { companyId, engine: 'demo', uppercase: false });
  assert.deepEqual((await call('GET', `/api/evalos/config?companyId=${companyId}`)).body.hiddenScreens.sort(), ['correcciones', 'teletrabajo']);
  await call('PUT', '/api/evalos/config', { companyId, engine: 'demo', hiddenScreens: [] });
  assert.equal((await call('GET', '/api/evalos/me')).body.screens.length, EVALOS_SCREENS.length);
});
