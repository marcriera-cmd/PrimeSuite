import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';
import { Icon, Logo } from '../components/ui';

export default function Login() {
  const { refresh } = useSession();
  const loc = useLocation();
  const next = new URLSearchParams(loc.search).get('next') || '/';
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canRegister, setCanRegister] = useState(true);
  const fromApp = next.startsWith('/oidc/');

  useEffect(() => {
    api.get<{ allowSelfRegistration: boolean }>('/api/settings/public').then((s) => setCanRegister(s.allowSelfRegistration)).catch(() => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { login, password });
      if (fromApp) {
        window.location.replace(next);
        return;
      }
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="row" style={{ gap: 12 }}>
          <span style={{ background: '#24222B', borderRadius: 10, padding: 7, display: 'grid' }}><Logo /></span>
          <div>
            <h2>Prime Suite</h2>
            <span className="xs muted">Inicia sesión una vez y accede a todas tus aplicaciones</span>
          </div>
        </div>
        {fromApp && <div className="alert info">Una aplicación te ha pedido identificarte con Prime ID.</div>}
        {error && <div className="alert error">{error}</div>}
        <label className="field">Email o usuario
          <input className="input" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
        </label>
        <label className="field">Contraseña
          <span className="pw-wrap">
            <input className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" className="pw-toggle" aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShow(!show)}>
              {show ? <Icon.eyeOff /> : <Icon.eye />}
            </button>
          </span>
        </label>
        <button className="btn primary" disabled={busy}>{busy ? 'Entrando…' : 'Iniciar sesión'}</button>
        {canRegister && <span className="small muted">¿No tienes cuenta? <Link to="/registro">Solicitar acceso</Link></span>}
      </form>
    </div>
  );
}
