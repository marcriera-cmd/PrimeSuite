// Atajos de Evalos · Personal (alta, modificación y eliminación de empleados en la tabla PERSONAL de Evalos 8).
// El mismo componente se usa como pantalla completa y como widget del Inicio.
import { useMemo, useState, type FormEvent, type JSX, type ReactNode } from 'react';
import {
  api, ApiError,
  type EvalosCardAssignment, type EvalosLookupItem, type EvalosPersonalDetail, type EvalosPersonal, type EvalosPersonalInput, type EvalosPersonalLookupKey, type EvalosPersonalResponse
} from '../../api';
import { Drawer, ErrorBox, Icon, Loading, Modal, Spinner, confirmAction, useData, useToast } from '../../components/ui';
import { NotConfigured } from './common';

type Filter = 'active' | 'inactive' | 'all';

const EMPTY: EvalosPersonalInput = {
  code: '', name: '', card: '', email: '', hireDate: '', endDate: '',
  company: '', department: '', section: '', area: '', consultas: '', solicitudes: ''
};

/** Pantalla completa. */
export default function Personal() {
  const { data, error, reload } = usePersonalState();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => filterList(data?.items || [], q, filter), [data, q, filter]);
  if (error) return error;
  if (!data) return <Loading />;

  const active = data.items.filter((e) => e.active).length;
  const deps = new Map((data.lookups.department || []).map((d) => [d.code, d.description]));

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="ev-kpis">
        <Kpi label="Empleados" value={data.items.length} />
        <Kpi label="Activos" value={active} />
        <Kpi label="De baja" value={data.items.length - active} />
      </div>

      <div className="card flat">
        <div className="ev-toolbar">
          <label className="search grow" style={{ minWidth: 220, maxWidth: 380 }}>
            <Icon.search />
            <input placeholder="Buscar por código, nombre o tarjeta…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar empleado" />
          </label>
          <div className="viewseg" role="group" aria-label="Filtrar">
            {([['active', 'Activos'], ['inactive', 'De baja'], ['all', 'Todos']] as [Filter, string][]).map(([k, l]) => (
              <button key={k} className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <span className="grow" />
          <button className="btn sm" onClick={reload} title="Volver a leer de Evalos"><Icon.refresh /> Actualizar</button>
          {data.canEdit && <button className="btn primary sm" onClick={() => setCreating(true)}><Icon.plus /> Nuevo empleado</button>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Código</th><th>Nombre</th><th style={{ width: 120 }}>Tarjeta</th>
                <th>Departamento</th><th style={{ width: 110 }}>Alta</th><th style={{ width: 120 }}>Baja</th><th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.code} className="clickable" onClick={() => setOpen(e.code)}>
                  <td className="mono"><b>{e.code}</b></td>
                  <td>{e.name || <span className="muted">—</span>}</td>
                  <td className="mono small">{e.card || <span className="muted">—</span>}</td>
                  <td className="small">{e.department ? (deps.get(e.department) || e.department) : <span className="muted">—</span>}</td>
                  <td className="small">{fmtDate(e.hireDate) || <span className="muted">—</span>}</td>
                  <td className="small">
                    {e.endDate ? <span className={`tag ${e.active ? 'warn' : 'outline'}`} title={e.active ? 'Baja prevista' : undefined}>{fmtDate(e.endDate)}</span> : <span className="muted">—</span>}
                  </td>
                  <td className="muted"><span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }}><Icon.chevron /></span></td>
                </tr>
              ))}
              {!list.length && (
                <tr><td colSpan={7} className="muted small" style={{ padding: 28, textAlign: 'center' }}>
                  {data.items.length ? 'Ningún empleado coincide con la búsqueda.' : 'Todavía no hay empleados en Evalos. Da de alta el primero con «Nuevo empleado».'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ev-foot xs muted">{list.length} de {data.items.length} empleados · datos leídos directamente de la base de datos de Evalos{data.engine === 'demo' ? ' (demostración)' : ''}</div>
      </div>

      {open && <EmployeeDrawer code={open} data={data} onClose={() => setOpen(null)} onChanged={reload} />}
      {creating && <NewEmployeeModal data={data} onClose={() => setCreating(false)} onCreated={(code) => { setCreating(false); reload(); setOpen(code); }} />}
    </div>
  );
}

/** Versión widget: recuento, buscador, lista compacta y alta rápida. */
export function PersonalWidget() {
  const { data, error, reload } = usePersonalState(true);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => filterList(data?.items || [], q, 'active'), [data, q]);
  if (error) return error;
  if (!data) return <div style={{ padding: 12 }}><Spinner /></div>;
  const active = data.items.filter((e) => e.active).length;

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ alignItems: 'baseline', gap: 14 }}>
        <span><span className="stat">{active}</span> <span className="small muted">empleados activos</span></span>
        {data.items.length > active && <span className="small muted"><b style={{ color: 'var(--ink)' }}>{data.items.length - active}</b> de baja</span>}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <label className="search grow" style={{ minWidth: 0, padding: '6px 10px' }}>
          <Icon.search />
          <input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar empleado" />
        </label>
        {data.canEdit && <button className="icon-btn" title="Nuevo empleado" aria-label="Nuevo empleado" onClick={() => setCreating(true)} style={{ border: '1px solid var(--line)' }}><Icon.plus /></button>}
      </div>
      <div className="ev-wlist">
        {list.slice(0, 50).map((e) => (
          <button key={e.code} className="ev-wrow" onClick={() => setOpen(e.code)}>
            <span className="col grow" style={{ gap: 1, textAlign: 'left', minWidth: 0 }}>
              <span className="small" style={{ fontWeight: 600 }}>{e.name || e.code}</span>
              <span className="xs muted mono">{e.code}{e.card ? ` · tarjeta ${e.card}` : ''}</span>
            </span>
          </button>
        ))}
        {!list.length && <span className="small muted" style={{ padding: 10 }}>{data.items.length ? 'Sin resultados' : 'Aún no hay empleados'}</span>}
      </div>
      {open && <EmployeeDrawer code={open} data={data} onClose={() => setOpen(null)} onChanged={reload} />}
      {creating && <NewEmployeeModal data={data} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
    </div>
  );
}

