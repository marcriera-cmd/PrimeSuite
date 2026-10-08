// Atajos de Evalos · Correcciones.
// Corrige marcajes (fichajes), resuelve solicitudes de empleados y registra ausencias.
// El mismo componente sirve de pantalla completa y de widget del Inicio.
// Sin conexión (modo demostración) trabaja sobre el motor de demostración; con conexión real, la vista de Marcajes
// se alimenta de la API REST de Evalos 8: anomalías del listado PS_ANOMA y marcajes de Booking/attendance.
import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react';
import {
  api, ApiError, type EvalosCorreccionesResponse, type EvalosMarcaje, type EvalosMarcajePunch,
  type EvalosRestMarcaje, type EvalosRestMarcajesResponse, type EvalosBookingRef, type EvalosIncidencia, type EvalosEmployeeBrief
} from '../../api';
import { ErrorBox, Icon, Loading, Modal, confirmAction, useData, useToast } from '../../components/ui';
import { NotConfigured } from './common';

const NC = { notConfigured: true } as unknown as EvalosCorreccionesResponse;
const fmtDate = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
const AUSENCIA_TYPES = ['Enfermedad común', 'Accidente', 'Permiso retribuido', 'Asuntos propios', 'Vacaciones', 'Maternidad/Paternidad', 'Otros'];

function useCorrecciones() {
  const { data, error, reload } = useData(() =>
    api.get<EvalosCorreccionesResponse>('/api/evalos/correcciones').catch((e) => {
      if (e instanceof ApiError && e.code === 'not_configured') return NC;
      throw e;
    })
  );
  let node: JSX.Element | null = null;
  if (data === NC) node = <NotConfigured />;
  else if (error) node = <div className="col" style={{ gap: 8 }}><ErrorBox error={error} /><button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={reload}><Icon.refresh /> Reintentar</button></div>;
  return { data: data === NC ? null : data, error: node, reload };
}

type Tab = 'marcajes' | 'solicitudes' | 'ausencias';

