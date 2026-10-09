// Atajos de Evalos · Convenios.
// Cada convenio predefine tantos periodos de vacaciones como se quiera (tipo de TIPOSVACACIONES, inicio y días), y los límites de
// incidencia (por incidencia de INCIDENC, en días u horas) de su periodo de incidencias. Los periodos duran un año
// desde su día/mes de inicio. Desde la ventana también se pueden crear tipos de vacaciones nuevos en TIPOSVACACIONES.
// Se guarda en PS_CONVENIOS, PS_CONVENIOS_VACACIONES y PS_CONVENIOS_LIMITES (BD de Evalos 8).
// El mismo archivo exporta el widget del Inicio.
import { useMemo, useState, type FormEvent, type JSX } from 'react';
import {
  api, ApiError, type EvalosConvenio, type EvalosConveniosResponse, type EvalosIncidence,
  type EvalosVacationType, type EvalosVacationTypeCreated, type EvalosVacationTypesInfo
} from '../../api';
import { ErrorBox, Icon, Loading, Modal, confirmAction, useData, useToast } from '../../components/ui';
import { NotConfigured } from './common';

const NC = { notConfigured: true } as unknown as EvalosConveniosResponse;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Febrero con 28 días: un periodo no puede empezar el 29/02, que no existe todos los años. */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const TYPE_LABEL: Record<string, string> = { A: 'Absentismo', S: 'Salida en el día' };

const pad = (n: number) => String(n).padStart(2, '0');
const dm = (d: number, m: number) => `${pad(d)}/${pad(m)}`;
const fmt = (iso: string) => iso.split('-').reverse().join('/');
const fmtDays = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
const fmtHours = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const fmtLimit = (unit: 'D' | 'H', value: number) => (unit === 'D' ? `${fmtDays(value)} ${value === 1 ? 'día' : 'días'}` : `${fmtHours(value)} h`);

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Periodo de un año que contiene hoy y empieza el día/mes indicado (igual que server/evalos/convenios.ts). */
function currentPeriod(day: number, month: number) {
  const [y, m, d] = todayIso().split('-').map(Number);
  const start = m > month || (m === month && d >= day) ? y : y - 1;
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { from: iso(new Date(Date.UTC(start, month - 1, day))), to: iso(new Date(Date.UTC(start + 1, month - 1, day - 1))) };
}
const periodText = (day: number, month: number) => { const p = currentPeriod(day, month); return `del ${fmt(p.from)} al ${fmt(p.to)}`; };

/** «12», «12,5» → número; '' o texto no válido → NaN. */
const parseDays = (s: string) => (/^\d{1,3}([.,]\d)?$/.test(s.trim()) ? Number(s.trim().replace(',', '.')) : NaN);
/** «8», «8:30», «120:00» → minutos; texto no válido → NaN. */
function parseHours(s: string) {
  const m = /^(\d{1,4})(?::([0-5]\d))?$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2] || 0) : NaN;
}

function useConvenios() {
  const { data, error, reload } = useData(() =>
    api.get<EvalosConveniosResponse>('/api/evalos/convenios').catch((e) => {
      if (e instanceof ApiError && e.code === 'not_configured') return NC;
      throw e;
    })
  );
  let node: JSX.Element | null = null;
  if (data === NC) node = <NotConfigured />;
  else if (error) node = <div className="col" style={{ gap: 8 }}><ErrorBox error={error} /><button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={reload}><Icon.refresh /> Reintentar</button></div>;
  return { data: data === NC ? null : data, error: node, reload };
}

