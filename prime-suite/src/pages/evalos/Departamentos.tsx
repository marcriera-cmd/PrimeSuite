// Atajos de Evalos · Departamentos (Configuración › Organización › Departamentos de Evalos 8).
// El mismo componente se usa como pantalla completa y como widget del Inicio.
import { useMemo, useState, type FormEvent, type JSX } from 'react';
import { api, ApiError, type EvalosDepartment, type EvalosDepartmentEmployee, type EvalosDepartmentsResponse } from '../../api';
import { Drawer, ErrorBox, Icon, Loading, Modal, Spinner, confirmAction, useData, useToast } from '../../components/ui';
import { NotConfigured } from './common';

type Filter = 'all' | 'with' | 'empty';

/** Pantalla completa. */
export default function Departamentos() {
  const { data, error, reload } = useDepartmentsState();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => filterList(data?.items || [], q, filter), [data, q, filter]);
  if (error) return error;
  if (!data) return <Loading />;

  const totalActive = data.items.reduce((a, d) => a + d.active, 0);
  const emptyCount = data.items.filter((d) => d.employees === 0).length;
  const maxActive = Math.max(1, ...data.items.map((d) => d.active));

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="ev-kpis">
        <Kpi label="Departamentos" value={data.items.length} />
        <Kpi label="Empleados activos asignados" value={totalActive} />
        <Kpi label="Sin empleados" value={emptyCount} hint={emptyCount ? 'Se pueden eliminar' : undefined} />
      </div>

      <div className="card flat">
        <div className="ev-toolbar">
          <label className="search grow" style={{ minWidth: 220, maxWidth: 380 }}>
            <Icon.search />
            <input placeholder="Buscar por código o descripción…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar departamento" />
          </label>
          <div className="viewseg" role="group" aria-label="Filtrar">
            {([['all', 'Todos'], ['with', 'Con empleados'], ['empty', 'Vacíos']] as [Filter, string][]).map(([k, l]) => (
              <button key={k} className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <span className="grow" />
          <button className="btn sm" onClick={reload} title="Volver a leer de Evalos"><Icon.refresh /> Actualizar</button>
          {data.canEdit && <button className="btn primary sm" onClick={() => setCreating(true)}><Icon.plus /> Nuevo departamento</button>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th style={{ width: 170 }}>Código</th><th>Descripción</th><th style={{ width: 220 }}>Empleados activos</th><th style={{ width: 90, textAlign: 'right' }}>De baja</th><th style={{ width: 40 }} /></tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.code} className="clickable" onClick={() => setOpen(d.code)}>
                  <td className="mono"><b>{d.code}</b></td>
                  <td>{d.description || <span className="muted">—</span>}</td>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="ev-meter" aria-hidden="true"><span style={{ width: `${(d.active / maxActive) * 100}%` }} /></span>
                      <span className="small" style={{ fontWeight: 600, minWidth: 24, textAlign: 'right' }}>{d.active}</span>
                    </div>
                  </td>
                  <td className="small muted" style={{ textAlign: 'right' }}>{d.employees - d.active || '—'}</td>
                  <td className="muted"><span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }}><Icon.chevron /></span></td>
                </tr>
              ))}
              {!list.length && (
                <tr><td colSpan={5} className="muted small" style={{ padding: 28, textAlign: 'center' }}>{data.items.length ? 'Ningún departamento coincide con la búsqueda.' : 'No hay departamentos en Evalos.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ev-foot xs muted">{list.length} de {data.items.length} departamentos · datos leídos directamente de la base de datos de Evalos{data.engine === 'demo' ? ' (demostración)' : ''}</div>
      </div>

      {open && <DepartmentDrawer code={open} data={data} onClose={() => setOpen(null)} onChanged={reload} />}
      {creating && <NewDepartmentModal data={data} onClose={() => setCreating(false)} onCreated={(code) => { setCreating(false); reload(); setOpen(code); }} />}
    </div>
  );
}

/** Versión widget: resumen, buscador, lista compacta y alta rápida. */
export function DepartamentosWidget() {
  const { data, error, reload } = useDepartmentsState(true);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => filterList(data?.items || [], q, 'all'), [data, q]);
  if (error) return error;
  if (!data) return <div style={{ padding: 12 }}><Spinner /></div>;
  const totalActive = data.items.reduce((a, d) => a + d.active, 0);
  const maxActive = Math.max(1, ...data.items.map((d) => d.active));

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ alignItems: 'baseline', gap: 14 }}>
        <span><span className="stat">{data.items.length}</span> <span className="small muted">departamentos</span></span>
        <span className="small muted"><b style={{ color: 'var(--ink)' }}>{totalActive}</b> empleados activos</span>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <label className="search grow" style={{ minWidth: 0, padding: '6px 10px' }}>
          <Icon.search />
          <input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar departamento" />
        </label>
        {data.canEdit && <button className="icon-btn" title="Nuevo departamento" aria-label="Nuevo departamento" onClick={() => setCreating(true)} style={{ border: '1px solid var(--line)' }}><Icon.plus /></button>}
      </div>
      <div className="ev-wlist">
        {list.map((d) => (
          <button key={d.code} className="ev-wrow" onClick={() => setOpen(d.code)}>
            <span className="col grow" style={{ gap: 1, textAlign: 'left' }}>
              <span className="small" style={{ fontWeight: 600 }}>{d.description || d.code}</span>
              <span className="xs muted mono">{d.code}</span>
            </span>
            <span className="ev-meter sm" aria-hidden="true"><span style={{ width: `${(d.active / maxActive) * 100}%` }} /></span>
            <span className="small" style={{ fontWeight: 700, width: 28, textAlign: 'right' }}>{d.active}</span>
          </button>
        ))}
        {!list.length && <span className="small muted" style={{ padding: 10 }}>Sin resultados</span>}
      </div>
      {open && <DepartmentDrawer code={open} data={data} onClose={() => setOpen(null)} onChanged={reload} />}
      {creating && <NewDepartmentModal data={data} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
    </div>
  );
}

