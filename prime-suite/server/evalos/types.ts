// Atajos de Evalos: tipos compartidos por la configuración, los drivers y las rutas.

/** Motor de base de datos de la instalación de Evalos 8. */
export type EvalosEngine = 'mssql' | 'demo';

/**
 * Correspondencia entre los conceptos de Atajos de Evalos y las tablas/columnas reales de la BD de Evalos 8.
 * Se rellena con "Detectar" en Configuración y se puede ajustar a mano (cada instalación puede variar).
 */
export interface EvalosMapping {
  departments: { schema?: string; table: string; code: string; description: string };
  employees: { schema?: string; table: string; code: string; name: string; department: string; endDate: string };
  /** Histórico de departamentos (instalaciones con históricos). Opcional: solo se usa para impedir borrados con referencias. */
  departmentHistory?: { schema?: string; table: string; department: string } | null;
}

export const DEFAULT_MAPPING: EvalosMapping = {
  departments: { table: 'DEPMENTO', code: '', description: '' },
  employees: { table: 'PERSONAL', code: 'EM_CODI', name: 'EM_NOMB', department: 'EM_DEPA', endDate: 'EM_FBAJ' },
  departmentHistory: null
};

export interface EvalosConfig {
  companyId: string;
  engine: EvalosEngine;
  /** Cadena de conexión cifrada (AES-256-GCM). Nunca sale del servidor. */
  connEnc?: string;
  /** Servidor y base de datos (sin credenciales), solo para mostrar. */
  connHint?: string;
  mapping: EvalosMapping;
  /** Guardar códigos y descripciones en mayúsculas, como hace Evalos 8. */
  uppercase: boolean;
  updatedAt: string;
  updatedBy?: string;
}

export interface Department {
  code: string;
  description: string;
  /** Empleados con este departamento en la ficha (activos + de baja). */
  employees: number;
  /** Empleados sin fecha de baja o con baja futura. */
  active: number;
}

export interface DepartmentEmployee {
  code: string;
  name: string;
  active: boolean;
  endDate?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  maxLength: number | null;
  nullable: boolean;
  hasDefault: boolean;
  identity: boolean;
  computed: boolean;
}

export interface TableInfo {
  schema: string;
  name: string;
  columns: ColumnInfo[];
}

export interface DetectResult {
  mapping: EvalosMapping;
  /** Tablas candidatas con sus columnas, para que el administrador elija si la detección no acierta. */
  candidates: TableInfo[];
  warnings: string[];
}

/** Tabla del esquema completo (exportación para preparar el mapeo de nuevas pantallas). Sin datos, solo estructura. */
export interface SchemaTable {
  schema: string;
  name: string;
  /** Filas aproximadas (estadísticas de SQL Server). */
  rows: number;
  primaryKey: string[];
  foreignKeys: { column: string; refTable: string; refColumn: string }[];
  /** Pantalla de Atajos a la que probablemente corresponde, por el nombre de la tabla. */
  topic?: string;
  columns: ColumnInfo[];
  /** Filas de ejemplo (solo si se piden, y solo de las tablas de Atajos). */
  sample?: Record<string, unknown>[];
}

export interface SchemaExport {
  server?: string;
  database?: string;
  version?: string;
  exportedAt: string;
  samples?: boolean;
  tables: SchemaTable[];
}

export interface ConnectionInfo {
  engine: EvalosEngine;
  server?: string;
  database?: string;
  version?: string;
}

// ---------- Calendarios y convenios ----------
export type HolidayType = 'NACIONAL' | 'AUTONOMICO' | 'LOCAL' | 'EMPRESA';
export interface Holiday { date: string; type: HolidayType; description: string }
export interface Calendar {
  code: string;
  name: string;
  year: number;
  convenio?: string;   // código de convenio aplicado
  employees: number;   // empleados asignados a este calendario
  holidays: number;    // nº de días festivos
}
export interface CalendarDetail extends Calendar { days: Holiday[] }

export interface SeniorityTier { years: number; extraDays: number }
export interface Convenio {
  code: string;
  name: string;
  vacationDays: number;      // días laborables de vacaciones al año
  hoursYear: number;         // jornada anual (horas)
  seniority: SeniorityTier[]; // días adicionales por antigüedad
  calendars?: number;        // calendarios que lo usan (solo lectura)
}
export interface VacationCalc {
  convenio: string;
  convenioName: string;
  year: number;
  hireDate: string;
  baseDays: number;
  seniorityYears: number;
  seniorityExtra: number;
  totalDays: number;
  proratedDays: number;   // prorrateado si el alta es dentro del año
  workedDays: number;
  yearDays: number;
}

