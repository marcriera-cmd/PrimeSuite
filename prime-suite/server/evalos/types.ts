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

/** Operaciones que cada motor debe implementar. Cada pantalla nueva añade aquí sus métodos. */
export interface EvalosDriver {
  info(): Promise<ConnectionInfo>;
  detect(): Promise<DetectResult>;
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
