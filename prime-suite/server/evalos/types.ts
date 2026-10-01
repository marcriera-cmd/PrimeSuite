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
  close?(): Promise<void>;
}
