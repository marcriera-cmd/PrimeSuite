// Cliente HTTP del portal.
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
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
    throw new ApiError(res.status, json?.error || `Error ${res.status}`, json?.code);
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
export type OpenMode = 'iframe' | 'tab' | 'fullscreen' | 'native';

export interface Me {
  user: { id: string; email: string; username?: string; firstName: string; lastName: string; role: 'superadmin' | 'admin' | 'user'; companyId: string };
  company: { id: string; name: string; code: string };
  groups: { id: string; name: string }[];
  isAdmin: boolean;
  isSuper: boolean;
  moduleCount: number;
}

export interface Category { id: string; name: string; color: string; order: number; enabled: boolean }

export interface WidgetDef { id: string; title: string; type: 'kpi' | 'list' | 'chart' | 'iframe' | 'superset' | 'evalos'; dashboardId?: string; screen?: string; endpoint?: string; size: 's' | 'm' | 'l'; refreshSec: number }

export interface PortalApp {
  id: string; name: string; description: string; initials: string; color: string; iconUrl?: string; iconGlyph?: string; categoryId: string | null;
  openMode: OpenMode; authMethod: AuthMethod; role: ModuleRole; widgets: number; nativeUrl?: string;
}

export interface AdminModule {
  id: string; clientId: string; name: string; description: string; categoryId: string | null; initials: string; color: string; iconUrl?: string; iconGlyph?: string;
  url: string; openMode: OpenMode; authMethod: AuthMethod; tokenDelivery: 'fragment' | 'query' | 'form_post'; tokenParam: string; tokenTtlSec: number;
  redirectUris: string[]; postLogoutRedirectUris: string[]; initiateLoginUri?: string; responseTypes?: string[]; alwaysEmail?: boolean; defaultRole: ModuleRole | null;
  manifestUrl?: string; widgets: WidgetDef[]; enabled: boolean; order: number; hasSecret: boolean; companyCount?: number;
  createdAt: string; updatedAt: string;
}

export interface Company { id: string; name: string; code: string; taxId?: string; email?: string; enabledModules: string[]; moduleUrls: Record<string, string>; userCount?: number }
export interface Group { id: string; companyId: string | null; name: string; description?: string; moduleRoles: Record<string, ModuleRole>; memberCount?: number }
export interface AdminUser {
  id: string; companyId: string; companyName?: string; email: string; username?: string; firstName: string; lastName: string;
  role: 'superadmin' | 'admin' | 'user'; groupIds: string[]; groups?: string[]; status: 'active' | 'pending' | 'disabled'; lastLoginAt?: string; createdAt: string;
  evalos?: { initials: string; at: string }; evalosError?: string;
}

export const AUTH_LABEL: Record<AuthMethod, string> = { oidc: 'OpenID Connect', prime_token: 'Prime Token', none: 'Sin SSO' };
export const OPEN_LABEL: Record<OpenMode, string> = { iframe: 'Embebido', tab: 'Pestaña nueva', fullscreen: 'Pantalla completa', native: 'Módulo nativo' };
export const ROLE_LABEL: Record<ModuleRole, string> = { admin: 'Administrador', user: 'Usuario', viewer: 'Lectura' };
export const PORTAL_ROLE_LABEL = { superadmin: 'Superadministrador', admin: 'Administrador', user: 'Usuario' } as const;

export const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const initialsOf = (a: string, b = '') => ((a[0] || '') + (b[0] || '')).toUpperCase();

// ---- Prime Insights ----
export interface InsightCategory { id: string; name: string; order: number }
export interface InsightDashboard {
  id: string; serverId: string | null; name: string; description?: string; categoryId: string | null; supersetId?: number;
  embeddedUuid?: string; dashboardUrl?: string; order: number; enabled: boolean; showAsWidget: boolean;
  companyIds: string[]; groupIds: string[]; rlsClause?: string; updatedAt?: string;
}
export interface SupersetServer { id: string; name: string; baseUrl: string; username: string; provider: 'db' | 'ldap'; hasPassword: boolean; updatedAt: string }

