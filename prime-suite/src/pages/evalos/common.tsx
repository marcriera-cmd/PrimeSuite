// Piezas comunes de Atajos de Evalos.
import { Link } from 'react-router-dom';
import { api, type EvalosMe } from '../../api';
import { useData } from '../../components/ui';

export const EVALOS_COLOR = '#0E7C66';

let meCache: Promise<EvalosMe> | null = null;
/** Permisos y estado del módulo (se comparte entre pantallas y widgets). */
export function loadEvalosMe(force = false) {
  if (!meCache || force) meCache = api.get<EvalosMe>('/api/evalos/me').catch((e) => { meCache = null; throw e; });
  return meCache;
}
export function useEvalosMe() {
  return useData(() => loadEvalosMe());
}

/** Estado vacío cuando aún no hay cadena de conexión. */
export function NotConfigured({ compact }: { compact?: boolean }) {
  const { data: me } = useEvalosMe();
  return (
    <div className="empty" style={compact ? { padding: 16 } : undefined}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3" /><path d="m16 17 5 5M21 17l-5 5" />
      </svg>
      <b style={{ color: 'var(--ink)' }}>Sin conexión con la base de datos de Evalos</b>
      <span className="small">
        {me?.canConfigure ? 'Indica la cadena de conexión de Evalos 8 en Configuración para empezar.' : 'Un administrador debe configurar la conexión con la base de datos de Evalos 8.'}
      </span>
      {me?.canConfigure && <Link className="btn sm" to="/evalos/configuracion">Ir a Configuración</Link>}
    </div>
  );
}

/** Etiqueta de estado de la conexión. */
export function ConnectionTag({ me }: { me: EvalosMe }) {
  if (!me.configured) return <span className="tag warn"><span className="dot" style={{ background: '#B45309' }} /> Sin configurar</span>;
  if (me.engine === 'demo') return <span className="tag info"><span className="dot" style={{ background: '#5C6B78' }} /> Datos de demostración</span>;
  return <span className="tag ok" title={me.connHint || undefined}><span className="dot" /> {me.connHint || 'Conectado'}</span>;
}
