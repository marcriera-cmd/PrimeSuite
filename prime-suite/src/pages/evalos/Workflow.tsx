// Atajos de Evalos · Perfiles Workflow.
// Cada persona tiene un equipo, un rol (EMPLEADO, RESPONSABLE o RRHH) y, si valida, el equipo cuyas solicitudes aprueba.
// Prime Suite crea a partir de ellos los perfiles de WORKFLOW (copiando la plantilla de cada rol) y los asigna en EM_WFOP:
// el nivel 1 son quienes validan el equipo. Aquí se gestionan los equipos, se asignan en bloque y se editan los niveles
// 2 a 4 y el orden de validación de cada solicitud. El mismo archivo exporta el widget del Inicio.
import { Fragment, useMemo, useState, type FormEvent, type JSX, type ReactNode } from 'react';
import {
  api, ApiError, type EvalosEquipo, type EvalosOrgKind, type EvalosWfPerson, type EvalosWfProfile, type EvalosWfMode, type EvalosWfRole, type EvalosWorkflowResponse, type EvalosWorkflowSync
} from '../../api';
import { ErrorBox, Icon, Loading, Modal, confirmAction, useData, useToast } from '../../components/ui';
import { NotConfigured, workflowToast } from './common';

const NC = { notConfigured: true } as unknown as EvalosWorkflowResponse;
export const ROLE_LABEL: Record<string, string> = { EMPLEADO: 'Empleado', RESPONSABLE: 'Responsable', RRHH: 'RR.HH.' };
export const ROLE_TAG: Record<string, string> = { EMPLEADO: 'outline', RESPONSABLE: 'info', RRHH: 'ok' };
const ORG_KINDS: [EvalosOrgKind, string][] = [['company', 'Empresa'], ['department', 'Departamento'], ['section', 'Sección'], ['area', 'Área']];
/** Valor del desplegable de la asignación en bloque que deja el campo como está. */
const KEEP = '__keep__';
type Tab = 'personas' | 'equipos' | 'perfiles' | 'ajustes';

function useWorkflow() {
  const { data, error, reload } = useData(() =>
    api.get<EvalosWorkflowResponse>('/api/evalos/workflow').catch((e) => {
      if (e instanceof ApiError && e.code === 'not_configured') return NC;
      throw e;
    })
  );
  let node: JSX.Element | null = null;
  if (data === NC) node = <NotConfigured />;
  else if (error) node = <div className="col" style={{ gap: 8 }}><ErrorBox error={error} /><button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={reload}><Icon.refresh /> Reintentar</button></div>;
  return { data: data === NC ? null : data, error: node, reload };
}

export const hasChanges = (s?: EvalosWorkflowSync | null) => !!s && (s.created.length + s.updated.length + s.removed.length + s.assigned > 0);