// ---- Atajos de Evalos ----
export interface EvalosScreenInfo { key: string; title: string; description: string; glyph: string; widgetSize: 's' | 'm' | 'l' }
export interface EvalosMe {
  role: ModuleRole; canEdit: boolean; canDelete: boolean; canConfigure: boolean;
  configured: boolean; engine: 'mssql' | 'demo' | null; connHint: string | null; screens: EvalosScreenInfo[];
}
export interface EvalosMapping {
  departments: { schema?: string; table: string; code: string; description: string };
  employees: { schema?: string; table: string; code: string; name: string; department: string; endDate: string };
  departmentHistory?: { schema?: string; table: string; department: string } | null;
}
export interface EvalosConfigView {
  companyId: string; companyName: string; configured: boolean; engine: 'mssql' | 'demo'; hasConnection: boolean; connHint: string | null;
  mapping: EvalosMapping; uppercase: boolean; updatedAt: string | null; updatedBy: string | null;
  companies?: { id: string; name: string; code: string }[];
  /** Resultado del alta en Evalos 8 de los usuarios pendientes al guardar la conexión. */
  userSync?: { created: number; failed: { email: string; error: string }[] } | null;
}
export interface EvalosColumn { name: string; type: string; maxLength: number | null; nullable: boolean }
export interface EvalosDetect { mapping: EvalosMapping; candidates: { schema: string; name: string; columns: EvalosColumn[] }[]; warnings: string[] }
export interface EvalosDepartment { code: string; description: string; employees: number; active: number }
export interface EvalosDepartmentEmployee { code: string; name: string; active: boolean; endDate?: string }
export interface EvalosDepartmentsResponse {
  items: EvalosDepartment[]; limits: { code: number | null; description: number | null };
  canEdit: boolean; canDelete: boolean; uppercase: boolean; engine: 'mssql' | 'demo';
}

// Personal (tabla PERSONAL). Fechas en AAAA-MM-DD; '' = sin valor.
export interface EvalosPersonalInput {
  code: string; name: string; card: string; email: string; hireDate: string; endDate: string;
  company: string; department: string; section: string; area: string; consultas: string; solicitudes: string;
}
export interface EvalosPersonal extends EvalosPersonalInput { active: boolean }
/** Tramo de asignación de tarjeta (HIS_TARJETA). to '' = sin fecha de baja. */
export interface EvalosCardAssignment { card: string; from: string; to: string; type: string; active: boolean; recordedAt: string; user: string }
export interface EvalosPersonalDetail extends EvalosPersonal { cards: EvalosCardAssignment[] }
export interface EvalosLookupItem { code: string; description: string }
export type EvalosPersonalLookupKey = 'company' | 'department' | 'section' | 'area' | 'consultas' | 'solicitudes';
export interface EvalosPersonalResponse {
  items: EvalosPersonal[];
  /** null = la tabla no existe en esta instalación de Evalos (se escribe el código a mano). */
  lookups: Record<EvalosPersonalLookupKey, EvalosLookupItem[] | null>;
  limits: Partial<Record<keyof EvalosPersonalInput, number | null>>;
  canEdit: boolean; canDelete: boolean; uppercase: boolean; engine: 'mssql' | 'demo';
}

// Calendarios y convenios
export type EvalosHolidayType = 'NACIONAL' | 'AUTONOMICO' | 'LOCAL' | 'EMPRESA';
export interface EvalosHoliday { date: string; type: EvalosHolidayType; description: string }
export interface EvalosCalendar { code: string; name: string; year: number; convenio?: string; employees: number; holidays: number }
export interface EvalosCalendarDetail extends EvalosCalendar { days: EvalosHoliday[] }
export interface EvalosSeniorityTier { years: number; extraDays: number }
export interface EvalosConvenio { code: string; name: string; vacationDays: number; hoursYear: number; seniority: EvalosSeniorityTier[]; calendars?: number }
export interface EvalosVacationCalc {
  convenio: string; convenioName: string; year: number; hireDate: string;
  baseDays: number; seniorityYears: number; seniorityExtra: number; totalDays: number;
  proratedDays: number; workedDays: number; yearDays: number;
}
export interface EvalosCalendariosResponse { calendars: EvalosCalendar[]; convenios: EvalosConvenio[]; canEdit: boolean; canDelete: boolean; engine: 'mssql' | 'demo' }

// Correcciones
export interface EvalosMarcajePunch { time: string; type: 'E' | 'S' }
export interface EvalosMarcaje { id: string; employee: string; employeeName: string; date: string; punches: EvalosMarcajePunch[]; status: 'OK' | 'INCIDENCIA'; issue?: string }
export interface EvalosSolicitud { id: string; employee: string; employeeName: string; type: string; from: string; to: string; days: number; reason?: string; status: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'; createdAt: string }
export interface EvalosAusencia { id: string; employee: string; employeeName: string; type: string; from: string; to: string; days: number; reason?: string }
export interface EvalosEmployeeBrief { code: string; name: string }
export interface EvalosCorreccionesResponse {
  marcajes: EvalosMarcaje[]; solicitudes: EvalosSolicitud[]; ausencias: EvalosAusencia[]; employees: EvalosEmployeeBrief[];
  canEdit: boolean; canDelete: boolean; engine: 'mssql' | 'demo';
}
