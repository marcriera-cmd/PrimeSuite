// Atajos de Evalos · Convenios.
// Cada convenio predefine los días de vacaciones de su periodo y los límites de incidencia (por incidencia de INCIDENC,
// en días u horas) de su periodo de incidencias. Los dos periodos duran un año desde su día/mes de inicio.
// Se guarda en PS_CONVENIOS y PS_CONVENIOS_LIMITES (BD de Evalos 8). El mismo archivo exporta el widget del Inicio.
import { useMemo, useState, type FormEvent, type JSX } from 'react';
import { api, ApiError, type EvalosConvenio, type EvalosConveniosResponse, type EvalosIncidence } from '../../api';
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
  if (error) return error;
  if (!data) return <Loading />;
  if (data.missing) return <MissingTables missing={data.missing} onRetry={reload} />;

  const needle = q.trim().toLowerCase();
  const list = needle ? data.convenios.filter((c) => c.code.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle)) : data.convenios;

  return (
    <div className="col" style={{ gap: 16 }}>
      {data.incidencesError && <div className="alert warn">No se pudieron leer las incidencias de INCIDENC: {data.incidencesError}</div>}
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
                <th style={{ width: 190 }}>Vacaciones</th>
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
                    <b className="small">{fmtLimit('D', c.vacationDays)}</b>
                    <div className="xs muted">desde el {dm(c.vacationDay, c.vacationMonth)}</div>
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
          Los periodos de vacaciones y de incidencias duran un año desde su día y mes de inicio. Los límites se aplican a cada periodo de incidencias.
        </div>
      </div>

      {edit && (
        <ConvenioModal
          convenio={edit === 'new' ? null : edit}
          incidences={data.incidences}
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
      <select className="select" style={{ width: 76 }} aria-label="Día" value={day} disabled={disabled} onChange={(e) => onChange(Number(e.target.value), month)}>
        {Array.from({ length: max }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{pad(d)}</option>)}
      </select>
      <select className="select grow" aria-label="Mes" value={month} disabled={disabled} onChange={(e) => { const m = Number(e.target.value); onChange(Math.min(day, MONTH_DAYS[m - 1]), m); }}>
        {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </select>
    </div>
  );
}

// ---------- Ventana del convenio ----------
interface LimitRow { key: number; incidence: string; unit: 'D' | 'H'; text: string }
let rowSeq = 0;
const toRow = (l: { incidence: string; unit: 'D' | 'H'; value: number }): LimitRow =>
  ({ key: ++rowSeq, incidence: l.incidence, unit: l.unit, text: l.unit === 'D' ? fmtDays(l.value) : fmtHours(l.value) });

function ConvenioModal({ convenio, incidences, canEdit, canDelete, onClose, onChanged }: {
  convenio: EvalosConvenio | null; incidences: EvalosIncidence[]; canEdit: boolean; canDelete: boolean; onClose: () => void; onChanged: () => void;
}) {
  const isNew = !convenio;
  const ro = !canEdit;
  const [code, setCode] = useState(convenio?.code || '');
  const [name, setName] = useState(convenio?.name || '');
  const [vac, setVac] = useState({ day: convenio?.vacationDay ?? 1, month: convenio?.vacationMonth ?? 1 });
  const [vacDays, setVacDays] = useState(convenio ? fmtDays(convenio.vacationDays) : '');
  const [inc, setInc] = useState({ day: convenio?.incidenceDay ?? 1, month: convenio?.incidenceMonth ?? 1 });
  const [rows, setRows] = useState<LimitRow[]>(() => (convenio?.limits || []).map(toRow));
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const byCode = useMemo(() => new Map(incidences.map((i) => [i.code, i])), [incidences]);
  const used = new Set(rows.map((r) => r.incidence));
  const free = incidences.filter((i) => !used.has(i.code));

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
  const vacDaysNum = parseDays(vacDays);
  const vacDaysError = !vacDays.trim() ? 'Indica los días' : !(vacDaysNum >= 0 && vacDaysNum <= 365) || !Number.isInteger(vacDaysNum * 2) ? 'De 0 a 365, admite medios días' : '';
  const [touched, setTouched] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (vacDaysError || rows.some((r) => rowError(r))) { toast('Revisa los campos marcados', true); return; }
    setBusy(true);
    const payload = {
      code, name,
      vacationDay: vac.day, vacationMonth: vac.month, vacationDays: vacDaysNum,
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
    if (!convenio || !confirmAction(`¿Eliminar el convenio ${convenio.code} y sus límites de incidencia?`)) return;
    try { await api.del(`/api/evalos/convenios/${encodeURIComponent(convenio.code)}`); toast(`Convenio ${convenio.code} eliminado`); onChanged(); }
    catch (err: any) { toast(err.message, true); }
  }

  const title = isNew ? 'Nuevo convenio' : `Convenio ${convenio!.code}${ro ? ' (consulta)' : ''}`;
  return (
    <Modal title={title} onClose={onClose} wide>
      <form className="col" style={{ gap: 16 }} onSubmit={submit} noValidate>
        <div className="row wrap" style={{ gap: 12 }}>
          <label className="field" style={{ width: 160 }}>Código
            <input className="input mono" value={code} maxLength={10} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={!isNew || ro} placeholder="OFI" required autoFocus={isNew} />
          </label>
          <label className="field grow" style={{ minWidth: 220 }}>Nombre
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} disabled={ro} placeholder="Convenio de oficinas" required />
          </label>
        </div>

        <div className="grid-2" style={{ alignItems: 'stretch' }}>
          <div className="card col" style={{ gap: 10 }}>
            <b className="small row" style={{ gap: 6 }}><Icon.calendar /> Vacaciones</b>
            <label className="field">Inicio del periodo
              <DayMonth label="Inicio del periodo de vacaciones" day={vac.day} month={vac.month} disabled={ro} onChange={(day, month) => setVac({ day, month })} />
            </label>
            <label className="field">Días de vacaciones del periodo
              <input className="input" style={{ width: 120 }} inputMode="decimal" value={vacDays} disabled={ro} placeholder="22" onChange={(e) => setVacDays(e.target.value)} aria-invalid={touched && !!vacDaysError} />
              {touched && vacDaysError && <span className="xs" style={{ color: 'var(--bad)' }}>{vacDaysError}</span>}
            </label>
            <span className="xs muted">Periodo actual: {periodText(vac.day, vac.month)}</span>
          </div>
          <div className="card col" style={{ gap: 10 }}>
            <b className="small row" style={{ gap: 6 }}><Icon.clock /> Incidencias</b>
            <label className="field">Inicio del periodo
              <DayMonth label="Inicio del periodo de incidencias" day={inc.day} month={inc.month} disabled={ro} onChange={(day, month) => setInc({ day, month })} />
            </label>
            <span className="xs muted">Periodo actual: {periodText(inc.day, inc.month)}</span>
            <span className="xs muted">Los límites de abajo cuentan dentro de cada periodo de incidencias.</span>
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
                  <th style={{ width: 150 }}>Unidad</th>
                  <th style={{ width: 170 }}>Límite por periodo</th>
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
                          <select className="select grow" aria-label="Incidencia" value={r.incidence} disabled={ro} onChange={(e) => setRow(r.key, { incidence: e.target.value })}>
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
            <span className="muted xs" style={{ whiteSpace: 'nowrap' }}>{fmtLimit('D', c.vacationDays)} · {c.limits.length} límite(s)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