export default function Convenios() {
  const { data, error, reload } = useConvenios();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<EvalosConvenio | 'new' | null>(null);
  const incName = useMemo(() => new Map((data?.incidences || []).map((i) => [i.code, i.name])), [data]);
  const vacType = useMemo(() => new Map((data?.vacationTypes.items || []).map((t) => [t.code, t])), [data]);
  if (error) return error;
  if (!data) return <Loading />;
  if (data.missing) return <MissingTables missing={data.missing} onRetry={reload} />;

  const needle = q.trim().toLowerCase();
  const list = needle ? data.convenios.filter((c) => c.code.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle)) : data.convenios;

  return (
    <div className="col" style={{ gap: 16 }}>
      {data.incidencesError && <div className="alert warn">No se pudieron leer las incidencias de INCIDENC: {data.incidencesError}</div>}
      {data.vacationTypesError && <div className="alert warn">No se pudieron leer los tipos de vacaciones de TIPOSVACACIONES: {data.vacationTypesError}</div>}
      <div className="card flat">
        <div className="ev-toolbar">
          <b className="small">{data.convenios.length} convenio(s)</b>
          {data.engine === 'demo' && <span className="tag outline">Datos de demostración</span>}
          <span className="grow" />
          <input className="input" style={{ width: 220 }} placeholder="Buscar por código o nombre" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn sm" onClick={reload}><Icon.refresh /> Actualizar</button>
          {data.canEdit && <button className="btn primary sm" onClick={() => setEdit('new')}><Icon.plus /> Nuevo convenio</button>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Código</th>
                <th>Nombre</th>
                <th>Vacaciones</th>
                <th style={{ width: 170 }}>Periodo de incidencias</th>
                <th>Límites de incidencia</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.code} className="clickable" onClick={() => setEdit(c)}>
                  <td className="mono"><b>{c.code}</b></td>
                  <td>{c.name}</td>
                  <td>
                    {c.vacations.length ? (
                      <div className="col" style={{ gap: 3 }}>
                        {c.vacations.map((v, i) => (
                          <span key={i} className="small row" style={{ gap: 6 }} title={vacType.get(v.type)?.name || v.type}>
                            <TypeDot color={vacType.get(v.type)?.color} />
                            <b className="mono">{v.type}</b> {fmtLimit('D', v.days)} <span className="xs muted">desde el {dm(v.day, v.month)}</span>
                          </span>
                        ))}
                      </div>
                    ) : <span className="muted small">Sin vacaciones</span>}
                  </td>
                  <td className="small">desde el {dm(c.incidenceDay, c.incidenceMonth)}</td>
                  <td>
                    {c.limits.length ? (
                      <div className="row wrap" style={{ gap: 4 }}>
                        {c.limits.slice(0, 4).map((l) => (
                          <span key={l.incidence} className="tag" title={incName.get(l.incidence) || l.incidence}>{l.incidence} · {fmtLimit(l.unit, l.value)}</span>
                        ))}
                        {c.limits.length > 4 && <span className="tag outline">+{c.limits.length - 4}</span>}
                      </div>
                    ) : <span className="muted small">Sin límites</span>}
                  </td>
                  <td className="muted">{data.canEdit ? <Icon.edit /> : <Icon.eye />}</td>
                </tr>
              ))}
              {!list.length && (
                <tr><td colSpan={6} className="muted small" style={{ padding: 28, textAlign: 'center' }}>
                  {needle ? 'Ningún convenio coincide con la búsqueda.' : 'No hay convenios. Crea el primero con «Nuevo convenio».'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ev-foot xs muted">
          Cada periodo, de vacaciones o de incidencias, dura un año desde su día y mes de inicio. Los límites se aplican a cada periodo de incidencias.
        </div>
      </div>

      {edit && (
        <ConvenioModal
          convenio={edit === 'new' ? null : edit}
          incidences={data.incidences}
          vacationTypes={data.vacationTypes}
          onTypeCreated={reload}
          canEdit={data.canEdit}
          canDelete={data.canDelete}
          onClose={() => setEdit(null)}
          onChanged={() => { setEdit(null); reload(); }}
        />
      )}
    </div>
  );
}

// ---------- Faltan las tablas en la BD de Evalos ----------
function MissingTables({ missing, onRetry }: { missing: { message: string; script: string }; onRetry: () => void }) {
  const toast = useToast();
  async function copy() {
    try { await navigator.clipboard.writeText(missing.script); toast('Script copiado'); }
    catch { toast('No se pudo copiar: selecciona el texto y cópialo a mano', true); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([missing.script], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'PS_CONVENIOS.sql' });
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="card col" style={{ gap: 12 }}>
      <h3 style={{ margin: 0 }}>Falta preparar la base de datos</h3>
      <div className="alert warn">{missing.message}</div>
      <span className="small muted">
        Los convenios se guardan en dos tablas nuevas de la base de datos de Evalos 8. Ejecuta este script en SQL Server
        (con un usuario que pueda crear tablas) y pulsa «Comprobar de nuevo». Se puede lanzar varias veces: solo crea lo que falta.
      </span>
      <pre className="code" style={{ maxHeight: 340 }}>{missing.script}</pre>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn sm" onClick={copy}><Icon.copy /> Copiar script</button>
        <button className="btn sm" onClick={download}><Icon.down /> Descargar .sql</button>
        <span className="grow" />
        <button className="btn primary sm" onClick={onRetry}><Icon.refresh /> Comprobar de nuevo</button>
      </div>
    </div>
  );
}

// ---------- Selector de día y mes ----------
function DayMonth({ day, month, onChange, disabled, label }: { day: number; month: number; onChange: (d: number, m: number) => void; disabled?: boolean; label: string }) {
  const max = MONTH_DAYS[month - 1];
  return (
    <div className="row" style={{ gap: 6 }} role="group" aria-label={label}>
      <select className="select" style={{ width: 72, flex: 'none' }} aria-label="Día" value={day} disabled={disabled} onChange={(e) => onChange(Number(e.target.value), month)}>
        {Array.from({ length: max }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{pad(d)}</option>)}
      </select>
      <select className="select" style={{ width: 132, flex: 'none' }} aria-label="Mes" value={month} disabled={disabled} onChange={(e) => { const m = Number(e.target.value); onChange(Math.min(day, MONTH_DAYS[m - 1]), m); }}>
        {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </select>
    </div>
  );
}

/** Punto con el color del tipo de vacaciones (si la tabla lo tiene). */
function TypeDot({ color }: { color?: string | null }) {
  return <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, flex: 'none', background: color || 'var(--line)', border: '1px solid rgba(0,0,0,.12)' }} />;
}

