// Correcciones › Marcajes con conexión real: datos de EvalosRest (API REST de Evalos 8).
//  - Anomalías: listado PS_ANOMA calculado con GET /Report/filter.
//  - Marcajes de presencia: GET /Booking/attendance[/{empleado}].
//  - Corregir = añadir marcajes manuales con POST /Booking/attendance (Debug "MAN").
// Las respuestas de Evalos se interpretan de forma tolerante (los nombres de campo varían según versión).
import { HttpError } from '../http.ts';
import { evalosRestGet, evalosRestPost } from '../evalosrest.ts';

export const ANOMALY_REPORT = 'PS_ANOMA';
export const MAX_DAYS = 31;
export const MAX_NEW_PUNCHES = 20;

export interface RestPunch {
  time: string;            // HH:mm
  seconds: string;         // HH:mm:ss (orden y deduplicado)
  type: 'E' | 'S';
  incidence: string;       // código de incidencia ('00' = normal)
  incidenceName?: string;
  terminal?: string;
  manual: boolean;         // insertado a mano (Debug MAN / sin terminal)
  anomaly?: string;
}
export interface RestMarcaje {
  id: string;              // <empleado>|<AAAA-MM-DD>
  employee: string;
  employeeName: string;
  date: string;            // AAAA-MM-DD
  punches: RestPunch[];
  status: 'OK' | 'INCIDENCIA';
  issues: string[];        // anomalías del día (PS_ANOMA y marcajes con anomalía)
}
export interface Anomaly { employee: string; employeeName?: string; date: string; text: string }

// ---------- Fechas y horas ----------
export const pad = (n: number | string, l = 2) => String(n).padStart(l, '0');
/** AAAA-MM-DD → dd/mm/aaaa (formato de las consultas de EvalosRest). */
export const toEvalosQueryDate = (iso: string) => iso.split('-').reverse().join('/');
/** AAAA-MM-DD → aaaammdd (formato del cuerpo de los marcajes). */
export const toEvalosBodyDate = (iso: string) => iso.replace(/-/g, '');

/** Normaliza una fecha de Evalos (aaaammdd, dd/mm/aaaa, ISO, /Date(ms)/) a AAAA-MM-DD; '' si no se reconoce. */
export function normDate(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  // aaaammdd (con año/mes/día plausibles: un código de empleado de 8 cifras no es una fecha)
  if ((m = s.match(/^(19\d{2}|20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/\/Date\((-?\d+)/))) { const d = new Date(Number(m[1])); return isNaN(+d) ? '' : d.toISOString().slice(0, 10); }
  return '';
}
/** Normaliza una hora (HHmmss, HHmm, HH:mm[:ss], ISO con T) a HH:mm:ss; '' si no se reconoce. */
export function normTime(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/))) return `${m[1]}:${m[2]}:${m[3] || '00'}`;
  if ((m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/))) return `${pad(m[1])}:${m[2]}:${m[3] || '00'}`;
  if ((m = s.match(/^(\d{2})(\d{2})(\d{2})?$/))) return `${m[1]}:${m[2]}:${m[3] || '00'}`;
  return '';
}

// ---------- Lectura tolerante de objetos de Evalos ----------
const txt = (v: unknown) => (v == null ? '' : typeof v === 'object' ? '' : String(v).trim());
/** Primer valor no vacío entre las claves indicadas (sin distinguir mayúsculas). */
function pick(o: Record<string, unknown>, ...keys: string[]): string {
  const lower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    if (real !== undefined) { const v = txt(o[real]); if (v) return v; }
  }
  return '';
}
const truthy = (v: unknown) => v === true || /^(true|s|si|sí|1|y|yes)$/i.test(String(v ?? '').trim());

