// Correcciones › Marcajes con conexión real: datos de EvalosRest (API REST de Evalos 8).
//  - Anomalías: listado PS_ANOMA calculado con GET /Report/filter.
//  - Marcajes de presencia: GET /Booking/attendance[/{empleado}].
//  - Corregir = añadir marcajes manuales con POST /Booking/attendance (Debug "MAN").
// Las respuestas de Evalos se interpretan de forma tolerante (los nombres de campo varían según versión).
import { HttpError } from '../http.ts';
import { evalosRestGet, evalosRestPost, evalosRestPut, evalosRestDelete } from '../evalosrest.ts';

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
  /** Datos originales del marcaje en Evalos (para volver a enviarlo al modificarlo). */
  ref?: BookingRef;
}
export interface BookingRef { id?: string; installation?: string; clock?: string; lector?: string; card?: string; ip?: string; debug?: string }
export interface RestMarcaje {
  id: string;              // <empleado>|<AAAA-MM-DD>
  employee: string;
  employeeName: string;
  date: string;            // AAAA-MM-DD
  punches: RestPunch[];
  status: 'OK' | 'INCIDENCIA';
  issues: string[];        // anomalías del día (PS_ANOMA y marcajes con anomalía)
}
export interface Anomaly { employee: string; employeeName?: string; date: string; items: string[] }

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

const HEADER_KEYS = ['Header', 'header', 'Caption', 'caption', 'Cabecera', 'cabecera', 'Title', 'title', 'Text', 'text', 'ColumnName', 'columnName', 'Name', 'name', 'Id', 'id', 'Key', 'key'];
const colName = (c: any, i: number) => {
  if (c && typeof c === 'object') { for (const k of HEADER_KEYS) { const v = txt(c[k]); if (v) return v; } return `C${i + 1}`; }
  return txt(c) || `C${i + 1}`;
};
const cellValue = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v.Value ?? v.value ?? v.Text ?? v.text ?? v.Valor ?? v.valor : v);
const isPlainRow = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x);

