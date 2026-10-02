// Atajos de Evalos · Calendarios y convenios.
// Calendarios laborales con sus festivos, convenios colectivos y una calculadora de vacaciones
// que aplica los días de convenio + la antigüedad. El mismo componente sirve de pantalla y de widget.
import { useMemo, useState, type FormEvent, type JSX } from 'react';
import {
  api, ApiError, type EvalosCalendar, type EvalosCalendarDetail, type EvalosCalendariosResponse,
  type EvalosConvenio, type EvalosHoliday, type EvalosHolidayType, type EvalosVacationCalc
} from '../../api';
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

type Tab = 'calendarios' | 'convenios' | 'calculadora';

export default function Calendarios() {
  const { data, error, reload } = useCalendarios();
  const [tab, setTab] = useState<Tab>('calendarios');
  const [openCal, setOpenCal] = useState<string | null>(null);
  const [newCal, setNewCal] = useState(false);
  const [editConv, setEditConv] = useState<EvalosConvenio | null | 'new'>(null);
  if (error) return error;
  if (!data) return <Loading />;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="tabs" role="tablist">
        {([['calendarios', 'Calendarios'], ['convenios', 'Convenios'], ['calculadora', 'Calculadora de vacaciones']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'calendarios' && (
        <div className="card flat">
          <div className="ev-toolbar">
            <b className="small">{data.calendars.length} calendario(s)</b>
            <span className="grow" />
            <button className="btn sm" onClick={reload}><Icon.refresh /> Actualizar</button>
            {data.canEdit && <button className="btn primary sm" onClick={() => setNewCal(true)}><Icon.plus /> Nuevo calendario</button>}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 140 }}>Código</th><th>Nombre</th><th style={{ width: 70 }}>Año</th><th style={{ width: 150 }}>Convenio</th><th style={{ width: 90, textAlign: 'right' }}>Festivos</th><th style={{ width: 110, textAlign: 'right' }}>Empleados</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {data.calendars.map((c) => (
                  <tr key={c.code} className="clickable" onClick={() => setOpenCal(c.code)}>
                    <td className="mono"><b>{c.code}</b></td>
                    <td>{c.name}</td>
                    <td className="small">{c.year}</td>
                    <td>{c.convenio ? <span className="tag">{c.convenio}</span> : <span className="muted">—</span>}</td>
                    <td className="small" style={{ textAlign: 'right' }}>{c.holidays}</td>
                    <td className="small" style={{ textAlign: 'right' }}>{c.employees}</td>
                    <td className="muted"><span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }}><Icon.chevron /></span></td>
                  </tr>
                ))}
                {!data.calendars.length && <tr><td colSpan={7} className="muted small" style={{ padding: 28, textAlign: 'center' }}>No hay calendarios.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'convenios' && (
        <div className="card flat">
          <div className="ev-toolbar">
            <b className="small">{data.convenios.length} convenio(s)</b>
            <span className="grow" />
            {data.canEdit && <button className="btn primary sm" onClick={() => setEditConv('new')}><Icon.plus /> Nuevo convenio</button>}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 120 }}>Código</th><th>Nombre</th><th style={{ width: 130, textAlign: 'right' }}>Días vacaciones</th><th style={{ width: 120, textAlign: 'right' }}>Horas/año</th><th style={{ width: 150 }}>Antigüedad</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {data.convenios.map((c) => (
                  <tr key={c.code} className={data.canEdit ? 'clickable' : undefined} onClick={data.canEdit ? () => setEditConv(c) : undefined}>
                    <td className="mono"><b>{c.code}</b></td>
                    <td>{c.name}</td>
                    <td className="small" style={{ textAlign: 'right', fontWeight: 600 }}>{c.vacationDays}</td>
                    <td className="small" style={{ textAlign: 'right' }}>{c.hoursYear || '—'}</td>
                    <td className="xs muted">{c.seniority.length ? c.seniority.map((t) => `+${t.extraDays}d a ${t.years}a`).join(' · ') : '—'}</td>
                    <td className="muted">{data.canEdit && <Icon.edit />}</td>
                  </tr>
                ))}
                {!data.convenios.length && <tr><td colSpan={6} className="muted small" style={{ padding: 28, textAlign: 'center' }}>No hay convenios.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="ev-foot xs muted">Los convenios definen los días de vacaciones y los días extra por antigüedad que usa la calculadora.</div>
        </div>
      )}

      {tab === 'calculadora' && <VacationCalculator convenios={data.convenios} />}

      {openCal && <CalendarDrawer code={openCal} convenios={data.convenios} canEdit={data.canEdit} canDelete={data.canDelete} onClose={() => setOpenCal(null)} onChanged={reload} />}
      {newCal && <NewCalendarModal convenios={data.convenios} onClose={() => setNewCal(false)} onCreated={(code) => { setNewCal(false); reload(); setOpenCal(code); }} />}
      {editConv && <ConvenioModal convenio={editConv === 'new' ? null : editConv} canDelete={data.canDelete} onClose={() => setEditConv(null)} onChanged={() => { setEditConv(null); reload(); }} />}
    </div>
  );
}