// ---------- Alta de un tipo de vacaciones (TIPOSVACACIONES) ----------
function NewVacationType({ info, onCreated, onCancel }: { info: EvalosVacationTypesInfo; onCreated: (t: EvalosVacationType) => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#2e7d32');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<EvalosVacationTypeCreated | null>(null);
  const toast = useToast();
  async function create() {
    if (!code.trim() || !name.trim()) { toast('Indica el código y la descripción', true); return; }
    setBusy(true);
    try {
      const r = await api.post<EvalosVacationTypeCreated>('/api/evalos/tiposvacaciones', { code: code.trim(), name: name.trim(), color: info.hasColor ? color : undefined });
      setRes(r);
      toast(`Tipo de vacaciones ${r.type.code} creado en TIPOSVACACIONES`);
      onCreated(r.type);
      setCode(''); setName('');
    } catch (err: any) { toast(err.message, true); }
    finally { setBusy(false); }
  }
  return (
    <div className="card col" style={{ gap: 10 }}>
      <b className="small">Nuevo tipo de vacaciones</b>
      <span className="xs muted">Se crea en la tabla TIPOSVACACIONES de Evalos 8 y queda disponible para todos los convenios y para Evalos.</span>
      <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 120 }}>Código
          <input className="input mono" value={code} maxLength={info.codeMax} inputMode={info.numericCode ? 'numeric' : 'text'}
            onChange={(e) => setCode(info.numericCode ? e.target.value.replace(/\D/g, '') : e.target.value.toUpperCase())} placeholder={info.numericCode ? '27' : 'V27'} />
        </label>
        <label className="field grow" style={{ minWidth: 200 }}>Descripción
          <input className="input" value={name} maxLength={info.nameMax || 60} onChange={(e) => setName(e.target.value)} placeholder="Vacaciones 2027" />
        </label>
        {info.hasColor && (
          <label className="field" style={{ width: 70 }}>Color
            <input className="input" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ padding: 2, height: 38 }} />
          </label>
        )}
        <button type="button" className="btn primary sm" onClick={create} disabled={busy}>{busy ? 'Creando…' : 'Crear tipo'}</button>
        <button type="button" className="btn sm" onClick={onCancel}>Cerrar</button>
      </div>
      {res && (
        <details className="xs">
          <summary className="muted" style={{ cursor: 'pointer' }}>Ver respuesta (fila creada en TIPOSVACACIONES)</summary>
          {res.filled.length > 0 && <div className="muted" style={{ margin: '6px 0' }}>Columnas obligatorias rellenadas con un valor vacío: {res.filled.join(', ')}</div>}
          <pre className="code" style={{ marginTop: 6, maxHeight: 220 }}>{JSON.stringify(res.row, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

// ---------- Ventana del convenio ----------
interface LimitRow { key: number; incidence: string; unit: 'D' | 'H'; text: string }
interface VacRow { key: number; type: string; day: number; month: number; text: string }
let rowSeq = 0;
const toRow = (l: { incidence: string; unit: 'D' | 'H'; value: number }): LimitRow =>
  ({ key: ++rowSeq, incidence: l.incidence, unit: l.unit, text: l.unit === 'D' ? fmtDays(l.value) : fmtHours(l.value) });

function ConvenioModal({ convenio, incidences, vacationTypes, canEdit, canDelete, onClose, onChanged, onTypeCreated }: {
  convenio: EvalosConvenio | null; incidences: EvalosIncidence[]; vacationTypes: EvalosVacationTypesInfo;
  canEdit: boolean; canDelete: boolean; onClose: () => void; onChanged: () => void; onTypeCreated: () => void;
}) {
  const isNew = !convenio;
  const ro = !canEdit;
  const [code, setCode] = useState(convenio?.code || '');
  const [name, setName] = useState(convenio?.name || '');
  const [types, setTypes] = useState<EvalosVacationType[]>(vacationTypes.items);
  const [vacRows, setVacRows] = useState<VacRow[]>(() => (convenio?.vacations || []).map((v) => ({ key: ++rowSeq, type: v.type, day: v.day, month: v.month, text: fmtDays(v.days) })));
  const [newType, setNewType] = useState(false);
  const [inc, setInc] = useState({ day: convenio?.incidenceDay ?? 1, month: convenio?.incidenceMonth ?? 1 });
  const [rows, setRows] = useState<LimitRow[]>(() => (convenio?.limits || []).map(toRow));
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const byCode = useMemo(() => new Map(incidences.map((i) => [i.code, i])), [incidences]);
  const used = new Set(rows.map((r) => r.incidence));
  const free = incidences.filter((i) => !used.has(i.code));

  const typeByCode = useMemo(() => new Map(types.map((t) => [t.code, t])), [types]);
  const setVacRow = (key: number, patch: Partial<VacRow>) => setVacRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  function addVacRow(type?: string) {
    // Por defecto, el mismo tipo e inicio que el último periodo (se pueden repetir tipos con inicios distintos).
    const last = vacRows[vacRows.length - 1];
    const t = type || last?.type || types[0]?.code;
    if (!t) return;
    setVacRows((rs) => [...rs, { key: ++rowSeq, type: t, day: last?.day ?? 1, month: last?.month ?? 1, text: '' }]);
  }
  function vacError(r: VacRow) {
    if (!r.text.trim()) return 'Indica los días';
    const n = parseDays(r.text);
    return !(n > 0 && n <= 365) ? 'De 0,5 a 365 días' : Number.isInteger(n * 2) ? '' : 'Solo medios días (p. ej. 22,5)';
  }
  function typeCreated(t: EvalosVacationType) {
    setTypes((ts) => [...ts.filter((x) => x.code !== t.code), t].sort((a, b) => a.code.localeCompare(b.code)));
    addVacRow(t.code);
    onTypeCreated();
  }
  const setRow = (key: number, patch: Partial<LimitRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  function addRow() {
    const first = free[0];
    if (!first) return;
    // Absentismos (tipo A) se suelen limitar en días; el resto, en horas.
    setRows((rs) => [...rs, { key: ++rowSeq, incidence: first.code, unit: first.type === 'A' ? 'D' : 'H', text: '' }]);
  }
  function rowError(r: LimitRow) {
    if (!r.text.trim()) return 'Indica el límite';
    if (r.unit === 'D') { const n = parseDays(r.text); return !(n > 0 && n <= 366) ? 'Días de 0,5 a 366 (p. ej. 3 o 2,5)' : Number.isInteger(n * 2) ? '' : 'Solo medios días (p. ej. 2,5)'; }
    return parseHours(r.text) > 0 ? '' : 'Horas en formato HH:MM (p. ej. 20:00)';
  }
  const [touched, setTouched] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (vacRows.some((r) => vacError(r)) || rows.some((r) => rowError(r))) { toast('Revisa los campos marcados', true); return; }
    setBusy(true);
    const payload = {
      code, name,
      vacations: vacRows.map((r) => ({ type: r.type, day: r.day, month: r.month, days: parseDays(r.text) })),
      incidenceDay: inc.day, incidenceMonth: inc.month,
      limits: rows.map((r) => ({ incidence: r.incidence, unit: r.unit, value: r.unit === 'D' ? parseDays(r.text) : parseHours(r.text) }))
    };
    try {
      if (isNew) await api.post('/api/evalos/convenios', payload);
      else await api.put(`/api/evalos/convenios/${encodeURIComponent(convenio!.code)}`, payload);
      toast(isNew ? `Convenio ${code.trim().toUpperCase()} creado` : `Convenio ${convenio!.code} guardado`);
      onChanged();
    } catch (err: any) { toast(err.message, true); setBusy(false); }
  }
  async function remove() {
    if (!convenio || !confirmAction(`¿Eliminar el convenio ${convenio.code} con sus periodos de vacaciones y límites de incidencia?`)) return;
    try { await api.del(`/api/evalos/convenios/${encodeURIComponent(convenio.code)}`); toast(`Convenio ${convenio.code} eliminado`); onChanged(); }
    catch (err: any) { toast(err.message, true); }
  }

  const title = isNew ? 'Nuevo convenio' : `Convenio ${convenio!.code}${ro ? ' (consulta)' : ''}`;
  return (
    <Modal title={title} onClose={onClose} width={1000}>
      <form className="col" style={{ gap: 16 }} onSubmit={submit} noValidate>
        <div className="row wrap" style={{ gap: 12 }}>
          <label className="field" style={{ width: 160 }}>Código
            <input className="input mono" value={code} maxLength={10} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={!isNew || ro} placeholder="OFI" required autoFocus={isNew} />
          </label>
          <label className="field grow" style={{ minWidth: 220 }}>Nombre
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} disabled={ro} placeholder="Convenio de oficinas" required />
          </label>
        </div>

        <div className="col" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <b className="small row" style={{ gap: 6 }}><Icon.calendar /> Vacaciones</b>
            <span className="tag outline">{vacRows.length}</span>
            <span className="grow" />
            {!ro && <button type="button" className="btn sm" onClick={() => setNewType((v) => !v)}><Icon.plus /> Nuevo tipo de vacaciones</button>}
            {!ro && (
              <button type="button" className="btn sm" onClick={() => addVacRow()} disabled={!types.length}
                title={!types.length ? 'No hay tipos de vacaciones: crea uno' : undefined}>
                <Icon.plus /> Añadir periodo
              </button>
            )}
          </div>
          {newType && !ro && <NewVacationType info={vacationTypes} onCreated={typeCreated} onCancel={() => setNewType(false)} />}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo de vacaciones</th>
                  <th>Inicio del periodo</th>
                  <th>Días</th>
                  <th>Periodo actual</th>
                  {!ro && <th style={{ width: 44 }} />}
                </tr>
              </thead>
              <tbody>
                {vacRows.map((r) => {
                  const info = typeByCode.get(r.type);
                  const err = touched ? vacError(r) : '';
                  return (
                    <tr key={r.key}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <TypeDot color={info?.color} />
                          <select className="select" style={{ minWidth: 230 }} aria-label="Tipo de vacaciones" title={info ? `${info.code} · ${info.name}` : r.type} value={r.type} disabled={ro} onChange={(e) => setVacRow(r.key, { type: e.target.value })}>
                            {!info && <option value={r.type}>{r.type} · (no existe en TIPOSVACACIONES)</option>}
                            {types.map((t) => <option key={t.code} value={t.code}>{t.code} · {t.name}</option>)}
                          </select>
                          {!info && <span className="tag warn" title="El código no está en la tabla TIPOSVACACIONES">?</span>}
                        </div>
                      </td>
                      <td><DayMonth label={`Inicio del periodo de ${r.type}`} day={r.day} month={r.month} disabled={ro} onChange={(day, month) => setVacRow(r.key, { day, month })} /></td>
                      <td>
                        <input className="input" style={{ width: 80 }} inputMode="decimal" value={r.text} disabled={ro} placeholder="22" aria-invalid={!!err}
                          onChange={(e) => setVacRow(r.key, { text: e.target.value })} />
                        {err && <div className="xs" style={{ color: 'var(--bad)' }}>{err}</div>}
                      </td>
                      <td className="xs muted" style={{ whiteSpace: 'nowrap' }}>{periodText(r.day, r.month)}</td>
                      {!ro && <td><button type="button" className="icon-btn" aria-label={`Quitar ${r.type}`} onClick={() => setVacRows((rs) => rs.filter((x) => x.key !== r.key))}><Icon.trash /></button></td>}
                    </tr>
                  );
                })}
                {!vacRows.length && (
                  <tr><td colSpan={ro ? 4 : 5} className="muted small" style={{ padding: 20, textAlign: 'center' }}>
                    Sin periodos de vacaciones.{!ro && (types.length ? ' Añade tantos periodos como necesites.' : ' Crea primero un tipo de vacaciones.')}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col" style={{ gap: 8 }}>
          <b className="small row" style={{ gap: 6 }}><Icon.list /> Periodo de incidencias</b>
          <div className="row wrap" style={{ gap: 12 }}>
            <span className="small" style={{ fontWeight: 600 }}>Inicio del periodo</span>
            <DayMonth label="Inicio del periodo de incidencias" day={inc.day} month={inc.month} disabled={ro} onChange={(day, month) => setInc({ day, month })} />
            <span className="xs muted">Periodo actual: {periodText(inc.day, inc.month)}. Los límites de abajo cuentan dentro de cada periodo.</span>
          </div>
        </div>

        <div className="col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <b className="small">Límites de incidencia</b>
            <span className="tag outline">{rows.length}</span>
            <span className="grow" />
            {!ro && (
              <button type="button" className="btn sm" onClick={addRow} disabled={!free.length} title={!incidences.length ? 'No hay incidencias en INCIDENC' : !free.length ? 'Ya están todas las incidencias' : undefined}>
                <Icon.plus /> Añadir incidencia
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Incidencia</th>
                  <th>Unidad</th>
                  <th>Límite por periodo</th>
                  {!ro && <th style={{ width: 44 }} />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const info = byCode.get(r.incidence);
                  const err = touched ? rowError(r) : '';
                  return (
                    <tr key={r.key}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <select className="select grow" style={{ minWidth: 230 }} aria-label="Incidencia" value={r.incidence} disabled={ro} onChange={(e) => setRow(r.key, { incidence: e.target.value })}>
                            {!info && <option value={r.incidence}>{r.incidence} · (no existe en INCIDENC)</option>}
                            {incidences.filter((i) => i.code === r.incidence || !used.has(i.code)).map((i) => <option key={i.code} value={i.code}>{i.code} · {i.name}</option>)}
                          </select>
                          {info?.type && <span className={`tag ${info.type === 'A' ? 'info' : 'outline'}`} title={TYPE_LABEL[info.type] || `Tipo ${info.type}`}>{info.type}</span>}
                          {!info && <span className="tag warn" title="El código no está en la tabla INCIDENC">?</span>}
                        </div>
                      </td>
                      <td>
                        <div className="viewseg" role="radiogroup" aria-label="Unidad" style={{ padding: 3 }}>
                          {(['D', 'H'] as const).map((u) => (
                            <button key={u} type="button" role="radio" aria-checked={r.unit === u} className={r.unit === u ? 'on' : ''} style={{ padding: '5px 12px' }} disabled={ro}
                              onClick={() => r.unit !== u && setRow(r.key, { unit: u, text: '' })}>
                              {u === 'D' ? 'Días' : 'Horas'}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td>
                        <input className="input" style={{ width: 130 }} inputMode={r.unit === 'D' ? 'decimal' : 'text'} value={r.text} disabled={ro}
                          placeholder={r.unit === 'D' ? 'días, p. ej. 3' : 'HH:MM, p. ej. 20:00'} aria-invalid={!!err}
                          onChange={(e) => setRow(r.key, { text: e.target.value })} />
                        {err && <div className="xs" style={{ color: 'var(--bad)' }}>{err}</div>}
                      </td>
                      {!ro && <td><button type="button" className="icon-btn" aria-label={`Quitar ${r.incidence}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Icon.trash /></button></td>}
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr><td colSpan={ro ? 3 : 4} className="muted small" style={{ padding: 20, textAlign: 'center' }}>
                    Sin límites de incidencia.{!ro && incidences.length > 0 && ' Añade las incidencias que quieras limitar.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {!incidences.length && <span className="xs muted">No se han encontrado incidencias en la tabla INCIDENC.</span>}
        </div>

        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          {!isNew && canDelete ? <button type="button" className="btn danger sm" onClick={remove}><Icon.trash /> Eliminar</button> : <span />}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>{ro ? 'Cerrar' : 'Cancelar'}</button>
            {!ro && <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>}
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Widget ----------
export function ConveniosWidget() {
  const { data, error } = useConvenios();
  if (error) return error;
  if (!data) return <Loading />;
  if (data.missing) return <span className="small muted">Falta crear las tablas de convenios en la base de datos de Evalos 8. Abre la pantalla Convenios para ver el script.</span>;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="card" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Convenios</span><span className="stat">{data.convenios.length}</span></div>
      <div className="col" style={{ gap: 4 }}>
        {data.convenios.slice(0, 4).map((c) => (
          <div key={c.code} className="row" style={{ justifyContent: 'space-between', fontSize: 13, gap: 8 }}>
            <span><b className="mono">{c.code}</b> {c.name}</span>
            <span className="muted xs" style={{ whiteSpace: 'nowrap' }}>{c.vacations.map((v) => `${v.type} ${fmtDays(v.days)} d`).join(' · ') || 'sin vacaciones'} · {c.limits.length} límite(s)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
