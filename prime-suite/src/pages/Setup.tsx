import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Logo } from '../components/ui';

export default function Setup() {
  const { refresh } = useSession();
  const [f, setF] = useState({ companyName: 'Primion', companyCode: 'pri5', firstName: '', lastName: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/setup', f);
      await refresh();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" style={{ width: 'min(520px, 100%)' }} onSubmit={submit}>
        <div className="row" style={{ gap: 12 }}>
          <span style={{ background: '#24222B', borderRadius: 10, padding: 7, display: 'grid' }}><Logo /></span>
          <div>
            <h2>Configurar Prime Suite</h2>
            <span className="xs muted">Primera puesta en marcha: crea la empresa principal y el superadministrador</span>
          </div>
        </div>
        {error && <div className="alert error">{error}</div>}
        <div className="grid-2">
          <label className="field">Empresa<input className="input" value={f.companyName} onChange={set('companyName')} required /></label>
          <label className="field">Código (tenant)<input className="input mono" value={f.companyCode} onChange={set('companyCode')} pattern="[a-z0-9\-]{2,32}" required /></label>
          <label className="field">Nombre<input className="input" value={f.firstName} onChange={set('firstName')} required /></label>
          <label className="field">Apellidos<input className="input" value={f.lastName} onChange={set('lastName')} /></label>
        </div>
        <label className="field">Email<input className="input" type="email" value={f.email} onChange={set('email')} required /></label>
        <label className="field">Contraseña<span className="hint">Mínimo 10 caracteres</span><input className="input" type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={set('password')} required /></label>
        <div className="alert info small">Se crearán las categorías (Analytics, People, Performance, Security, Otros), los módulos actuales de Prime Suite y dos apps de demostración para probar el SSO.</div>
        <button className="btn primary" disabled={busy}>{busy ? 'Configurando…' : 'Crear y entrar'}</button>
      </form>
    </div>
  );
}
