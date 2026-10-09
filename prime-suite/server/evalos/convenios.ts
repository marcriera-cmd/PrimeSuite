// Atajos de Evalos · Convenios.
// Un convenio predefine, para el personal al que se asigne:
//  - tantos periodos de vacaciones como se quiera: tipo (TIPOSVACACIONES), inicio (día/mes) y días del periodo;
//  - el inicio (día/mes) del periodo de incidencias y, por cada incidencia de INCIDENC, su límite en días u horas.
// Cada periodo dura un año desde su día/mes de inicio (p. ej. 01/04 → del 01/04 al 31/03 del año siguiente).
// En la base de datos de Evalos 8 se guarda en tres tablas propias de Prime Suite:
//  PS_CONVENIOS             cabecera (una fila por convenio)
//  PS_CONVENIOS_VACACIONES  periodos de vacaciones (una fila por periodo, numeradas por convenio)
//  PS_CONVENIOS_LIMITES     límites de incidencia (una fila por convenio e incidencia)
import { HttpError } from '../http.ts';
import type { Convenio, ConvenioLimit, ConvenioVacation } from './types.ts';

export const CONVENIOS_TABLE = 'PS_CONVENIOS';
export const VACACIONES_TABLE = 'PS_CONVENIOS_VACACIONES';
export const LIMITES_TABLE = 'PS_CONVENIOS_LIMITES';
export const CONVENIO_CODE_MAX = 10;
export const CONVENIO_NAME_MAX = 60;
export const MAX_VACATION_DAYS = 365;
export const MAX_LIMIT_DAYS = 366;
export const MAX_LIMIT_MINUTES = 8784 * 60; // un año bisiesto entero
export const MAX_LIMITS = 200;
export const MAX_VACATIONS = 50;
export const VACATION_TYPE_MAX = 10;

/** Días de cada mes. Febrero tiene 28: un periodo no puede empezar el 29/02, que no existe todos los años. */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function validDayMonth(day: number, month: number) {
  return Number.isInteger(day) && Number.isInteger(month) && month >= 1 && month <= 12 && day >= 1 && day <= MONTH_DAYS[month - 1];
}

/** Periodo de un año que contiene `ref` (AAAA-MM-DD) y empieza el día/mes indicado. Fechas AAAA-MM-DD. */
export function periodAround(day: number, month: number, ref: string): { from: string; to: string } {
  const [y, m, d] = ref.split('-').map(Number);
  const startYear = m > month || (m === month && d >= day) ? y : y - 1;
  const from = new Date(Date.UTC(startYear, month - 1, day));
  const to = new Date(Date.UTC(startYear + 1, month - 1, day - 1));
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN);
const halfDays = (n: number) => Math.round(n * 2) === n * 2;

/**
 * Valida y normaliza un convenio recibido de la interfaz.
 * Los días admiten medios días; los límites en horas se reciben en minutos.
 */
