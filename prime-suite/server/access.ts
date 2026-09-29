// Contexto de la petición, permisos y construcción de claims.
import { Companies, Groups, Users, Modules, type Company, type Group, type Module, type ModuleRole, type User } from './db.ts';
import { readSession, SESSION_COOKIE } from './crypto.ts';
import { HttpError, origin, parseCookies } from './http.ts';

export interface Ctx {
  user: User;
  company: Company;
  groups: Group[];
  issuer: string;
}

export async function currentUser(req: Request): Promise<Ctx | null> {
  const issuer = origin(req);
  const s = await readSession(issuer, parseCookies(req)[SESSION_COOKIE]);
  if (!s) return null;
  const user = await Users.get(s.userId);
  if (!user || user.status !== 'active' || user.sessionVersion !== s.sv) return null;
  const company = await Companies.get(user.companyId);
  if (!company) return null;
  const groups = (await Promise.all(user.groupIds.map((g) => Groups.get(g)))).filter(Boolean) as Group[];
  return { user, company, groups, issuer };
}

export async function requireUser(req: Request) {
  const c = await currentUser(req);
  if (!c) throw new HttpError(401, 'Sesión no iniciada');
  return c;
}

export async function requireAdmin(req: Request) {
  const c = await requireUser(req);
  if (c.user.role !== 'admin' && c.user.role !== 'superadmin') throw new HttpError(403, 'Requiere permisos de administrador');
  return c;
}

export async function requireSuper(req: Request) {
  const c = await requireUser(req);
  if (c.user.role !== 'superadmin') throw new HttpError(403, 'Requiere superadministrador');
  return c;
}

/** Un admin de empresa solo gestiona su empresa; el superadmin, todas. */
export function assertCompanyScope(c: Ctx, companyId: string | null | undefined) {
  if (c.user.role === 'superadmin') return;
  if (!companyId || companyId !== c.company.id) throw new HttpError(403, 'Fuera del ámbito de tu empresa');
}

const RANK: Record<ModuleRole, number> = { viewer: 1, user: 2, admin: 3 };

/** Rol efectivo del usuario en un módulo, o null si no tiene acceso. */
export function moduleRole(user: User, company: Company, groups: Group[], m: Module): ModuleRole | null {
  if (!m.enabled) return null;
  if (user.role === 'superadmin') return 'admin';
  if (!company.enabledModules.includes(m.id)) return null;
  if (user.role === 'admin') return 'admin';
  let best: ModuleRole | null = m.defaultRole;
  for (const g of groups) {
    const r = g.moduleRoles[m.id];
    if (r && (!best || RANK[r] > RANK[best])) best = r;
  }
  return best;
}

export async function accessibleModules(c: Ctx) {
  const all = (await Modules.all()).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return all
    .map((m) => ({ m, role: moduleRole(c.user, c.company, c.groups, m) }))
    .filter((x) => x.role !== null) as { m: Module; role: ModuleRole }[];
}

export function launchUrl(m: Module, company: Company, user: User, portalOrigin: string) {
  const tpl = (company.moduleUrls?.[m.id] || m.url)
    .replaceAll('{tenant}', encodeURIComponent(company.code))
    .replaceAll('{email}', encodeURIComponent(user.email))
    .replaceAll('{username}', encodeURIComponent(user.username || user.email));
  return abs(tpl, portalOrigin);
}

/** Claims estándar que Prime ID entrega a cualquier aplicación. */
export function claimsFor(user: User, company: Company, groups: Group[], role: ModuleRole | null, scopes?: string[]) {
  const has = (s: string) => !scopes || scopes.includes(s);
  const c: Record<string, unknown> = {};
  if (has('profile')) {
    c.name = `${user.firstName} ${user.lastName}`.trim();
    c.given_name = user.firstName;
    c.family_name = user.lastName;
    c.preferred_username = user.username || user.email;
  }
  if (has('email')) {
    c.email = user.email;
    c.email_verified = true;
  }
  if (has('tenant')) {
    c.tenant = company.code;
    c.company_id = company.id;
    c.company_name = company.name;
  }
  if (has('roles')) {
    c.roles = role ? [role] : [];
    c.groups = groups.map((g) => g.name);
    c.portal_role = user.role;
  }
  return c;
}

export function publicUser(u: User) {
  const { passwordHash, sessionVersion, ...rest } = u;
  return rest;
}

/** Resuelve URLs relativas ("/demo-app/") contra el dominio del portal. */
export function abs(url: string, base: string) {
  try {
    return new URL(url, base + '/').toString();
  } catch {
    return url;
  }
}
