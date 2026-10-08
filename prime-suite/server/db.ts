// Modelo de datos y repositorios sobre el KV.
import { randomUUID } from 'node:crypto';
import { store } from './store.ts';

export type PortalRole = 'superadmin' | 'admin' | 'user';
export type ModuleRole = 'admin' | 'user' | 'viewer';
export type AuthMethod = 'oidc' | 'prime_token' | 'none';
export type OpenMode = 'iframe' | 'tab' | 'fullscreen' | 'native';
export type TokenDelivery = 'fragment' | 'query' | 'form_post';
export type WidgetType = 'kpi' | 'list' | 'chart' | 'iframe';

export interface Company {
  id: string;
  name: string;
  code: string; // tenant, p.ej. "pri5"
  taxId?: string;
  email?: string;
  enabledModules: string[]; // ids de módulo
  moduleUrls: Record<string, string>; // URL específica por módulo para esta empresa
  createdAt: string;
}

export interface User {
  id: string;
  companyId: string;
  email: string;
  username?: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  role: PortalRole;
  groupIds: string[];
  status: 'active' | 'pending' | 'disabled';
  sessionVersion: number;
  lastLoginAt?: string;
  failedLogins?: number;
  lockedUntil?: string;
  /** Alta en la tabla USUARIOS de Evalos 8 (si la empresa tiene conexión configurada). */
  evalos?: { initials: string; at: string };
  /** Último error al darlo de alta en Evalos 8 (se reintenta al guardar la conexión). */
  evalosError?: string;
  /** Código del empleado de Evalos 8 (PERSONAL.EM_CODI) vinculado: su nombre y email se copian a la ficha. */
  evalosEmployee?: string;
  createdAt: string;
}

export interface Group {
  id: string;
  companyId: string | null; // null = global (solo superadmin)
  name: string;
  description?: string;
  moduleRoles: Record<string, ModuleRole>;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  order: number;
  enabled: boolean;
}

/** Inicio de sesión automático para módulos sin SSO (ver server/autologin.ts). */
export interface AutoLogin {
  enabled: boolean;
  /** form: POST del formulario de login · url: URL con {usuario} y {password} */
  method: 'form' | 'url';
  loginUrl: string;
  userField: string;
  passField: string;
  /** Campos fijos adicionales del formulario (admiten {usuario} y {password}). */
  extraFields: { name: string; value: string }[];
  /** user: cada usuario guarda las suyas · shared: cuenta común de la integración */
  credentials: 'user' | 'shared';
  sharedUser?: string;
  sharedPassEnc?: string;
}

export interface WidgetDef {
  id: string;
  title: string;
  type: WidgetType;
  endpoint?: string; // JSON (kpi/list/chart) o URL (iframe); relativo a la URL del módulo
  size: 's' | 'm' | 'l';
  refreshSec: number;
}