/** Convierte cualquier forma de lista de Evalos (array, {Rows/Columns}, DataSet {Table}, {Data}…) en filas objeto. */
export function rowsOf(data: unknown): Record<string, unknown>[] {
  if (typeof data === 'string') { try { return rowsOf(JSON.parse(data)); } catch { return []; } }
  if (Array.isArray(data)) {
    if (data.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return data as Record<string, unknown>[];
    return [];
  }
  if (!data || typeof data !== 'object') return [];
  const o = data as Record<string, any>;
  const key = (re: RegExp) => Object.keys(o).find((k) => re.test(k));
  const rowsKey = key(/^rows$/i), colsKey = key(/^(columns|cols|headers|header)$/i);
  if (rowsKey && Array.isArray(o[rowsKey])) {
    const rows = o[rowsKey] as any[];
    const cols: string[] = colsKey && Array.isArray(o[colsKey]) ? o[colsKey].map((c: any) => (c && typeof c === 'object' ? txt(c.Name ?? c.name ?? c.Header ?? c.header ?? c.Caption ?? c.Id ?? c.id) : txt(c))) : [];
    return rows.map((r) => {
      if (Array.isArray(r)) return Object.fromEntries(r.map((v, i) => [cols[i] || `C${i + 1}`, v]));
      if (r && typeof r === 'object' && Array.isArray(r.Values ?? r.values ?? r.Cells ?? r.cells)) {
        const vals = r.Values ?? r.values ?? r.Cells ?? r.cells;
        return Object.fromEntries(vals.map((v: any, i: number) => [cols[i] || `C${i + 1}`, v && typeof v === 'object' ? v.Value ?? v.value ?? v.Text ?? v.text : v]));
      }
      return r && typeof r === 'object' ? r : {};
    });
  }
  for (const k of ['Table', 'Table1', 'Data', 'data', 'Items', 'items', 'Result', 'result', 'Lines', 'Lineas', 'Report']) {
    if (k in o) { const r = rowsOf(o[k]); if (r.length) return r; }
  }
  // Un único objeto con forma de fila.
  return Object.values(o).some((v) => v == null || typeof v !== 'object') ? [o] : [];
}

// ---------- Anomalías (PS_ANOMA) ----------
const EMP_KEYS = ['EM_CODI', 'CodeEmployee', 'EmployeeCode', 'Codigo', 'Código', 'CODIGO', 'Code', 'Empleado', 'Employee'];
const NAME_KEYS = ['EM_NOMB', 'Nombre', 'Name', 'EmployeeName', 'Description', 'ApellidosNombre'];
const DATE_KEYS = ['FECHA', 'Fecha', 'Date', 'Dia', 'Día', 'Day', 'DateFormatted'];


/** Nombres legibles de las columnas de PS_ANOMA (por cabecera o por variable del generador de listados). */
const ANOMALY_LABELS: Record<string, string> = {
  RETRA: 'Retraso', RETRASO: 'Retraso',
  SAANT: 'Salida antes', 'SALIDA ANTES': 'Salida antes',
  FUHOR: 'Fuera de horas', 'FUERA DE HORAS': 'Fuera de horas',
  ABSIN: 'Absentismo injustificado', 'AB. INJUSTIFICADO': 'Absentismo injustificado', 'AB INJUSTIFICADO': 'Absentismo injustificado',
  'M. IMPARES': 'Marcajes impares', 'M IMPARES': 'Marcajes impares', NUMMC: 'Marcajes impares',
  NFSTR: 'Festivo trabajado', 'FES.TRABAJADO': 'Festivo trabajado', 'FES. TRABAJADO': 'Festivo trabajado',
  NVATR: 'Vacaciones trabajadas', 'VAC.TRABAJADAS': 'Vacaciones trabajadas', 'VAC. TRABAJADAS': 'Vacaciones trabajadas'
};
const labelOf = (k: string) => ANOMALY_LABELS[k.trim().toUpperCase()] || k.trim().charAt(0).toUpperCase() + k.trim().slice(1).toLowerCase();

/** Valor de una columna de anomalía: '' si es cero o vacío (horas 0:00, 0, 0,00, False…); si no, el valor a mostrar. */
function anomalyValue(v: unknown): string {
  if (v == null || typeof v === 'object') return '';
  if (typeof v === 'boolean') return v ? 'sí' : '';
  const s = String(v).trim();
  if (!s || /^(false|no|n)$/i.test(s)) return '';
  if (/^[-+]?0*([.,:]0*)*$/.test(s) || /^[-+]?0*:0+(:0+)?$/.test(s)) return '';
  if (/^(true|s|si|sí|y|yes)$/i.test(s)) return 'sí';
  return s;
}

/**
 * Anomalías por empleado y día a partir de las filas del listado PS_ANOMA.
 * El listado devuelve una fila por empleado y día con contadores (retraso, salida antes, fuera de horas,
 * absentismo injustificado, marcajes impares, festivo/vacaciones trabajados…): hay anomalía si alguno no es cero.
 */
export function parseAnomalies(data: unknown): Anomaly[] {
  const out: Anomaly[] = [];
  for (const row of rowsOf(data)) {
    const employee = pick(row, ...EMP_KEYS);
    let date = normDate(pick(row, ...DATE_KEYS));
    if (!date) { // fecha en cualquier columna con forma de fecha
      for (const v of Object.values(row)) { const d = normDate(v); if (d) { date = d; break; } }
    }
    if (!employee || !date) continue;
    const fixed = new Set([...EMP_KEYS, ...NAME_KEYS, ...DATE_KEYS].map((x) => x.toLowerCase()));
    const parts: string[] = [];
    for (const [k, v] of Object.entries(row)) {
      if (fixed.has(k.toLowerCase()) || normDate(v) === date) continue;
      const val = anomalyValue(v);
      if (!val) continue;
      const label = labelOf(k);
      // Contadores 1/sí: basta el nombre; horas o cantidades: nombre y valor.
      parts.push(/^(1|sí)$/.test(val) ? label : `${label} ${val}`);
    }
    if (parts.length) out.push({ employee, employeeName: pick(row, ...NAME_KEYS) || undefined, date, text: parts.join(' · ') });
  }
  return out;
}

// ---------- Marcajes (Booking/attendance) ----------
export interface ParsedBooking { employee: string; date: string; seconds: string; inOut: '' | 'E' | 'S'; incidence: string; incidenceName?: string; terminal?: string; manual: boolean; anomaly?: string }

export function parseBookings(data: unknown): ParsedBooking[] {
  const out: ParsedBooking[] = [];
  for (const b of rowsOf(data)) {
    const employee = pick(b, 'CodeEmployee', 'EmployeeCode', 'EM_CODI', 'Code');
    const dt = pick(b, 'DateTime', 'RealTime');
    const date = normDate(pick(b, 'Date', 'DateFormatted')) || normDate(dt);
    const seconds = normTime(pick(b, 'Time', 'TimeFormatted')) || normTime(dt);
    if (!employee || !date || !seconds) continue;
    const io = pick(b, 'InOut', 'Type').toUpperCase();
    const debug = pick(b, 'Debug');
    const terminal = [pick(b, 'Installation'), pick(b, 'Clock'), pick(b, 'Lector')].filter(Boolean).join('-');
    const anomalyText = pick(b, 'DescriptionAnomaly', 'Anomaly', 'MsgError');
    out.push({
      employee, date, seconds,
      inOut: io === 'E' || io === 'I' || io === 'ENTRADA' ? 'E' : io === 'S' || io === 'O' || io === 'SALIDA' ? 'S' : '',
      incidence: pick(b, 'Incidence') || '00',
      incidenceName: pick(b, 'DescriptionIncidence') || undefined,
      terminal: pick(b, 'DescriptionTerminal') || terminal || undefined,
      manual: /^MAN/i.test(debug) || !terminal,
      anomaly: anomalyText && anomalyText !== '0' ? anomalyText : truthy(b.HasAnomalies) ? 'Marcaje con anomalía' : undefined
    });
  }
  return out;
}

/** Agrupa marcajes y anomalías por empleado y día, como la vista de Marcajes. Orden: fecha desc., empleado. */
export function buildMarcajes(bookings: ParsedBooking[], anomalies: Anomaly[], names: Map<string, string>): RestMarcaje[] {
  const days = new Map<string, RestMarcaje>();
  const day = (employee: string, date: string, name?: string) => {
    const id = `${employee}|${date}`;
    let d = days.get(id);
    if (!d) { d = { id, employee, employeeName: names.get(employee) || name || employee, date, punches: [], status: 'OK', issues: [] }; days.set(id, d); }
    else if (d.employeeName === employee && name) d.employeeName = name;
    return d;
  };
  const seen = new Set<string>();
  for (const b of bookings) {
    const key = `${b.employee}|${b.date}|${b.seconds}|${b.incidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    day(b.employee, b.date).punches.push({
      time: b.seconds.slice(0, 5), seconds: b.seconds, type: b.inOut || 'E', incidence: b.incidence, incidenceName: b.incidenceName,
      terminal: b.terminal, manual: b.manual, anomaly: b.anomaly, ...(b.inOut ? {} : { _auto: true })
    } as RestPunch);
  }
  for (const a of anomalies) {
    const d = day(a.employee, a.date, a.employeeName);
    if (!d.issues.includes(a.text)) d.issues.push(a.text);
  }
  for (const d of days.values()) {
    d.punches.sort((x, y) => x.seconds.localeCompare(y.seconds));
    // Sin sentido E/S de Evalos: se alternan entrada/salida por orden.
    d.punches.forEach((p: any, i) => { if (p._auto) { p.type = i % 2 === 0 ? 'E' : 'S'; delete p._auto; } });
    for (const p of d.punches) if (p.anomaly && !d.issues.includes(p.anomaly)) d.issues.push(p.anomaly);
    if (d.issues.length) d.status = 'INCIDENCIA';
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName, 'es') || a.employee.localeCompare(b.employee));
}

// ---------- Llamadas a EvalosRest ----------
const CODE_RE = /^[A-Za-z0-9_.\-]{1,20}$/;
export function cleanEmployeeCode(v: unknown, required = false): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) { if (required) throw new HttpError(400, 'Falta el empleado'); return ''; }
  if (!CODE_RE.test(s)) throw new HttpError(400, 'Código de empleado no válido');
  return s;
}
export function cleanRange(from: unknown, to: unknown): { from: string; to: string } {
  const ok = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(`${v}T00:00:00Z`));
  if (!ok(from) || !ok(to)) throw new HttpError(400, 'Periodo no válido (AAAA-MM-DD)');
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  if (b < a) throw new HttpError(400, 'La fecha «hasta» es anterior a «desde»');
  if ((b - a) / 86400000 + 1 > MAX_DAYS) throw new HttpError(400, `El periodo no puede superar ${MAX_DAYS} días`);
  return { from: from as string, to: to as string };
}

export interface MarcajesResult { marcajes: RestMarcaje[]; warnings: string[]; ms: number; report: string }

/** Marcajes y anomalías del periodo (todos los empleados o uno). Si PS_ANOMA falla, se devuelven los marcajes con un aviso. */
export async function loadMarcajes(opts: { from: string; to: string; employee?: string; names: Map<string, string>; portalOrigin: string }): Promise<MarcajesResult> {
  const started = Date.now();
  const q = `dateAdd=${encodeURIComponent(toEvalosQueryDate(opts.from))}&dateEnd=${encodeURIComponent(toEvalosQueryDate(opts.to))}`;
  const bookingPath = `/Booking/attendance${opts.employee ? `/${encodeURIComponent(opts.employee)}` : ''}?${q}`;
  // `filter` es obligatorio en Report/filter (sin él EvalosRest responde 404): sin empleado, un filtro que incluye a todos.
  const filter = opts.employee ? `EM_CODI='${opts.employee}'` : `EM_CODI<>''`;
  const reportPath = `/Report/filter?id=${ANOMALY_REPORT}&${q}&filter=${encodeURIComponent(filter)}`;
  const warnings: string[] = [];
  const [bk, rp] = await Promise.all([
    evalosRestGet(bookingPath, opts.portalOrigin),
    evalosRestGet(reportPath, opts.portalOrigin).catch((e: any) => { warnings.push(`No se pudo calcular el listado ${ANOMALY_REPORT}: ${e?.message || e}`); return null; })
  ]);
  const anomalies = rp ? parseAnomalies(rp.data).filter((a) => a.date >= opts.from && a.date <= opts.to && (!opts.employee || a.employee === opts.employee)) : [];
  const bookings = parseBookings(bk.data).filter((b) => b.date >= opts.from && b.date <= opts.to && (!opts.employee || b.employee === opts.employee));
  return { marcajes: buildMarcajes(bookings, anomalies, opts.names), warnings, ms: Date.now() - started, report: ANOMALY_REPORT };
}

export interface NewPunch { time: string; incidence: string }
export function cleanNewPunches(v: unknown): NewPunch[] {
  if (!Array.isArray(v) || !v.length) throw new HttpError(400, 'Añade al menos un marcaje');
  if (v.length > MAX_NEW_PUNCHES) throw new HttpError(400, `Como máximo ${MAX_NEW_PUNCHES} marcajes a la vez`);
  return v.map((x: any) => {
    const time = String(x?.time ?? '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, `Hora no válida: ${time || '(vacía)'}`);
    const incidence = String(x?.incidence ?? '').trim() || '00';
    if (!/^[A-Za-z0-9]{1,5}$/.test(incidence)) throw new HttpError(400, `Incidencia no válida: ${incidence}`);
    return { time, incidence };
  });
}

/** Inserta marcajes manuales (POST /Booking/attendance, Debug MAN). Lanza 502 si Evalos rechaza alguno. */
export async function insertPunches(employee: string, date: string, punches: NewPunch[], portalOrigin: string) {
  const payload = punches.map((p) => ({ CodeEmployee: employee, Date: toEvalosBodyDate(date), Time: `${p.time.replace(':', '')}00`, Incidence: p.incidence, Debug: 'MAN' }));
  const r = await evalosRestPost<unknown>('/Booking/attendance', payload, portalOrigin);
  const results = Array.isArray(r.data) ? r.data : [];
  const bad = results
    .map((x: any, i: number) => ({ i, msg: x && typeof x === 'object' ? txt(x.message ?? x.Message ?? x.Result ?? '') : txt(x) }))
    .filter((x) => x.msg && !/^ok$/i.test(x.msg));
  if (bad.length) {
    throw new HttpError(502, `Evalos no ha insertado ${bad.length === punches.length ? 'los marcajes' : `${bad.length} de ${punches.length} marcajes`}: ${bad.map((b) => `${punches[b.i]?.time ?? '?'} → ${b.msg}`).join('; ').slice(0, 300)}`);
  }
  return { inserted: punches.length, ms: r.ms };
}

/** Incidencias de Evalos (GET /Incidence) para el desplegable de marcajes manuales. */
export async function loadIncidences(portalOrigin: string): Promise<{ code: string; name: string }[]> {
  const r = await evalosRestGet('/Incidence', portalOrigin);
  const list = rowsOf(r.data)
    .map((x) => ({ code: pick(x, 'Code', 'IN_CODI', 'Codigo'), name: pick(x, 'Description', 'IN_DESC', 'Name', 'Descripcion') }))
    .filter((x) => x.code);
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(x.code) ? false : (seen.add(x.code), true))).sort((a, b) => a.code.localeCompare(b.code));
}