export default function Correcciones() {
  const { data, error, reload } = useCorrecciones();
  const [tab, setTab] = useState<Tab>('marcajes');
  const [editM, setEditM] = useState<EvalosMarcaje | null>(null);
  const toast = useToast();

  if (error) return error;
  if (!data) return <Loading />;
  if (data.mode === 'rest') return <MarcajesRest employees={data.employees} canEdit={data.canEdit} />;

  const incidencias = data.marcajes.filter((m) => m.status === 'INCIDENCIA').length;
  const pendientes = data.solicitudes.filter((s) => s.status === 'PENDIENTE').length;

  async function resolve(id: string) {
    try { await api.post(`/api/evalos/marcajes/${encodeURIComponent(id)}/resolver`); reload(); }
    catch (err: any) { toast(err.message, true); }
  }
  async function decide(id: string, approve: boolean) {
    try { await api.post(`/api/evalos/solicitudes/${encodeURIComponent(id)}/decidir`, { approve }); reload(); }
    catch (err: any) { toast(err.message, true); }
  }
  async function delAusencia(id: string) {
    if (!confirmAction('¿Eliminar esta ausencia?')) return;
    try { await api.del(`/api/evalos/ausencias/${encodeURIComponent(id)}`); reload(); }
    catch (err: any) { toast(err.message, true); }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="tabs" role="tablist">
        {([['marcajes', `Marcajes${incidencias ? ` · ${incidencias}` : ''}`], ['solicitudes', `Solicitudes${pendientes ? ` · ${pendientes}` : ''}`], ['ausencias', 'Ausencias']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
        <span className="grow" />
        <button className="btn sm" onClick={reload}><Icon.refresh /> Actualizar</button>
      </div>

      {tab === 'marcajes' && (
        <div className="card flat">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 110 }}>Fecha</th><th>Empleado</th><th>Marcajes</th><th style={{ width: 230 }}>Estado</th>{data.canEdit && <th style={{ width: 150 }} />}</tr></thead>
              <tbody>
                {data.marcajes.map((m) => (
                  <tr key={m.id}>
                    <td className="mono small">{fmtDate(m.date)}</td>
                    <td className="small">{m.employeeName}</td>
                    <td className="mono small">{m.punches.length ? m.punches.map((p) => `${p.time}${p.type === 'E' ? '↓' : '↑'}`).join('  ') : <span className="muted">—</span>}</td>
                    <td>{m.status === 'OK' ? <span className="tag ok">Correcto</span> : <span className="tag bad" title={m.issue}>{m.issue || 'Incidencia'}</span>}</td>
                    {data.canEdit && (
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn sm" onClick={() => setEditM(m)}><Icon.edit /> Corregir</button>
                          {m.status === 'INCIDENCIA' && <button className="btn sm" onClick={() => resolve(m.id)} title="Marcar como resuelta">OK</button>}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {!data.marcajes.length && <tr><td colSpan={5} className="muted small" style={{ padding: 28, textAlign: 'center' }}>No hay marcajes.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="ev-foot xs muted">↓ entrada · ↑ salida · {incidencias} incidencia(s)</div>
        </div>
      )}

      {tab === 'solicitudes' && (
        <div className="card flat">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Empleado</th><th style={{ width: 160 }}>Tipo</th><th style={{ width: 180 }}>Fechas</th><th style={{ width: 70, textAlign: 'right' }}>Días</th><th style={{ width: 120 }}>Estado</th>{data.canEdit && <th style={{ width: 170 }} />}</tr></thead>
              <tbody>
                {data.solicitudes.map((s) => (
                  <tr key={s.id}>
                    <td className="small">{s.employeeName}{s.reason && <div className="xs muted">{s.reason}</div>}</td>
                    <td className="small">{s.type}</td>
                    <td className="small">{fmtDate(s.from)}{s.to !== s.from ? ` – ${fmtDate(s.to)}` : ''}</td>
                    <td className="small" style={{ textAlign: 'right' }}>{s.days}</td>
                    <td>{s.status === 'PENDIENTE' ? <span className="tag warn">Pendiente</span> : s.status === 'APROBADA' ? <span className="tag ok">Aprobada</span> : <span className="tag bad">Rechazada</span>}</td>
                    {data.canEdit && (
                      <td>{s.status === 'PENDIENTE' && (
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn sm success" onClick={() => decide(s.id, true)}>Aprobar</button>
                          <button className="btn sm danger" onClick={() => decide(s.id, false)}>Rechazar</button>
                        </div>
                      )}</td>
                    )}
                  </tr>
                ))}
                {!data.solicitudes.length && <tr><td colSpan={6} className="muted small" style={{ padding: 28, textAlign: 'center' }}>No hay solicitudes.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="ev-foot xs muted">Al aprobar una solicitud de vacaciones/permiso se registra automáticamente en Ausencias.</div>
        </div>
      )}

      {tab === 'ausencias' && <AusenciasTab data={data} onChanged={reload} onDelete={delAusencia} />}

      {editM && <MarcajeModal marcaje={editM} onClose={() => setEditM(null)} onSaved={() => { setEditM(null); reload(); }} />}
    </div>
  );
}

function AusenciasTab({ data, onChanged, onDelete }: { data: EvalosCorreccionesResponse; onChanged: () => void; onDelete: (id: string) => void }) {
  const [employee, setEmployee] = useState('');
  const [type, setType] = useState(AUSENCIA_TYPES[0]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!employee) return toast('Elige un empleado', true);
    setBusy(true);
    try { await api.post('/api/evalos/ausencias', { employee, type, from, to: to || from, reason }); setEmployee(''); setFrom(''); setTo(''); setReason(''); onChanged(); }
    catch (err: any) { toast(err.message, true); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start', gridTemplateColumns: '1.3fr 1fr' }}>
      <div className="card flat">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Empleado</th><th style={{ width: 160 }}>Tipo</th><th style={{ width: 180 }}>Fechas</th><th style={{ width: 60, textAlign: 'right' }}>Días</th>{data.canDelete && <th style={{ width: 40 }} />}</tr></thead>
            <tbody>
              {data.ausencias.map((a) => (
                <tr key={a.id}>
                  <td className="small">{a.employeeName}{a.reason && <div className="xs muted">{a.reason}</div>}</td>
                  <td className="small">{a.type}</td>
                  <td className="small">{fmtDate(a.from)}{a.to !== a.from ? ` – ${fmtDate(a.to)}` : ''}</td>
                  <td className="small" style={{ textAlign: 'right' }}>{a.days}</td>
                  {data.canDelete && <td><button className="icon-btn" aria-label="Quitar" onClick={() => onDelete(a.id)}><Icon.trash /></button></td>}
                </tr>
              ))}
              {!data.ausencias.length && <tr><td colSpan={5} className="muted small" style={{ padding: 28, textAlign: 'center' }}>No hay ausencias registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {data.canEdit && (
        <form className="card" onSubmit={submit}>
          <h3>Añadir ausencia</h3>
          <label className="field">Empleado
            <select className="select" value={employee} onChange={(e) => setEmployee(e.target.value)} required>
              <option value="">— Selecciona —</option>
              {data.employees.map((e) => <option key={e.code} value={e.code}>{e.name}</option>)}
            </select>
          </label>
          <label className="field">Tipo
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              {AUSENCIA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div className="grid-2">
            <label className="field">Desde<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required /></label>
            <label className="field">Hasta<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <label className="field">Motivo (opcional)<input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Registrar ausencia'}</button>
        </form>
      )}
    </div>
  );
}

function MarcajeModal({ marcaje, onClose, onSaved }: { marcaje: EvalosMarcaje; onClose: () => void; onSaved: () => void }) {
  const [punches, setPunches] = useState<EvalosMarcajePunch[]>(marcaje.punches.length ? marcaje.punches : [{ time: '08:00', type: 'E' }]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (i: number, k: 'time' | 'type', v: string) => setPunches((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  async function save() {
    setBusy(true);
    try { await api.put(`/api/evalos/marcajes/${encodeURIComponent(marcaje.id)}`, { punches }); onSaved(); }
    catch (err: any) { toast(err.message, true); setBusy(false); }
  }

  return (
    <Modal title={`Corregir marcajes · ${marcaje.employeeName}`} onClose={onClose}>
      <div className="col" style={{ gap: 12 }}>
        <span className="xs muted">{fmtDate(marcaje.date)} · marca las entradas (E) y salidas (S). Deben quedar en pares.</span>
        {punches.map((p, i) => (
          <div key={i} className="row" style={{ gap: 8 }}>
            <input className="input" style={{ width: 120 }} type="time" value={p.time} onChange={(e) => set(i, 'time', e.target.value)} />
            <select className="select" style={{ width: 130 }} value={p.type} onChange={(e) => set(i, 'type', e.target.value)}>
              <option value="E">Entrada</option><option value="S">Salida</option>
            </select>
            <button type="button" className="icon-btn" aria-label="Quitar" onClick={() => setPunches((x) => x.filter((_, j) => j !== i))}><Icon.trash /></button>
          </div>
        ))}
        <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPunches((x) => [...x, { time: '17:00', type: x.length % 2 === 0 ? 'E' : 'S' }])}><Icon.plus /> Añadir marcaje</button>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Marcajes con conexión real (EvalosRest) ----------
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d); };
const qs = (from: string, to: string, employee: string) =>
  `/api/evalos/correcciones/marcajes?from=${from}&to=${to}${employee ? `&employee=${encodeURIComponent(employee)}` : ''}`;
/** Incidencia normal: 0, 00, 000… según la instalación. */
const isNormalInc = (c: string) => /^0*$/.test(c);
const punchTitle = (p: EvalosRestMarcaje['punches'][number]) =>
  [`${p.seconds} · ${p.type === 'E' ? 'entrada' : 'salida'}`, !isNormalInc(p.incidence) ? `incidencia ${p.incidence}${p.incidenceName ? ` · ${p.incidenceName}` : ''}` : '', p.manual ? 'manual' : p.terminal ? `terminal ${p.terminal}` : '', p.anomaly || ''].filter(Boolean).join('\n');

/** Marcajes y anomalías de Evalos 8 por empleado y día, con alta de marcajes manuales. Mismo diseño que la vista sin conexión. */
function MarcajesRest({ employees, canEdit }: { employees: EvalosEmployeeBrief[]; canEdit: boolean }) {
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(isoLocal(new Date()));
  const [employee, setEmployee] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState({ from, to, employee });
  const [editM, setEditM] = useState<EvalosRestMarcaje | null>(null);
  const [showReport, setShowReport] = useState(false);
  const { data, error, reload } = useData(() => api.get<EvalosRestMarcajesResponse>(qs(query.from, query.to, query.employee)), [query.from, query.to, query.employee]);

  const apply = (e?: FormEvent) => { e?.preventDefault(); if (query.from === from && query.to === to && query.employee === employee) reload(); else setQuery({ from, to, employee }); };
  const t = q.trim().toLowerCase();
  const list = useMemo(() => (data?.marcajes || []).filter((m) =>
    (!onlyIssues || m.status === 'INCIDENCIA') && (!t || m.employeeName.toLowerCase().includes(t) || m.employee.toLowerCase().includes(t))
  ), [data, onlyIssues, t]);
  const incidencias = (data?.marcajes || []).filter((m) => m.status === 'INCIDENCIA').length;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected className="on">Marcajes{incidencias ? ` · ${incidencias}` : ''}</button>
        <span className="grow" />
        <button className="btn sm" onClick={() => apply()}><Icon.refresh /> Actualizar</button>
      </div>

      <div className="card flat">
        <form className="ev-toolbar" onSubmit={apply}>
          <label className="field" style={{ margin: 0 }}><span className="xs muted">Desde</span><input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required /></label>
          <label className="field" style={{ margin: 0 }}><span className="xs muted">Hasta</span><input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required /></label>
          <label className="field" style={{ margin: 0, minWidth: 200 }}><span className="xs muted">Empleado</span>
            <select className="select" value={employee} onChange={(e) => setEmployee(e.target.value)}>
              <option value="">Todos</option>
              {employees.map((e) => <option key={e.code} value={e.code}>{e.name} · {e.code}</option>)}
            </select>
          </label>
          <button className="btn primary sm" style={{ alignSelf: 'flex-end' }}>Consultar</button>
          <span className="grow" />
          <label className="search" style={{ minWidth: 160, maxWidth: 240, alignSelf: 'flex-end' }}>
            <Icon.search /><input placeholder="Filtrar empleado…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrar por empleado" />
          </label>
          <label className="check xs" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Solo con anomalías</label>
        </form>

        {error && <div style={{ padding: 14 }} className="col"><ErrorBox error={error} />{/API REST/.test(error) && <span className="xs muted">Un superadministrador puede completarla en Administración › Integraciones › Evalos8 › API REST.</span>}</div>}
        {data?.warnings.map((w) => <div key={w} style={{ padding: '10px 14px 0' }}><div className="alert warn small">{w}</div></div>)}
        {!data && !error && <Loading />}
        {data && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 110 }}>Fecha</th><th>Empleado</th><th>Marcajes</th><th style={{ width: 260 }}>Estado</th>{canEdit && <th style={{ width: 120 }} />}</tr></thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id}>
                    <td className="mono small">{fmtDate(m.date)}</td>
                    <td className="small">{m.employeeName}{m.employeeName !== m.employee && <div className="xs muted mono">{m.employee}</div>}</td>
                    <td className="mono small">
                      {m.punches.length ? m.punches.map((p, i) => (
                        <span key={i} title={punchTitle(p)} style={{ marginRight: 10, whiteSpace: 'nowrap', color: p.anomaly ? 'var(--bad, #c0392b)' : undefined }}>
                          {p.time}{p.type === 'E' ? '↓' : '↑'}{p.manual ? '*' : ''}{!isNormalInc(p.incidence) ? <sup className="xs muted">{p.incidence}</sup> : null}
                        </span>
                      )) : <span className="muted">—</span>}
                    </td>
                    <td>{m.status === 'OK' ? <span className="tag ok">Correcto</span> : (
                      <div className="row wrap" style={{ gap: 4 }}>{(m.issues.length ? m.issues : ['Anomalía']).map((x) => <span key={x} className="tag bad">{x}</span>)}</div>
                    )}</td>
                    {canEdit && <td><button className="btn sm" onClick={() => setEditM(m)}><Icon.edit /> Corregir</button></td>}
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={5} className="muted small" style={{ padding: 28, textAlign: 'center' }}>{data.marcajes.length ? 'Ningún día coincide con el filtro.' : 'No hay marcajes ni anomalías en el periodo.'}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="ev-foot xs muted">
            ↓ entrada · ↑ salida · * manual · {incidencias} día(s) con anomalías · {fmtDate(data.from)} – {fmtDate(data.to)} · Evalos 8 (API REST) · {data.ms} ms
            {data.reportPreview && <> · listado {data.report}: {data.reportPreview.rows} fila(s), {data.reportPreview.anomalies} con anomalías · <button type="button" className="xs" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setShowReport((v) => !v)}>{showReport ? 'Ocultar respuesta' : 'Ver respuesta'}</button></>}
          </div>
        )}
        {data?.reportPreview && showReport && (
          <div style={{ padding: 14 }} className="col">
            <span className="xs muted">Columnas leídas: {data.reportPreview.columns.length ? data.reportPreview.columns.join(' · ') : '(ninguna)'}</span>
            <pre className="code" style={{ maxHeight: 360, overflow: 'auto', margin: 0 }}>{data.reportPreview.sample || '(respuesta vacía)'}</pre>
          </div>
        )}
      </div>

      {editM && <MarcajeRestModal marcaje={editM} onClose={() => setEditM(null)} onSaved={() => { setEditM(null); reload(); }} />}
    </div>
  );
}

/** Incidencia de los marcajes normales: no está en la tabla INCIDENC y va siempre la primera. */
const NORMAL_INC: EvalosIncidencia = { code: '000', name: 'Entrada / Salida' };
let incidenciasCache: Promise<EvalosIncidencia[]> | null = null;
const loadIncidencias = () => (incidenciasCache ||= api.get<{ items: EvalosIncidencia[] }>('/api/evalos/correcciones/incidencias').then((r) => r.items).catch((e) => { incidenciasCache = null; throw e; }));

interface EditRow { time: string; incidence: string; original?: string; origTime?: string; origInc?: string; ref?: EvalosBookingRef; manual?: boolean; type?: 'E' | 'S'; terminal?: string; anomaly?: string; incidenceName?: string }

/**
 * Corregir un día: los marcajes que ya están en Evalos se pueden modificar (incidencia; la hora solo en los manuales,
 * como en Evalos) y se pueden añadir marcajes manuales. Todo se graba con POST /Booking/attendance.
 */
function MarcajeRestModal({ marcaje, onClose, onSaved }: { marcaje: EvalosRestMarcaje; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<EditRow[]>(() => [
    ...marcaje.punches.map((p) => ({ time: p.time, incidence: p.incidence, original: p.seconds, origTime: p.time, origInc: p.incidence, ref: p.ref, manual: p.manual, type: p.type, terminal: p.terminal, anomaly: p.anomaly, incidenceName: p.incidenceName })),
    ...(marcaje.punches.length ? [] : [{ time: '08:00', incidence: NORMAL_INC.code }])
  ]);
  const [incs, setIncs] = useState<EvalosIncidencia[]>([NORMAL_INC]);
  const [incErr, setIncErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { loadIncidencias().then(setIncs, (e) => setIncErr(e.message)); }, []);
  const set = (i: number, k: 'time' | 'incidence', v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const changed = rows.filter((r) => !r.original || r.time !== r.origTime || r.incidence !== r.origInc);
  const nNew = changed.filter((r) => !r.original).length, nMod = changed.length - nNew;

  async function save() {
    if (!changed.length) return toast('No hay cambios que guardar', true);
    setBusy(true);
    try {
      await api.post('/api/evalos/correcciones/marcajes', {
        employee: marcaje.employee, date: marcaje.date,
        punches: changed.map((r) => (r.original ? { time: r.time, incidence: r.incidence, original: r.original, ref: r.ref } : { time: r.time, incidence: r.incidence }))
      });
      toast([nMod ? `${nMod} marcaje(s) modificado(s)` : '', nNew ? `${nNew} añadido(s)` : ''].filter(Boolean).join(' · ') + ' en Evalos');
      onSaved();
    } catch (err: any) { toast(err.message, true); setBusy(false); }
  }

  // Combo de incidencias (tabla INCIDENC): se ve la descripción y se guarda el código.
  const incSelect = (r: EditRow, i: number) => (
    <select className="select grow" value={r.incidence} onChange={(e) => set(i, 'incidence', e.target.value)} aria-label="Incidencia" title={`Incidencia ${r.incidence}`}>
      {/* 0, 00… también son «Entrada / Salida»: se muestra igual y se conserva el código que trae el marcaje. */}
      {!incs.some((x) => x.code === r.incidence) && <option value={r.incidence}>{isNormalInc(r.incidence) ? NORMAL_INC.name : r.incidenceName || r.incidence}</option>}
      {incs.map((x) => <option key={x.code} value={x.code}>{x.name || x.code}</option>)}
    </select>
  );

  return (
    <Modal title={`Corregir marcajes · ${marcaje.employeeName}`} onClose={onClose}>
      <div className="col" style={{ gap: 12 }}>
        <span className="xs muted">{fmtDate(marcaje.date)} · cambia la incidencia de cualquier marcaje y la hora de los manuales (la de los marcajes de terminal no se puede cambiar), o añade marcajes manuales.</span>
        {marcaje.issues.length > 0 && <div className="row wrap" style={{ gap: 4 }}>{marcaje.issues.map((x) => <span key={x} className="tag bad">{x}</span>)}</div>}
        {incErr && <div className="alert warn xs">No se pudo leer la lista de incidencias (INCIDENC): {incErr}</div>}
        {rows.map((r, i) => {
          const isMod = !!r.original && (r.time !== r.origTime || r.incidence !== r.origInc);
          return (
            <div key={i} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input className="input" style={{ width: 120 }} type="time" value={r.time} onChange={(e) => set(i, 'time', e.target.value)} required
                disabled={!!r.original && !r.manual} title={r.original && !r.manual ? 'La hora de un marcaje de terminal no se puede cambiar' : undefined} aria-label="Hora" />
              {incSelect(r, i)}
              <span className="xs muted" style={{ width: 120, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.anomaly || r.terminal || ''}>
                {!r.original ? <span className="tag info">Nuevo</span> : isMod ? <span className="tag warn">Modificado</span> : r.manual ? 'Manual' : r.terminal || 'Terminal'}
              </span>
              {r.original
                ? <button type="button" className="icon-btn" aria-label="Deshacer cambios" title="Deshacer cambios" disabled={!isMod} onClick={() => setRows((x) => x.map((y, j) => (j === i ? { ...y, time: y.origTime!, incidence: y.origInc! } : y)))}><Icon.refresh /></button>
                : <button type="button" className="icon-btn" aria-label="Quitar" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Icon.trash /></button>}
            </div>
          );
        })}
        {!rows.length && <span className="muted small">Sin marcajes este día.</span>}
        <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRows((x) => [...x, { time: '17:00', incidence: NORMAL_INC.code }])}><Icon.plus /> Añadir marcaje</button>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !changed.length} onClick={save}>{busy ? 'Guardando…' : changed.length ? `Guardar en Evalos (${changed.length})` : 'Guardar en Evalos'}</button>
        </div>
      </div>
    </Modal>
  );
}

function CorreccionesRestWidget() {
  const { data, error } = useData(() => api.get<EvalosRestMarcajesResponse>(qs(daysAgo(6), isoLocal(new Date()), '')));
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const incidencias = data.marcajes.filter((m) => m.status === 'INCIDENCIA').length;
  return (
    <div className="row" style={{ gap: 10 }}>
      <div className="card grow" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Días con anomalías (7 días)</span><span className="stat">{incidencias}</span></div>
      <div className="card grow" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Días con marcajes</span><span className="stat">{data.marcajes.filter((m) => m.punches.length).length}</span></div>
    </div>
  );
}

// ---------- Widget ----------
export function CorreccionesWidget() {
  const { data, error } = useCorrecciones();
  if (error) return error;
  if (!data) return <Loading />;
  if (data.mode === 'rest') return <CorreccionesRestWidget />;
  const incidencias = data.marcajes.filter((m) => m.status === 'INCIDENCIA').length;
  const pendientes = data.solicitudes.filter((s) => s.status === 'PENDIENTE').length;
  return (
    <div className="row" style={{ gap: 10 }}>
      <div className="card grow" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Marcajes con incidencia</span><span className="stat">{incidencias}</span></div>
      <div className="card grow" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Solicitudes pendientes</span><span className="stat">{pendientes}</span></div>
    </div>
  );
}
