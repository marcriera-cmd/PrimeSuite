import { useEffect, useState, type FormEvent } from 'react';
import { api, fmtDate, PORTAL_ROLE_LABEL } from '../api';
import { useSession } from '../session';
import { AppIcon, useToast } from '../components/ui';

interface SavedAccess { moduleId: string; username: string; updatedAt: string; name: string; initials?: string; color?: string; iconUrl?: string; iconGlyph?: string }

export default function Profile() {
  const { me } = useSession();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/me/password', { current: cur, next });
      setCur('');
      setNext('');
      toast('Contraseña actualizada. Se han cerrado tus otras sesiones.');
    } catch (err: any) {
      setError(err.message);
    }
  }
  return (
    <>
      <div className="page-head"><div><h1>Mi perfil</h1></div></div>
      <div className="grid-2">
        <div className="card">
          <h3>Datos</h3>
          <table className="table"><tbody>
            <tr><td className="muted">Nombre</td><td>{me.user.firstName} {me.user.lastName}</td></tr>
            <tr><td className="muted">Email</td><td>{me.user.email}</td></tr>
            <tr><td className="muted">Empresa</td><td>{me.company.name} <span className="mono muted">{me.company.code}</span></td></tr>
            <tr><td className="muted">Rol</td><td>{PORTAL_ROLE_LABEL[me.user.role]}</td></tr>
            <tr><td className="muted">Grupos</td><td>{me.groups.map((g) => g.name).join(', ') || '—'}</td></tr>
          </tbody></table>
        </div>
        <form className="card" onSubmit={submit}>
          <h3>Cambiar contraseña</h3>
          {error && <div className="alert error">{error}</div>}
          <label className="field">Contraseña actual<input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} required /></label>
          <label className="field">Nueva contraseña<span className="hint">Mínimo 10 caracteres</span><input className="input" type="password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }}>Guardar</button>
        </form>
      </div>
      <SavedAccesses />
    </>
  );
}

// Credenciales guardadas para entrar automáticamente en aplicaciones sin SSO.
function SavedAccesses() {
  const toast = useToast();
  const [list, setList] = useState<SavedAccess[] | null>(null);
  const load = () => api.get<SavedAccess[]>('/api/portal/credentials').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  if (!list || !list.length) return null;
  return (
    <div className="card flat">
      <div className="col" style={{ gap: 2, padding: '18px 20px 12px' }}>
        <h3>Accesos guardados</h3>
        <span className="xs muted">Aplicaciones sin inicio de sesión único en las que Prime Suite entra por ti. Las contraseñas se guardan cifradas.</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Aplicación</th><th>Usuario</th><th>Guardado</th><th /></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.moduleId}>
                <td><div className="row"><AppIcon initials={a.initials || a.name.slice(0, 2).toUpperCase()} color={a.color || '#243A4D'} iconUrl={a.iconUrl} glyph={a.iconGlyph} size={28} /> {a.name}</div></td>
                <td className="mono">{a.username}</td>
                <td className="small muted">{fmtDate(a.updatedAt)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm danger" onClick={async () => { await api.del(`/api/portal/credentials/${a.moduleId}`); toast(`Acceso a ${a.name} olvidado`); load(); }}>Olvidar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