// ---------- Correcciones ----------
export interface MarcajePunch { time: string; type: 'E' | 'S' }   // Entrada / Salida
export interface Marcaje {
  id: string;
  employee: string;
  employeeName: string;
  date: string;              // YYYY-MM-DD
  punches: MarcajePunch[];
  status: 'OK' | 'INCIDENCIA';
  issue?: string;            // descripción de la incidencia
}
export interface Solicitud {
  id: string;
  employee: string;
  employeeName: string;
  type: string;              // Vacaciones, Permiso, Cambio de turno…
  from: string;
  to: string;
  days: number;
  reason?: string;
  status: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
  createdAt: string;
}
export interface Ausencia {
  id: string;
  employee: string;
  employeeName: string;
  type: string;              // Enfermedad, Permiso retribuido, Asuntos propios…
  from: string;
  to: string;
  days: number;
  reason?: string;
}
export interface EmployeeBrief { code: string; name: string }

// ---------- Personal (tabla PERSONAL) ----------
/** Ficha de empleado tal como la gestiona la pantalla Personal. Fechas en AAAA-MM-DD ('' = sin fecha). */
export interface PersonalInput {
  code: string;         // EM_CODI (clave, no modificable)
  name: string;         // EM_NOMB
  card: string;         // EM_TARJ
  email: string;        // EM_WFEM
  hireDate: string;     // EM_FALT
  endDate: string;      // EM_FBAJ
  company: string;      // EM_CEMP  → EMPRESA
  department: string;   // EM_DEPA  → DEPMENTO
  section: string;      // EM_SECC  → SECCION
  area: string;         // EM_AREA  → AREA
  consultas: string;    // EM_KOPC  → KIOSKO
  solicitudes: string;  // EM_WFOP  → WORKFLOW
}
export interface Personal extends PersonalInput { active: boolean }

export interface LookupItem { code: string; description: string }
export type PersonalLookupKey = 'company' | 'department' | 'section' | 'area' | 'consultas' | 'solicitudes';
/** Valores de los desplegables. null = la tabla no existe en esta instalación (se deja escribir el código). */
export type PersonalLookups = Record<PersonalLookupKey, LookupItem[] | null>;
/** Longitud máxima de cada campo según la BD (null si no se conoce). */
export type PersonalLimits = Partial<Record<keyof PersonalInput, number | null>>;

/** Históricos de la ficha (tablas HIS_*): tarjetas y organización. */
export type HistoryKind = 'card' | 'company' | 'department' | 'section' | 'area';
export type OrgKind = Exclude<HistoryKind, 'card'>;
/** Tramo de un histórico. Fechas en AAAA-MM-DD. */
export interface HistoryEntry {
  value: string;       // <P>_CODI
  from: string;        // <P>_FALT
  to: string;          // <P>_FBAJ ('' = sin fecha de baja, en la BD '0')
  type: string;        // <P>_TIPO: A = alta, B = baja
  active: boolean;     // vigente hoy
  recordedAt: string;  // <P>_FECH + <P>_HORA → 'AAAA-MM-DD HH:MM' ('' si no hay)
  user: string;        // <P>_USUA (iniciales del usuario de Evalos)
}
export type PersonalHistory = Record<HistoryKind, HistoryEntry[]>;
/** periods = periodos de alta/baja del empleado (HIS_VIGENCIA), más recientes primero. */
export interface PersonalDetail extends Personal { history: PersonalHistory; periods: HistoryEntry[] }
/** Datos para volver a dar de alta a un empleado de baja: nueva fecha de alta y asignaciones (formulario vacío). */
export type ReadmitInput = Pick<PersonalInput, 'hireDate' | 'card' | 'company' | 'department' | 'section' | 'area'>;
/** Valor para un histórico: un código existente o un nombre nuevo (se crea con código automático). */
export type HistoryValue = { code: string } | { name: string };
/** Nombres nuevos escritos en el alta para empresa, departamento, sección y área. */
export type NewNames = Partial<Record<OrgKind, string>>;

/** Quién y cuándo hace un cambio en un histórico (HIS_*). */
export interface ChangeStamp { date: string /* aaaammdd */; time: string /* hhmm */; user: string /* iniciales */ }

/** Valores fijos que se escriben al dar de alta un empleado (no se tocan al modificar). */
export const PERSONAL_FIXED_ON_CREATE: Record<string, string> = { EM_CACC: '999', EM_CAUT: '001', EM_TURN: 'DEF' };

/** Operaciones que cada motor debe implementar. Cada pantalla nueva añade aquí sus métodos. */
export interface EvalosDriver {
  info(): Promise<ConnectionInfo>;
  detect(): Promise<DetectResult>;
  /** Estructura de todas las tablas (solo SQL Server). */
  schema?(opts?: { samples?: boolean }): Promise<SchemaExport>;
  listDepartments(): Promise<Department[]>;
  getDepartment(code: string): Promise<Department | null>;
  createDepartment(code: string, description: string): Promise<void>;
  updateDepartment(code: string, description: string): Promise<void>;
  /** Comprueba referencias y borra. Lanza HttpError 409 si hay empleados o históricos que lo usan. */
  deleteDepartment(code: string): Promise<void>;
  departmentEmployees(code: string, limit?: number): Promise<DepartmentEmployee[]>;
  /** Longitud máxima de código y descripción de departamento (null si no se conoce). */
  departmentLimits(): Promise<{ code: number | null; description: number | null }>;

