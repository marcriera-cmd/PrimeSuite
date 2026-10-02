// Atajos de Evalos · Correcciones.
// Corrige marcajes (fichajes), resuelve solicitudes de empleados y registra ausencias.
// El mismo componente sirve de pantalla completa y de widget del Inicio.
import { useState, type FormEvent, type JSX } from 'react';
import {
  api, ApiError, type EvalosCorreccionesResponse, type EvalosMarcaje, type EvalosMarcajePunch
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

// ---------- Widget ----------
export function CorreccionesWidget() {
  const { data, error } = useCorrecciones();
  if (error) return error;
  if (!data) return <Loading />;
  const incidencias = data.marcajes.filter((m) => m.status === 'INCIDENCIA').length;
  const pendientes = data.solicitudes.filter((s) => s.status === 'PENDIENTE').length;
  return (
    <div className="row" style={{ gap: 10 }}>
      <div className="card grow" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Marcajes con incidencia</span><span className="stat">{incidencias}</span></div>
      <div className="card grow" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Solicitudes pendientes</span><span className="stat">{pendientes}</span></div>
    </div>
  );
}
