// Atajos de Evalos · Calendarios.
// Calendarios laborales con sus festivos (por ahora en modo demostración). Los convenios están en su propia pantalla.
// El mismo componente sirve de pantalla y de widget.
import { useState, type FormEvent, type JSX } from 'react';
import { api, ApiError, type EvalosCalendar, type EvalosCalendarDetail, type EvalosCalendariosResponse, type EvalosHolidayType } from '../../api';
import { Drawer, ErrorBox, Icon, Loading, Modal, confirmAction, useData, useToast } from '../../components/ui';
import { NotConfigured } from './common';

const NC = { notConfigured: true } as unknown as EvalosCalendariosResponse;
const HOLIDAY_LABEL: Record<EvalosHolidayType, string> = { NACIONAL: 'Nacional', AUTONOMICO: 'Autonómico', LOCAL: 'Local', EMPRESA: 'Empresa' };
const HOLIDAY_TAG: Record<EvalosHolidayType, string> = { NACIONAL: 'bad', AUTONOMICO: 'info', LOCAL: 'warn', EMPRESA: 'ok' };
const fmtDate = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');

function useCalendarios() {
  const { data, error, reload } = useData(() =>
    api.get<EvalosCalendariosResponse>('/api/evalos/calendarios').catch((e) => {
      if (e instanceof ApiError && e.code === 'not_configured') return NC;
      throw e;
    })
  );
  let node: JSX.Element | null = null;
  if (data === NC) node = <NotConfigured />;
  else if (error) node = <div className="col" style={{ gap: 8 }}><ErrorBox error={error} /><button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={reload}><Icon.refresh /> Reintentar</button></div>;
  return { data: data === NC ? null : data, error: node, reload };
}

export default function Calendarios() {
  const { data, error, reload } = useCalendarios();
  const [openCal, setOpenCal] = useState<string | null>(null);
  const [newCal, setNewCal] = useState(false);
  if (error) return error;
  if (!data) return <Loading />;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card flat">
        <div className="ev-toolbar">
          <b className="small">{data.calendars.length} calendario(s)</b>
          <span className="grow" />
          <button className="btn sm" onClick={reload}><Icon.refresh /> Actualizar</button>
          {data.canEdit && <button className="btn primary sm" onClick={() => setNewCal(true)}><Icon.plus /> Nuevo calendario</button>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 140 }}>Código</th><th>Nombre</th><th style={{ width: 70 }}>Año</th><th style={{ width: 90, textAlign: 'right' }}>Festivos</th><th style={{ width: 110, textAlign: 'right' }}>Empleados</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>
              {data.calendars.map((c) => (
                <tr key={c.code} className="clickable" onClick={() => setOpenCal(c.code)}>
                  <td className="mono"><b>{c.code}</b></td>
                  <td>{c.name}</td>
                  <td className="small">{c.year}</td>
                  <td className="small" style={{ textAlign: 'right' }}>{c.holidays}</td>
                  <td className="small" style={{ textAlign: 'right' }}>{c.employees}</td>
                  <td className="muted"><span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }}><Icon.chevron /></span></td>
                </tr>
              ))}
              {!data.calendars.length && <tr><td colSpan={6} className="muted small" style={{ padding: 28, textAlign: 'center' }}>No hay calendarios.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {openCal && <CalendarDrawer code={openCal} canEdit={data.canEdit} canDelete={data.canDelete} onClose={() => setOpenCal(null)} onChanged={reload} />}
      {newCal && <NewCalendarModal onClose={() => setNewCal(false)} onCreated={(code) => { setNewCal(false); reload(); setOpenCal(code); }} />}
    </div>
  );
}

