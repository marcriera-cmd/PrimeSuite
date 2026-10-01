import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useModules, type Launch, type OpenModule } from '../modules';
import { AppIcon, Icon, Spinner } from './ui';

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
  const [loaded, setLoaded] = useState(false);
  const frameName = `ps-frame-${mod.id}`;
  const submitted = useRef<number | null>(null);
  const l = mod.launch;

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
      {!mod.error && l && l.openMode === 'tab' && (
        <div className="center-box">
          <div className="col" style={{ alignItems: 'center', maxWidth: 460 }}>
            <h2>{l.name} se abre en una pestaña nueva</h2>
            <span className="muted small">Esta aplicación no permite mostrarse dentro del portal. Se abrirá con tu sesión ya iniciada.</span>
            <button className="btn primary" onClick={() => openInTab(mod.id)}><Icon.ext /> Abrir {l.name}</button>
          </div>
        </div>
      )}
      {!mod.error && l && l.openMode !== 'tab' && (
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
    </div>
  );

  return shell;
}
