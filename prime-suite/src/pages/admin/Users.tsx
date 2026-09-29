import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, fmtDate, initialsOf, PORTAL_ROLE_LABEL, ROLE_LABEL, type AdminUser, type Company, type Group, type ModuleRole } from '../../api';
import { useSession } from '../../session';
import { AppIcon, Drawer, ErrorBox, Icon, Loading, confirmAction, useData, useToast } from '../../components/ui';

const STATUS = { active: ['Activo', 'ok'], pending: ['Pendiente', 'warn'], disabled: ['Desactivado', 'outline'] } as const;

export default function Users() {
  const { me } = useSession();
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const { data: companies } = useData(() => api.get<Company[]>('/api/admin/companies'));
  const { data: users, error, reload } = useData(
    () => api.get<AdminUser[]>(`/api/admin/users?${new URLSearchParams({ ...(companyId && { companyId }), ...(status && { status }) })}`),
    [companyId, status]
  );
  const list = useMemo(() => (users || []).filter((u) => !q || `${u.firstName} ${u.lastName} ${u.email} ${u.username || ''}`.toLowerCase().includes(q.toLowerCase())), [users, q]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Usuarios</h1>
          <span className="muted small">Un solo usuario de Prime Suite para todas las aplicaciones. Los permisos vienen de sus grupos.</span>
        </div>
        <button className="btn primary" onClick={() => setOpen('new')}><Icon.plus /> Nuevo usuario</button>
      </div>
      <div className="row wrap">
        <div className="tabs" style={{ border: 0 }}>
          {[['', 'Todos'], ['active', 'Activos'], ['pending', 'Solicitudes pendientes'], ['disabled', 'Desactivados']].map(([v, l]) => (
            <button key={v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>{l}</button>
          ))}
        </div>
        {me?.isSuper && companies && (
          <select className="select" style={{ width: 220 }} value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Empresa">
            <option value="">Todas las empresas</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <label className="search" style={{ marginLeft: 'auto' }}><Icon.search /><input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar usuario" /></label>
      </div>
      <ErrorBox error={error} />
      {!users && !error && <Loading />}
      {users && (
        <div className="card flat table-wrap">
          <table className="table">
            <thead><tr><th>Usuario</th><th>Empresa</th><th>Rol</th><th>Grupos</th><th>Estado</th><th>Último acceso</th></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => setOpen(u.id)}>
                  <td>
                    <div className="row">
                      <span className="avatar" style={{ width: 32, height: 32, background: '#EDEBE6', color: 'var(--ink)' }}>{initialsOf(u.firstName, u.lastName)}</span>
                      <div className="col" style={{ gap: 0 }}>
                        <button className="btn ghost" style={{ padding: 0, justifyContent: 'flex-start', fontWeight: 600 }} onClick={() => setOpen(u.id)}>{u.firstName} {u.lastName}</button>
                        <span className="xs muted">{u.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>{u.companyName}</td>
                  <td>{PORTAL_ROLE_LABEL[u.role]}</td>
                  <td className="small">{u.groups?.join(', ') || <span className="muted">—</span>}</td>
                  <td><span className={`tag ${STATUS[u.status][1]}`}>{STATUS[u.status][0]}</span></td>
                  <td className="small muted">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'Nunca'}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 28 }}>Sin usuarios</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {open && companies && <UserDrawer id={open} companies={companies} onClose={() => setOpen(null)} onSaved={() => { reload(); }} />}
    </>
  );
}

interface Detail {
  user: AdminUser;
  access: { moduleId: string; name: string; initials: string; color: string; role: ModuleRole | null; enabledForCompany: boolean }[];
}

function UserDrawer({ id, companies, onClose, onSaved }: { id: string; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const { me } = useSession();
  const toast = useToast();
  const isNew = id === 'new';
  const [detail, setDetail] = useState<Detail | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [f, setF] = useState({ companyId: me!.company.id, firstName: '', lastName: '', email: '', username: '', role: 'user', status: 'active', groupIds: [] as string[], password: '' });
  const [error, setError] = useState<string | null>(null);

  const loadDetail = () => api.get<Detail>(`/api/admin/users/${id}`).then((d) => {
    setDetail(d);
    const u = d.user;
    setF({ companyId: u.companyId, firstName: u.firstName, lastName: u.lastName, email: u.email, username: u.username || '', role: u.role, status: u.status, groupIds: u.groupIds, password: '' });
  });
  useEffect(() => {
    if (!isNew) loadDetail().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    api.get<Group[]>(`/api/admin/groups?companyId=${f.companyId}`).then(setGroups).catch(() => {});
  }, [f.companyId]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload = { ...f, password: f.password || undefined };
      if (isNew) await api.post('/api/admin/users', payload);
      else await api.put(`/api/admin/users/${id}`, payload);
      toast(isNew ? 'Usuario creado' : 'Usuario actualizado');
      onSaved();
      if (isNew) onClose();
      else loadDetail();
    } catch (err: any) {
      setError(err.message);
    }
  }
  async function action(kind: 'approve' | 'revoke' | 'delete') {
    try {
      if (kind === 'delete') {
        if (!confirmAction('¿Eliminar este usuario? Perderá el acceso a todas las aplicaciones.')) return;
        await api.del(`/api/admin/users/${id}`);
        toast('Usuario eliminado');
        onSaved();
        onClose();
        return;
      }
      await api.post(`/api/admin/users/${id}/${kind === 'approve' ? 'approve' : 'revoke-sessions'}`);
      toast(kind === 'approve' ? 'Usuario aprobado' : 'Sesiones cerradas en todas las aplicaciones');
      onSaved();
      loadDetail();
    } catch (err: any) {
      toast(err.message, true);
    }
  }

  if (!isNew && !detail && !error) return <Drawer title={<h2>Usuario</h2>} onClose={onClose}><Loading /></Drawer>;
  const self = detail?.user.id === me?.user.id;

  return (
    <Drawer title={<h2>{isNew ? 'Nuevo usuario' : `${f.firstName} ${f.lastName}`}</h2>} onClose={onClose}>
      <ErrorBox error={error} />
      {detail?.user.status === 'pending' && (
        <div className="alert warn row"><span className="grow">Solicitud de alta pendiente</span><button className="btn sm success" onClick={() => action('approve')}>Aprobar</button></div>
      )}
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        {me?.isSuper && (
          <label className="field">Empresa
            <select className="select" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value, groupIds: [] })}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <div className="grid-2">
          <label className="field">Nombre<input className="input" value={f.firstName} onChange={set('firstName')} required /></label>
          <label className="field">Apellidos<input className="input" value={f.lastName} onChange={set('lastName')} /></label>
          <label className="field">Email<input className="input" type="email" value={f.email} onChange={set('email')} required /></label>
          <label className="field">Usuario (opcional)<input className="input" value={f.username} onChange={set('username')} /></label>
          <label className="field">Rol en el portal
            <select className="select" value={f.role} onChange={set('role')} disabled={self}>
              <option value="user">Usuario</option>
              <option value="admin">Administrador de empresa</option>
              {me?.isSuper && <option value="superadmin">Superadministrador</option>}
            </select>
          </label>
          <label className="field">Estado
            <select className="select" value={f.status} onChange={set('status')} disabled={self}>
              <option value="active">Activo</option><option value="pending">Pendiente</option><option value="disabled">Desactivado</option>
            </select>
          </label>
        </div>
        <div className="field">Grupos
          <div className="row wrap">
            {groups.map((g) => (
              <label key={g.id} className="check tag" style={{ padding: '6px 10px' }}>
                <input type="checkbox" checked={f.groupIds.includes(g.id)} onChange={(e) => setF({ ...f, groupIds: e.target.checked ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id) })} />
                {g.name}{g.companyId === null ? ' (global)' : ''}
              </label>
            ))}
            {!groups.length && <span className="xs muted">No hay grupos en esta empresa.</span>}
          </div>
        </div>
        <label className="field">{isNew ? 'Contraseña' : 'Restablecer contraseña'}<span className="hint">Mínimo 10 caracteres{isNew ? '' : '. Déjalo vacío para no cambiarla; si la cambias se cierran sus sesiones.'}</span>
          <input className="input" type="password" autoComplete="new-password" minLength={10} required={isNew} value={f.password} onChange={set('password')} />
        </label>
        <button className="btn primary" style={{ alignSelf: 'flex-start' }}>{isNew ? 'Crear usuario' : 'Guardar'}</button>
      </form>
      {detail && (
        <>
          <div className="divider" />
          <h3>Acceso efectivo por aplicación</h3>
          <div className="col" style={{ gap: 8 }}>
            {detail.access.map((a) => (
              <div key={a.moduleId} className="row" style={{ paddingBottom: 8, borderBottom: '1px solid var(--line-2)' }}>
                <AppIcon initials={a.initials} color={a.color} size={28} />
                <span className="small grow">{a.name}{!a.enabledForCompany && <span className="xs muted"> · no habilitada para su empresa</span>}</span>
                {a.role ? <span className={`tag ${a.role === 'admin' ? 'dark' : a.role === 'user' ? 'info' : ''}`}>{ROLE_LABEL[a.role]}</span> : <span className="tag outline">Sin acceso</span>}
              </div>
            ))}
          </div>
          <span className="xs muted">Creado {fmtDate(detail.user.createdAt)} · último acceso {detail.user.lastLoginAt ? fmtDate(detail.user.lastLoginAt) : 'nunca'}</span>
          <div className="row wrap">
            <button className="btn" onClick={() => action('revoke')}>Cerrar todas sus sesiones</button>
            {!self && <button className="btn danger" onClick={() => action('delete')}><Icon.trash /> Eliminar</button>}
          </div>
        </>
      )}
    </Drawer>
  );
}