// ---------- Piezas compartidas ----------

function filterList(items: EvalosDepartment[], q: string, f: Filter) {
  const t = q.trim().toLowerCase();
  return items.filter((d) => (!t || d.code.toLowerCase().includes(t) || d.description.toLowerCase().includes(t)) && (f === 'all' || (f === 'with' ? d.employees > 0 : d.employees === 0)));
}

/** Carga departamentos y traduce "sin configurar" y otros errores a un bloque visible. */
function useDepartmentsState(compact = false) {
  const { data, error, reload } = useData(() =>
    api.get<EvalosDepartmentsResponse>('/api/evalos/departamentos').catch((e) => {
      if (e instanceof ApiError && e.code === 'not_configured') return NOT_CONFIGURED;
      throw e;
    })
  );
  let node: JSX.Element | null = null;
  if (data === NOT_CONFIGURED) node = <NotConfigured compact={compact} />;
  else if (error) node = <div className="col" style={{ gap: 8 }}><ErrorBox error={error} /><button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={reload}><Icon.refresh /> Reintentar</button></div>;
  return { data: data === NOT_CONFIGURED ? null : data, error: node, reload };
}
const NOT_CONFIGURED = { notConfigured: true } as unknown as EvalosDepartmentsResponse;

function Kpi({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="card" style={{ gap: 4, padding: '16px 18px' }}>
      <span className="xs muted" style={{ fontWeight: 600 }}>{label}</span>
      <span className="stat">{value}</span>
      {hint && <span className="xs muted ev-kpi-hint">{hint}</span>}
    </div>
  );
}