/** Convierte cualquier forma de lista de Evalos (array, {Rows/Columns}, DataSet {Table}, {Data}…) en filas objeto. */
export function rowsOf(data: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4) return [];
  if (typeof data === 'string') { try { return rowsOf(JSON.parse(data), depth + 1); } catch { return []; } }
  if (Array.isArray(data)) {
    if (!data.length) return [];
    // Matriz: la primera fila son las cabeceras.
    if (data.every((x) => Array.isArray(x))) {
      const [head, ...rest] = data as unknown[][];
      const cols = head.map((c, i) => colName(c, i));
      return rest.map((r) => Object.fromEntries(r.map((v, i) => [cols[i] || `C${i + 1}`, cellValue(v)])));
    }
    if (data.every(isPlainRow)) {
      // Lista de filas con celdas ({Cells:[…]} / {Values:[…]}) o filas planas.
      return (data as Record<string, any>[]).map((r) => {
        const cells = r.Cells ?? r.cells ?? r.Values ?? r.values ?? r.Columns ?? r.columns;
        if (Array.isArray(cells)) return Object.fromEntries(cells.map((c: any, i: number) => [colName(c?.Column ?? c?.column ?? c, i), cellValue(c)]));
        return r;
      });
    }
    return [];
  }
  if (!data || typeof data !== 'object') return [];
  const o = data as Record<string, any>;
  const key = (re: RegExp) => Object.keys(o).find((k) => re.test(k));
  // Formato de Report/filter (EvalosRest): { header: [{Number, Value}], body: [{RowNumber, columns: [{Number, Value}]}] }.
  const hKey = key(/^header$/i), bKey = key(/^body$/i);
  if (hKey && bKey && Array.isArray(o[hKey]) && Array.isArray(o[bKey])) {
    const titles = new Map<string, string>();
    (o[hKey] as any[]).forEach((h, i) => titles.set(txt(h?.Number ?? h?.number ?? i + 1), txt(h?.Value ?? h?.value ?? h?.Text ?? h?.text) || `C${i + 1}`));
    return (o[bKey] as any[]).map((r) => {
      const cells = r?.columns ?? r?.Columns ?? r?.cells ?? r?.Cells ?? [];
      if (!Array.isArray(cells)) return {};
      return Object.fromEntries(cells.map((c: any, i: number) => {
        const n = txt(c?.Number ?? c?.number ?? i + 1);
        return [titles.get(n) || `C${n}`, typeof c === 'object' && c ? c.Value ?? c.value ?? c.Text ?? c.text : c];
      }));
    });
  }
  const rowsKey = key(/^(rows|filas|lines|lineas|líneas|data|datos|items|values|valores)$/i), colsKey = key(/^(columns|cols|columnas|headers|header|cabeceras|fields|campos)$/i);
  if (rowsKey && colsKey && Array.isArray(o[rowsKey]) && Array.isArray(o[colsKey])) {
    const cols: string[] = o[colsKey].map((c: any, i: number) => colName(c, i));
    return (o[rowsKey] as any[]).map((r) => {
      if (Array.isArray(r)) return Object.fromEntries(r.map((v, i) => [cols[i] || `C${i + 1}`, cellValue(v)]));
      const cells = r && typeof r === 'object' ? r.Values ?? r.values ?? r.Cells ?? r.cells ?? r.Valores : null;
      if (Array.isArray(cells)) return Object.fromEntries(cells.map((v: any, i: number) => [cols[i] || `C${i + 1}`, cellValue(v)]));
      if (r && typeof r === 'object') {
        // Fila con claves CAnnn / nombres de columna: se renombran a la cabecera cuando se conoce.
        const byName = new Map<string, string>(o[colsKey].map((c: any, i: number) => [txt(c?.Name ?? c?.name ?? c?.Id ?? c?.id ?? ''), cols[i]] as [string, string]));
        return Object.fromEntries(Object.entries(r).map(([k, v]) => [byName.get(k) || k, cellValue(v)]));
      }
      return {};
    });
  }
  if (rowsKey) { const r = rowsOf(o[rowsKey], depth + 1); if (r.length) return r; }
  for (const k of ['Table', 'Table1', 'Result', 'result', 'Report', 'report', 'Listado', 'listado']) {
    if (k in o) { const r = rowsOf(o[k], depth + 1); if (r.length) return r; }
  }
  // Cualquier propiedad que contenga una lista de filas.
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') { const r = rowsOf(v, depth + 1); if (r.length) return r; }
  }
  // Un único objeto con forma de fila.
  return Object.values(o).some((v) => v == null || typeof v !== 'object') ? [o] : [];
}

// ---------- Anomalías (PS_ANOMA) ----------
const EMP_KEYS = ['EM_CODI', 'CodeEmployee', 'EmployeeCode', 'Codigo', 'Código', 'CODIGO', 'Code', 'Empleado', 'Employee'];
const NAME_KEYS = ['EM_NOMB', 'Nombre', 'Name', 'EmployeeName', 'Description', 'ApellidosNombre'];
const DATE_KEYS = ['FECHA', 'Fecha', 'Date', 'Dia', 'Día', 'Day', 'DateFormatted'];


/** Valor de una columna de anomalía: true si está marcada (1, horas distintas de cero, sí…); '-', 0, 0:00 o vacío = no. */
export function anomalyOn(v: unknown): boolean {
  if (v == null || typeof v === 'object') return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim();
  if (!s || /^[-–—]+$/.test(s) || /^(false|no|n)$/i.test(s)) return false;
  if (/^[-+]?[0.,:\s]*$/.test(s)) return false; // 0, 0,00, 00:00, 0:00:00
  return true;
}

/**
 * Anomalías por empleado y día a partir de las filas del listado PS_ANOMA.
 * El listado devuelve una fila por empleado y día con una columna por anomalía (RETRASO, SALIDA ANTES, M. IMPARES…):
 * la anomalía es el título de la columna y se muestra cuando la columna está marcada (1 o un valor distinto de cero).
 */
