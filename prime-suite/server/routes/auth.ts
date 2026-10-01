// Primera configuración, login, logout y perfil.
import { Router, json, body, HttpError, cookie, isSecure, origin, clientIp } from '../http.ts';
import { Users, Companies, Categories, findUserByLogin, audit, id, now, getSettings, type User } from '../db.ts';
import { createSession, hashPassword, checkPassword, dummyCheck, SESSION_COOKIE } from '../crypto.ts';
import { requireUser, publicUser, accessibleModules } from '../access.ts';
import { seed } from '../seed.ts';

export function validPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= 10;
}
export const PASSWORD_RULE = 'La contraseña debe tener al menos 10 caracteres';

async function needsSetup() {
  return (await Users.all()).length === 0;
}

async function startSession(req: Request, user: User) {
  const { token, ttl } = await createSession(origin(req), user);
  return cookie(SESSION_COOKIE, token, { maxAge: ttl, secure: isSecure(req) });
}

export function authRoutes(r: Router) {
  r.get('/api/setup/status', async () => json({ needsSetup: await needsSetup() }));

  r.post('/api/setup', async (req) => {
    if (!(await needsSetup())) throw new HttpError(409, 'Prime Suite ya está configurado');
    const b = await body(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!b.companyName || !b.companyCode || !email || !b.firstName) throw new HttpError(400, 'Faltan datos obligatorios');
    if (!/^[a-z0-9-]{2,32}$/.test(String(b.companyCode))) throw new HttpError(400, 'El código de empresa solo admite minúsculas, números y guiones');
    if (!validPassword(b.password)) throw new HttpError(400, PASSWORD_RULE);
    const company = await seed({ origin: origin(req), companyName: String(b.companyName), companyCode: String(b.companyCode) });
    const user: User = {
      id: id(), companyId: company.id, email, username: b.username || undefined,
      firstName: String(b.firstName), lastName: String(b.lastName || ''),
      passwordHash: await hashPassword(b.password), role: 'superadmin', groupIds: [], status: 'active',
      sessionVersion: 1, createdAt: now()
    };
    await Users.put(user);
    await audit({ actorId: user.id, actorEmail: user.email, companyId: company.id, action: 'setup.completed', ip: clientIp(req) });
    return json({ ok: true }, 201, { 'set-cookie': await startSession(req, user) });
  });

  r.post('/api/auth/login', async (req) => {
    const b = await body(req);
    const user = await findUserByLogin(String(b.login || ''));
    const fail = () => new HttpError(401, 'Usuario o contraseña incorrectos');
    if (!user) {
      await dummyCheck(); // tiempo similar exista o no el usuario
      throw fail();
    }
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) throw new HttpError(429, 'Cuenta bloqueada temporalmente por intentos fallidos. Prueba en unos minutos.');
    if (!(await checkPassword(String(b.password || ''), user.passwordHash))) {
      user.failedLogins = (user.failedLogins || 0) + 1;
      if (user.failedLogins >= 5) {
        user.lockedUntil = new Date(Date.now() + 5 * 60_000).toISOString();
        user.failedLogins = 0;
      }
      await Users.put(user);
      await audit({ actorId: user.id, actorEmail: user.email, companyId: user.companyId, action: 'auth.login_failed', ip: clientIp(req) });
      throw fail();
    }
    if (user.status === 'pending') throw new HttpError(403, 'Tu cuenta está pendiente de aprobación');
    if (user.status === 'disabled') throw new HttpError(403, 'Cuenta desactivada');
    user.failedLogins = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = now();
    await Users.put(user);
    await audit({ actorId: user.id, actorEmail: user.email, companyId: user.companyId, action: 'auth.login', ip: clientIp(req) });
    return json({ ok: true }, 200, { 'set-cookie': await startSession(req, user) });
  });

  r.post('/api/auth/logout', async (req) => {
    const settings = await getSettings();
    try {
      const c = await requireUser(req);
      if (settings.singleLogout) {
        // Invalida todas las sesiones del usuario (cierre de sesión único).
        c.user.sessionVersion += 1;
        await Users.put(c.user);
      }
      await audit({ actorId: c.user.id, actorEmail: c.user.email, companyId: c.company.id, action: 'auth.logout' });
    } catch {}
    return json({ ok: true }, 200, { 'set-cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecure(req) }) });
  });

  r.post('/api/auth/register', async (req) => {
    const s = await getSettings();
    if (!s.allowSelfRegistration) throw new HttpError(403, 'El registro está desactivado');
    const b = await body(req);
    const company = (await Companies.all()).find((c) => c.code === String(b.companyCode || '').trim());
    if (!company) throw new HttpError(400, 'Código de empresa no válido');
    const email = String(b.email || '').trim().toLowerCase();
    if (!email || !b.firstName) throw new HttpError(400, 'Faltan datos');
    if (await findUserByLogin(email)) throw new HttpError(409, 'Ya existe una cuenta con ese email');
    if (!validPassword(b.password)) throw new HttpError(400, PASSWORD_RULE);
    const user: User = {
      id: id(), companyId: company.id, email, firstName: String(b.firstName), lastName: String(b.lastName || ''),
      passwordHash: await hashPassword(b.password), role: 'user', groupIds: [], status: 'pending', sessionVersion: 1, createdAt: now()
    };
    await Users.put(user);
    await audit({ actorId: user.id, actorEmail: email, companyId: company.id, action: 'auth.registered', ip: clientIp(req) });
    return json({ ok: true, pending: true }, 201);
  });

  r.get('/api/me', async (req) => {
    const c = await requireUser(req);
    const cats = await Categories.all();
    const mods = await accessibleModules(c);
    return json({
      user: publicUser(c.user),
      company: { id: c.company.id, name: c.company.name, code: c.company.code },
      groups: c.groups.map((g) => ({ id: g.id, name: g.name })),
      isAdmin: c.user.role !== 'user',
      isSuper: c.user.role === 'superadmin',
      moduleCount: mods.length,
      categories: cats.length
    });
  });

  r.post('/api/me/password', async (req) => {
    const c = await requireUser(req);
    const b = await body(req);
    if (!(await checkPassword(String(b.current || ''), c.user.passwordHash))) throw new HttpError(400, 'La contraseña actual no es correcta');
    if (!validPassword(b.next)) throw new HttpError(400, PASSWORD_RULE);
    c.user.passwordHash = await hashPassword(b.next);
    c.user.sessionVersion += 1;
    await Users.put(c.user);
    await audit({ actorId: c.user.id, actorEmail: c.user.email, companyId: c.company.id, action: 'user.password_changed', target: c.user.id });
    return json({ ok: true }, 200, { 'set-cookie': await startSession(req, c.user) });
  });

  r.get('/api/settings/public', async () => {
    const s = await getSettings();
    return json({ allowSelfRegistration: s.allowSelfRegistration });
  });
}