export interface ApiRest {
  apiUrl: string;     // URL base de la API
  tokenUrl: string;   // endpoint OAuth2 de token
  clientId: string;
  /** Client Secret cifrado (AES-256-GCM). Nunca sale del servidor. */
  clientSecretEnc?: string;
  /** URL de los servicios SOAP (ServiciosCliente.asmx) de la aplicación, si los tiene. */
  soapUrl?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Module {
  id: string;
  clientId: string; // identificador público (client_id OIDC / audience del token)
  name: string;
  description: string;
  categoryId: string | null;
  initials: string;
  color: string;
  iconUrl?: string; // icono propio subido (data URL PNG/SVG/JPG/WEBP) o URL https; si no, se usan iniciales+color
  iconGlyph?: string; // icono integrado (clave de la galería); se pinta con degradado del color. Imagen > glifo > iniciales
  url: string; // admite {tenant}, {email}, {username}
  openMode: OpenMode;
  authMethod: AuthMethod;
  // Prime Token
  tokenDelivery: TokenDelivery;
  tokenParam: string; // nombre del parámetro (por defecto prime_token; "sso_token" para compatibilidad)
  tokenTtlSec: number;
  // OIDC
  clientSecretHash?: string;
  redirectUris: string[];
  initiateLoginUri?: string;
  postLogoutRedirectUris: string[];
  // response_type permitidos. Por defecto solo 'code' (sin cambiar clientes existentes).
  // El flujo híbrido añade 'code id_token' y 'code id_token token'.
  responseTypes?: string[];
  // Incluir siempre email/email_verified en el id_token, aunque no se pida el scope email
  // (necesario para apps como Evalos8/Katana que identifican por email con scope reducido).
  alwaysEmail?: boolean;
  // Sin SSO: entrar automáticamente con credenciales guardadas
  autoLogin?: AutoLogin;
  // Log de inicio de sesión (depuración): Prime ID apunta cada paso del login con esta app (todas las formas de SSO).
  ssoDebug?: boolean;
  // API REST de la aplicación (OAuth2 client credentials) para que Prime Suite pueda llamarla.
  apiRest?: ApiRest;
  // Acceso
  defaultRole: ModuleRole | null; // rol para todos los usuarios de empresas habilitadas
  // Widgets
  manifestUrl?: string;
  widgets: WidgetDef[];
  enabled: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  sessionHours: number;
  mfaAdmins: boolean;
  singleLogout: boolean;
  oneTimeTokens: boolean;
  keyRotationDays: number;
  allowSelfRegistration: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string | null;
  actorEmail: string | null;
  companyId: string | null;
  action: string;
  target?: string;
  detail?: string;
  ip?: string;
}

export interface DashboardItem {
  moduleId: string;
  widgetId: string;
  size: 's' | 'm' | 'l';
}

const kv = () => store();

function repo<T extends { id: string }>(prefix: string) {
  return {
    async get(id: string) {
      return kv().get<T>(`${prefix}/${id}`);
    },
    async all(): Promise<T[]> {
      const keys = await kv().keys(`${prefix}/`);
      const items = await Promise.all(keys.map((k) => kv().get<T>(k)));
      return items.filter(Boolean) as T[];
    },
    async put(item: T) {
      await kv().set(`${prefix}/${item.id}`, item);
      return item;
    },
    async del(id: string) {
      await kv().del(`${prefix}/${id}`);
    }
  };
}

export const Companies = repo<Company>('companies');
export const Users = repo<User>('users');
export const Groups = repo<Group>('groups');
export const Categories = repo<Category>('categories');
export const Modules = repo<Module>('modules');

// ---- Prime Insights (Superset) ----
export interface SupersetServer {
  id: string;
  name: string;
  baseUrl: string; // p. ej. https://evalos-c.digitekcloud.com:8802
  username: string;
  passwordEnc: string; // cifrada (AES-256-GCM)
  provider: 'db' | 'ldap';
  createdAt: string;
  updatedAt: string;
}
export interface InsightCategory {
  id: string;
  name: string;
  order: number;
}
export interface InsightDashboard {
  id: string;
  serverId: string | null;
  name: string;
  description?: string;
  categoryId: string | null;
  supersetId?: number; // id del dashboard en Superset
  embeddedUuid?: string; // UUID de "Embed dashboard"
  dashboardUrl?: string; // URL directa (iframe plano, requiere login en Superset)
  order: number;
  enabled: boolean;
  showAsWidget: boolean;
  companyIds: string[]; // vacío = todas las empresas con Prime Insights
  groupIds: string[]; // vacío = todos los usuarios de esas empresas
  rlsClause?: string; // filtro por tenant, admite {tenant} {email} {company_id}
  createdAt: string;
  updatedAt: string;
}
export const SupersetServers = repo<SupersetServer>('insights-servers');
export const InsightCategories = repo<InsightCategory>('insights-categories');
export const InsightDashboards = repo<InsightDashboard>('insights-dashboards');

export const id = () => randomUUID();
export const now = () => new Date().toISOString();

export async function findUserByLogin(login: string) {
  const l = login.trim().toLowerCase();
  const all = await Users.all();
  return all.find((u) => u.email.toLowerCase() === l || (u.username && u.username.toLowerCase() === l)) || null;
}

export async function findModuleByClientId(clientId: string) {
  const all = await Modules.all();
  return all.find((m) => m.clientId === clientId) || null;
}

const DEFAULT_SETTINGS: Settings = {
  sessionHours: 8,
  mfaAdmins: false,
  singleLogout: true,
  oneTimeTokens: true,
  keyRotationDays: 90,
  allowSelfRegistration: true
};

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await kv().get<Settings>('settings')) || {}) };
}
export async function putSettings(s: Settings) {
  await kv().set('settings', s);
}

// Auditoría: una clave por entrada, ordenable por fecha.
export async function audit(e: Omit<AuditEntry, 'id' | 'at'>) {
  const at = now();
  const entry: AuditEntry = { id: id(), at, ...e };
  await kv().set(`audit/${at}_${entry.id}`, entry);
}
export async function listAudit(limit = 200, companyId?: string | null) {
  const keys = (await kv().keys('audit/')).sort().reverse();
  const out: AuditEntry[] = [];
  for (const k of keys) {
    if (out.length >= limit) break;
    const e = await kv().get<AuditEntry>(k);
    if (e && (!companyId || e.companyId === companyId)) out.push(e);
  }
  return out;
}

// Códigos de autorización OIDC y jti consumidos (con caducidad).
export async function putTemp(kind: string, key: string, value: unknown, ttlSec: number) {
  await kv().set(`${kind}/${key}`, { value, exp: Date.now() + ttlSec * 1000 });
}
export async function takeTemp<T>(kind: string, key: string): Promise<T | null> {
  const rec = await kv().get<{ value: T; exp: number }>(`${kind}/${key}`);
  if (!rec) return null;
  await kv().del(`${kind}/${key}`);
  return rec.exp > Date.now() ? rec.value : null;
}
export async function markOnce(kind: string, key: string, ttlSec: number) {
  // true si es la primera vez que se marca
  return kv().set(`${kind}/${key}`, { exp: Date.now() + ttlSec * 1000 }, { onlyIfNew: true });
}

export async function getDashboard(userId: string) {
  return kv().get<DashboardItem[]>(`dashboards/${userId}`);
}
export async function putDashboard(userId: string, items: DashboardItem[]) {
  await kv().set(`dashboards/${userId}`, items);
}

export async function rawGet<T>(key: string) {
  return kv().get<T>(key);
}
export async function rawSet(key: string, v: unknown, opts?: { onlyIfNew?: boolean }) {
  return kv().set(key, v, opts);
}
export async function rawDel(key: string) {
  return kv().del(key);
}