function DepartmentDrawer({ code, data, onClose, onChanged }: { code: string; data: EvalosDepartmentsResponse; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data: det, error, reload } = useData(() => api.get<EvalosDepartment & { employeesList: EvalosDepartmentEmployee[] }>(`/api/evalos/departamentos/${encodeURIComponent(code)}`), [code]);
  const [desc, setDesc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const value = desc ?? det?.description ?? '';
  const dirty = det && desc !== null && desc.trim() !== det.description;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/api/evalos/departamentos/${encodeURIComponent(code)}`, { description: value });
      toast('Departamento modificado en Evalos');
      setDesc(null);
      reload();
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirmAction(`¿Eliminar el departamento ${code} de Evalos? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    try {
      await api.del(`/api/evalos/departamentos/${encodeURIComponent(code)}`);
      toast('Departamento eliminado');
      onChanged();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const emps = det?.employeesList || [];
  const shown = showInactive ? emps : emps.filter((e) => e.active);
  return (
    <Drawer
      onClose={onClose}
      title={
        <div className="col" style={{ gap: 2 }}>
          <span className="xs muted">Departamento</span>
          <h2 className="mono" style={{ fontSize: 20 }}>{code}</h2>
        </div>
      }
    >
      <ErrorBox error={error || err} />
      {!det && !error && <Loading />}
      {det && (
        <>
          <form className="col" style={{ gap: 12 }} onSubmit={save}>
            <label className="field">Descripción
              {data.uppercase && <span className="hint">Se guarda en mayúsculas, como en Evalos.</span>}
              <input className="input" value={value} onChange={(e) => setDesc(e.target.value)} maxLength={data.limits.description || undefined} disabled={!data.canEdit} required
                style={data.uppercase ? { textTransform: 'uppercase' } : undefined} />
            </label>
            {data.canEdit && (
              <div className="row">
                <button className="btn primary" disabled={!dirty || busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
                {dirty && <button type="button" className="btn ghost" onClick={() => setDesc(null)}>Descartar</button>}
              </div>
            )}
          </form>

          <div className="grid-2" style={{ gap: 10 }}>
            <div className="ev-mini"><span className="xs muted">Activos</span><b>{det.active}</b></div>
            <div className="ev-mini"><span className="xs muted">De baja</span><b>{det.employees - det.active}</b></div>
          </div>

          <div className="col" style={{ gap: 8 }}>
            <div className="row">
              <h3 className="grow">Empleados</h3>
              {det.employees > det.active && (
                <label className="check xs"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Ver también los de baja</label>
              )}
            </div>
            <div className="ev-emps">
              {shown.map((e) => (
                <div key={e.code} className="ev-emp">
                  <span className="mono xs muted" style={{ width: 84, flexShrink: 0 }}>{e.code}</span>
                  <span className="small grow">{e.name}</span>
                  {!e.active && <span className="tag outline" title={e.endDate ? `Baja ${e.endDate}` : undefined}>Baja{e.endDate ? ` ${e.endDate}` : ''}</span>}
                </div>
              ))}
              {!shown.length && <span className="small muted" style={{ padding: 12 }}>{emps.length ? 'Todos los empleados de este departamento están de baja.' : 'Ningún empleado tiene asignado este departamento.'}</span>}
            </div>
            {emps.length >= 500 && <span className="xs muted">Se muestran los 500 primeros.</span>}
          </div>

          {data.canDelete && (
            <div className="col" style={{ gap: 6, marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--line-2)' }}>
              <button className="btn danger" style={{ alignSelf: 'flex-start' }} disabled={busy || det.employees > 0} onClick={remove}><Icon.trash /> Eliminar departamento</button>
              {det.employees > 0 && <span className="xs muted">No se puede eliminar mientras haya empleados (activos o de baja) con este departamento.</span>}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

function NewDepartmentModal({ data, onClose, onCreated }: { data: EvalosDepartmentsResponse; onClose: () => void; onCreated: (code: string) => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const up = (s: string) => (data.uppercase ? s.toLocaleUpperCase('es-ES') : s);
  const exists = data.items.some((d) => d.code.toUpperCase() === up(code.trim()).toUpperCase());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const d = await api.post<EvalosDepartment>('/api/evalos/departamentos', { code, description: desc });
      toast(`Departamento ${d.code} creado en Evalos`);
      onCreated(d.code);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Nuevo departamento" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <ErrorBox error={err} />
        <label className="field">Código
          <span className="hint">Identificador único en Evalos{data.limits.code ? ` · máximo ${data.limits.code} caracteres` : ''}. No se puede cambiar después.</span>
          <input className="input mono" value={code} onChange={(e) => setCode(up(e.target.value))} maxLength={data.limits.code || undefined} required autoFocus />
          {exists && <span className="xs" style={{ color: 'var(--bad)', fontWeight: 500 }}>Ya existe un departamento con este código.</span>}
        </label>
        <label className="field">Descripción
          <input className="input" value={desc} onChange={(e) => setDesc(up(e.target.value))} maxLength={data.limits.description || undefined} required />
        </label>
        <div className="row">
          <button className="btn primary" disabled={busy || exists || !code.trim() || !desc.trim()}>{busy ? 'Creando…' : 'Crear en Evalos'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </Modal>
  );
}