// ---------- Detalle de calendario (festivos) ----------
function CalendarDrawer({ code, canEdit, canDelete, onClose, onChanged }: { code: string; canEdit: boolean; canDelete: boolean; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload, setData } = useData(() => api.get<EvalosCalendarDetail>(`/api/evalos/calendarios/${encodeURIComponent(code)}`), [code]);
  const toast = useToast();
  const [addDate, setAddDate] = useState('');
  const [addType, setAddType] = useState<EvalosHolidayType>('EMPRESA');
  const [addDesc, setAddDesc] = useState('');

  async function addHoliday(e: FormEvent) {
    e.preventDefault();
    try { setData(await api.post<EvalosCalendarDetail>(`/api/evalos/calendarios/${encodeURIComponent(code)}/festivos`, { date: addDate, type: addType, description: addDesc })); setAddDate(''); setAddDesc(''); onChanged(); }
    catch (err: any) { toast(err.message, true); }
  }
  async function delHoliday(date: string) {
    try { setData(await api.del<EvalosCalendarDetail>(`/api/evalos/calendarios/${encodeURIComponent(code)}/festivos/${date}`)); onChanged(); }
    catch (err: any) { toast(err.message, true); }
  }
  async function removeCalendar() {
    if (!confirmAction(`¿Eliminar el calendario ${code}?`)) return;
    try { await api.del(`/api/evalos/calendarios/${encodeURIComponent(code)}`); onChanged(); onClose(); }
    catch (err: any) { toast(err.message, true); }
  }

  return (
    <Drawer title={<span className="row" style={{ gap: 10 }}><span className="mono">{code}</span>{data && <span className="muted small">{data.name}</span>}</span>} onClose={onClose}>
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
        <div className="col" style={{ gap: 16 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="tag info">Año {data.year}</span>
            <span className="tag">{data.holidays} festivos</span>
            <span className="tag ok">{data.employees} empleados</span>
          </div>

          <div className="col" style={{ gap: 6 }}>
            <b className="small">Festivos</b>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th style={{ width: 110 }}>Fecha</th><th style={{ width: 110 }}>Tipo</th><th>Descripción</th>{canEdit && <th style={{ width: 40 }} />}</tr></thead>
                <tbody>
                  {data.days.map((h) => (
                    <tr key={h.date}>
                      <td className="mono small">{fmtDate(h.date)}</td>
                      <td><span className={`tag ${HOLIDAY_TAG[h.type]}`}>{HOLIDAY_LABEL[h.type]}</span></td>
                      <td className="small">{h.description}</td>
                      {canEdit && <td><button className="icon-btn" aria-label="Quitar" onClick={() => delHoliday(h.date)}><Icon.trash /></button></td>}
                    </tr>
                  ))}
                  {!data.days.length && <tr><td colSpan={canEdit ? 4 : 3} className="muted small" style={{ padding: 20, textAlign: 'center' }}>Sin festivos todavía.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {canEdit && (
            <form className="card" style={{ gap: 10 }} onSubmit={addHoliday}>
              <b className="small">Añadir festivo</b>
              <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
                <label className="field" style={{ width: 150 }}>Fecha<input className="input" type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} required /></label>
                <label className="field" style={{ width: 150 }}>Tipo
                  <select className="select" value={addType} onChange={(e) => setAddType(e.target.value as EvalosHolidayType)}>
                    {(Object.keys(HOLIDAY_LABEL) as EvalosHolidayType[]).map((t) => <option key={t} value={t}>{HOLIDAY_LABEL[t]}</option>)}
                  </select>
                </label>
                <label className="field grow" style={{ minWidth: 160 }}>Descripción<input className="input" value={addDesc} onChange={(e) => setAddDesc(e.target.value)} required /></label>
                <button className="btn primary"><Icon.plus /> Añadir</button>
              </div>
            </form>
          )}

          {canDelete && <button className="btn danger sm" style={{ alignSelf: 'flex-start' }} onClick={removeCalendar}><Icon.trash /> Eliminar calendario</button>}
        </div>
      )}
    </Drawer>
  );
}

function NewCalendarModal({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { const c = await api.post<EvalosCalendar>('/api/evalos/calendarios', { code, name, year }); onCreated(c.code); }
    catch (err: any) { toast(err.message, true); setBusy(false); }
  }
  return (
    <Modal title="Nuevo calendario" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <div className="grid-2">
          <label className="field">Código<input className="input mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="OFI2026" required /></label>
          <label className="field">Año<input className="input" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        </div>
        <label className="field">Nombre<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Oficinas 2026" required /></label>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Creando…' : 'Crear'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Widget ----------
export function CalendariosWidget() {
  const { data, error } = useCalendarios();
  if (error) return error;
  if (!data) return <Loading />;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="card" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Calendarios</span><span className="stat">{data.calendars.length}</span></div>
      <div className="col" style={{ gap: 4 }}>
        {data.calendars.slice(0, 4).map((c) => (
          <div key={c.code} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
            <span>{c.name}</span><span className="muted xs">{c.holidays} festivos</span>
          </div>
        ))}
      </div>
    </div>
  );
}
