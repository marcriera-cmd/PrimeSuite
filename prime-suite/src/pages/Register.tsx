import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../components/ui';

export default function Register() {
  const [f, setF] = useState({ companyCode: '', firstName: '', lastName: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/auth/register', f);
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    }
  }
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h2>Solicitar acceso</h2>
        {done ? (
          <div className="alert ok">Solicitud enviada. Un administrador de tu empresa la revisará. <Link to="/login">Volver</Link></div>
        ) : (
          <>
            {error && <div className="alert error">{error}</div>}
            <label className="field">Código de empresa<span className="hint">El identificador de tu empresa (p. ej. pri5). Pídeselo a tu administrador.</span><input className="input mono" value={f.companyCode} onChange={set('companyCode')} required /></label>
            <div className="grid-2">
              <label className="field">Nombre<input className="input" value={f.firstName} onChange={set('firstName')} required /></label>
              <label className="field">Apellidos<input className="input" value={f.lastName} onChange={set('lastName')} /></label>
            </div>
            <label className="field">Email<input className="input" type="email" value={f.email} onChange={set('email')} required /></label>
            <label className="field">Contraseña<span className="hint">Mínimo 10 caracteres</span>
              <span className="pw-wrap">
                <input className="input" type={show ? 'text' : 'password'} minLength={10} value={f.password} onChange={set('password')} required />
                <button type="button" className="pw-toggle" aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShow(!show)}>{show ? <Icon.eyeOff /> : <Icon.eye />}</button>
              </span>
            </label>
            <button className="btn primary">Enviar solicitud</button>
            <span className="small muted">Se creará una solicitud que un administrador debe aprobar antes de que puedas entrar.</span>
            <Link to="/login" className="small">Ya tengo cuenta</Link>
          </>
        )}
      </form>
    </div>
  );
}