  // Empleados (para selectores). Opcional: solo lo implementa el motor que lo soporte.
  listEmployees?(): Promise<EmployeeBrief[]>;

  // Personal (alta, modificación y baja de fichas en PERSONAL).
  listPersonal?(): Promise<Personal[]>;
  /** Incidencias (tabla INCIDENC) para los marcajes de Correcciones. */
  listIncidences?(): Promise<{ code: string; name: string }[]>;
  getPersonal?(code: string): Promise<Personal | null>;
  /**
   * Da de alta la ficha y, en la misma transacción: crea los valores nuevos (newNames) con código automático,
   * la tarjeta si no existe, y abre los tramos de tarjeta, empresa, departamento, sección y área desde la fecha de alta.
   */
  createPersonal?(p: PersonalInput, stamp: ChangeStamp, newNames?: NewNames): Promise<void>;
  /**
   * Modifica la ficha; no cambia el código ni los campos con histórico (tarjeta, empresa, departamento, sección y área).
   * Si lleva fecha de baja, en la misma transacción cierra con esa fecha todos los tramos HIS_* abiertos ese día
   * (409 si alguno empieza después de la baja).
   */
  updatePersonal?(code: string, p: Omit<PersonalInput, 'code'>, stamp: ChangeStamp): Promise<void>;
  /** Lanza HttpError 409 si el empleado tiene marcajes, calendarios, accesos u otros datos asociados. Borra sus históricos HIS_*. */
  deletePersonal?(code: string): Promise<void>;
  /** Históricos del empleado (más recientes primero). */
  personalHistory?(code: string): Promise<PersonalHistory>;
  /** Periodos de alta/baja del empleado (HIS_VIGENCIA), más recientes primero. */
  personalPeriods?(code: string): Promise<HistoryEntry[]>;
  /**
   * Vuelve a dar de alta a un empleado de baja: nuevo periodo en HIS_VIGENCIA, EM_FALT = nueva fecha, EM_FBAJ vacía
   * y tramos nuevos de tarjeta y organización desde esa fecha. 409 si no está de baja o la fecha no es posterior a la baja.
   */
  readmitPersonal?(code: string, r: ReadmitInput, stamp: ChangeStamp, newNames?: NewNames): Promise<void>;
  /**
   * Abre un tramo desde una fecha (AAAA-MM-DD). Tarjetas: 409 si otro empleado la tiene vigente.
   * Empresa/departamento/sección/área: cierra el tramo abierto el día anterior.
   */
  assignHistory?(kind: HistoryKind, code: string, value: HistoryValue, from: string, stamp: ChangeStamp): Promise<void>;
  /** Cierra el tramo (empleado, valor, desde) con fecha de baja y tipo B. */
  closeHistory?(kind: HistoryKind, code: string, value: string, from: string, to: string, stamp: ChangeStamp): Promise<void>;
  /** Copia el nombre y el email del usuario del portal vinculado a su ficha (EM_NOMB, EM_WFEM). */
  updatePersonalContact?(code: string, name: string, email: string): Promise<void>;
  /** Iniciales del usuario en Evalos 8 (tabla USUARIOS) para <P>_USUA. */
  userInitials?(email: string): Promise<string>;
  personalLookups?(): Promise<PersonalLookups>;
  personalLimits?(): Promise<PersonalLimits>;

  // Calendarios y convenios (por ahora solo en modo demostración).
  listCalendars?(): Promise<Calendar[]>;
  getCalendar?(code: string): Promise<CalendarDetail | null>;
  createCalendar?(c: { code: string; name: string; year: number; convenio?: string }): Promise<void>;
  updateCalendar?(code: string, patch: { name?: string; convenio?: string }): Promise<void>;
  deleteCalendar?(code: string): Promise<void>;
  addHoliday?(code: string, h: Holiday): Promise<void>;
  deleteHoliday?(code: string, date: string): Promise<void>;
  listConvenios?(): Promise<Convenio[]>;
  getConvenio?(code: string): Promise<Convenio | null>;
  saveConvenio?(c: Convenio, isNew: boolean): Promise<void>;
  deleteConvenio?(code: string): Promise<void>;
  calcVacation?(convenioCode: string, hireDate: string, year: number): Promise<VacationCalc>;

  // Correcciones (por ahora solo en modo demostración).
  listMarcajes?(): Promise<Marcaje[]>;
  updateMarcaje?(id: string, punches: MarcajePunch[]): Promise<void>;
  resolveMarcaje?(id: string): Promise<void>;
  listSolicitudes?(): Promise<Solicitud[]>;
  decideSolicitud?(id: string, approve: boolean): Promise<void>;
  listAusencias?(): Promise<Ausencia[]>;
  createAusencia?(a: Omit<Ausencia, 'id' | 'employeeName' | 'days'>): Promise<void>;
  deleteAusencia?(id: string): Promise<void>;

  close?(): Promise<void>;
}
