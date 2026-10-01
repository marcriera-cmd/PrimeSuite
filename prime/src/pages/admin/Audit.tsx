import { useMemo, useState } from 'react';
import { api, fmtDate } from '../../api';
import { ErrorBox, Icon, Loading, useData } from '../../components/ui';

interface Entry { id: string; at: string; actorEmail: string | null; action: string; target?: string; detail?: string; ip?: string }

const LABEL: Record<string, string> = {
  'auth.login': 'Inicio de sesión', 'auth.login_failed': 'Login fallido', 'auth.logout': 'Cierre de sesión', 'auth.registered': 'Solicitud de alta',
  'sso.prime_token_issued': 'Prime Token emitido', 'sso.oidc_launch': 'Lanzamiento OIDC', 'oidc.authorized': 'OIDC autorizado', 'oidc.token_issued': 'Tokens OIDC emitidos',
  'oidc.access_denied': 'Acceso denegado', 'oidc.logout': 'Logout OIDC', 'setup.completed': 'Configuración inicial'
};

export default function Audit() {
  const { data, error, reload } = useData(() => api.get<Entry[]>('/api/admin/audit?limit=300'));
  const [q, setQ] = useState('');
  const list = useMemo(() => (data || []).filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q.toLowerCase())), [data, q]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Auditoría</h1>
          <span className="muted small">Inicios de sesión, tokens emitidos y cambios de administración.</span>
        </div>
        <div className="row">
          <label className="search"><Icon.search /><input placeholder="Filtrar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrar" /></label>
          <button className="btn" onClick={reload}><Icon.refresh /> Actualizar</button>
        </div>
      </div>
      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && (
        <div className="card flat table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Objeto</th><th>IP</th></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.at)}</td>
                  <td className="small">{e.actorEmail || '—'}</td>
                  <td><span className={`tag ${e.action.includes('failed') || e.action.includes('denied') ? 'bad' : e.action.startsWith('sso') || e.action.startsWith('oidc') ? 'ok' : ''}`}>{LABEL[e.action] || e.action}</span></td>
                  <td className="small">{e.target || '—'}{e.detail && <div className="xs muted mono">{e.detail}</div>}</td>
                  <td className="mono muted">{e.ip || '—'}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 28 }}>Sin registros</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