export function parseAnomalies(data: unknown): Anomaly[] {
  const out: Anomaly[] = [];
  const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));
  const EMP = lower(EMP_KEYS), NAME = lower(NAME_KEYS), DATE = lower(DATE_KEYS);
  for (const row of rowsOf(data)) {
    const keys = Object.keys(row);
    // Código: columna conocida o, si no, la primera; nombre: conocida o la segunda.
    const empKey = keys.find((k) => EMP.has(k.toLowerCase())) ?? keys[0];
    const nameKey = keys.find((k) => NAME.has(k.toLowerCase())) ?? (keys[1] !== empKey ? keys[1] : undefined);
    let dateKey = keys.find((k) => DATE.has(k.toLowerCase()) && normDate(row[k]));
    if (!dateKey) dateKey = keys.find((k) => k !== empKey && normDate(row[k]));
    const employee = empKey ? txt(row[empKey]) : '';
    const date = dateKey ? normDate(row[dateKey]) : '';
    if (!employee || !date) continue;
    const items: string[] = [];
    for (const k of keys) {
      if (k === empKey || k === nameKey || k === dateKey || /^(id|rowid|row|rownumber|index|fila|orden|tipo|type|n[ºo°]?)$/i.test(k.trim())) continue;
      if (anomalyOn(row[k])) items.push(k.trim());
    }
    if (items.length) out.push({ employee, employeeName: (nameKey && txt(row[nameKey])) || undefined, date, items });
  }
  return out;
}

// ---------- Marcajes (Booking/attendance) ----------
export interface ParsedBooking { employee: string; date: string; seconds: string; inOut: '' | 'E' | 'S'; incidence: string; incidenceName?: string; terminal?: string; manual: boolean; anomaly?: string; ref: BookingRef }

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
      anomaly: anomalyText && anomalyText !== '0' ? anomalyText : truthy(b.HasAnomalies) ? 'Marcaje con anomalía' : undefined,
      ref: Object.fromEntries(Object.entries({
        id: pick(b, 'Id'), installation: pick(b, 'Installation'), clock: pick(b, 'Clock'), lector: pick(b, 'Lector'),
        card: pick(b, 'Card'), ip: pick(b, 'Ip'), debug: debug
      }).filter(([, v]) => v)) as BookingRef
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
      terminal: b.terminal, manual: b.manual, anomaly: b.anomaly, ref: b.ref, ...(b.inOut ? {} : { _auto: true })
    } as RestPunch);
  }
  for (const a of anomalies) {
    const d = day(a.employee, a.date, a.employeeName);
    for (const it of a.items) if (!d.issues.includes(it)) d.issues.push(it);
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

/** Resumen de la respuesta del listado para comprobar cómo la interpreta Prime Suite. */
export interface ReportPreview { rows: number; anomalies: number; columns: string[]; sample: string }
export interface MarcajesResult { marcajes: RestMarcaje[]; warnings: string[]; ms: number; report: string; reportPreview: ReportPreview | null }

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
  const reportRows = rp ? rowsOf(rp.data) : [];
  let sample = '';
  if (rp) {
    const d: any = rp.data;
    const reportError = d && typeof d === 'object' && !Array.isArray(d) ? txt(d.ReportError ?? d.reportError) : '';
    if (reportError) warnings.push(`El listado ${ANOMALY_REPORT} devolvió un error: ${reportError}`);
    // Muestra: las primeras filas ya interpretadas (columna → valor), más fácil de leer que el JSON completo.
    try { sample = JSON.stringify(reportRows.length ? reportRows.slice(0, 8) : d, null, 2) ?? ''; } catch { sample = String(d); }
  }
  const reportPreview: ReportPreview | null = rp ? {
    rows: reportRows.length,
    anomalies: 0,
    columns: Array.from(new Set(reportRows.slice(0, 20).flatMap((r) => Object.keys(r)))),
    sample: sample.length > 6000 ? `${sample.slice(0, 6000)}\n…` : sample
  } : null;
  const anomalies = rp ? parseAnomalies(rp.data).filter((a) => a.date >= opts.from && a.date <= opts.to && (!opts.employee || a.employee === opts.employee)) : [];
  const bookings = parseBookings(bk.data).filter((b) => b.date >= opts.from && b.date <= opts.to && (!opts.employee || b.employee === opts.employee));
  if (reportPreview) reportPreview.anomalies = anomalies.length;
  return { marcajes: buildMarcajes(bookings, anomalies, opts.names), warnings, ms: Date.now() - started, report: ANOMALY_REPORT, reportPreview };
}