export default function Workflow() {
  const { data, error, reload } = useWorkflow();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('personas');
  const [applying, setApplying] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  if (error) return error;
  if (!data) return <Loading />;
  if (data.missing) return <MissingTables missing={data.missing} onRetry={reload} />;

  const d = data as Required<EvalosWorkflowResponse>;
  const dynCount = d.profiles.filter((p) => p.dyn).length;
  const withRole = d.people.filter((p) => p.workflowRol).length;

  async function applyPending() {
    setApplying(true);
    try {
      const r = await api.post<{ workflowSync: EvalosWorkflowSync }>('/api/evalos/workflow/recalcular', {});
      workflowToast(toast, r.workflowSync);
      if (!hasChanges(r.workflowSync)) toast('Los perfiles ya estaban al día');
      reload();
    } catch (e: any) { toast(e.message, true); }
    finally { setApplying(false); }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <ModeBanner mode={d.mode} here="equipos" canConfigure={d.canConfigure} onChanged={reload} />
      {!!d.missingColumns?.length && (
        <div className="alert warn">
          Faltan en PERSONAL las columnas {d.missingColumns.join(', ')}. Créalas en la base de datos de Evalos 8 (texto, p. ej. nvarchar(20) para los equipos y nvarchar(15) para el rol) para poder asignar equipos y roles.
        </div>
      )}
      <div className="ev-kpis">
        <Kpi label="Equipos" value={d.equipos.length} />
        <Kpi label="Personas con rol" value={withRole} hint={`de ${d.people.filter((p) => p.active).length} en alta`} />
        <Kpi label="Perfiles creados por Prime Suite" value={dynCount} hint={`${d.profiles.length - dynCount} perfiles más en Evalos`} />
      </div>

      {hasChanges(d.pending) && (
        <div className="alert info row wrap" style={{ gap: 10 }}>
          <span className="grow small">
            <b>Hay cambios pendientes de aplicar en Evalos:</b>{' '}
            {[d.pending.created.length && `${d.pending.created.length} perfil(es) por crear`, d.pending.updated.length && `${d.pending.updated.length} por actualizar`,
              d.pending.removed.length && `${d.pending.removed.length} por borrar (${d.pending.removed.map((x) => x.code).join(', ')})`, d.pending.assigned && `${d.pending.assigned} persona(s) por cambiar de perfil`].filter(Boolean).join(' · ')}.
            {' '}Suele pasar cuando se cambia algo directamente en Evalos.
          </span>
          {d.canEdit && <button className="btn sm primary" onClick={applyPending} disabled={applying}><Icon.refresh /> {applying ? 'Aplicando…' : 'Aplicar ahora'}</button>}
        </div>
      )}
      {!!d.pending.warnings.length && (
        <div className="alert warn small col" style={{ gap: 4 }}>
          <button type="button" className="row" style={{ gap: 6, background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', fontWeight: 700, textAlign: 'left' }} onClick={() => setShowWarnings((v) => !v)}>
            <Icon.warn /> {d.pending.warnings.length} aviso(s) en los perfiles · {showWarnings ? 'ocultar' : 'ver'}
          </button>
          {showWarnings && d.pending.warnings.map((w, i) => <span key={i}>{w}</span>)}
        </div>
      )}

      <div className="tabs" role="tablist">
        {([['personas', 'Personas', <Icon.users />], ['equipos', 'Equipos', <Icon.building />], ['perfiles', 'Perfiles', <Icon.layers />], ...(d.canConfigure ? [['ajustes', 'Ajustes', <Icon.sliders />]] : [])] as [Tab, string, JSX.Element][]).map(([k, l, ico]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{ico}{l}</button>
        ))}
      </div>

      {tab === 'personas' && <PeopleTab d={d} onChanged={reload} />}
      {tab === 'equipos' && <TeamsTab d={d} onChanged={reload} />}
      {tab === 'perfiles' && <ProfilesTab d={d} onChanged={reload} />}
      {tab === 'ajustes' && d.canConfigure && <SettingsTab d={d} onChanged={reload} />}
    </div>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="card" style={{ gap: 4, padding: '16px 18px' }}>
      <span className="xs muted" style={{ fontWeight: 600 }}>{label}</span>
      <span className="stat">{value}</span>
      {hint && <span className="xs muted ev-kpi-hint">{hint}</span>}
    </div>
  );
}

// ---------- Utilidades ----------
function useNames(d: Required<EvalosWorkflowResponse>) {
  return useMemo(() => ({
    person: new Map(d.people.map((p) => [p.code, p.name])),
    team: new Map(d.equipos.map((e) => [e.code, e.name])),
    profile: new Map(d.profiles.map((p) => [p.code, p])),
    org: Object.fromEntries(ORG_KINDS.map(([k]) => [k, new Map((d.org[k] || []).map((x) => [x.code, x.description]))])) as Record<EvalosOrgKind, Map<string, string>>
  }), [d]);
}
export const RoleTag = ({ rol }: { rol: string }) => (rol ? <span className={`tag ${ROLE_TAG[rol] || 'warn'}`}>{ROLE_LABEL[rol] || rol}</span> : <span className="muted xs">Sin rol</span>);

// ---------- Personas: asignación en bloque ----------
function PeopleTab({ d, onChanged }: { d: Required<EvalosWorkflowResponse>; onChanged: () => void }) {
  const toast = useToast();
  const names = useNames(d);
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [role, setRole] = useState('');
  const [orgKind, setOrgKind] = useState<EvalosOrgKind>('department');
  const [orgValue, setOrgValue] = useState('');
  const [withInactive, setWithInactive] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState({ equipo: KEEP, workflowRol: KEEP, valEquipo: KEEP });
  const [busy, setBusy] = useState(false);

  const needle = q.trim().toLowerCase();
  const list = d.people.filter((p) =>
    (withInactive || p.active)
    && (!needle || p.code.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle))
    && (!team || (team === '-' ? !p.equipo : p.equipo === team || p.valEquipo === team))
    && (!role || (role === '-' ? !p.workflowRol : p.workflowRol === role))
    && (!orgValue || p[orgKind] === orgValue)
  ).sort((a, b) => a.name.localeCompare(b.name));
  const orgOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of d.people) if (p[orgKind] && (withInactive || p.active)) count.set(p[orgKind], (count.get(p[orgKind]) || 0) + 1);
    return [...count.entries()].map(([code, n]) => ({ code, n, label: names.org[orgKind].get(code) || code })).sort((a, b) => a.label.localeCompare(b.label));
  }, [d, orgKind, withInactive, names]);
  const allSel = list.length > 0 && list.every((p) => sel.has(p.code));
  const toggleAll = () => setSel(allSel ? new Set([...sel].filter((c) => !list.some((p) => p.code === c))) : new Set([...sel, ...list.map((p) => p.code)]));
  const toggle = (c: string) => { const s = new Set(sel); if (s.has(c)) s.delete(c); else s.add(c); setSel(s); };
  const changes = Object.entries(bulk).filter(([, v]) => v !== KEEP);

  async function apply() {
    if (!sel.size || !changes.length) return;
    const text = changes.map(([k, v]) => `${k === 'equipo' ? 'equipo' : k === 'valEquipo' ? 'equipo que valida' : 'rol'}: ${v ? (k === 'workflowRol' ? ROLE_LABEL[v] : names.team.get(v) || v) : 'ninguno'}`).join(', ');
    if (!confirmAction(`Se cambiará a ${sel.size} persona(s) ${text}, y se recalcularán sus perfiles de Workflow en Evalos. ¿Continuar?`)) return;
    setBusy(true);
    try {
      const r = await api.put<{ changed: number; workflowSync: EvalosWorkflowSync }>('/api/evalos/workflow/personas', { employees: [...sel], ...Object.fromEntries(changes) });
      toast(`${r.changed} persona(s) actualizadas`);
      workflowToast(toast, r.workflowSync);
      setSel(new Set());
      setBulk({ equipo: KEEP, workflowRol: KEEP, valEquipo: KEEP });
      onChanged();
    } catch (e: any) { toast(e.message, true); }
    finally { setBusy(false); }
  }

  const teamOptions = (keepLabel: string, noneLabel: string) => (
    <>
      <option value={KEEP}>{keepLabel}</option>
      <option value="">{noneLabel}</option>
      {d.equipos.map((e) => <option key={e.code} value={e.code}>{e.name} ({e.code})</option>)}
    </>
  );

  return (
    <div className="card flat">
      <div className="ev-toolbar">
        <input className="input search" style={{ width: 220 }} placeholder="Buscar por código o nombre" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ width: 'auto' }} value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Equipo">
          <option value="">Todos los equipos</option>
          <option value="-">Sin equipo</option>
          {d.equipos.map((e) => <option key={e.code} value={e.code}>{e.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rol">
          <option value="">Todos los roles</option>
          <option value="-">Sin rol</option>
          {d.roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={orgKind} onChange={(e) => { setOrgKind(e.target.value as EvalosOrgKind); setOrgValue(''); }} aria-label="Filtrar por">
          {ORG_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', minWidth: 160 }} value={orgValue} onChange={(e) => setOrgValue(e.target.value)} aria-label="Valor">
          <option value="">Todos</option>
          {orgOptions.map((o) => <option key={o.code} value={o.code}>{o.label} · {o.n}</option>)}
        </select>
        <label className="row small" style={{ gap: 6, fontWeight: 400 }}><input type="checkbox" checked={withInactive} onChange={(e) => setWithInactive(e.target.checked)} /> Incluir bajas</label>
      </div>

      {d.canEdit && sel.size > 0 && (
        <div className="row wrap" style={{ gap: 8, padding: '10px 12px', margin: '0 12px 8px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <b className="small">{sel.size} seleccionada(s)</b>
          <select className="select" style={{ width: 'auto' }} value={bulk.equipo} onChange={(e) => setBulk({ ...bulk, equipo: e.target.value })} aria-label="Equipo">
            {teamOptions('Equipo: no cambiar', 'Equipo: quitar')}
          </select>
          <select className="select" style={{ width: 'auto' }} value={bulk.workflowRol} onChange={(e) => setBulk({ ...bulk, workflowRol: e.target.value })} aria-label="Rol">
            <option value={KEEP}>Rol: no cambiar</option>
            <option value="">Rol: quitar</option>
            {d.roles.map((r) => <option key={r} value={r}>Rol: {ROLE_LABEL[r]}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={bulk.valEquipo} onChange={(e) => setBulk({ ...bulk, valEquipo: e.target.value })} aria-label="Valida el equipo">
            {teamOptions('Valida: no cambiar', 'Valida: ninguno')}
          </select>
          <button className="btn sm primary" onClick={apply} disabled={busy || !changes.length}>{busy ? 'Aplicando…' : 'Aplicar'}</button>
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
              <th>Equipo</th>
              <th>Rol</th>
              <th>Valida</th>
              <th>Perfil de solicitudes</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const prof = names.profile.get(p.profile);
              return (
                <tr key={p.code} className={d.canEdit ? 'clickable' : undefined} onClick={() => d.canEdit && toggle(p.code)}>
                  {d.canEdit && <td><input type="checkbox" checked={sel.has(p.code)} onChange={() => toggle(p.code)} onClick={(e) => e.stopPropagation()} aria-label={`Seleccionar ${p.code}`} /></td>}
                  <td className="mono small">{p.code}</td>
                  <td className="small">
                    {p.name}
                    {!p.active && <span className="tag outline" style={{ marginLeft: 6 }}>De baja</span>}
                    {p.workflowRol && !p.email && <span className="tag warn" style={{ marginLeft: 6 }} title="Sin email en la ficha (EM_WFEM): no recibirá los avisos del Workflow">Sin email</span>}
                  </td>
                  <td className="small">{p.equipo ? names.team.get(p.equipo) || p.equipo : <span className="muted">—</span>}</td>
                  <td><RoleTag rol={p.workflowRol} /></td>
                  <td className="small">{p.valEquipo ? names.team.get(p.valEquipo) || p.valEquipo : <span className="muted">—</span>}</td>
                  <td className="small">
                    {p.profile ? <><b className="mono">{p.profile}</b> {prof?.name || ''}{prof && !prof.dyn && p.workflowRol && <span className="tag warn" style={{ marginLeft: 6 }}>Pendiente</span>}</> : <span className="muted">Sin perfil</span>}
                  </td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={7} className="muted small" style={{ padding: 28, textAlign: 'center' }}>Nadie coincide con los filtros.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="ev-foot xs muted">
        Marca personas y cambia su equipo, su rol o el equipo que validan. Al aplicar, Prime Suite crea o reutiliza el perfil de Workflow de cada combinación de equipo y rol,
        pone como autorizadores de nivel 1 a quienes validan su equipo y borra los perfiles que se quedan sin nadie. También se cambia desde la ficha de cada persona en Personal.
      </div>
    </div>
  );
}

// ---------- Equipos ----------
function TeamsTab({ d, onChanged }: { d: Required<EvalosWorkflowResponse>; onChanged: () => void }) {
  const names = useNames(d);
  const [edit, setEdit] = useState<EvalosEquipo | 'new' | null>(null);
  const stats = useMemo(() => {
    const m = new Map<string, { members: number; validators: string[]; profiles: number }>();
    const get = (c: string) => { let x = m.get(c); if (!x) { x = { members: 0, validators: [], profiles: 0 }; m.set(c, x); } return x; };
    for (const p of d.people) {
      if (p.equipo && p.active) get(p.equipo).members++;
      if (p.valEquipo && p.active) get(p.valEquipo).validators.push(p.code);
    }
    for (const pr of d.profiles) if (pr.dyn?.equipo) get(pr.dyn.equipo).profiles++;
    return m;
  }, [d]);
  return (
    <div className="card flat">
      <div className="ev-toolbar">
        <b className="small">{d.equipos.length} equipo(s)</b>
        {d.engine === 'demo' && <span className="tag outline">Datos de demostración</span>}
        <span className="grow" />
        {d.canEdit && <button className="btn primary sm" onClick={() => setEdit('new')}><Icon.plus /> Nuevo equipo</button>}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th style={{ width: 140 }}>Código</th><th>Nombre</th><th style={{ textAlign: 'right' }}>Personas</th><th>Lo validan (nivel 1)</th><th style={{ textAlign: 'right' }}>Perfiles</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {d.equipos.map((e) => {
              const s = stats.get(e.code);
              return (
                <tr key={e.code} className="clickable" onClick={() => setEdit(e)}>
                  <td className="mono"><b>{e.code}</b></td>
                  <td>{e.name}</td>
                  <td style={{ textAlign: 'right' }}><b className="small">{s?.members || 0}</b></td>
                  <td className="small">{s?.validators.length ? s.validators.map((c) => names.person.get(c) || c).join(', ') : <span className="tag warn">Nadie</span>}</td>
                  <td style={{ textAlign: 'right' }} className="small">{s?.profiles || 0}</td>
                  <td className="muted">{d.canEdit ? <Icon.edit /> : <Icon.eye />}</td>
                </tr>
              );
            })}
            {!d.equipos.length && <tr><td colSpan={6} className="muted small" style={{ padding: 28, textAlign: 'center' }}>No hay equipos. Crea el primero con «Nuevo equipo».</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="ev-foot xs muted">Las solicitudes de las personas de un equipo las aprueban (nivel 1) quienes tienen ese equipo en «Valida». Un equipo solo se puede borrar si nadie lo tiene asignado.</div>
      {edit && <TeamModal d={d} team={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onChanged={() => { setEdit(null); onChanged(); }} />}
    </div>
  );
}

function TeamModal({ d, team, onClose, onChanged }: { d: Required<EvalosWorkflowResponse>; team: EvalosEquipo | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState(team?.code || '');
  const [name, setName] = useState(team?.name || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ro = !d.canEdit;
  const max = Math.min(20, ...[d.limits.equipo, d.limits.valEquipo].filter((x): x is number => typeof x === 'number'));
  const members = team ? d.people.filter((p) => p.equipo === team.code && p.active) : [];
  const validators = team ? d.people.filter((p) => p.valEquipo === team.code && p.active) : [];
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = team
        ? await api.put<{ workflowSync: EvalosWorkflowSync | null }>(`/api/evalos/workflow/equipos/${encodeURIComponent(team.code)}`, { name })
        : await api.post<{ workflowSync: EvalosWorkflowSync | null }>('/api/evalos/workflow/equipos', { code, name });
      toast(team ? 'Equipo guardado' : `Equipo ${code.toUpperCase()} creado`);
      workflowToast(toast, r.workflowSync, { quiet: true });
      onChanged();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  async function remove() {
    if (!team || !confirmAction(`¿Eliminar el equipo ${team.code}?`)) return;
    setBusy(true); setErr(null);
    try { await api.del(`/api/evalos/workflow/equipos/${encodeURIComponent(team.code)}`); toast(`Equipo ${team.code} eliminado`); onChanged(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title={team ? `Equipo ${team.code}` : 'Nuevo equipo'} onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={save}>
        <ErrorBox error={err} />
        <div className="grid-2" style={{ gap: 12 }}>
          <label className="field">Código
            <span className="hint">{team ? 'No se puede cambiar.' : `Letras, números, guion y guion bajo; máximo ${max}.`}</span>
            <input className="input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} maxLength={max} required disabled={!!team || ro} autoFocus={!team} />
          </label>
          <label className="field">Nombre
            <span className="hint">Aparece en la descripción de sus perfiles de Workflow.</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required disabled={ro} autoFocus={!!team} />
          </label>
        </div>
        {team && (
          <div className="grid-2" style={{ gap: 12 }}>
            <div className="col" style={{ gap: 4 }}>
              <b className="small">Personas ({members.length})</b>
              <span className="small">{members.length ? members.map((p) => p.name).join(', ') : <span className="muted">Nadie</span>}</span>
            </div>
            <div className="col" style={{ gap: 4 }}>
              <b className="small">Lo validan ({validators.length})</b>
              <span className="small">{validators.length ? validators.map((p) => p.name).join(', ') : <span className="muted">Nadie: sus solicitudes no tienen autorizador de nivel 1</span>}</span>
            </div>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          {!ro && <button className="btn primary" disabled={busy || !code || !name.trim()}>{busy ? 'Guardando…' : 'Guardar'}</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Cerrar</button>
          <span className="grow" />
          {team && d.canDelete && <button type="button" className="btn danger" onClick={remove} disabled={busy}><Icon.trash /> Eliminar</button>}
        </div>
      </form>
    </Modal>
  );
}

// ---------- Perfiles ----------
function ProfilesTab({ d, onChanged }: { d: Required<EvalosWorkflowResponse>; onChanged: () => void }) {
  const names = useNames(d);
  const [edit, setEdit] = useState<EvalosWfProfile | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const dyn = d.profiles.filter((p) => p.dyn).sort((a, b) => a.name.localeCompare(b.name));
  const others = d.profiles.filter((p) => !p.dyn);
  const active = (p: EvalosWfProfile) => d.requests.filter((r) => p.orders[r.col]).length;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card flat">
        <div className="ev-toolbar"><b className="small">{dyn.length} perfil(es) creados por Prime Suite</b></div>
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
                    <td style={{ textAlign: 'right' }} className="small">{active(p)} de {d.requests.length}</td>
                    <td style={{ textAlign: 'right' }}><b className="small">{p.people}</b></td>
                    <td className="muted">{d.canEdit ? <Icon.edit /> : <Icon.eye />}</td>
                  </tr>
                );
              })}
              {!dyn.length && <tr><td colSpan={8} className="muted small" style={{ padding: 28, textAlign: 'center' }}>Todavía no hay perfiles. Se crean solos al dar un equipo y un rol a las personas (pestaña Personas o ficha de Personal).</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="ev-foot xs muted">El nivel 1 lo calcula Prime Suite (quien valida el equipo). En cada perfil puedes añadir autorizadores en los niveles 2 a 4 y elegir qué solicitudes aparecen y en qué orden se validan.</div>
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
        {showOthers && <div className="ev-foot xs muted">Estos perfiles no los gestiona Prime Suite: se editan en Evalos (Seguridad y perfiles › Workflow). Las plantillas se copian al crear cada perfil nuevo.</div>}
      </div>
      {edit && <ProfileModal d={d} profile={edit} onClose={() => setEdit(null)} onChanged={() => { setEdit(null); onChanged(); }} />}
    </div>
  );
}

/** Ventana de un perfil de Perfiles Workflow (equipos). */
function ProfileModal({ d, profile, onClose, onChanged }: { d: Required<EvalosWorkflowResponse>; profile: EvalosWfProfile; onClose: () => void; onChanged: () => void }) {
  const names = useNames(d);
  const k = profile.dyn!;
  return (
    <ProfileEditorModal profile={profile} people={d.people} requests={d.requests} levelCols={d.levelCols} canEdit={d.canEdit}
      endpoint={`/api/evalos/workflow/perfiles/${encodeURIComponent(profile.code)}`} onClose={onClose} onChanged={onChanged}
      level1Note={`lo calcula Prime Suite: quien valida el equipo ${k.equipo ? names.team.get(k.equipo) || k.equipo : ''}`}
      header={<>
        <span>Equipo: <b>{k.equipo ? names.team.get(k.equipo) || k.equipo : 'Sin equipo'}</b></span>
        <span>Rol: <RoleTag rol={k.rol} /></span>
        {k.valEquipo && <span>Valida: <b>{names.team.get(k.valEquipo) || k.valEquipo}</b></span>}
        <span>Filtro de personal: <span className="mono xs">{profile.filter || (k.rol === 'RRHH' ? 'todo el personal' : 'el de la plantilla')}</span></span>
      </>} />
  );
}

/**
 * Ventana de un perfil (común a Perfiles Workflow y Perfiles Workflow 2): autorizadores de los niveles 2 a 4 y asistente
 * del orden de validación de cada solicitud. El nivel 1 lo calcula Prime Suite.
 */
export function ProfileEditorModal({ profile, people, requests, levelCols, canEdit, endpoint, header, level1Note, onClose, onChanged }: {
  profile: { code: string; name: string; levels: Record<string, string[]>; orders: Record<string, string>; people: number };
  people: { code: string; name: string; active: boolean }[]; requests: { col: string; label: string }[]; levelCols: string[]; canEdit: boolean;
  endpoint: string; header: ReactNode; level1Note: string; onClose: () => void; onChanged: () => void;
}) {
  const toast = useToast();
  const d = { levelCols, requests, people };
  const personName = useMemo(() => new Map(people.map((p) => [p.code, p.name])), [people]);
  const ro = !canEdit;
  const [levels, setLevels] = useState<Record<string, string[]>>(() => Object.fromEntries(d.levelCols.map((c) => [c, [...(profile.levels[c] || [])]])));
  const [orders, setOrders] = useState<Record<string, string>>(() => ({ ...profile.orders }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const emptyLevels = d.levelCols.map((c, i) => (levels[c].length ? 0 : i + 1)).filter(Boolean);
  const alerts = d.requests.flatMap((r) => {
    const o = orders[r.col];
    if (!o || o === '0') return [];
    const miss = o.split(',').map(Number).filter((n) => emptyLevels.includes(n));
    return miss.length ? [`${r.label}: pasa por el nivel ${miss.join(' y ')}, que no tiene autorizadores.`] : [];
  });
  const dirty = JSON.stringify(levels) !== JSON.stringify(Object.fromEntries(d.levelCols.map((c) => [c, profile.levels[c] || []]))) || JSON.stringify(orders) !== JSON.stringify(profile.orders);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await api.put<{ alerts: string[] }>(endpoint, {
        levels: Object.fromEntries(d.levelCols.slice(1).map((c) => [c, levels[c]])), orders
      });
      toast(`Perfil ${profile.code} guardado en Evalos`);
      for (const a of r.alerts) toast(a, true);
      onChanged();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  /** Copia el orden de una solicitud a todas las que aparecen. */
  function copyToAll(col: string) {
    const o = orders[col];
    setOrders(Object.fromEntries(d.requests.map((r) => [r.col, orders[r.col] ? o : orders[r.col]])));
  }

  return (
    <Modal title={`Perfil ${profile.code} · ${profile.name}`} onClose={onClose} width={900}>
      <div className="col" style={{ gap: 16 }}>
        <ErrorBox error={err} />
        <div className="row wrap small" style={{ gap: 14 }}>
          {header}
          <span>{profile.people} persona(s)</span>
        </div>

        <div className="col" style={{ gap: 10 }}>
          <h3 style={{ margin: 0 }}>Autorizadores por nivel</h3>
          <span className="xs muted">En cada nivel basta con que valide una de las personas.</span>
          {d.levelCols.map((c, i) => (
            <div key={c} className="row wrap" style={{ gap: 8, alignItems: 'flex-start' }}>
              <b className="small" style={{ minWidth: 70, paddingTop: 6 }}>Nivel {i + 1}</b>
              <div className="col grow" style={{ gap: 6 }}>
                {i === 0
                  ? <span className="small">{levels[c].length ? levels[c].map((x) => personName.get(x) || x).join(', ') : <span className="tag warn">Nadie</span>} <span className="xs muted">· {level1Note}</span></span>
                  : <PeoplePicker people={d.people} value={levels[c]} onChange={(v) => setLevels({ ...levels, [c]: v })} disabled={ro} />}
              </div>
            </div>
          ))}
        </div>

        <div className="col" style={{ gap: 10 }}>
          <h3 style={{ margin: 0 }}>Solicitudes y orden de validación</h3>
          <span className="xs muted">Marca las solicitudes que aparecen y pulsa los niveles en el orden en que tienen que validar. «Sin validación» la aprueba directamente.</span>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 40 }}>Ver</th><th>Solicitud</th><th>Orden de validación</th>{!ro && <th style={{ width: 180 }} />}</tr></thead>
              <tbody>
                {d.requests.map((r) => (
                  <OrderRow key={r.col} label={r.label} value={orders[r.col] || ''} emptyLevels={emptyLevels} ro={ro}
                    onChange={(v) => setOrders({ ...orders, [r.col]: v })} onCopyAll={() => copyToAll(r.col)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {!!alerts.length && <div className="alert warn small col" style={{ gap: 4 }}>{alerts.map((a, i) => <span key={i}>{a}</span>)}</div>}
        <div className="row" style={{ gap: 8 }}>
          {!ro && <button className="btn primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Guardando…' : 'Guardar en Evalos'}</button>}
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </Modal>
  );
}

/** Fila del asistente de orden: disponible, sin validación o la secuencia de niveles (p. ej. 1 → 2). */
export function OrderRow({ label, value, emptyLevels, ro, onChange, onCopyAll }: {
  label: string; value: string; emptyLevels: number[]; ro: boolean; onChange: (v: string) => void; onCopyAll: () => void;
}) {
  const on = value !== '';
  const direct = value === '0';
  const seq = on && !direct ? value.split(',').map(Number) : [];
  const add = (n: number) => onChange([...seq, n].join(','));
  const removeAt = (i: number) => { const s = seq.filter((_, j) => j !== i); onChange(s.length ? s.join(',') : '0'); };
  return (
    <tr>
      <td><input type="checkbox" checked={on} disabled={ro} onChange={(e) => onChange(e.target.checked ? '1' : '')} aria-label={`Mostrar ${label}`} /></td>
      <td className="small" style={{ opacity: on ? 1 : 0.55 }}>{label}</td>
      <td>
        {!on ? <span className="xs muted">No aparece</span> : (
          <div className="row wrap" style={{ gap: 6 }}>
            <label className="row xs" style={{ gap: 4, fontWeight: 400 }}>
              <input type="checkbox" checked={direct} disabled={ro} onChange={(e) => onChange(e.target.checked ? '0' : '1')} /> Sin validación
            </label>
            {!direct && seq.map((n, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="muted xs">→</span>}
                <button type="button" className={`tag ${emptyLevels.includes(n) ? 'warn' : 'info'}`} style={{ cursor: ro ? 'default' : 'pointer', border: 0 }} disabled={ro}
                  title={ro ? undefined : 'Quitar este nivel'} onClick={() => removeAt(i)}>Nivel {n}{!ro && ' ×'}</button>
              </Fragment>
            ))}
            {!direct && !ro && [1, 2, 3, 4].filter((n) => !seq.includes(n)).map((n) => (
              <button key={n} type="button" className="btn xs ghost" onClick={() => add(n)} title={emptyLevels.includes(n) ? 'Este nivel aún no tiene autorizadores' : undefined}>+ {n}</button>
            ))}
          </div>
        )}
      </td>
      {!ro && <td>{on && <button type="button" className="btn xs ghost" onClick={onCopyAll} title="Pone este mismo orden en todas las solicitudes que aparecen">Aplicar a todas</button>}</td>}
    </tr>
  );
}

/** Lista de personas: chips con el nombre y buscador para añadir. */
export function PeoplePicker({ people, value, onChange, disabled, exclude }: { people: { code: string; name: string; active: boolean }[]; value: string[]; onChange: (v: string[]) => void; disabled: boolean; exclude?: string }) {
  const [q, setQ] = useState('');
  const byCode = useMemo(() => new Map(people.map((p) => [p.code, p])), [people]);
  const needle = q.trim().toLowerCase();
  const hits = needle ? people.filter((p) => p.active && p.code !== exclude && !value.includes(p.code) && (p.code.includes(needle) || p.name.toLowerCase().includes(needle))).slice(0, 8) : [];
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        {value.map((c) => (
          <span key={c} className="tag outline">
            {byCode.get(c)?.name || c}
            {!disabled && <button type="button" aria-label={`Quitar ${c}`} style={{ background: 'none', border: 0, cursor: 'pointer', padding: '0 0 0 4px', color: 'inherit' }} onClick={() => onChange(value.filter((x) => x !== c))}>×</button>}
          </span>
        ))}
        {!value.length && <span className="xs muted">Sin autorizadores</span>}
      </div>
      {!disabled && (
        <div style={{ position: 'relative', maxWidth: 360 }}>
          <input className="input" placeholder="Añadir persona: busca por código o nombre" value={q} onChange={(e) => setQ(e.target.value)} />
          {!!hits.length && (
            <div className="card" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, top: '100%', marginTop: 4, padding: 4, gap: 0 }}>
              {hits.map((p) => (
                <button key={p.code} type="button" className="row small" style={{ gap: 8, background: 'none', border: 0, padding: '6px 8px', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                  onClick={() => { onChange([...value, p.code]); setQ(''); }}>
                  <span className="mono xs muted">{p.code}</span> {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Ajustes ----------
function SettingsTab({ d, onChanged }: { d: Required<EvalosWorkflowResponse>; onChanged: () => void }) {
  return <SettingsForm settings={d.settings} roles={d.roles} profiles={d.profiles} endpoint="/api/evalos/workflow/ajustes" mode={d.mode} canConfigure={d.canConfigure} onChanged={onChanged} />;
}

/** Ajustes (común a las dos opciones): plantilla de cada rol, prefijo de los códigos y opción activa. */
export function SettingsForm({ settings, roles, profiles, endpoint, mode, canConfigure, onChanged }: {
  settings: { templates: Record<EvalosWfRole, string>; prefix: string }; roles: EvalosWfRole[]; profiles: { code: string; name: string; dyn: unknown }[];
  endpoint: string; mode: EvalosWfMode; canConfigure: boolean; onChanged: () => void;
}) {
  const toast = useToast();
  const d = { roles };
  const [templates, setTemplates] = useState<Record<EvalosWfRole, string>>({ ...settings.templates });
  const [prefix, setPrefix] = useState(settings.prefix);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const candidates = profiles.filter((p) => !p.dyn);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api.put(endpoint, { templates, prefix }); toast('Ajustes guardados'); onChanged(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }
  return (
    <form className="card col" style={{ gap: 14 }} onSubmit={save}>
      <ErrorBox error={err} />
      <span className="small muted">
        Cada perfil nuevo se crea copiando la plantilla de su rol (permisos, historial visible, adjuntos, mensajería…). Prime Suite solo cambia la descripción,
        los autorizadores, el filtro de personal de responsables y RR.HH. y, si la plantilla las deja vacías, pone todas las solicitudes con un nivel.
        Los cambios de plantilla se aplican a los perfiles que se creen a partir de ahora.
      </span>
      <div className="grid-2" style={{ gap: 12 }}>
        {d.roles.map((r) => (
          <label key={r} className="field">Plantilla {ROLE_LABEL[r]}
            <select className="select" value={templates[r]} onChange={(e) => setTemplates({ ...templates, [r]: e.target.value })}>
              {!candidates.some((p) => p.code === templates[r]) && <option value={templates[r]}>{templates[r]} (no existe en WORKFLOW)</option>}
              {candidates.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}
            </select>
          </label>
        ))}
        <label className="field">Prefijo de los códigos
          <span className="hint">Una letra: los perfiles se numeran {prefix || 'P'}01, {prefix || 'P'}02… (WF_CODI admite 3 caracteres).</span>
          <input className="input mono" value={prefix} maxLength={1} onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} required />
        </label>
      </div>
      <div className="row"><button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar ajustes'}</button></div>
      <ModeBanner mode={mode} canConfigure={canConfigure} onChanged={onChanged} inSettings />
    </form>
  );
}

const MODE_LABEL: Record<EvalosWfMode, string> = { equipos: 'Perfiles Workflow (equipos)', departamentos: 'Perfiles Workflow 2 (departamentos)' };
/**
 * Opción activa: solo una de las dos asigna los perfiles (EM_WFOP). Se muestra en las dos pantallas; desde Ajustes
 * (o el aviso) un administrador cambia de opción: se recalcula con la nueva y se borran los perfiles de la otra que se quedan sin nadie.
 */
export function ModeBanner({ mode, here, canConfigure, onChanged, inSettings }: { mode: EvalosWfMode; here?: EvalosWfMode; canConfigure: boolean; onChanged: () => void; inSettings?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const target: EvalosWfMode = here ?? (mode === 'equipos' ? 'departamentos' : 'equipos');
  if (!inSettings && here && mode === here) return null;
  async function activate() {
    if (!confirmAction(`Se activará ${MODE_LABEL[target]}: se recalcularán los perfiles de Workflow de todas las personas con rol con esta opción y se borrarán los perfiles de la otra opción que se queden sin nadie. ¿Continuar?`)) return;
    setBusy(true);
    try {
      const r = await api.put<{ workflowSync: EvalosWorkflowSync }>('/api/evalos/workflow/modo', { mode: target });
      toast(`Opción activa: ${MODE_LABEL[target]}`);
      workflowToast(toast, r.workflowSync);
      onChanged();
    } catch (e: any) { toast(e.message, true); }
    finally { setBusy(false); }
  }
  return (
    <div className={`alert ${inSettings ? 'info' : 'warn'} row wrap`} style={{ gap: 10 }}>
      <span className="grow small">
        Opción activa: <b>{MODE_LABEL[mode]}</b>.{' '}
        {!inSettings && 'Esta pantalla no asigna perfiles mientras no esté activa: puedes preparar la configuración y ver cómo quedarían.'}
      </span>
      {canConfigure && (
        <button type="button" className="btn sm" onClick={activate} disabled={busy}>{busy ? 'Activando…' : `Activar ${MODE_LABEL[target]}`}</button>
      )}
    </div>
  );
}

// ---------- Faltan las tablas en la BD de Evalos ----------
export function MissingTables({ missing, onRetry, fileName = 'PS_PERFILES_WORKFLOW.sql', what = 'Los equipos y el registro de los perfiles que crea Prime Suite se guardan' }: { missing: { message: string; script: string }; onRetry: () => void; fileName?: string; what?: string }) {
  const toast = useToast();
  async function copy() {
    try { await navigator.clipboard.writeText(missing.script); toast('Script copiado'); }
    catch { toast('No se pudo copiar: selecciona el texto y cópialo a mano', true); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([missing.script], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="card col" style={{ gap: 12 }}>
      <h3 style={{ margin: 0 }}>Falta preparar la base de datos</h3>
      <div className="alert warn">{missing.message}</div>
      <span className="small muted">
        {what} en dos tablas nuevas de la base de datos de Evalos 8. Ejecuta este script en SQL Server
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

// ---------- Widget ----------
export function WorkflowWidget() {
  const { data, error } = useWorkflow();
  if (error) return error;
  if (!data) return <Loading />;
  if (data.missing) return <span className="small muted">Falta crear las tablas de Perfiles Workflow en la base de datos de Evalos 8. Abre la pantalla para ver el script.</span>;
  const d = data as Required<EvalosWorkflowResponse>;
  const noValidator = d.equipos.filter((e) => !d.people.some((p) => p.active && p.valEquipo === e.code)).length;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <div className="card grow" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Equipos</span><span className="stat">{d.equipos.length}</span></div>
        <div className="card grow" style={{ gap: 2, padding: '12px 14px' }}><span className="xs muted" style={{ fontWeight: 600 }}>Personas con rol</span><span className="stat">{d.people.filter((p) => p.workflowRol).length}</span></div>
      </div>
      {noValidator > 0 && <span className="small" style={{ color: 'var(--warn-ink, #B45309)' }}>{noValidator} equipo(s) sin nadie que valide sus solicitudes</span>}
      {hasChanges(d.pending) && <span className="small muted">Hay cambios de perfiles pendientes de aplicar.</span>}
    </div>
  );
}
