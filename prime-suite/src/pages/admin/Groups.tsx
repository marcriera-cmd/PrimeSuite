import { useEffect, useState } from 'react';
import { api, type AdminModule, type Company, type Group, type ModuleRole } from '../../api';
import { useSession } from '../../session';
import { AppIcon, ErrorBox, Icon, Loading, confirmAction, useData, useToast } from '../../components/ui';

const ROLES: { v: ModuleRole | ''; l: string }[] = [{ v: '', l: 'Sin acceso extra' }, { v: 'viewer', l: 'Lectura' }, { v: 'user', l: 'Usuario' }, { v: 'admin', l: 'Administrador' }];

export default function Groups() {
  const { me } = useSession();
  const toast = useToast();
  const [companyId, setCompanyId] = useState(me?.company.id || '');
  const { data: companies } = useData(() => api.get<Company[]>('/api/admin/companies'));
  const { data: modules } = useData(() => api.get<AdminModule[]>('/api/admin/modules'));
  const { data: groups, error, reload } = useData(() => api.get<Group[]>(`/api/admin/groups?companyId=${companyId}`), [companyId]);
  const [sel, setSel] = useState<Group | null>(null);
  const [draft, setDraft] = useState<Group | null>(null);

  useEffect(() => setDraft(sel ? JSON.parse(JSON.stringify(sel)) : null), [sel]);
  const company = companies?.find((c) => c.id === companyId);
  const visibleModules = (modules || []).filter((m) => !company || company.enabledModules.includes(m.id));

  async function save() {
    if (!draft) return;
    try {
      const body = { name: draft.name, description: draft.description, moduleRoles: draft.moduleRoles, companyId: draft.companyId };
      const g = draft.id ? await api.put<Group>(`/api/admin/groups/${draft.id}`, body) : await api.post<Group>('/api/admin/groups', body);
      toast('Grupo guardado');
      reload();
      setSel(g);
    } catch (e: any) {
      toast(e.message, true);
    }
  }
  async function remove() {
    if (!draft?.id || !confirmAction(`¿Eliminar el grupo "${draft.name}"? Sus miembros perderán los permisos que da.`)) return;
    await api.del(`/api/admin/groups/${draft.id}`);
    toast('Grupo eliminado');
    setSel(null);
    reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Grupos y permisos</h1>
          <span className="muted small">Cada grupo da un rol en cada aplicación. Un usuario recibe el rol más alto de sus grupos.</span>
        </div>
        <div className="row">
          {me?.isSuper && companies && (
            <select className="select" style={{ width: 220 }} value={companyId} onChange={(e) => { setCompanyId(e.target.value); setSel(null); }} aria-label="Empresa">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button className="btn primary" onClick={() => setSel({ id: '', companyId, name: 'Nuevo grupo', description: '', moduleRoles: {} })}><Icon.plus /> Nuevo grupo</button>
        </div>
      </div>
      <ErrorBox error={error} />
      {!groups && !error && <Loading />}
      {groups && (
        <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div className="card flat" style={{ width: 320, flexShrink: 0 }}>
            <table className="table">
              <thead><tr><th>Grupo</th><th>Miembros</th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className={`clickable ${sel?.id === g.id ? 'selected' : ''}`} onClick={() => setSel(g)}>
                    <td><b className="small">{g.name}</b>{g.companyId === null && <span className="tag" style={{ marginLeft: 6 }}>Global</span>}<div className="xs muted">{g.description}</div></td>
                    <td>{g.memberCount}</td>
                  </tr>
                ))}
                {!groups.length && <tr><td colSpan={2} className="muted small" style={{ padding: 20 }}>Sin grupos</td></tr>}
              </tbody>
            </table>
          </div>
          {draft ? (
            <div className="card grow" style={{ minWidth: 360 }}>
              <div className="grid-2">
                <label className="field">Nombre<input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                <label className="field">Descripción<input className="input" value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
              </div>
              {me?.isSuper && !draft.id && (
                <label className="check"><input type="checkbox" checked={draft.companyId === null} onChange={(e) => setDraft({ ...draft, companyId: e.target.checked ? null : companyId })} /> Grupo global (disponible en todas las empresas)</label>
              )}
              <h3>Rol en cada aplicación</h3>
              <div className="card flat">
                <table className="table">
                  <tbody>
                    {visibleModules.map((m) => (
                      <tr key={m.id}>
                        <td><div className="row"><AppIcon initials={m.initials} color={m.color} size={28} /><span className="small">{m.name}</span></div></td>
                        <td style={{ width: 220 }}>
                          <select className="select" value={draft.moduleRoles[m.id] || ''} aria-label={`Rol en ${m.name}`} onChange={(e) => {
                            const mr = { ...draft.moduleRoles };
                            if (e.target.value) mr[m.id] = e.target.value as ModuleRole;
                            else delete mr[m.id];
                            setDraft({ ...draft, moduleRoles: mr });
                          }}>
                            {ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
                          </select>
                        </td>
                        <td className="xs muted" style={{ width: 170 }}>{m.defaultRole ? `Por defecto: ${ROLES.find((r) => r.v === m.defaultRole)?.l}` : 'Sin acceso por defecto'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row">
                <button className="btn primary" onClick={save}>Guardar grupo</button>
                {draft.id && <button className="btn danger" onClick={remove}><Icon.trash /> Eliminar</button>}
              </div>
            </div>
          ) : (
            <div className="empty grow">Selecciona un grupo para editar sus permisos</div>
          )}
        </div>
      )}
    </>
  );
}