export function sanitizeConvenio(b: any, opts: { uppercase: boolean; incidences?: Set<string>; vacationTypes?: Set<string> }): Convenio {
  const code = String(b?.code ?? '').trim();
  const finalCode = opts.uppercase ? code.toUpperCase() : code;
  if (!finalCode) throw new HttpError(400, 'Indica el código del convenio');
  if (finalCode.length > CONVENIO_CODE_MAX) throw new HttpError(400, `El código admite como máximo ${CONVENIO_CODE_MAX} caracteres`);
  if (!/^[A-Za-z0-9_.-]+$/.test(finalCode)) throw new HttpError(400, 'El código solo admite letras, números, guion, punto y guion bajo');
  const name = String(b?.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new HttpError(400, 'Indica el nombre del convenio');
  if (name.length > CONVENIO_NAME_MAX) throw new HttpError(400, `El nombre admite como máximo ${CONVENIO_NAME_MAX} caracteres`);

  // Periodos de vacaciones: tantos como se quiera (también del mismo tipo), en el orden en que se dan.
  const rawVac: any[] = Array.isArray(b?.vacations) ? b.vacations : [];
  if (rawVac.length > MAX_VACATIONS) throw new HttpError(400, `Como máximo ${MAX_VACATIONS} periodos de vacaciones por convenio`);
  const seenVac = new Set<string>();
  const vacations: ConvenioVacation[] = rawVac.map((v, i) => {
    const type = String(v?.type ?? '').trim();
    if (!type) throw new HttpError(400, `Elige el tipo de vacaciones de la línea ${i + 1}`);
    if (type.length > VACATION_TYPE_MAX) throw new HttpError(400, `El tipo de vacaciones admite como máximo ${VACATION_TYPE_MAX} caracteres`);
    if (opts.vacationTypes && !opts.vacationTypes.has(type)) throw new HttpError(400, `El tipo de vacaciones ${type} no existe en TIPOSVACACIONES`);
    const day = num(v?.day), month = num(v?.month);
    if (!validDayMonth(day, month)) throw new HttpError(400, `El inicio del periodo de ${type} no es una fecha válida (día/mes)`);
    const key = `${type}|${day}|${month}`;
    if (seenVac.has(key)) throw new HttpError(400, `El periodo de ${type} que empieza el ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')} está repetido`);
    seenVac.add(key);
    const days = num(v?.days);
    if (!Number.isFinite(days) || days <= 0 || days > MAX_VACATION_DAYS || !halfDays(days))
      throw new HttpError(400, `Los días de vacaciones de ${type} deben ser de 0,5 a ${MAX_VACATION_DAYS} (admite medios días)`);
    return { type, day, month, days };
  });

  const incidenceDay = num(b?.incidenceDay), incidenceMonth = num(b?.incidenceMonth);
  if (!validDayMonth(incidenceDay, incidenceMonth)) throw new HttpError(400, 'El inicio del periodo de incidencias no es una fecha válida (día/mes)');

  const raw: any[] = Array.isArray(b?.limits) ? b.limits : [];
  if (raw.length > MAX_LIMITS) throw new HttpError(400, `Como máximo ${MAX_LIMITS} incidencias por convenio`);
  const seen = new Set<string>();
  const limits: ConvenioLimit[] = raw.map((l, i) => {
    const incidence = String(l?.incidence ?? '').trim();
    if (!incidence) throw new HttpError(400, `Elige la incidencia de la línea ${i + 1}`);
    if (seen.has(incidence)) throw new HttpError(400, `La incidencia ${incidence} está repetida`);
    seen.add(incidence);
    if (opts.incidences && !opts.incidences.has(incidence)) throw new HttpError(400, `La incidencia ${incidence} no existe en la tabla INCIDENC`);
    const unit: ConvenioLimit['unit'] | null = l?.unit === 'H' ? 'H' : l?.unit === 'D' ? 'D' : null;
    if (!unit) throw new HttpError(400, `Indica si el límite de la incidencia ${incidence} es en días u horas`);
    const value = num(l?.value);
    if (unit === 'D') {
      if (!Number.isFinite(value) || value <= 0 || value > MAX_LIMIT_DAYS || !halfDays(value))
        throw new HttpError(400, `El límite de la incidencia ${incidence} debe ser de 0,5 a ${MAX_LIMIT_DAYS} días (admite medios días)`);
    } else if (!Number.isInteger(value) || value <= 0 || value > MAX_LIMIT_MINUTES) {
      throw new HttpError(400, `El límite de la incidencia ${incidence} debe ser una cantidad de horas mayor que 00:00`);
    }
    return { incidence, unit, value };
  }).sort((a, b) => a.incidence.localeCompare(b.incidence));

  return { code: finalCode, name, vacations, incidenceDay, incidenceMonth, limits };
}

/** Script de SQL Server que crea las tablas de convenios en la BD de Evalos 8 (se puede lanzar varias veces). */
export function conveniosSql(schema = 'dbo') {
  const s = `[${(schema || 'dbo').replace(/]/g, ']]')}]`;
  const q = (x: string) => x.replace(/'/g, "''"); // dentro de EXEC (N'...')
  return `-- Atajos de Evalos (Prime Suite) · Convenios
-- Crea las tablas de convenios en la base de datos de Evalos 8. Se puede ejecutar varias veces: solo crea lo que falta.
--
-- ${CONVENIOS_TABLE}: un registro por convenio.
--   CV_CODI  código del convenio
--   CV_DESC  nombre
--   CV_IDIA / CV_IMES  día y mes de inicio del periodo de incidencias (el periodo dura un año)
--   CV_FECH / CV_HORA / CV_USUA  última modificación: fecha aaaammdd, hora hhmm e iniciales del usuario (como Evalos)
--
-- ${VACACIONES_TABLE}: periodos de vacaciones de cada convenio (tantos como se quiera, también del mismo tipo).
--   CA_CONV  código del convenio (${CONVENIOS_TABLE}.CV_CODI; se borra con el convenio)
--   CA_LINE  número de periodo dentro del convenio (1, 2, 3…)
--   CA_TVAC  tipo de vacaciones (TIPOSVACACIONES.CODIGO)
--   CA_VDIA / CA_VMES  día y mes de inicio del periodo (el periodo dura un año)
--   CA_DIAS  días de vacaciones del periodo (admite medios días)
--
-- ${LIMITES_TABLE}: límites de incidencia de cada convenio (una fila por incidencia).
--   CL_CONV  código del convenio (${CONVENIOS_TABLE}.CV_CODI; se borra con el convenio)
--   CL_INCI  código de la incidencia (INCIDENC.IN_CODI)
--   CL_UNID  D = límite en días, H = límite en horas
--   CL_DIAS  límite en días (si CL_UNID = 'D'; admite medios días)
--   CL_MINU  límite en minutos (si CL_UNID = 'H'; 8:30 h = 510)

IF OBJECT_ID(N'${s}.[${CONVENIOS_TABLE}]', N'U') IS NULL
BEGIN
  CREATE TABLE ${s}.[${CONVENIOS_TABLE}] (
    CV_CODI nvarchar(${CONVENIO_CODE_MAX}) NOT NULL,
    CV_DESC nvarchar(${CONVENIO_NAME_MAX}) NOT NULL,
    CV_IDIA tinyint       NOT NULL CONSTRAINT DF_PS_CONVENIOS_IDIA DEFAULT (1),
    CV_IMES tinyint       NOT NULL CONSTRAINT DF_PS_CONVENIOS_IMES DEFAULT (1),
    CV_FECH char(8)       NULL,
    CV_HORA char(4)       NULL,
    CV_USUA nvarchar(10)  NULL,
    CONSTRAINT PK_PS_CONVENIOS PRIMARY KEY (CV_CODI),
    CONSTRAINT CK_PS_CONVENIOS_INCIDENCIAS CHECK (CV_IMES BETWEEN 1 AND 12 AND CV_IDIA BETWEEN 1 AND 31)
  );
END;

IF OBJECT_ID(N'${s}.[${VACACIONES_TABLE}]', N'U') IS NULL
BEGIN
  CREATE TABLE ${s}.[${VACACIONES_TABLE}] (
    CA_CONV nvarchar(${CONVENIO_CODE_MAX}) NOT NULL,
    CA_LINE smallint      NOT NULL,
    CA_TVAC nvarchar(${VACATION_TYPE_MAX}) NOT NULL,
    CA_VDIA tinyint       NOT NULL,
    CA_VMES tinyint       NOT NULL,
    CA_DIAS decimal(5, 1) NOT NULL,
    CONSTRAINT PK_PS_CONVENIOS_VACACIONES PRIMARY KEY (CA_CONV, CA_LINE),
    CONSTRAINT FK_PS_CONVENIOS_VACACIONES_CONV FOREIGN KEY (CA_CONV) REFERENCES ${s}.[${CONVENIOS_TABLE}] (CV_CODI) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT CK_PS_CONVENIOS_VACACIONES_INICIO CHECK (CA_VMES BETWEEN 1 AND 12 AND CA_VDIA BETWEEN 1 AND 31),
    CONSTRAINT CK_PS_CONVENIOS_VACACIONES_DIAS CHECK (CA_DIAS > 0 AND CA_DIAS <= ${MAX_VACATION_DAYS})
  );
END;

-- Tabla creada con una versión anterior del script (un solo periodo por tipo): se numeran los periodos.
IF COL_LENGTH(N'${s}.[${VACACIONES_TABLE}]', N'CA_LINE') IS NULL
BEGIN
  ALTER TABLE ${s}.[${VACACIONES_TABLE}] ADD CA_LINE smallint NOT NULL CONSTRAINT DF_PS_CONVENIOS_VACACIONES_LINE DEFAULT (1);
  EXEC (N'WITH n AS (SELECT CA_LINE, ROW_NUMBER() OVER (PARTITION BY CA_CONV ORDER BY CA_TVAC) AS r FROM ${q(s)}.[${VACACIONES_TABLE}])
    UPDATE n SET CA_LINE = r;
    ALTER TABLE ${q(s)}.[${VACACIONES_TABLE}] DROP CONSTRAINT PK_PS_CONVENIOS_VACACIONES;
    ALTER TABLE ${q(s)}.[${VACACIONES_TABLE}] ADD CONSTRAINT PK_PS_CONVENIOS_VACACIONES PRIMARY KEY (CA_CONV, CA_LINE);');
END;

IF OBJECT_ID(N'${s}.[${LIMITES_TABLE}]', N'U') IS NULL
BEGIN
  CREATE TABLE ${s}.[${LIMITES_TABLE}] (
    CL_CONV nvarchar(${CONVENIO_CODE_MAX}) NOT NULL,
    CL_INCI nvarchar(10)  NOT NULL,
    CL_UNID char(1)       NOT NULL,
    CL_DIAS decimal(5, 1) NULL,
    CL_MINU int           NULL,
    CONSTRAINT PK_PS_CONVENIOS_LIMITES PRIMARY KEY (CL_CONV, CL_INCI),
    CONSTRAINT FK_PS_CONVENIOS_LIMITES_CONV FOREIGN KEY (CL_CONV) REFERENCES ${s}.[${CONVENIOS_TABLE}] (CV_CODI) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT CK_PS_CONVENIOS_LIMITES_VALOR CHECK (
      (CL_UNID = 'D' AND CL_DIAS > 0 AND CL_MINU IS NULL) OR
      (CL_UNID = 'H' AND CL_MINU > 0 AND CL_DIAS IS NULL)
    )
  );
END;
`;
}

// ---------- Tipos de vacaciones (TIPOSVACACIONES de Evalos 8) ----------
/**
 * Valores con los que se crea un tipo de vacaciones nuevo, como los deja Evalos 8 (S = marcado, N = sin marcar,
 * '' = vacío). Solo se escriben las columnas que existan en la tabla.
 */
export const VACATION_TYPE_DEFAULTS: Record<string, 'S' | 'N' | ''> = {
  TEORICAS_HORARIO: 'S', TEORICAS_VACACIONES: 'N', TEORICAS_OTROS: 'N', FESTIVO: 'N', NOLABORABLE: 'N',
  DIASTRIENIO: '', DESDETRIENIO: '', HASTATRIENIO: '', DIASTRIENIO2: '', DESDETRIENIO2: '', HASTATRIENIO2: '',
  MAXDAYS: '', DIASPERIODO: '', HORASDISPO: 'N', INCIDENCIACOMPENSAR: '', YEAR: '',
  PERMITIRDIA: 'S', PERMITIRMEDIODIA: 'S', PERMITIRHORAS: 'S'
};

/**
 * Valor de VACATION_TYPE_DEFAULTS adaptado al tipo de la columna: en texto se escribe tal cual; en columnas
 * numéricas o bit, S/N pasan a 1/0 y el vacío a NULL (o 0 si la columna no admite NULL).
 * Devuelve undefined si no se sabe escribir en ese tipo de columna (se deja al valor por defecto de la tabla).
 */
export function vacationTypeDefault(v: 'S' | 'N' | '', col: { type: string; nullable: boolean }, kinds: { text: string[]; num: string[] }): string | number | null | undefined {
  if (kinds.text.includes(col.type)) return v;
  if (kinds.num.includes(col.type)) return v === 'S' ? 1 : v === 'N' ? 0 : col.nullable ? null : 0;
  return v === '' && col.nullable ? null : undefined;
}
/** Formato en que la tabla guarda el color, deducido de los valores que ya tiene. */
export type ColorFormat = 'hex' | 'argb' | 'ole' | 'none';

/** Color #rrggbb → valor para la columna, en el mismo formato que las filas existentes. */
export function encodeColor(hex: string, format: ColorFormat): string | number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m || format === 'none') return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  if (format === 'hex') return m[1].toUpperCase();
  if (format === 'argb') return (0xff000000 | n) | 0;            // System.Drawing.Color.ToArgb() (opaco, negativo)
  return r + g * 256 + b * 65536;                                // OLE/Win32: BGR
}

/** Deduce el formato del color a partir del tipo de columna y de los valores guardados. */
export function detectColorFormat(columnIsText: boolean, samples: unknown[]): ColorFormat {
  const vals = samples.map((v) => (v == null ? '' : String(v).trim())).filter(Boolean);
  if (columnIsText && (!vals.length || vals.some((v) => /^#?[0-9a-f]{6}$/i.test(v) && !/^-?\d+$/.test(v)))) return 'hex';
  if (vals.some((v) => /^-\d+$/.test(v) || Number(v) > 0xffffff)) return 'argb';
  if (columnIsText && vals.length && vals.every((v) => /^\d+$/.test(v) && v.length !== 6)) return 'ole';
  return columnIsText ? 'hex' : 'ole';
}
