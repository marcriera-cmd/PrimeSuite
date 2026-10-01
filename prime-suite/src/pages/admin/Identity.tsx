import { api, fmtDate } from '../../api';
import { CopyValue, ErrorBox, Icon, Loading, Toggle, confirmAction, useData, useToast } from '../../components/ui';

interface Settings { sessionHours: number; mfaAdmins: boolean; singleLogout: boolean; oneTimeTokens: boolean; keyRotationDays: number; allowSelfRegistration: boolean }
interface IdentityInfo {
  issuer: string;
  endpoints: { key: string; value: string }[];
  keys: { kid: string; createdAt: string; current: boolean }[];
  connectors: { oidc: number; prime_token: number; none: number };
  settings: Settings;
  canEdit: boolean;
}

const FLOW = [
  { n: '1 · USUARIO', t: 'Inicia sesión una vez', d: 'Usuario y contraseña de Prime Suite (Entra ID y Google en la hoja de ruta).' },
  { n: '2 · PRIME ID', t: 'Emite la identidad firmada', d: 'JWT RS256 con email, empresa, grupos y rol en cada aplicación.', dark: true },
  { n: '3 · CONECTOR', t: 'La entrega a cada app', d: 'OpenID Connect o Prime Token de un solo uso.' },
  { n: '4 · MÓDULO', t: 'Se abre ya autenticado', d: 'Dentro del portal o en pestaña, con cierre de sesión único.' }
];

export default function Identity() {
  const toast = useToast();
  const { data, error, reload, setData } = useData(() => api.get<IdentityInfo>('/api/admin/identity'));
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  async function saveSetting(patch: Partial<Settings>) {
    try {
      const s = await api.put<Settings>('/api/admin/settings', { ...data!.settings, ...patch });
      setData({ ...data!, settings: s });
      toast('Política actualizada');
    } catch (e: any) {
      toast(e.message, true);
    }
  }
  async function rotate() {
    if (!confirmAction('¿Rotar las claves de firma? Los tokens emitidos siguen siendo válidos hasta que caduquen: la clave anterior se mantiene publicada en el JWKS.')) return;
    await api.post('/api/admin/identity/rotate');
    toast('Nueva clave de firma activa');
    reload();
  }

  const s = data.settings;
  const policies: { k: keyof Settings; t: string; d: string }[] = [
    { k: 'singleLogout', t: 'Cierre de sesión único', d: 'Al salir de Prime Suite se invalidan todas las sesiones del usuario.' },
    { k: 'oneTimeTokens', t: 'Prime Tokens de un solo uso', d: 'Un token canjeado no puede reutilizarse (protección frente a robo).' },
    { k: 'allowSelfRegistration', t: 'Permitir solicitudes de alta', d: 'Los usuarios pueden pedir acceso con el código de su empresa; un admin las aprueba.' }
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Identidad y SSO</h1>
          <span className="muted small">Prime ID es el proveedor de identidad de Prime Suite. Todas las integraciones confían en él.</span>
        </div>
      </div>
      <div className="card" style={{ flexDirection: 'row', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
        {FLOW.map((f, i) => (
          <div key={f.n} className="row" style={{ flex: '1 1 200px', alignItems: 'center' }}>
            <div className="col" style={{ flex: 1, gap: 6, padding: 16, borderRadius: 12, background: f.dark ? 'var(--ink)' : 'var(--surface-2)', color: f.dark ? '#fff' : undefined, minHeight: 112 }}>
              <span className="xs" style={{ fontWeight: 600, letterSpacing: '.08em', opacity: 0.75 }}>{f.n}</span>
              <b>{f.t}</b>
              <span className="xs" style={{ opacity: 0.85, lineHeight: 1.45 }}>{f.d}</span>
            </div>
            {i < FLOW.length - 1 && <span style={{ color: '#8A8694' }} aria-hidden="true">→</span>}
          </div>
        ))}
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>Endpoints públicos de Prime ID</h3>
          {data.endpoints.map((e) => <div key={e.key} className="kv"><span className="xs muted">{e.key}</span><CopyValue value={e.value} /></div>)}
        </div>
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="row"><h3 className="grow">Claves de firma (RS256)</h3>{data.canEdit && <button className="btn sm" onClick={rotate}><Icon.refresh /> Rotar ahora</button>}</div>
            <table className="table">
              <thead><tr><th>kid</th><th>Creada</th><th>Estado</th></tr></thead>
              <tbody>
                {data.keys.map((k) => (
                  <tr key={k.kid}><td className="mono">{k.kid}</td><td>{fmtDate(k.createdAt)}</td><td>{k.current ? <span className="tag ok">Firmando</span> : <span className="tag">Solo verificación</span>}</td></tr>
                ))}
              </tbody>
            </table>
            <span className="xs muted">Recomendado rotar cada {s.keyRotationDays} días. Las apps que usan el JWKS la recogen solas.</span>
          </div>
          <div className="card">
            <h3>Conectores en uso</h3>
            <div className="grid-3">
              <div className="col" style={{ gap: 2 }}><span className="stat">{data.connectors.oidc}</span><span className="xs muted">OpenID Connect</span></div>
              <div className="col" style={{ gap: 2 }}><span className="stat">{data.connectors.prime_token}</span><span className="xs muted">Prime Token</span></div>
              <div className="col" style={{ gap: 2 }}><span className="stat">{data.connectors.none}</span><span className="xs muted">Sin SSO (login propio)</span></div>
            </div>
            <div className="row wrap" style={{ gap: 6 }}><span className="tag outline">SAML 2.0 · próximamente</span><span className="tag outline">Prime Gateway · próximamente</span><span className="tag outline">Entra ID / Google · próximamente</span></div>
          </div>
        </div>
      </div>
      <div className="card">
        <h3>Políticas</h3>
        {policies.map((p) => (
          <div key={p.k} className="row" style={{ paddingBottom: 12, borderBottom: '1px solid var(--line-2)' }}>
            <div className="col grow" style={{ gap: 2 }}><b className="small">{p.t}</b><span className="xs muted">{p.d}</span></div>
            <Toggle on={!!s[p.k]} disabled={!data.canEdit} label={p.t} onChange={(v) => saveSetting({ [p.k]: v })} />
          </div>
        ))}
        <div className="row wrap" style={{ gap: 16 }}>
          <label className="field" style={{ width: 220 }}>Duración de la sesión (horas)
            <input className="input" type="number" min={1} max={72} defaultValue={s.sessionHours} disabled={!data.canEdit} onBlur={(e) => Number(e.target.value) !== s.sessionHours && saveSetting({ sessionHours: Number(e.target.value) })} />
          </label>
          <label className="field" style={{ width: 220 }}>Rotación de claves (días)
            <input className="input" type="number" min={7} max={365} defaultValue={s.keyRotationDays} disabled={!data.canEdit} onBlur={(e) => Number(e.target.value) !== s.keyRotationDays && saveSetting({ keyRotationDays: Number(e.target.value) })} />
          </label>
        </div>
      </div>
    </>
  );
}
