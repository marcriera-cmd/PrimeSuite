// Atajos de Evalos · Perfiles Workflow 2 (por departamentos, sin equipos).
// Alternativa a Perfiles Workflow: cada persona tiene su departamento y su rol; el responsable valida su departamento
// (y los que se le añadan), y a quien haga falta (p. ej. un jefe de departamento) se le asigna a mano quién le valida.
// Solo la opción activa asigna los perfiles; la otra se puede preparar y comparar. El mismo archivo exporta el widget.
import { useMemo, useState, type JSX } from 'react';
import { api, ApiError, type EvalosWf2Person, type EvalosWf2Profile, type EvalosWorkflow2Response, type EvalosWorkflowSync } from '../../api';
import { ErrorBox, Icon, Loading, Modal, confirmAction, useData, useToast } from '../../components/ui';
import { NotConfigured, workflowToast } from './common';
import { Kpi, MissingTables, ModeBanner, PeoplePicker, ProfileEditorModal, ROLE_LABEL, RoleTag, SettingsForm, hasChanges } from './Workflow';

const NC = { notConfigured: true } as unknown as EvalosWorkflow2Response;
type Tab = 'personas' | 'departamentos' | 'perfiles' | 'ajustes';
type D = Required<EvalosWorkflow2Response>;

function useWorkflow2() {
  const { data, error, reload } = useData(() =>
    api.get<EvalosWorkflow2Response>('/api/evalos/workflow2').catch((e) => {
      if (e instanceof ApiError && e.code === 'not_configured') return NC;
      throw e;
    })
  );
  let node: JSX.Element | null = null;
  if (data === NC) node = <NotConfigured />;
  else if (error) node = <div className="col" style={{ gap: 8 }}><ErrorBox error={error} /><button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={reload}><Icon.refresh /> Reintentar</button></div>;
  return { data: data === NC ? null : data, error: node, reload };
}

function useNames(d: D) {
  return useMemo(() => ({
    person: new Map(d.people.map((p) => [p.code, p.name])),
    dept: new Map(d.departments.map((x) => [x.code, x.description])),
    profile: new Map(d.profiles.map((p) => [p.code, p]))
  }), [d]);
}