/**
 * Marcaje a grabar con POST /Booking/attendance.
 *  - Nuevo: hora HH:mm, incidencia → marcaje manual (Debug MAN).
 *  - Modificación de uno existente: `original` = hora exacta (HH:mm:ss) que tiene en Evalos y `ref` = sus datos de terminal;
 *    se reenvía con la nueva incidencia (y la nueva hora solo si es manual: en los de terminal la hora no se cambia).
 */
export interface PunchWrite { time: string; incidence: string; original?: string; ref?: BookingRef }

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const REF_RE = /^[A-Za-z0-9 _.:\-]{0,40}$/;
export function cleanPunchWrites(v: unknown): PunchWrite[] {
  if (!Array.isArray(v) || !v.length) throw new HttpError(400, 'No hay cambios que guardar');
  if (v.length > MAX_NEW_PUNCHES) throw new HttpError(400, `Como máximo ${MAX_NEW_PUNCHES} marcajes a la vez`);
  return v.map((x: any) => {
    const time = String(x?.time ?? '');
    if (!TIME_RE.test(time)) throw new HttpError(400, `Hora no válida: ${time || '(vacía)'}`);
    const incidence = String(x?.incidence ?? '').trim() || NORMAL_INCIDENCE.code;
    if (!/^[A-Za-z0-9]{1,5}$/.test(incidence)) throw new HttpError(400, `Incidencia no válida: ${incidence}`);
    const out: PunchWrite = { time, incidence };
    if (x?.original != null && x.original !== '') {
      const original = String(x.original);
      if (!TIME_RE.test(original)) throw new HttpError(400, `Hora original no válida: ${original}`);
      out.original = original;
      const ref: BookingRef = {};
      for (const k of ['id', 'installation', 'clock', 'lector', 'card', 'ip', 'debug'] as const) {
        const val = x?.ref?.[k];
        if (val == null || val === '') continue;
        if (!REF_RE.test(String(val))) throw new HttpError(400, `Dato de marcaje no válido (${k})`);
        ref[k] = String(val);
      }
      out.ref = ref;
    }
    return out;
  });
}

const hhmmss = (t: string) => (t.length === 5 ? `${t}:00` : t).replace(/:/g, '');

/** Cuerpo de POST /Booking/attendance para cada marcaje (nuevo o modificado). */
export function bookingPayload(employee: string, date: string, punches: PunchWrite[]) {
  return punches.map((p) => {
    const body: Record<string, string> = { CodeEmployee: employee, Date: toEvalosBodyDate(date), Time: hhmmss(p.time), Incidence: p.incidence };
    if (!p.original) { body.Debug = 'MAN'; return body; }
    const r = p.ref || {};
    const fromTerminal = !!(r.installation || r.clock || r.lector) && !/^MAN/i.test(r.debug || '');
    // En los marcajes de terminal la hora no se modifica: se reenvía la original con su terminal.
    if (fromTerminal) body.Time = hhmmss(p.original);
    if (r.id) body.Id = r.id;
    if (r.installation) body.Installation = r.installation;
    if (r.clock) body.Clock = r.clock;
    if (r.lector) body.Lector = r.lector;
    if (r.card) body.Card = r.card;
    if (r.ip) body.Ip = r.ip;
    body.Debug = r.debug || (fromTerminal ? '' : 'MAN');
    if (!body.Debug) delete body.Debug;
    return body;
  });
}

/** Graba marcajes nuevos o modificados (POST /Booking/attendance). Lanza 502 si Evalos rechaza alguno. */
export async function savePunches(employee: string, date: string, punches: PunchWrite[], portalOrigin: string) {
  const payload = bookingPayload(employee, date, punches);
  const r = await evalosRestPost<unknown>('/Booking/attendance', payload, portalOrigin);
  const results = Array.isArray(r.data) ? r.data : [];
  const bad = results
    .map((x: any, i: number) => ({ i, msg: x && typeof x === 'object' ? txt(x.message ?? x.Message ?? x.Result ?? '') : txt(x) }))
    .filter((x) => x.msg && !/^ok$/i.test(x.msg));
  if (bad.length) {
    throw new HttpError(502, `Evalos no ha grabado ${bad.length === punches.length ? 'los marcajes' : `${bad.length} de ${punches.length} marcajes`}: ${bad.map((b) => `${punches[b.i]?.time ?? '?'} → ${b.msg}`).join('; ').slice(0, 300)}`);
  }
  return { saved: punches.length, ms: r.ms };
}