// ---------- Calculadora de vacaciones ----------
function VacationCalculator({ convenios }: { convenios: EvalosConvenio[] }) {
  const [convenio, setConvenio] = useState(convenios[0]?.code || '');
  const [hireDate, setHireDate] = useState('2015-03-01');
  const [year, setYear] = useState(new Date().getFullYear());
  const [res, setRes] = useState<EvalosVacationCalc | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function calc(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { setRes(await api.post<EvalosVacationCalc>('/api/evalos/vacaciones/calcular', { convenio, hireDate, year })); }
    catch (err: any) { toast(err.message, true); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <form className="card" onSubmit={calc}>
        <h3>Calcular vacaciones</h3>
        <span className="xs muted">Aplica los días del convenio más los días extra por antigüedad, y prorratea si el alta es dentro del año.</span>
        <label className="field">Convenio
          <select className="select" value={convenio} onChange={(e) => setConvenio(e.target.value)}>
            {convenios.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
        </label>
        <div className="grid-2">
          <label className="field">Fecha de alta<input className="input" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} required /></label>
          <label className="field">Año<input className="input" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        </div>
        <button className="btn primary" disabled={busy || !convenio}>{busy ? 'Calculando…' : 'Calcular'}</button>
      </form>

      <div className="card">
        <h3>Resultado</h3>
        {!res ? <span className="muted small">Introduce los datos y pulsa Calcular.</span> : (
          <>
            <div className="ev-kpis">
              <div className="card" style={{ gap: 2, padding: '14px 16px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Días que le corresponden ({res.year})</span><span className="stat">{res.proratedDays}</span></div>
            </div>
            <table className="table"><tbody>
              <tr><td>Convenio</td><td style={{ textAlign: 'right' }}><b>{res.convenio}</b> · {res.convenioName}</td></tr>
              <tr><td>Días base del convenio</td><td style={{ textAlign: 'right' }}>{res.baseDays}</td></tr>
              <tr><td>Antigüedad a 31/12/{res.year}</td><td style={{ textAlign: 'right' }}>{res.seniorityYears} año(s)</td></tr>
              <tr><td>Días extra por antigüedad</td><td style={{ textAlign: 'right' }}>+{res.seniorityExtra}</td></tr>
              <tr><td>Total anual</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{res.totalDays}</td></tr>
              <tr><td>Días trabajados en el año</td><td style={{ textAlign: 'right' }}>{res.workedDays} / {res.yearDays}</td></tr>
              <tr><td><b>Prorrateado</b></td><td style={{ textAlign: 'right', fontWeight: 700 }}>{res.proratedDays} días</td></tr>
            </tbody></table>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Detalle de calendario (festivos) ----------
function CalendarDrawer({ code, convenios, canEdit, canDelete, onClose, onChanged }: { code: string; convenios: EvalosConvenio[]; canEdit: boolean; canDelete: boolean; onClose: () => void; onChanged: () => void }) {
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
  async function setConvenio(conv: string) {
    try { setData(await api.put<EvalosCalendarDetail>(`/api/evalos/calendarios/${encodeURIComponent(code)}`, { convenio: conv })); onChanged(); }
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

          <label className="field" style={{ maxWidth: 280 }}>Convenio aplicado
            <select className="select" value={data.convenio || ''} onChange={(e) => setConvenio(e.target.value)} disabled={!canEdit}>
              <option value="">— Sin convenio —</option>
              {convenios.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
            </select>
          </label>

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

function NewCalendarModal({ convenios, onClose, onCreated }: { convenios: EvalosConvenio[]; onClose: () => void; onCreated: (code: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [convenio, setConvenio] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { const c = await api.post<EvalosCalendar>('/api/evalos/calendarios', { code, name, year, convenio }); onCreated(c.code); }
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
        <label className="field">Convenio
          <select className="select" value={convenio} onChange={(e) => setConvenio(e.target.value)}>
            <option value="">— Sin convenio —</option>
            {convenios.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
        </label>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Creando…' : 'Crear'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ConvenioModal({ convenio, canDelete, onClose, onChanged }: { convenio: EvalosConvenio | null; canDelete: boolean; onClose: () => void; onChanged: () => void }) {
  const isNew = !convenio;
  const [code, setCode] = useState(convenio?.code || '');
  const [name, setName] = useState(convenio?.name || '');
  const [vacationDays, setVac] = useState(convenio?.vacationDays ?? 22);
  const [hoursYear, setHours] = useState(convenio?.hoursYear ?? 1750);
  const [seniority, setSeniority] = useState(convenio?.seniority || []);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const setTier = (i: number, k: 'years' | 'extraDays', v: number) => setSeniority((s) => s.map((t, j) => (j === i ? { ...t, [k]: v } : t)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload = { code, name, vacationDays, hoursYear, seniority };
    try {
      if (isNew) await api.post('/api/evalos/convenios', payload);
      else await api.put(`/api/evalos/convenios/${encodeURIComponent(convenio!.code)}`, payload);
      onChanged();
    } catch (err: any) { toast(err.message, true); setBusy(false); }
  }
  async function remove() {
    if (!convenio || !confirmAction(`¿Eliminar el convenio ${convenio.code}?`)) return;
    try { await api.del(`/api/evalos/convenios/${encodeURIComponent(convenio.code)}`); onChanged(); }
    catch (err: any) { toast(err.message, true); }
  }

  return (
    <Modal title={isNew ? 'Nuevo convenio' : `Convenio ${convenio!.code}`} onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <div className="grid-2">
          <label className="field">Código<input className="input mono" value={code} onChange={(e) => setCode(e.target.value)} disabled={!isNew} placeholder="OFI" required /></label>
          <label className="field">Nombre<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Convenio Oficinas" required /></label>
        </div>
        <div className="grid-2">
          <label className="field">Días de vacaciones al año<input className="input" type="number" min={0} max={60} value={vacationDays} onChange={(e) => setVac(Number(e.target.value))} /></label>
          <label className="field">Jornada anual (horas)<input className="input" type="number" min={0} max={3000} value={hoursYear} onChange={(e) => setHours(Number(e.target.value))} /></label>
        </div>
        <div className="col" style={{ gap: 6 }}>
          <b className="small">Días extra por antigüedad</b>
          {seniority.map((t, i) => (
            <div key={i} className="row" style={{ gap: 8 }}>
              <input className="input" style={{ width: 90 }} type="number" min={0} value={t.years} onChange={(e) => setTier(i, 'years', Number(e.target.value))} /> <span className="small muted">años →</span>
              <input className="input" style={{ width: 80 }} type="number" min={0} value={t.extraDays} onChange={(e) => setTier(i, 'extraDays', Number(e.target.value))} /> <span className="small muted">días extra</span>
              <button type="button" className="icon-btn" aria-label="Quitar" onClick={() => setSeniority((s) => s.filter((_, j) => j !== i))}><Icon.trash /></button>
            </div>
          ))}
          <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setSeniority((s) => [...s, { years: 10, extraDays: 1 }])}><Icon.plus /> Añadir tramo</button>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          {!isNew && canDelete ? <button type="button" className="btn danger sm" onClick={remove}><Icon.trash /> Eliminar</button> : <span />}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
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
      <div className="row" style={{ gap: 10 }}>
        <div className="card grow" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Calendarios</span><span className="stat">{data.calendars.length}</span></div>
        <div className="card grow" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Convenios</span><span className="stat">{data.convenios.length}</span></div>
      </div>
      <div className="col" style={{ gap: 4 }}>
        {data.calendars.slice(0, 4).map((c) => (
          <div key={c.code} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
            <span>{c.name}</span><span className="muted xs">{c.holidays} festivos · {c.convenio || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
