import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useModules, type Launch, type OpenModule } from '../modules';
import { AppIcon, Icon, Modal, Spinner, useToast } from './ui';
import { SsoTracePanel } from './SsoTrace';

function submitForm(target: string, fp: NonNullable<Launch['formPost']>) {
  const f = document.createElement('form');
  f.method = 'POST';
  f.action = fp.action;
  f.target = target;
  for (const [k, v] of Object.entries(fp.fields)) {
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = k;
    i.value = v;
    f.appendChild(i);
  }
  document.body.appendChild(f);
  f.submit();
  f.remove();
}

// Panel individual de un módulo. Su iframe se mantiene montado mientras el módulo
// esté abierto, aunque no sea el activo (queda oculto con display:none), de modo
// que conserva el estado y lo que estuvieras haciendo dentro.
function ModulePane({ mod, active }: { mod: OpenModule; active: boolean }) {
  const { reload } = useModules();
  const [loaded, setLoaded] = useState(false);
  // «Abrir sin guardar»: se muestra la app con su propio login, sin pedir credenciales.
  const [skipCreds, setSkipCreds] = useState(false);
  const frameName = `ps-frame-${mod.id}`;
  const submitted = useRef<number | null>(null);
  const l = mod.launch;
  const askCreds = !!l && l.autoLogin?.mode === 'user' && l.autoLogin.missing && !skipCreds;

  useEffect(() => {
    if (l?.formPost && l.openMode !== 'tab' && submitted.current !== mod.issuedAt) {
      submitted.current = mod.issuedAt;
      setLoaded(false);
      setTimeout(() => submitForm(frameName, l.formPost!), 0);
    }
  }, [l, mod.issuedAt, frameName]);

  return (
    <div className="module-pane" style={{ display: active ? 'flex' : 'none' }}>
      {mod.error && (
        <div className="center-box"><div className="col" style={{ alignItems: 'center' }}><Icon.warn /><b>{mod.error}</b><Link to="/apps">Volver a aplicaciones</Link></div></div>
      )}
      {!mod.error && !l && <div className="center-box"><Spinner /></div>}
      {!mod.error && askCreds && (
        <div className="center-box">
          <CredentialsForm
            moduleId={mod.id}
            name={l!.name}
            onSaved={() => reload(mod.id)}
            onSkip={() => setSkipCreds(true)}
          />
        </div>
      )}
      {!mod.error && l && !askCreds && l.openMode === 'tab' && (
        <div className="center-box">
          <div className="col" style={{ alignItems: 'center', maxWidth: 460 }}>
            <h2>{l.name} se abre en una pestaña nueva</h2>
            <span className="muted small">Esta aplicación no permite mostrarse dentro del portal. Se abrirá con tu sesión ya iniciada.</span>
            <button className="btn primary" onClick={() => openInTab(mod.id)}><Icon.ext /> Abrir {l.name}</button>
          </div>
        </div>
      )}
      {!mod.error && l && !askCreds && l.openMode !== 'tab' && (
        <div className="col grow" style={{ position: 'relative', gap: 0 }}>
          {!loaded && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#fff' }}><Spinner /></div>}
          <iframe
            key={mod.issuedAt}
            name={frameName}
            title={l.name}
            src={l.formPost ? 'about:blank' : l.url}
            onLoad={() => setLoaded(true)}
            allow="clipboard-read; clipboard-write; fullscreen; camera; microphone; geolocation"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </div>
  );
}

// Usuario y contraseña de una app sin SSO: se guardan cifrados y el portal entra solo a partir de entonces.
function CredentialsForm({ moduleId, name, onSaved, onSkip }: { moduleId: string; name: string; onSaved: () => void; onSkip: () => void }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/api/portal/credentials/${moduleId}`, { username: u.trim(), password: p });
      onSaved();
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card" onSubmit={save} style={{ width: 'min(420px, 100%)', textAlign: 'left', gap: 14 }}>
      <div className="col" style={{ gap: 4 }}>
        <h2>Entra en {name}</h2>
        <span className="small muted">
          {name} todavía no tiene inicio de sesión único. Indica tu usuario y contraseña de {name}: Prime Suite los guarda cifrados y a partir de ahora entrará por ti automáticamente.
        </span>
      </div>
      {err && <div className="alert error small">{err}</div>}
      <label className="field">Usuario<input className="input" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus required /></label>
      <label className="field">Contraseña<input className="input" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></label>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost sm" onClick={onSkip}>Abrir sin guardar</button>
        <button className="btn primary" disabled={busy || !u.trim() || !p}>{busy ? 'Guardando…' : 'Guardar y entrar'}</button>
      </div>
    </form>
  );
}

// Abre un módulo en pestaña nueva con un token recién emitido.
async function openInTab(id: string) {
  const name = `ps-tab-${Date.now()}`;
  const w = window.open('about:blank', name);
  try {
    const l = await api.post<Launch>('/api/sso/launch', { moduleId: id });
    if (!w) return;
    if (l.formPost) submitForm(name, l.formPost);
    else w.location.href = l.url;
    try { (w as any).opener = null; } catch {}
  } catch {
    if (w) w.close();
  }
}

export default function ModuleHost() {
  const { modules, close, reload } = useModules();
  const toast = useToast();
  const [access, setAccess] = useState(false);
  const [traceFor, setTraceFor] = useState<string | null>(null);
  const loc = useLocation();
  const nav = useNavigate();
  const [full, setFull] = useState(false);
  const match = loc.pathname.match(/^\/apps\/([^/]+)/);
  const activeId = match ? decodeURIComponent(match[1]) : null;
  const active = modules.find((m) => m.id === activeId) || null;

  // Al salir de la vista de módulo se abandona la pantalla completa.
  useEffect(() => { if (!activeId) setFull(false); }, [activeId]);

  const title = active?.launch?.name || active?.name || 'Aplicación';

  const shell = (
    <div className={`module-host${full ? ' full' : ''}`} style={{ display: activeId ? 'flex' : 'none' }}>
      <div className="viewer-bar">
        <Link to="/apps" className="btn sm"><Icon.back /> Aplicaciones</Link>

        {/* Pestañas de módulos abiertos: cambia entre ellos sin perder el estado */}
        <div className="mod-tabs">
          {modules.map((m) => (
            <button
              key={m.id}
              className={`mod-tab${m.id === activeId ? ' on' : ''}`}
              onClick={() => nav(`/apps/${m.id}`)}
              title={m.launch?.name || m.name}
            >
              <AppIcon initials={m.initials || (m.name || '?').slice(0, 2).toUpperCase()} color={m.color || '#243A4D'} size={18} />
              <span className="mod-tab-name">{m.launch?.name || m.name}</span>
              <span
                role="button"
                aria-label="Cerrar módulo"
                className="mod-tab-x"
                onClick={(e) => {
                  e.stopPropagation();
                  const rest = modules.filter((x) => x.id !== m.id);
                  close(m.id);
                  if (m.id === activeId) nav(rest.length ? `/apps/${rest[rest.length - 1].id}` : '/apps');
                }}
              >
                <Icon.x />
              </span>
            </button>
          ))}
        </div>

        <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
          {active?.launch?.autoLogin?.mode === 'user' && !active.launch.autoLogin.missing && (
            <button className="btn sm" onClick={() => setAccess(true)} title="Cambiar el usuario y la contraseña guardados para esta aplicación">Mi acceso</button>
          )}
          {active?.launch?.ssoDebug && (
            <button className="btn sm" onClick={() => setTraceFor(active.id)} title="Pasos del inicio de sesión con esta app y usuario que se le envía">Log de acceso</button>
          )}
          {active && <button className="btn sm" onClick={() => reload(active.id)}><Icon.refresh /> Recargar</button>}
          {active && <button className="btn sm" onClick={() => openInTab(active.id)}><Icon.ext /> Pestaña nueva</button>}
          {active?.launch && active.launch.openMode !== 'tab' && (
            <button className="btn sm" onClick={() => setFull((v) => !v)}>{full ? 'Salir de pantalla completa' : 'Pantalla completa'}</button>
          )}
          {active && (
            <button
              className="btn sm danger"
              onClick={() => {
                const rest = modules.filter((x) => x.id !== active.id);
                close(active.id);
                nav(rest.length ? `/apps/${rest[rest.length - 1].id}` : '/apps');
              }}
            ><Icon.x /> Cerrar</button>
          )}
        </div>
      </div>

      <div className="module-stage">
        {modules.map((m) => <ModulePane key={m.id} mod={m} active={m.id === activeId} />)}
        {activeId && !active && <div className="center-box"><Spinner /></div>}
      </div>
      {traceFor && (() => {
        const m = modules.find((x) => x.id === traceFor);
        if (!m) return null;
        // Pasos desde que se abrió (o recargó) la app, con un margen por si el reloj del navegador va adelantado.
        const since = new Date(m.issuedAt - 60_000).toISOString();
        return <SsoTracePanel key={`${m.id}-${m.issuedAt}`} moduleId={m.id} name={m.launch?.name || m.name} since={since} onClose={() => setTraceFor(null)} />;
      })()}
      {access && active?.launch && (
        <Modal title={`Mi acceso a ${active.launch.name}`} onClose={() => setAccess(false)}>
          <span className="small muted" style={{ marginTop: -8 }}>Guardado como <b>{active.launch.autoLogin?.username}</b>. Cámbialo si has cambiado la contraseña en {active.launch.name}.</span>
          <AccessEditForm
            moduleId={active.id}
            username={active.launch.autoLogin?.username || ''}
            onDone={(msg) => { setAccess(false); toast(msg); reload(active.id); }}
          />
        </Modal>
      )}
    </div>
  );

  return shell;
}

function AccessEditForm({ moduleId, username, onDone }: { moduleId: string; username: string; onDone: (msg: string) => void }) {
  const [u, setU] = useState(username);
  const [p, setP] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    setErr(null);
    try { await fn(); onDone(msg); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <form className="col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); run(() => api.put(`/api/portal/credentials/${moduleId}`, { username: u.trim(), password: p }), 'Acceso actualizado'); }}>
      {err && <div className="alert error small">{err}</div>}
      <label className="field">Usuario<input className="input" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" required /></label>
      <label className="field">Contraseña nueva<input className="input" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" autoFocus required /></label>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn danger sm" disabled={busy} onClick={() => run(() => api.del(`/api/portal/credentials/${moduleId}`), 'Acceso olvidado: se te pedirá la próxima vez')}>Olvidar acceso</button>
        <button className="btn primary" disabled={busy || !u.trim() || !p}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}