/** Incidencia de los marcajes normales: no está en la tabla INCIDENC y se ofrece siempre la primera. */
export const NORMAL_INCIDENCE = { code: '000', name: 'Entrada / Salida' };

// ---------- Borrar marcajes (DELETE /Booking/attendance) ----------
/**
 * La API documenta el borrado del marcaje del empleado {id}, fecha {date} y hora {time}, pero no el formato:
 * se envían como parámetros de la URL probando los formatos de fecha/hora de Evalos hasta que uno funciona.
 */
export function deleteVariants(employee: string, date: string, seconds: string): string[] {
  const id = encodeURIComponent(employee);
  const ymd = toEvalosBodyDate(date), dmy = encodeURIComponent(toEvalosQueryDate(date));
  const hms = seconds.replace(/:/g, ''), hmsc = encodeURIComponent(seconds);
  return [
    `/Booking/attendance?id=${id}&date=${ymd}&time=${hms}`,
    `/Booking/attendance?id=${id}&date=${dmy}&time=${hms}`,
    `/Booking/attendance?id=${id}&date=${dmy}&time=${hmsc}`
  ];
}

export function cleanDeleteTimes(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length) throw new HttpError(400, 'No hay marcajes que eliminar');
  if (v.length > MAX_NEW_PUNCHES) throw new HttpError(400, `Como máximo ${MAX_NEW_PUNCHES} marcajes a la vez`);
  return v.map((x) => {
    const t = String(x ?? '');
    if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(t)) throw new HttpError(400, `Hora no válida: ${t || '(vacía)'}`);
    return t;
  });
}

/** Borra marcajes del día y comprueba, volviendo a leer el día, que ya no están. */
export async function deletePunches(employee: string, date: string, times: string[], portalOrigin: string) {
  const failures: string[] = [];
  for (const t of times) {
    let last = '';
    let done = false;
    for (const path of deleteVariants(employee, date, t)) {
      const r = await evalosRestDelete(path, portalOrigin);
      if (r.ok) { done = true; break; }
      last = `${r.status}${r.message ? ` · ${r.message}` : ''}`;
      // Solo se prueba otro formato si Evalos no lo encuentra o no entiende los datos.
      if (![400, 403, 404].includes(r.status)) break;
    }
    if (!done) failures.push(`${t.slice(0, 5)} → ${last || 'sin respuesta'}`);
  }
  // Comprobación: el día ya no debe tener esos marcajes.
  const q = `dateAdd=${encodeURIComponent(toEvalosQueryDate(date))}&dateEnd=${encodeURIComponent(toEvalosQueryDate(date))}`;
  const after = parseBookings((await evalosRestGet(`/Booking/attendance/${encodeURIComponent(employee)}?${q}`, portalOrigin)).data)
    .filter((b) => b.employee === employee && b.date === date);
  const still = times.filter((t) => after.some((b) => b.seconds === t));
  if (still.length) {
    const why = failures.length ? ` (${failures.join('; ')})` : '';
    throw new HttpError(502, `Evalos no ha eliminado ${still.length === times.length ? 'los marcajes' : `${still.length} de ${times.length} marcajes`}: ${still.map((x) => x.slice(0, 5)).join(', ')}${why}.`);
  }
  return { deleted: times.length };
}

// ---------- Ausencias (PUT /Absence) ----------
/** Ausencia de un día: absentismo de fichero con fecha desde y hasta = el día seleccionado. */
export function absencePayload(employee: string, date: string, incidence: string, description: string) {
  const d = toEvalosBodyDate(date);
  return {
    CodeEmployee: employee, StartDate: d, EndDate: d, Description: description.slice(0, 40), Incidence: incidence,
    Holidays: 'N', NonWorkingDays: 'N', MaxDays: '1', NewIncidence: '', Observations: ''
  };
}

export async function saveAbsence(employee: string, date: string, incidence: string, description: string, portalOrigin: string) {
  if (!/^[A-Za-z0-9]{1,5}$/.test(incidence)) throw new HttpError(400, 'Elige la incidencia de la ausencia');
  const r = await evalosRestPut<unknown>('/Absence', absencePayload(employee, date, incidence, description), portalOrigin);
  return { ms: r.ms };
}