// ---------- Piezas compartidas ----------

function filterList(items: EvalosPersonal[], q: string, f: Filter) {
  const t = q.trim().toLowerCase();
  return items.filter((e) =>
    (!t || e.code.toLowerCase().includes(t) || e.name.toLowerCase().includes(t) || e.card.toLowerCase().includes(t)) &&
    (f === 'all' || (f === 'active' ? e.active : !e.active))
  );
}

const fmtDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '');

/** Carga los empleados y traduce "sin configurar" y otros errores a un bloque visible. */
function usePersonalState(compact = false) {
  const { data, error, reload } = useData(() =>
    api.get<EvalosPersonalResponse>('/api/evalos/personal').catch((e) => {
      if (e instanceof ApiError && e.code === 'not_configured') return NOT_CONFIGURED;
      throw e;
    })
  );
  let node: JSX.Element | null = null;
  if (data === NOT_CONFIGURED) node = <NotConfigured compact={compact} />;
  else if (error) node = <div className="col" style={{ gap: 8 }}><ErrorBox error={error} /><button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={reload}><Icon.refresh /> Reintentar</button></div>;
  return { data: data === NOT_CONFIGURED ? null : data, error: node, reload };
}
const NOT_CONFIGURED = { notConfigured: true } as unknown as EvalosPersonalResponse;

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="card" style={{ gap: 4, padding: '16px 18px' }}>
      <span className="xs muted" style={{ fontWeight: 600 }}>{label}</span>
      <span className="stat">{value}</span>
    </div>
  );
}

/** Errores de validación en el navegador (el servidor vuelve a comprobarlo todo). */
function validate(f: EvalosPersonalInput, isNew: boolean): string | null {
  if (isNew && !f.code.trim()) return 'Indica el código del empleado.';
  if (!f.name.trim()) return 'Indica el nombre.';
  if (isNew && !f.card.trim()) return 'Indica la tarjeta.';
  if (!f.hireDate) return 'Indica la fecha de alta.';
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return 'El email no tiene un formato válido.';
  if (f.endDate && f.endDate < f.hireDate) return 'La fecha de baja no puede ser anterior a la de alta.';
  return null;
}

