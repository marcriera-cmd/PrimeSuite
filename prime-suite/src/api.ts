// Cliente HTTP del portal.
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, data?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: data !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: data !== undefined ? JSON.stringify(data) : undefined
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth') && !url.startsWith('/api/me')) window.dispatchEvent(new Event('ps:unauthorized'));
    throw new ApiError(res.status, json?.error || `Error ${res.status}`);
  }
  return json as T;
}

export const api = {
  get: <T>(u: string) => request<T>('GET', u),
  post: <T>(u: string, d: unknown = {}) => request<T>('POST', u, d),
  put: <T>(u: string, d: unknown) => request<T>('PUT', u, d),
  del: <T>(u: string) => request<T>('DELETE', u)
};

// ---- Tipos compartidos con el backend ----
export type ModuleRole = 'admin' | 'user' | 'viewer';
export type AuthMethod = 'oidc' | 'prime_token' | 'none';
export type OpenMode = 'iframe' | 'tab' | 'fullscreen';

export interface Me {
  user: { id: string; email: string; username?: string; firstName: string; lastName: string; role: 'superadmin' | 'admin' | 'user'; companyId: string };
  company: { id: string; name: string; code: string };
  groups: { id: string; name: string }[];
  isAdmin: boolean;
  isSuper: boolean;
  moduleCount: number;
}

export interface Category { id: string; name: string; color: string; order: number; enabled: boolean }

export interface WidgetDef { id: string; title: string; type: 'kpi' | 'list' | 'chart' | 'iframe'; endpoint?: string; size: 's' | 'm' | 'l'; refreshSec: number }

export interface PortalApp {
  id: string; name: string; description: string; initials: string; color: string; categoryId: string | null;
  openMode: OpenMode; authMethod: AuthMethod; role: ModuleRole; widgets: number;
}

export interface AdminModule {
  id: string; clientId: string; name: string; description: string; categoryId: string | null; initials: string; color: string;
  url: string; openMode: OpenMode; authMethod: AuthMethod; tokenDelivery: 'fragment' | 'query' | 'form_post'; tokenParam: string; tokenTtlSec: number;
  redirectUris: string[]; postLogoutRedirectUris: string[]; initiateLoginUri?: string; defaultRole: ModuleRole | null;
  manifestUrl?: string; widgets: WidgetDef[]; enabled: boolean; order: number; hasSecret: boolean; companyCount?: number;
  createdAt: string; updatedAt: string;
}

export interface Company { id: string; name: string; code: string; taxId?: string; email?: string; enabledModules: string[]; moduleUrls: Record<string, string>; userCount?: number }
export interface Group { id: string; companyId: string | null; name: string; description?: string; moduleRoles: Record<string, ModuleRole>; memberCount?: number }
export interface AdminUser {
  id: string; companyId: string; companyName?: string; email: string; username?: string; firstName: string; lastName: string;
  role: 'superadmin' | 'admin' | 'user'; groupIds: string[]; groups?: string[]; status: 'active' | 'pending' | 'disabled'; lastLoginAt?: string; createdAt: string;
}

export const AUTH_LABEL: Record<AuthMethod, string> = { oidc: 'OpenID Connect', prime_token: 'Prime Token', none: 'Sin SSO' };
export const OPEN_LABEL: Record<OpenMode, string> = { iframe: 'Embebido', tab: 'Pestaña nueva', fullscreen: 'Pantalla completa' };
export const ROLE_LABEL: Record<ModuleRole, string> = { admin: 'Administrador', user: 'Usuario', viewer: 'Lectura' };
export const PORTAL_ROLE_LABEL = { superadmin: 'Superadministrador', admin: 'Administrador', user: 'Usuario' } as const;

export const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const initialsOf = (a: string, b = '') => ((a[0] || '') + (b[0] || '')).toUpperCase();
