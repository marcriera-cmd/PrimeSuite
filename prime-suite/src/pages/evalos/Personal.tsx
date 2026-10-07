// Atajos de Evalos · Personal (alta, modificación y eliminación de empleados en la tabla PERSONAL de Evalos 8).
// El mismo componente se usa como pantalla completa y como widget del Inicio.
import { useMemo, useState, type FormEvent, type JSX, type ReactNode } from 'react';
import {
  api, ApiError,
  type EvalosHistoryEntry, type EvalosHistoryKind, type EvalosLookupItem, type EvalosOrgKind, type EvalosPersonalDetail, type EvalosPersonal, type EvalosPersonalInput, type EvalosPersonalLookupKey, type EvalosPersonalResponse
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
function EmployeeForm({ data, value, onChange, isNew, readOnly, orgTexts, onOrgText }: {
  data: EvalosPersonalResponse; value: EvalosPersonalInput; onChange: (v: EvalosPersonalInput) => void; isNew: boolean; readOnly: boolean;
  /** Solo en el alta: texto escrito en empresa, departamento, sección y área. */
  orgTexts?: Record<EvalosOrgKind, string>; onOrgText?: (k: EvalosOrgKind, text: string) => void;
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
        {isNew && orgTexts && onOrgText ? (
          <>
            <div className="grid-2" style={{ gap: 12 }}>
              {ORG.map(([k, label]) => <OrgCombo key={k} label={label} k={k} data={data} text={orgTexts[k]} onText={(t) => onOrgText(k, t)} disabled={readOnly} />)}
            </div>
            <span className="xs muted">Escribe para buscar entre los existentes. Si escribes un nombre nuevo, se creará con el siguiente código libre. Cada uno queda asignado desde la fecha de alta.</span>
          </>
        ) : (
          <>
            <div className="grid-2" style={{ gap: 12 }}>
              {ORG.map(([k, label]) => (
                <label key={k} className="field">{label}
                  <input className="input" value={describe(data, k, value[k]) || 'Sin asignar'} disabled readOnly />
                </label>
              ))}
            </div>
            <span className="xs muted">Se cambian en su historial, más abajo.</span>
          </>
        )}
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

const ORG: [EvalosOrgKind, string][] = [['company', 'Empresa'], ['department', 'Departamento'], ['section', 'Sección'], ['area', 'Área']];

/** "CÓDIGO – NOMBRE" de un valor de un catálogo (o solo el código si no se encuentra). */
function describe(data: EvalosPersonalResponse, k: EvalosPersonalLookupKey, code: string) {
  if (!code) return '';
  const hit = data.lookups[k]?.find((x) => x.code === code);
  return hit?.description ? `${code} – ${hit.description}` : code;
}

/** Texto escrito → valor existente (por código o nombre, sin distinguir mayúsculas) o nombre nuevo. */
function resolveOrg(data: EvalosPersonalResponse, k: EvalosOrgKind, text: string): { code: string } | { name: string } | null {
  const t = text.trim();
  if (!t) return null;
  const items = data.lookups[k];
  if (!items) return { code: t };
  const u = t.toLocaleUpperCase('es-ES');
  const hit = items.find((x) => x.code.toUpperCase() === u) || items.find((x) => x.description.toLocaleUpperCase('es-ES') === u)
    || items.find((x) => `${x.code} – ${x.description}`.toLocaleUpperCase('es-ES') === u);
  return hit ? { code: hit.code } : { name: data.uppercase ? u : t };
}

/** Campo con autocompletado sobre los valores existentes; admite escribir uno nuevo. */
function OrgCombo({ label, k, data, text, onText, disabled, autoFocus }: {
  label: string; k: EvalosOrgKind; data: EvalosPersonalResponse; text: string; onText: (t: string) => void; disabled?: boolean; autoFocus?: boolean;
}) {
  const items = data.lookups[k];
  const listId = `ev-org-${k}`;
  const r = resolveOrg(data, k, text);
  return (
    <label className="field">{label}
      <input className="input" list={items ? listId : undefined} value={text} onChange={(e) => onText(e.target.value)} disabled={disabled} autoFocus={autoFocus}
        placeholder={items?.length ? 'Escribe o elige…' : 'Escribe el nombre…'} autoComplete="off" maxLength={100} />
      {items && (
        <datalist id={listId}>
          {items.map((x) => <option key={x.code} value={x.description || x.code}>{x.code}</option>)}
        </datalist>
      )}
      {r && 'name' in r && <span className="xs" style={{ color: 'var(--info-ink)', fontWeight: 500 }}>Nuevo: se creará «{r.name}».</span>}
      {r && 'code' in r && items && <span className="xs muted">{describe(data, k, r.code)}</span>}
    </label>
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

          {(() => {
            const changed = () => { setDraft(null); reload(); onChanged(); };
            return (
              <>
                <HistorySection kind="card" title="Tarjetas" code={code} entries={emp.history.card} data={data} onChanged={changed} />
                <div className="col" style={{ gap: 14 }}>
                  <h3>Organización</h3>
                  {ORG.map(([k, label]) => <HistorySection key={k} kind={k} title={label} code={code} entries={emp.history[k]} data={data} onChanged={changed} sub />)}
                </div>
              </>
            );
          })()}

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
  const [value, setValue] = useState<EvalosPersonalInput>({ ...EMPTY, hireDate: todayIso() });
  const [orgTexts, setOrgTexts] = useState<Record<EvalosOrgKind, string>>({ company: '', department: '', section: '', area: '' });
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
      // Empresa, departamento, sección y área: código si coincide con uno existente; si no, nombre nuevo.
      const payload: EvalosPersonalInput & { newNames: Partial<Record<EvalosOrgKind, string>> } = { ...value, newNames: {} };
      for (const [k] of ORG) {
        const r = resolveOrg(data, k, orgTexts[k]);
        payload[k] = r && 'code' in r ? r.code : '';
        if (r && 'name' in r) payload.newNames[k] = r.name;
      }
      const created = await api.post<EvalosPersonal>('/api/evalos/personal', payload);
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
        <EmployeeForm data={data} value={value} onChange={setValue} isNew readOnly={false}
          orgTexts={orgTexts} onOrgText={(k, t) => setOrgTexts((o) => ({ ...o, [k]: t }))} />
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
  const { active: _active, history: _history, ...rest } = e as EvalosPersonalDetail;
  return rest;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Día anterior a una fecha AAAA-MM-DD. */
function prevDay(iso: string) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Historial de un campo de la ficha (HIS_*): tramos vigentes y cerrados, abrir uno nuevo y cerrar los vigentes.
 * Tarjetas: varias a la vez por empleado. Empresa/departamento/sección/área: una vigente; al cambiar, la anterior
 * se cierra el día antes.
 */
function HistorySection({ kind, title, code, entries, data, onChanged, sub }: {
  kind: EvalosHistoryKind; title: string; code: string; entries: EvalosHistoryEntry[]; data: EvalosPersonalResponse; onChanged: () => void; sub?: boolean;
}) {
  const toast = useToast();
  const isCard = kind === 'card';
  const [text, setText] = useState('');
  const [from, setFrom] = useState(todayIso());
  const [adding, setAdding] = useState(isCard);
  const [closing, setClosing] = useState<string | null>(null); // clave valor|desde del tramo que se está cerrando
  const [to, setTo] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const url = `/api/evalos/personal/${encodeURIComponent(code)}/historial/${kind}`;
  const active = entries.filter((c) => c.active);
  const past = entries.filter((c) => !c.active);
  const show = (v: string) => (isCard ? v : describe(data, kind as EvalosOrgKind, v));
  const verbs = isCard
    ? { add: 'Asignar tarjeta', addShort: 'Asignar', close: 'Desasignar', closing: 'Desasignando…', added: 'asignada', closed: 'desasignada' }
    : { add: active.length ? `Cambiar ${title.toLowerCase()}` : `Asignar ${title.toLowerCase()}`, addShort: active.length ? 'Cambiar' : 'Asignar', close: 'Quitar', closing: 'Quitando…', added: 'asignado', closed: 'quitado' };
  const closesOn = !isCard && active.length && from ? prevDay(from) : '';

  async function add(e: FormEvent) {
    e.preventDefault();
    const body = isCard ? (text.trim() ? { code: text.trim() } : null) : resolveOrg(data, kind as EvalosOrgKind, text);
    if (!body) { setErr(isCard ? 'Indica el código de la tarjeta.' : `Indica ${title.toLowerCase()}.`); return; }
    if (!from) { setErr('Indica desde qué fecha.'); return; }
    setBusy(true);
    setErr(null);
    try {
      await api.post(url, { ...body, from });
      toast(`${title === 'Tarjetas' ? 'Tarjeta' : title} ${'code' in body ? body.code : body.name} ${verbs.added}`);
      setText('');
      setFrom(todayIso());
      if (!isCard) setAdding(false);
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function close(c: EvalosHistoryEntry) {
    if (!to) { setErr('Indica la fecha de baja.'); return; }
    if (to < c.from) { setErr('La fecha de baja no puede ser anterior a la de alta del tramo.'); return; }
    setBusy(true);
    setErr(null);
    try {
      await api.post(`${url}/cerrar`, { value: c.value, from: c.from, to });
      toast(`${title === 'Tarjetas' ? 'Tarjeta' : title} ${c.value} ${verbs.closed}`);
      setClosing(null);
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const row = (c: EvalosHistoryEntry) => {
    const key = `${c.value}|${c.from}`;
    return (
      <div key={key} className="ev-emp" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
          <span className={`small${isCard ? ' mono' : ''}`} style={{ fontWeight: 700 }}>{show(c.value)}</span>
          <span className="xs muted">
            Desde {fmtDate(c.from)}{c.to ? ` hasta ${fmtDate(c.to)}` : ', sin fecha de baja'}
            {(c.recordedAt || c.user) && <> · registrado {c.recordedAt ? fmtStamp(c.recordedAt) : ''}{c.user ? ` por ${c.user}` : ''}</>}
          </span>
        </span>
        {c.active ? <span className="tag ok">Vigente</span> : <span className="tag outline">Cerrado</span>}
        {c.active && data.canEdit && closing !== key && (
          <button type="button" className="btn sm" disabled={busy} onClick={() => { setClosing(key); setTo(todayIso() < c.from ? c.from : todayIso()); setErr(null); }}>{verbs.close}</button>
        )}
        {closing === key && (
          <div className="row" style={{ gap: 8, flexBasis: '100%', paddingTop: 8, flexWrap: 'wrap' }}>
            <label className="field" style={{ fontWeight: 500 }}>Fecha de baja
              <input className="input" type="date" value={to} min={c.from} onChange={(e) => setTo(e.target.value)} autoFocus />
            </label>
            <span className="row" style={{ gap: 6, alignSelf: 'flex-end' }}>
              <button type="button" className="btn primary sm" disabled={busy} onClick={() => close(c)}>{busy ? verbs.closing : verbs.close}</button>
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setClosing(null)}>Cancelar</button>
            </span>
          </div>
        )}
      </div>
    );
  };

  const Heading = sub ? 'h4' : 'h3';
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <Heading className={`grow${sub ? ' small' : ''}`} style={sub ? { fontWeight: 700, margin: 0 } : undefined}>{title}</Heading>
        {past.length > 0 && (
          <label className="check xs"><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Ver también los cerrados ({past.length})</label>
        )}
        {!isCard && data.canEdit && !adding && (
          <button type="button" className="btn sm" onClick={() => { setAdding(true); setErr(null); }}>{verbs.addShort}</button>
        )}
      </div>
      <ErrorBox error={err} />
      <div className="ev-emps">
        {active.map(row)}
        {showPast && past.map(row)}
        {!active.length && !(showPast && past.length) && (
          <span className="small muted" style={{ padding: 12 }}>{isCard ? 'No tiene ninguna tarjeta vigente.' : `Sin ${title.toLowerCase()} vigente.`}</span>
        )}
      </div>
      {data.canEdit && adding && (
        <form className="col" style={{ gap: 6 }} onSubmit={add} noValidate>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {isCard ? (
              <label className="field grow" style={{ minWidth: 140 }}>{verbs.add}
                <input className="input mono" value={text} onChange={(e) => setText(e.target.value.replace(/\s/g, ''))} maxLength={data.limits.card || undefined} placeholder="Código de tarjeta" />
              </label>
            ) : (
              <div className="grow" style={{ minWidth: 180 }}>
                <OrgCombo label={verbs.add} k={kind as EvalosOrgKind} data={data} text={text} onText={setText} autoFocus />
              </div>
            )}
            <label className="field">Desde
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <span className="row" style={{ gap: 6 }}>
              <button className="btn sm" disabled={busy || !text.trim()}><Icon.plus /> {verbs.addShort}</button>
              {!isCard && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setAdding(false); setText(''); setErr(null); }}>Cancelar</button>}
            </span>
          </div>
          {closesOn && <span className="xs muted">{show(active[0].value)} se cerrará el {fmtDate(closesOn)}, el día antes del nuevo alta.</span>}
        </form>
      )}
      {isCard && <span className="xs muted">Si la tarjeta no existe en Evalos, se crea al asignarla. No se puede asignar una tarjeta que otro empleado tiene vigente.</span>}
    </div>
  );
}

const fmtStamp = (s: string) => {
  const [d, t] = s.split(' ');
  return [fmtDate(d), t].filter(Boolean).join(' ');
};
