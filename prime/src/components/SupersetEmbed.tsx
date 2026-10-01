import { useEffect, useRef, useState } from 'react';
import { embedDashboard, type EmbeddedDashboard } from '@superset-ui/embedded-sdk';
import { api } from '../api';
import { Icon, Spinner } from './ui';

/**
 * Muestra un dashboard de Superset.
 * - Con UUID de embebido: SDK oficial + guest token emitido por el backend (el usuario no ve ningún login de Superset).
 * - Sin UUID: iframe plano con la URL directa (requiere sesión en Superset).
 */
export default function SupersetEmbed({ dashboardId, embedded, dashboardUrl, height = '100%', compact = false }: { dashboardId: string; embedded: boolean; dashboardUrl?: string; height?: number | string; compact?: boolean }) {
  const mount = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!embedded || !mount.current) return;
    let handle: EmbeddedDashboard | null = null;
    let cancelled = false;
    setError(null);
    setReady(false);
    const fetchToken = () => api.post<{ token: string }>(`/api/insights/dashboards/${dashboardId}/guest-token`).then((r) => r.token);
    (async () => {
      try {
        const first = await api.post<{ token: string; supersetDomain: string; embeddedUuid: string }>(`/api/insights/dashboards/${dashboardId}/guest-token`);
        if (cancelled || !mount.current) return;
        let used = false;
        handle = await embedDashboard({
          id: first.embeddedUuid,
          supersetDomain: first.supersetDomain,
          mountPoint: mount.current,
          fetchGuestToken: () => (used ? fetchToken() : ((used = true), Promise.resolve(first.token))),
          dashboardUiConfig: { hideTitle: true, hideChartControls: compact, filters: { expanded: false, visible: !compact } },
          iframeTitle: 'Dashboard de Superset'
        });
        setReady(true);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'No se pudo cargar el dashboard');
      }
    })();
    return () => {
      cancelled = true;
      handle?.unmount();
      if (mount.current) mount.current.innerHTML = '';
    };
  }, [dashboardId, embedded, compact]);

  if (!embedded) {
    if (!dashboardUrl) return <div className="center-box muted small">Sin URL configurada</div>;
    return <iframe title="Dashboard de Superset" src={dashboardUrl} style={{ width: '100%', height, border: 0, borderRadius: compact ? 10 : 0 }} />;
  }
  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      {!ready && !error && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><Spinner /></div>}
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 20, textAlign: 'center' }}>
          <div className="col" style={{ alignItems: 'center' }}><Icon.warn /><b className="small">{error}</b></div>
        </div>
      )}
      <div ref={mount} className="ss-mount" style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
