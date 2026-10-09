// Atajos de Evalos · Convenios.
// Un convenio predefine, para el personal al que se asigne:
//  - el inicio (día/mes) del periodo de vacaciones y los días de vacaciones del periodo;
//  - el inicio (día/mes) del periodo de incidencias y, por cada incidencia de INCIDENC, su límite en días u horas.
// Cada periodo dura un año desde su día/mes de inicio (p. ej. 01/04 → del 01/04 al 31/03 del año siguiente).
// En la base de datos de Evalos 8 se guarda en dos tablas propias de Prime Suite:
//  PS_CONVENIOS          cabecera (una fila por convenio)
//  PS_CONVENIOS_LIMITES  límites de incidencia (una fila por convenio e incidencia)
import { HttpError } from '../http.ts';
import type { Convenio, ConvenioLimit } from './types.ts';

export const CONVENIOS_TABLE = 'PS_CONVENIOS';
export const LIMITES_TABLE = 'PS_CONVENIOS_LIMITES';
export const CONVENIO_CODE_MAX = 10;
export const CONVENIO_NAME_MAX = 60;
export const MAX_VACATION_DAYS = 365;
export const MAX_LIMIT_DAYS = 366;
export const MAX_LIMIT_MINUTES = 8784 * 60; // un año bisiesto entero
export const MAX_LIMITS = 200;

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

/**
 * Valida y normaliza un convenio recibido de la interfaz.
 * Los límites en días admiten medios días; los de horas se reciben en minutos.
 */
export function sanitizeConvenio(b: any, opts: { uppercase: boolean; incidences?: Set<string> }): Convenio {
  const code = String(b?.code ?? '').trim();
  const finalCode = opts.uppercase ? code.toUpperCase() : code;
  if (!finalCode) throw new HttpError(400, 'Indica el código del convenio');
  if (finalCode.length > CONVENIO_CODE_MAX) throw new HttpError(400, `El código admite como máximo ${CONVENIO_CODE_MAX} caracteres`);
  if (!/^[A-Za-z0-9_.-]+$/.test(finalCode)) throw new HttpError(400, 'El código solo admite letras, números, guion, punto y guion bajo');
  const name = String(b?.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new HttpError(400, 'Indica el nombre del convenio');
  if (name.length > CONVENIO_NAME_MAX) throw new HttpError(400, `El nombre admite como máximo ${CONVENIO_NAME_MAX} caracteres`);

  const vacationDay = num(b?.vacationDay), vacationMonth = num(b?.vacationMonth);
  if (!validDayMonth(vacationDay, vacationMonth)) throw new HttpError(400, 'El inicio del periodo de vacaciones no es una fecha válida (día/mes)');
  const incidenceDay = num(b?.incidenceDay), incidenceMonth = num(b?.incidenceMonth);
  if (!validDayMonth(incidenceDay, incidenceMonth)) throw new HttpError(400, 'El inicio del periodo de incidencias no es una fecha válida (día/mes)');

  const vacationDays = num(b?.vacationDays);
  if (!Number.isFinite(vacationDays) || vacationDays < 0 || vacationDays > MAX_VACATION_DAYS) throw new HttpError(400, `Los días de vacaciones deben estar entre 0 y ${MAX_VACATION_DAYS}`);
  if (Math.round(vacationDays * 2) !== vacationDays * 2) throw new HttpError(400, 'Los días de vacaciones admiten como mucho medios días (p. ej. 22,5)');

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
      if (!Number.isFinite(value) || value <= 0 || value > MAX_LIMIT_DAYS || Math.round(value * 2) !== value * 2)
        throw new HttpError(400, `El límite de la incidencia ${incidence} debe ser de 0,5 a ${MAX_LIMIT_DAYS} días (admite medios días)`);
    } else if (!Number.isInteger(value) || value <= 0 || value > MAX_LIMIT_MINUTES) {
      throw new HttpError(400, `El límite de la incidencia ${incidence} debe ser una cantidad de horas mayor que 00:00`);
    }
    return { incidence, unit, value };
  }).sort((a, b) => a.incidence.localeCompare(b.incidence));

  return { code: finalCode, name, vacationDay, vacationMonth, vacationDays, incidenceDay, incidenceMonth, limits };
}

/** Script de SQL Server que crea las tablas de convenios en la BD de Evalos 8 (se puede lanzar varias veces). */
export function conveniosSql(schema = 'dbo') {
  const s = `[${(schema || 'dbo').replace(/]/g, ']]')}]`;
  return `-- Atajos de Evalos (Prime Suite) · Convenios
-- Crea las tablas de convenios en la base de datos de Evalos 8. Se puede ejecutar varias veces: solo crea lo que falta.
--
-- ${CONVENIOS_TABLE}: un registro por convenio.
--   CV_CODI  código del convenio
--   CV_DESC  nombre
--   CV_VDIA / CV_VMES  día y mes de inicio del periodo de vacaciones (el periodo dura un año)
--   CV_VACA  días de vacaciones del periodo (admite medios días)
--   CV_IDIA / CV_IMES  día y mes de inicio del periodo de incidencias (el periodo dura un año)
--   CV_FECH / CV_HORA / CV_USUA  última modificación: fecha aaaammdd, hora hhmm e iniciales del usuario (como Evalos)
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
    CV_VDIA tinyint       NOT NULL CONSTRAINT DF_PS_CONVENIOS_VDIA DEFAULT (1),
    CV_VMES tinyint       NOT NULL CONSTRAINT DF_PS_CONVENIOS_VMES DEFAULT (1),
    CV_VACA decimal(5, 1) NOT NULL CONSTRAINT DF_PS_CONVENIOS_VACA DEFAULT (0),
    CV_IDIA tinyint       NOT NULL CONSTRAINT DF_PS_CONVENIOS_IDIA DEFAULT (1),
    CV_IMES tinyint       NOT NULL CONSTRAINT DF_PS_CONVENIOS_IMES DEFAULT (1),
    CV_FECH char(8)       NULL,
    CV_HORA char(4)       NULL,
    CV_USUA nvarchar(10)  NULL,
    CONSTRAINT PK_PS_CONVENIOS PRIMARY KEY (CV_CODI),
    CONSTRAINT CK_PS_CONVENIOS_VACACIONES CHECK (CV_VMES BETWEEN 1 AND 12 AND CV_VDIA BETWEEN 1 AND 31),
    CONSTRAINT CK_PS_CONVENIOS_INCIDENCIAS CHECK (CV_IMES BETWEEN 1 AND 12 AND CV_IDIA BETWEEN 1 AND 31),
    CONSTRAINT CK_PS_CONVENIOS_DIAS CHECK (CV_VACA >= 0 AND CV_VACA <= ${MAX_VACATION_DAYS})
  );
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