/** Formulario de la ficha, común al alta y a la modificación. */
function EmployeeForm({ data, value, onChange, isNew, readOnly }: {
  data: EvalosPersonalResponse; value: EvalosPersonalInput; onChange: (v: EvalosPersonalInput) => void; isNew: boolean; readOnly: boolean;
}) {
  const up = (s: string) => (data.uppercase ? s.toLocaleUpperCase('es-ES') : s);
  const set = (patch: Partial<EvalosPersonalInput>) => onChange({ ...value, ...patch });
  const max = (k: keyof EvalosPersonalInput) => data.limits[k] || undefined;
  const exists = isNew && !!value.code.trim() && data.items.some((e) => e.code.toUpperCase() === value.code.trim().toUpperCase());
  const cardOwner = value.card.trim() ? data.items.find((e) => e.card === value.card.trim() && e.code !== value.code.trim()) : undefined;

  return (
    <div className="col" style={{ gap: 18 }}>
      <Section title="Empleado">
        <div className="grid-2" style={{ gap: 12 }}>
          <label className="field">Código
            <span className="hint">{isNew ? 'Identificador único en Evalos. No se puede cambiar después.' : 'El código no se puede modificar.'}</span>
            <input className="input mono" value={value.code} onChange={(e) => set({ code: up(e.target.value) })} maxLength={max('code')}
              disabled={!isNew} readOnly={!isNew} required={isNew} autoFocus={isNew} aria-describedby={exists ? 'emp-code-dup' : undefined} />
            {exists && <span id="emp-code-dup" className="xs" style={{ color: 'var(--bad)', fontWeight: 500 }}>Ya existe un empleado con este código.</span>}
          </label>
          {isNew ? (
            <label className="field">Tarjeta
              <span className="hint">Se crea en Evalos si no existe y se asigna desde la fecha de alta.</span>
              <input className="input mono" value={value.card} onChange={(e) => set({ card: e.target.value.replace(/\s/g, '') })} maxLength={max('card')} required disabled={readOnly} />
              {cardOwner && <span className="xs" style={{ color: 'var(--bad)', fontWeight: 500 }}>La tiene asignada el empleado {cardOwner.code}.</span>}
            </label>
          ) : (
            <label className="field">Tarjeta vigente
              <span className="hint">Se cambia en Tarjetas, más abajo.</span>
              <input className="input mono" value={value.card || 'Sin tarjeta'} disabled readOnly />
            </label>
          )}
        </div>
        <label className="field">Nombre
          <input className="input" value={value.name} onChange={(e) => set({ name: up(e.target.value) })} maxLength={max('name')} required disabled={readOnly} />
        </label>
        <label className="field">Email
          <input className="input" type="email" value={value.email} onChange={(e) => set({ email: e.target.value })} maxLength={max('email')} disabled={readOnly} />
        </label>
      </Section>

      <Section title="Fechas">
        <div className="grid-2" style={{ gap: 12 }}>
          <label className="field">Alta
            <input className="input" type="date" value={value.hireDate} onChange={(e) => set({ hireDate: e.target.value })} required disabled={readOnly} />
          </label>
          <label className="field">Baja
            <span className="hint">Vacía mientras el empleado siga activo.</span>
            <input className="input" type="date" value={value.endDate} min={value.hireDate || undefined} onChange={(e) => set({ endDate: e.target.value })} disabled={readOnly} />
          </label>
        </div>
      </Section>

      <Section title="Organización">
        <div className="grid-2" style={{ gap: 12 }}>
          <LookupField label="Empresa" k="company" data={data} value={value.company} onChange={(v) => set({ company: v })} disabled={readOnly} />
          <LookupField label="Departamento" k="department" data={data} value={value.department} onChange={(v) => set({ department: v })} disabled={readOnly} />
          <LookupField label="Sección" k="section" data={data} value={value.section} onChange={(v) => set({ section: v })} disabled={readOnly} />
          <LookupField label="Área" k="area" data={data} value={value.area} onChange={(v) => set({ area: v })} disabled={readOnly} />
        </div>
      </Section>

      <Section title="Portal del empleado">
        <div className="grid-2" style={{ gap: 12 }}>
          <LookupField label="Consultas" k="consultas" data={data} value={value.consultas} onChange={(v) => set({ consultas: v })} disabled={readOnly} />
          <LookupField label="Solicitudes" k="solicitudes" data={data} value={value.solicitudes} onChange={(v) => set({ solicitudes: v })} disabled={readOnly} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="col" style={{ gap: 12, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="small" style={{ fontWeight: 700, padding: 0, marginBottom: 10 }}>{title}</legend>
      {children}
    </fieldset>
  );
}

/** Desplegable con los valores de su tabla de Evalos; si la tabla no existe, campo de texto. */
function LookupField({ label, k, data, value, onChange, disabled }: {
  label: string; k: EvalosPersonalLookupKey; data: EvalosPersonalResponse; value: string; onChange: (v: string) => void; disabled: boolean;
}) {
  const items: EvalosLookupItem[] | null = data.lookups[k];
  if (!items) {
    return (
      <label className="field">{label}
        <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} maxLength={data.limits[k] || undefined} disabled={disabled} />
      </label>
    );
  }
  const missing = value && !items.some((x) => x.code === value);
  return (
    <label className="field">{label}
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">Sin asignar</option>
        {missing && <option value={value}>{value} (no existe en Evalos)</option>}
        {items.map((x) => <option key={x.code} value={x.code}>{x.description ? `${x.code} – ${x.description}` : x.code}</option>)}
      </select>
      {!items.length && <span className="hint">No hay valores en Evalos todavía.</span>}
    </label>
  );
}

function EmployeeDrawer({ code, data, onClose, onChanged }: { code: string; data: EvalosPersonalResponse; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data: emp, error, reload } = useData(() => api.get<EvalosPersonalDetail>(`/api/evalos/personal/${encodeURIComponent(code)}`), [code]);
  const [draft, setDraft] = useState<EvalosPersonalInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const value = draft ?? (emp ? toInput(emp) : EMPTY);
  const dirty = !!emp && !!draft && JSON.stringify(draft) !== JSON.stringify(toInput(emp));

  async function save(e: FormEvent) {
    e.preventDefault();
    const v = validate(value, false);
    if (v) { setErr(v); return; }
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/api/evalos/personal/${encodeURIComponent(code)}`, value);
      toast('Cambios guardados en Evalos');
      setDraft(null);
      reload();
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirmAction(`¿Eliminar el empleado ${code} de Evalos? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api.del(`/api/evalos/personal/${encodeURIComponent(code)}`);
      toast(`Empleado ${code} eliminado`);
      onChanged();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Drawer
      onClose={onClose}
      title={
        <div className="col" style={{ gap: 2 }}>
          <span className="xs muted">Empleado</span>
          <h2 style={{ fontSize: 20 }}>{emp?.name || code}</h2>
          <span className="row xs muted" style={{ gap: 8 }}>
            <span className="mono">{code}</span>
            {emp && (emp.active ? <span className="tag ok">Activo</span> : <span className="tag outline">De baja</span>)}
          </span>
        </div>
      }
    >
      <ErrorBox error={error || err} />
      {!emp && !error && <Loading />}
      {emp && (
        <>
          <form className="col" style={{ gap: 18 }} onSubmit={save} noValidate>
            <EmployeeForm data={data} value={value} onChange={setDraft} isNew={false} readOnly={!data.canEdit} />
            {data.canEdit && (
              <div className="row">
                <button className="btn primary" disabled={!dirty || busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
                {dirty && <button type="button" className="btn ghost" onClick={() => { setDraft(null); setErr(null); }}>Descartar</button>}
              </div>
            )}
          </form>

          <CardsSection code={code} cards={emp.cards} data={data} onChanged={() => { setDraft(null); reload(); onChanged(); }} />

          {data.canDelete && (
            <div className="col" style={{ gap: 6, marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--line-2)' }}>
              <button className="btn danger" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={remove}><Icon.trash /> Eliminar empleado</button>
              <span className="xs muted">Solo se puede eliminar si aún no tiene marcajes, calendarios ni accesos en Evalos. Si ya los tiene, ponle fecha de baja.</span>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

function NewEmployeeModal({ data, onClose, onCreated }: { data: EvalosPersonalResponse; onClose: () => void; onCreated: (code: string) => void }) {
  const toast = useToast();
  const [value, setValue] = useState<EvalosPersonalInput>({ ...EMPTY, hireDate: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const exists = !!value.code.trim() && data.items.some((e) => e.code.toUpperCase() === value.code.trim().toUpperCase());

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validate(value, true);
    if (v) { setErr(v); return; }
    setBusy(true);
    setErr(null);
    try {
      const created = await api.post<EvalosPersonal>('/api/evalos/personal', value);
      toast(`Empleado ${created.code} dado de alta en Evalos`);
      onCreated(created.code);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Nuevo empleado" onClose={onClose} wide>
      <form className="col" style={{ gap: 18 }} onSubmit={submit} noValidate>
        <ErrorBox error={err} />
        <EmployeeForm data={data} value={value} onChange={setValue} isNew readOnly={false} />
        <span className="xs muted">Se dará de alta con código de accesos 999, autorización 001 y turno DEF.</span>
        <div className="row">
          <button className="btn primary" disabled={busy || exists}>{busy ? 'Dando de alta…' : 'Dar de alta en Evalos'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </Modal>
  );
}

function toInput(e: EvalosPersonal | EvalosPersonalDetail): EvalosPersonalInput {
  const { active: _active, cards: _cards, ...rest } = e as EvalosPersonalDetail;
  return rest;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Tarjetas del empleado (HIS_TARJETA): historial, asignar una nueva y desasignar las vigentes. */
function CardsSection({ code, cards, data, onChanged }: { code: string; cards: EvalosCardAssignment[]; data: EvalosPersonalResponse; onChanged: () => void }) {
  const toast = useToast();
  const [card, setCard] = useState('');
  const [from, setFrom] = useState(todayIso());
  const [closing, setClosing] = useState<string | null>(null); // clave card|from del tramo que se está cerrando
  const [to, setTo] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const url = `/api/evalos/personal/${encodeURIComponent(code)}/tarjetas`;
  const active = cards.filter((c) => c.active);
  const past = cards.filter((c) => !c.active);
  const [showPast, setShowPast] = useState(false);

  async function assign(e: FormEvent) {
    e.preventDefault();
    if (!card.trim()) { setErr('Indica el código de la tarjeta.'); return; }
    if (!from) { setErr('Indica desde qué fecha se asigna.'); return; }
    setBusy(true);
    setErr(null);
    try {
      await api.post(url, { card: card.trim(), from });
      toast(`Tarjeta ${card.trim()} asignada`);
      setCard('');
      setFrom(todayIso());
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function unassign(c: EvalosCardAssignment) {
    if (!to) { setErr('Indica la fecha de baja.'); return; }
    if (to < c.from) { setErr('La fecha de baja no puede ser anterior a la de alta de la asignación.'); return; }
    setBusy(true);
    setErr(null);
    try {
      await api.post(`${url}/desasignar`, { card: c.card, from: c.from, to });
      toast(`Tarjeta ${c.card} desasignada`);
      setClosing(null);
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const row = (c: EvalosCardAssignment) => {
    const key = `${c.card}|${c.from}`;
    return (
      <div key={key} className="ev-emp" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
          <span className="mono small" style={{ fontWeight: 700 }}>{c.card}</span>
          <span className="xs muted">
            Desde {fmtDate(c.from)}{c.to ? ` hasta ${fmtDate(c.to)}` : ', sin fecha de baja'}
            {(c.recordedAt || c.user) && <> · registrado {c.recordedAt ? fmtStamp(c.recordedAt) : ''}{c.user ? ` por ${c.user}` : ''}</>}
          </span>
        </span>
        {c.active ? <span className="tag ok">Vigente</span> : <span className="tag outline">Cerrada</span>}
        {c.active && data.canEdit && closing !== key && (
          <button type="button" className="btn sm" disabled={busy} onClick={() => { setClosing(key); setTo(todayIso() < c.from ? c.from : todayIso()); setErr(null); }}>Desasignar</button>
        )}
        {closing === key && (
          <div className="row" style={{ gap: 8, flexBasis: '100%', paddingTop: 8, flexWrap: 'wrap' }}>
            <label className="field" style={{ fontWeight: 500 }}>Fecha de baja
              <input className="input" type="date" value={to} min={c.from} onChange={(e) => setTo(e.target.value)} autoFocus />
            </label>
            <span className="row" style={{ gap: 6, alignSelf: 'flex-end' }}>
              <button type="button" className="btn primary sm" disabled={busy} onClick={() => unassign(c)}>{busy ? 'Desasignando…' : 'Desasignar tarjeta'}</button>
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setClosing(null)}>Cancelar</button>
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row">
        <h3 className="grow">Tarjetas</h3>
        {past.length > 0 && (
          <label className="check xs"><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Ver también las cerradas ({past.length})</label>
        )}
      </div>
      <ErrorBox error={err} />
      <div className="ev-emps">
        {active.map(row)}
        {showPast && past.map(row)}
        {!active.length && !(showPast && past.length) && <span className="small muted" style={{ padding: 12 }}>No tiene ninguna tarjeta vigente.</span>}
      </div>
      {data.canEdit && (
        <form className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={assign} noValidate>
          <label className="field grow" style={{ minWidth: 140 }}>Asignar tarjeta
            <input className="input mono" value={card} onChange={(e) => setCard(e.target.value.replace(/\s/g, ''))} maxLength={data.limits.card || undefined} placeholder="Código de tarjeta" />
          </label>
          <label className="field">Desde
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <button className="btn sm" disabled={busy || !card.trim()}><Icon.plus /> Asignar</button>
        </form>
      )}
      <span className="xs muted">Si la tarjeta no existe en Evalos, se crea al asignarla. No se puede asignar una tarjeta que otro empleado tiene vigente.</span>
    </div>
  );
}

const fmtStamp = (s: string) => {
  const [d, t] = s.split(' ');
  return [fmtDate(d), t].filter(Boolean).join(' ');
};
