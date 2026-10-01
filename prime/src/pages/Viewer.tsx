import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type AuthMethod, type ModuleRole, type OpenMode, type PortalApp, type Category } from '../api';
import { AppIcon, Icon, Spinner, useData } from '../components/ui';

interface Launch {
  moduleId: string;
  name: string;
  url: string;
  openMode: OpenMode;
  authMethod: AuthMethod;
  role: ModuleRole;
  expiresIn?: number;
  formPost?: { action: string; fields: Record<string, string> };
}

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

export default function Viewer() {
  const { id = '' } = useParams();
  const { data: apps } = useData(() => api.get<{ categories: Category[]; apps: PortalApp[] }>('/api/portal/apps'));
  const app = apps?.apps.find((a) => a.id === id);
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [full, setFull] = useState(false);
  const [issuedAt, setIssuedAt] = useState<Date | null>(null);
  const frameName = `ps-frame-${id}`;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();

  const doLaunch = useCallback(async () => {
    setError(null);
    setLoaded(false);
    try {
      const l = await api.post<Launch>('/api/sso/launch', { moduleId: id });
      if (l.openMode === 'native') {
        navigate(l.url, { replace: true });
        return null;
      }
      setLaunch(l);
      setIssuedAt(new Date());
      if (l.openMode === 'fullscreen') setFull(true);
      return l;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [id]);

  useEffect(() => {
    setLaunch(null);
    doLaunch();
  }, [doLaunch]);

  // form_post: se envía el token por POST al iframe (no queda en la URL).
  useEffect(() => {
    if (launch?.formPost && launch.openMode !== 'tab') setTimeout(() => submitForm(frameName, launch.formPost!), 0);
  }, [launch, frameName]);

  async function openInTab() {
    // Se abre la ventana en el mismo clic (evita el bloqueador) y se carga con un token recién emitido.
    const name = `ps-tab-${Date.now()}`;
    const w = window.open('about:blank', name);
    const l = await doLaunch();
    if (!w || !l) return;
    if (l.formPost) submitForm(name, l.formPost);
    else w.location.href = l.url;
    try { w.opener = null; } catch {}
  }

  const title = launch?.name || app?.name || 'Aplicación';
  const bar = (
    <div className="viewer-bar">
      <Link to="/apps" className="btn sm"><Icon.back /> Aplicaciones</Link>
      {app && <AppIcon initials={app.initials} color={app.color} size={32} />}
      <b>{title}</b>
      <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
        <button className="btn sm" onClick={doLaunch}><Icon.refresh /> Recargar</button>
        <button className="btn sm" onClick={openInTab}><Icon.ext /> Pestaña nueva</button>
        {launch?.openMode !== 'tab' && <button className="btn sm" onClick={() => setFull(!full)}>{full ? 'Salir de pantalla completa' : 'Pantalla completa'}</button>}
      </div>
    </div>
  );

  const body = (
    <div className="viewer-body">
      {error && <div className="center-box"><div className="col" style={{ alignItems: 'center' }}><Icon.warn /><b>{error}</b><Link to="/apps">Volver a aplicaciones</Link></div></div>}
      {!error && !launch && <div className="center-box"><Spinner /></div>}
      {!error && launch && launch.openMode === 'tab' && (
        <div className="center-box">
          <div className="col" style={{ alignItems: 'center', maxWidth: 460 }}>
            <h2>{title} se abre en una pestaña nueva</h2>
            <span className="muted small">Esta aplicación no permite mostrarse dentro del portal. Se abrirá con tu sesión ya iniciada.</span>
            <button className="btn primary" onClick={openInTab}><Icon.ext /> Abrir {title}</button>
          </div>
        </div>
      )}
      {!error && launch && launch.openMode !== 'tab' && (
        <div className="col grow" style={{ position: 'relative', gap: 0 }}>
          {!loaded && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#fff' }}><Spinner /></div>}
          <iframe
            ref={frameRef}
            key={launch.url + (issuedAt?.getTime() || '')}
            name={frameName}
            title={title}
            src={launch.formPost ? 'about:blank' : launch.url}
            onLoad={() => setLoaded(true)}
            allow="clipboard-read; clipboard-write; fullscreen; camera; microphone; geolocation"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </div>
  );

  return full ? (
    <div className="fullscreen-viewer"><div className="viewer">{bar}{body}</div></div>
  ) : (
    <div className="viewer">{bar}{body}</div>
  );
}