export default function Workflow2() {
  const { data, error, reload } = useWorkflow2();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('personas');
  const [applying, setApplying] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  if (error) return error;
  if (!data) return <Loading />;
  if (data.missing) return <MissingTables missing={data.missing} onRetry={reload} fileName="PS_PERFILES_WORKFLOW_2.sql" what="El registro de los perfiles que crea Prime Suite y las asignaciones manuales de quién valida se guardan" />;
  const d = data as D;
  const active = d.mode === 'departamentos';
  const dynCount = d.profiles.filter((p) => p.dyn).length;

  async function applyPending() {
    setApplying(true);
    try {
      const r = await api.post<{ workflowSync: EvalosWorkflowSync }>('/api/evalos/workflow2/recalcular', {});
      workflowToast(toast, r.workflowSync);
      if (!hasChanges(r.workflowSync)) toast('Los perfiles ya estaban al día');
      reload();
    } catch (e: any) { toast(e.message, true); }
    finally { setApplying(false); }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <ModeBanner mode={d.mode} here="departamentos" canConfigure={d.canConfigure} onChanged={reload} />
      {!!d.missingColumns?.length && <div className="alert warn">Falta en PERSONAL la columna {d.missingColumns.join(', ')}. Créala en la base de datos de Evalos 8 (p. ej. nvarchar(15)) para poder asignar roles.</div>}
      <div className="ev-kpis">
        <Kpi label="Departamentos con responsable" value={new Set(d.people.flatMap((p) => p.validates)).size} hint={`de ${d.departments.length} departamentos`} />
        <Kpi label="Personas con rol" value={d.people.filter((p) => p.workflowRol).length} hint={`${d.people.filter((p) => p.manual.length).length} con validador asignado a mano`} />
        <Kpi label="Perfiles creados (opción 2)" value={dynCount} hint={active ? `${d.profiles.length - dynCount} perfiles más en Evalos` : 'Se crean al activar esta opción'} />
      </div>

      {active && hasChanges(d.pending) && (
        <div className="alert info row wrap" style={{ gap: 10 }}>
          <span className="grow small">
            <b>Hay cambios pendientes de aplicar en Evalos:</b>{' '}
            {[d.pending.created.length && `${d.pending.created.length} perfil(es) por crear`, d.pending.updated.length && `${d.pending.updated.length} por actualizar`,
              d.pending.removed.length && `${d.pending.removed.length} por borrar`, d.pending.assigned && `${d.pending.assigned} persona(s) por cambiar de perfil`].filter(Boolean).join(' · ')}.
          </span>
          {d.canEdit && <button className="btn sm primary" onClick={applyPending} disabled={applying}><Icon.refresh /> {applying ? 'Aplicando…' : 'Aplicar ahora'}</button>}
        </div>
      )}
      {!!d.pending.warnings.length && (
        <div className="alert warn small col" style={{ gap: 4 }}>
          <button type="button" className="row" style={{ gap: 6, background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', fontWeight: 700, textAlign: 'left' }} onClick={() => setShowWarnings((v) => !v)}>
            <Icon.warn /> {d.pending.warnings.length} aviso(s) de validación · {showWarnings ? 'ocultar' : 'ver'}
          </button>
          {showWarnings && d.pending.warnings.map((w, i) => <span key={i}>{w}</span>)}
        </div>
      )}

      <div className="tabs" role="tablist">
        {([['personas', 'Personas', <Icon.users />], ['departamentos', 'Departamentos', <Icon.building />], ['perfiles', 'Perfiles', <Icon.layers />], ...(d.canConfigure ? [['ajustes', 'Ajustes', <Icon.sliders />]] : [])] as [Tab, string, JSX.Element][]).map(([k, l, ico]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{ico}{l}</button>
        ))}
      </div>

      {tab === 'personas' && <PeopleTab d={d} onChanged={reload} />}
      {tab === 'departamentos' && <DepartmentsTab d={d} />}
      {tab === 'perfiles' && <ProfilesTab d={d} onChanged={reload} />}
      {tab === 'ajustes' && d.canConfigure && (
        <SettingsForm settings={d.settings} roles={d.roles} profiles={d.profiles} endpoint="/api/evalos/workflow2/ajustes" mode={d.mode} canConfigure={d.canConfigure} onChanged={reload} />
      )}
    </div>
  );
}

// ---------- Personas ----------
function PeopleTab({ d, onChanged }: { d: D; onChanged: () => void }) {
  const toast = useToast();
  const names = useNames(d);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [role, setRole] = useState('');
  const [withInactive, setWithInactive] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<EvalosWf2Person | null>(null);

  const needle = q.trim().toLowerCase();
  const list = d.people.filter((p) =>
    (withInactive || p.active)
    && (!needle || p.code.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle))
    && (!dept || (dept === '-' ? !p.department : p.department === dept))
    && (!role || (role === '-' ? !p.workflowRol : role === 'MANUAL' ? p.manual.length > 0 : p.workflowRol === role))
  ).sort((a, b) => a.name.localeCompare(b.name));
  const allSel = list.length > 0 && list.every((p) => sel.has(p.code));
  const toggleAll = () => setSel(allSel ? new Set([...sel].filter((c) => !list.some((p) => p.code === c))) : new Set([...sel, ...list.map((p) => p.code)]));
  const toggle = (c: string) => { const s = new Set(sel); if (s.has(c)) s.delete(c); else s.add(c); setSel(s); };

  async function apply() {
    if (!sel.size || bulkRole === null) return;
    if (!confirmAction(`Se pondrá a ${sel.size} persona(s) el rol ${bulkRole ? ROLE_LABEL[bulkRole] : '«sin rol»'}${d.mode === 'departamentos' ? ' y se recalcularán sus perfiles de Workflow en Evalos' : ''}. ¿Continuar?`)) return;
    setBusy(true);
    try {
      const r = await api.put<{ changed: number; workflowSync: EvalosWorkflowSync }>('/api/evalos/workflow2/personas', { employees: [...sel], workflowRol: bulkRole });
      toast(`${r.changed} persona(s) actualizadas`);
      workflowToast(toast, r.workflowSync);
      setSel(new Set()); setBulkRole(null);
      onChanged();
    } catch (e: any) { toast(e.message, true); }
    finally { setBusy(false); }
  }
  const deptName = (c: string) => (c ? names.dept.get(c) || c : '');

  return (
    <div className="card flat">
      <div className="ev-toolbar">
        <input className="input search" style={{ width: 220 }} placeholder="Buscar por código o nombre" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ width: 'auto' }} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Departamento">
          <option value="">Todos los departamentos</option>
          <option value="-">Sin departamento</option>
          {d.departments.map((x) => <option key={x.code} value={x.code}>{x.description || x.code}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rol">
          <option value="">Todos los roles</option>
          <option value="-">Sin rol</option>
          {d.roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          <option value="MANUAL">Con validador a mano</option>
        </select>
        <label className="row small" style={{ gap: 6, fontWeight: 400 }}><input type="checkbox" checked={withInactive} onChange={(e) => setWithInactive(e.target.checked)} /> Incluir bajas</label>
      </div>

      {d.canEdit && sel.size > 0 && (
        <div className="row wrap" style={{ gap: 8, padding: '10px 12px', margin: '0 12px 8px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <b className="small">{sel.size} seleccionada(s)</b>
          <select className="select" style={{ width: 'auto' }} value={bulkRole ?? '__keep__'} onChange={(e) => setBulkRole(e.target.value === '__keep__' ? null : e.target.value)} aria-label="Rol">
            <option value="__keep__">Rol: elige…</option>
            <option value="">Rol: quitar</option>
            {d.roles.map((r) => <option key={r} value={r}>Rol: {ROLE_LABEL[r]}</option>)}
          </select>
          <button className="btn sm primary" onClick={apply} disabled={busy || bulkRole === null}>{busy ? 'Aplicando…' : 'Aplicar'}</button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Quitar selección</button>
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {d.canEdit && <th style={{ width: 36 }}><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Seleccionar todas" /></th>}
              <th style={{ width: 120 }}>Código</th>
              <th>Nombre</th>
              <th>Departamento</th>
              <th>Rol</th>
              <th>Lo valida</th>
              <th>Valida</th>
              <th>Perfil de solicitudes</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const prof = names.profile.get(p.profile);
              return (
                <tr key={p.code} className="clickable" onClick={() => setEdit(p)}>
                  {d.canEdit && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(p.code)} onChange={() => toggle(p.code)} aria-label={`Seleccionar ${p.code}`} /></td>}
                  <td className="mono small">{p.code}</td>
                  <td className="small">
                    {p.name}
                    {!p.active && <span className="tag outline" style={{ marginLeft: 6 }}>De baja</span>}
                    {p.workflowRol && !p.email && <span className="tag warn" style={{ marginLeft: 6 }} title="Sin email en la ficha (EM_WFEM): no recibirá los avisos del Workflow">Sin email</span>}
                  </td>
                  <td className="small">{deptName(p.department) || <span className="muted">—</span>}</td>
                  <td><RoleTag rol={p.workflowRol} /></td>
                  <td className="small">
                    {!p.workflowRol ? <span className="muted">—</span>
                      : p.level1.length ? <>{p.level1.map((c) => names.person.get(c) || c).join(', ')}{p.level1Manual && <span className="tag info" style={{ marginLeft: 6 }}>A mano</span>}</>
                        : <span className="tag warn">Nadie</span>}
                  </td>
                  <td className="small">{p.validates.length ? p.validates.map(deptName).join(', ') : <span className="muted">—</span>}</td>
                  <td className="small">
                    {p.profile ? <><b className="mono">{p.profile}</b> {prof?.name || ''}</> : <span className="muted">Sin perfil</span>}
                  </td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={8} className="muted small" style={{ padding: 28, textAlign: 'center' }}>Nadie coincide con los filtros.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="ev-foot xs muted">
        El responsable valida las solicitudes de su departamento (y de los que se le añadan). Pulsa una persona para asignarle a mano quién la valida
        (por ejemplo, a un jefe de departamento su superior) o, si es responsable, añadirle departamentos. El departamento se cambia en su historial, en Personal.
      </div>
      {edit && <ValidationModal d={d} person={edit} onClose={() => setEdit(null)} onChanged={() => { setEdit(null); onChanged(); }} />}
    </div>
  );
}

/** Quién valida a una persona (a mano) y, si es responsable, departamentos de más que valida. */
function ValidationModal({ d, person, onClose, onChanged }: { d: D; person: EvalosWf2Person; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const names = useNames(d);
  const ro = !d.canEdit;
  const [manual, setManual] = useState<string[]>(person.manual);
  const [depts, setDepts] = useState<string[]>(person.extraDepts);
  const [addDept, setAddDept] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isResp = person.workflowRol === 'RESPONSABLE';
  const deptName = (c: string) => names.dept.get(c) || c;
  // Validadores por defecto: responsables (en alta) que validan su departamento, sin ella.
  const defaults = d.people.filter((p) => p.code !== person.code && p.validates.includes(person.department)).map((p) => p.name);
  const dirty = JSON.stringify(manual) !== JSON.stringify(person.manual) || JSON.stringify(depts) !== JSON.stringify(person.extraDepts);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await api.put<{ workflowSync: EvalosWorkflowSync | null }>(`/api/evalos/workflow2/validacion/${encodeURIComponent(person.code)}`, { manual, depts: isResp ? depts : person.extraDepts });
      toast(d.mode === 'departamentos' ? 'Validación guardada y perfiles recalculados' : 'Validación guardada (se aplicará al activar Perfiles Workflow 2)');
      workflowToast(toast, r.workflowSync, { quiet: true });
      onChanged();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title={`${person.name} · ${person.code}`} onClose={onClose} wide>
      <div className="col" style={{ gap: 16 }}>
        <ErrorBox error={err} />
        <div className="row wrap small" style={{ gap: 14 }}>
          <span>Departamento: <b>{person.department ? deptName(person.department) : 'Sin departamento'}</b></span>
          <span>Rol: <RoleTag rol={person.workflowRol} /></span>
          {person.profile && <span>Perfil: <b className="mono">{person.profile}</b> {names.profile.get(person.profile)?.name || ''}</span>}
        </div>
        {!person.workflowRol && <div className="alert info small">Esta persona no tiene rol: su perfil de solicitudes no lo gestiona Prime Suite. Dale un rol en la pestaña Personas o en su ficha.</div>}

        <div className="col" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>Quién valida sus solicitudes (nivel 1)</h3>
          <span className="xs muted">
            Si lo dejas vacío, la validan los responsables de su departamento: {defaults.length ? <b>{defaults.join(', ')}</b> : <b>nadie ahora mismo</b>}.
            Si asignas a alguien aquí, lo sustituye (por ejemplo, a un jefe de departamento lo valida su superior).
          </span>
          <PeoplePicker people={d.people} value={manual} onChange={setManual} disabled={ro} exclude={person.code} />
        </div>

        {isResp && (
          <div className="col" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>Departamentos que valida</h3>
            <span className="xs muted">Su propio departamento siempre; añade los demás cuyas solicitudes también tiene que validar. Verá a su gente en el Workflow.</span>
            <div className="row wrap" style={{ gap: 6 }}>
              {person.department && <span className="tag info">{deptName(person.department)} · el suyo</span>}
              {depts.map((c) => (
                <span key={c} className="tag outline">
                  {deptName(c)}
                  {!ro && <button type="button" aria-label={`Quitar ${c}`} style={{ background: 'none', border: 0, cursor: 'pointer', padding: '0 0 0 4px', color: 'inherit' }} onClick={() => setDepts(depts.filter((x) => x !== c))}>×</button>}
                </span>
              ))}
            </div>
            {!ro && (
              <div className="row wrap" style={{ gap: 8 }}>
                <select className="select" style={{ width: 'auto', minWidth: 240 }} value={addDept} onChange={(e) => setAddDept(e.target.value)} aria-label="Departamento a añadir">
                  <option value="">Añadir departamento…</option>
                  {d.departments.filter((x) => x.code !== person.department && !depts.includes(x.code)).map((x) => <option key={x.code} value={x.code}>{x.description || x.code}</option>)}
                </select>
                <button type="button" className="btn sm" disabled={!addDept} onClick={() => { setDepts([...depts, addDept]); setAddDept(''); }}><Icon.plus /> Añadir</button>
              </div>
            )}
          </div>
        )}

        <div className="row" style={{ gap: 8 }}>
          {!ro && <button className="btn primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Guardando…' : 'Guardar'}</button>}
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Departamentos ----------
function DepartmentsTab({ d }: { d: D }) {
  const names = useNames(d);
  const rows = d.departments.map((x) => {
    const members = d.people.filter((p) => p.active && p.department === x.code);
    const validators = d.people.filter((p) => p.validates.includes(x.code));
    return { ...x, members: members.length, withRole: members.filter((p) => p.workflowRol).length, manual: members.filter((p) => p.manual.length).length, validators };
  });
  return (
    <div className="card flat">
      <div className="ev-toolbar"><b className="small">{d.departments.length} departamento(s)</b></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th style={{ width: 140 }}>Código</th><th>Departamento</th><th style={{ textAlign: 'right' }}>Personas</th><th style={{ textAlign: 'right' }}>Con rol</th><th>Lo validan</th><th style={{ textAlign: 'right' }}>Validador a mano</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.code}>
                <td className="mono"><b>{x.code}</b></td>
                <td className="small">{x.description}</td>
                <td style={{ textAlign: 'right' }} className="small">{x.members}</td>
                <td style={{ textAlign: 'right' }} className="small">{x.withRole}</td>
                <td className="small">
                  {x.validators.length
                    ? x.validators.map((p) => `${p.name}${p.department !== x.code ? ` (de ${names.dept.get(p.department) || p.department})` : ''}`).join(', ')
                    : x.withRole ? <span className="tag warn">Nadie</span> : <span className="muted">—</span>}
                </td>
                <td style={{ textAlign: 'right' }} className="small">{x.manual || <span className="muted">—</span>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="muted small" style={{ padding: 28, textAlign: 'center' }}>No se han podido leer los departamentos.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="ev-foot xs muted">Un departamento lo validan sus responsables y los responsables de otros departamentos que lo tengan añadido. Se asignan en la pestaña Personas.</div>
    </div>
  );
}

// ---------- Perfiles ----------
function ProfilesTab({ d, onChanged }: { d: D; onChanged: () => void }) {
  const names = useNames(d);
  const [edit, setEdit] = useState<EvalosWf2Profile | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const dyn = d.profiles.filter((p) => p.dyn).sort((a, b) => a.name.localeCompare(b.name));
  const others = d.profiles.filter((p) => !p.dyn);
  const deptName = (c: string) => names.dept.get(c) || c;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card flat">
        <div className="ev-toolbar"><b className="small">{dyn.length} perfil(es) creados por Perfiles Workflow 2</b></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 70 }}>Código</th><th>Descripción</th><th>Rol</th><th>Nivel 1</th><th>Niveles 2–4</th><th style={{ textAlign: 'right' }}>Solicitudes</th><th style={{ textAlign: 'right' }}>Personas</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>
              {dyn.map((p) => {
                const extra = d.levelCols.slice(1).filter((c) => p.levels[c]?.length).length;
                return (
                  <tr key={p.code} className="clickable" onClick={() => setEdit(p)}>
                    <td className="mono"><b>{p.code}</b></td>
                    <td className="small">{p.name}{!!p.alerts.length && <span className="tag warn" style={{ marginLeft: 6 }} title={p.alerts.join('\n')}>Aviso</span>}</td>
                    <td><RoleTag rol={p.dyn!.rol} /></td>
                    <td className="small">{p.levels[d.levelCols[0]]?.length ? p.levels[d.levelCols[0]].map((c) => names.person.get(c) || c).join(', ') : <span className="tag warn">Nadie</span>}</td>
                    <td className="small">{extra ? `${extra} nivel(es) más` : <span className="muted">—</span>}</td>
                    <td style={{ textAlign: 'right' }} className="small">{d.requests.filter((r) => p.orders[r.col]).length} de {d.requests.length}</td>
                    <td style={{ textAlign: 'right' }}><b className="small">{p.people}</b></td>
                    <td className="muted">{d.canEdit ? <Icon.edit /> : <Icon.eye />}</td>
                  </tr>
                );
              })}
              {!dyn.length && <tr><td colSpan={8} className="muted small" style={{ padding: 28, textAlign: 'center' }}>{d.mode === 'departamentos' ? 'Todavía no hay perfiles: se crean al dar rol a las personas.' : 'Los perfiles de esta opción se crean al activarla.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="ev-foot xs muted">El nivel 1 lo calcula Prime Suite (responsables del departamento o el validador asignado a mano). En cada perfil puedes añadir autorizadores en los niveles 2 a 4 y elegir qué solicitudes aparecen y en qué orden se validan.</div>
      </div>
      <div className="card flat">
        <button type="button" className="ev-toolbar" style={{ background: 'none', border: 0, width: '100%', cursor: 'pointer', textAlign: 'left' }} onClick={() => setShowOthers((v) => !v)}>
          <b className="small">Otros perfiles de Evalos ({others.length})</b>
          <span className="grow" />
          <span className="xs muted">{showOthers ? 'Ocultar' : 'Ver'}</span>
        </button>
        {showOthers && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 70 }}>Código</th><th>Descripción</th><th /><th style={{ textAlign: 'right' }}>Personas</th></tr></thead>
              <tbody>
                {others.map((p) => (
                  <tr key={p.code}>
                    <td className="mono"><b>{p.code}</b></td>
                    <td className="small">{p.name}</td>
                    <td>{p.template && <span className="tag info">Plantilla {Object.entries(d.settings.templates).filter(([, t]) => t === p.code).map(([r]) => ROLE_LABEL[r]).join(', ')}</span>}</td>
                    <td style={{ textAlign: 'right' }} className="small">{p.people}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && (() => {
        const k = edit.dyn!;
        return (
          <ProfileEditorModal profile={edit} people={d.people} requests={d.requests} levelCols={d.levelCols} canEdit={d.canEdit}
            endpoint={`/api/evalos/workflow2/perfiles/${encodeURIComponent(edit.code)}`} onClose={() => setEdit(null)} onChanged={() => { setEdit(null); onChanged(); }}
            level1Note={k.manual.length ? 'asignado a mano en la pestaña Personas' : `lo calcula Prime Suite: responsables de ${k.department ? deptName(k.department) : 'su departamento'}`}
            header={<>
              <span>Departamento: <b>{k.department ? deptName(k.department) : 'Sin departamento'}</b></span>
              <span>Rol: <RoleTag rol={k.rol} /></span>
              {k.depts.length > 0 && <span>Valida: <b>{k.depts.map(deptName).join(', ')}</b></span>}
              <span>Filtro de personal: <span className="mono xs">{edit.filter || (k.rol === 'RRHH' ? 'todo el personal' : 'el de la plantilla')}</span></span>
            </>} />
        );
      })()}
    </div>
  );
}

// ---------- Widget ----------
export function Workflow2Widget() {
  const { data, error } = useWorkflow2();
  if (error) return error;
  if (!data) return <Loading />;
  if (data.missing) return <span className="small muted">Falta crear las tablas de Perfiles Workflow 2 en la base de datos de Evalos 8. Abre la pantalla para ver el script.</span>;
  const d = data as D;
  const noValidator = d.people.filter((p) => p.active && p.workflowRol && !p.level1.length).length;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <div className="card grow" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Personas con rol</span><span className="stat">{d.people.filter((p) => p.workflowRol).length}</span></div>
        <div className="card grow" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Sin validador</span><span className="stat">{noValidator}</span></div>
      </div>
      <span className="small muted">{d.mode === 'departamentos' ? 'Opción activa.' : 'Opción no activa (activa: Perfiles Workflow).'}</span>
    </div>
  );
}
