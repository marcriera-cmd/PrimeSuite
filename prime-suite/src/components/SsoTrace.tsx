// Ventana «Log de inicio de sesión»: pasos que da Prime ID al iniciar sesión en una app (depuración de SSO).
// Se usa desde el visor de apps (los pasos del propio usuario) y desde la integración (todos los usuarios).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SsoTraceEvent } from '../api';
import { Drawer, ErrorBox, Icon, confirmAction, useToast } from './ui';

const STATUS: Record<SsoTraceEvent['status'], { tag: string; label: string }> = {
  ok: { tag: 'ok', label: 'Correcto' },
  info: { tag: 'info', label: 'Info' },
  warn: { tag: 'warn', label: 'Aviso' },
  error: { tag: 'bad', label: 'Error' }
};
const CHANNEL: Record<SsoTraceEvent['channel'], string> = { portal: 'Portal', navegador: 'Navegador → Prime ID', app: 'App → Prime ID' };

/** Pasos que llevan los datos del usuario que se envían a la app (el último gana). */
const IDENTITY_STEPS = /id_token|recibe los datos|userinfo|Prime Token emitido|canjea el Prime Token|credenciales guardadas/;

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function Value({ v }: { v: unknown }) {
  if (v == null || v === '') return <span className="muted">—</span>;
  if (Array.isArray(v)) return <>{v.length ? v.map((x, i) => <div key={i}><Value v={x} /></div>) : <span className="muted">(vacío)</span>}</>;
  if (typeof v === 'object') return <DataTable data={v as Record<string, unknown>} />;
  return <>{String(v)}</>;
}

function DataTable({ data }: { data: Record<string, unknown> }) {
  const rows = Object.entries(data).filter(([, v]) => v !== undefined);
  if (!rows.length) return null;
  return (
    <table className="sso-kv">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}><th className="mono">{k}</th><td className="mono"><Value v={v} /></td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function SsoTracePanel({ moduleId, name, since, all, onClose }: {
  moduleId: string; name: string;
  /** Solo pasos desde este momento (al abrir la app). */
  since?: string;
  /** Todos los usuarios (superadministrador, desde la integración). */
  all?: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [events, setEvents] = useState<SsoTraceEvent[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [live, setLive] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ ...(since ? { since } : {}), ...(all ? { all: '1' } : {}) });
      const r = await api.get<{ enabled: boolean; events: SsoTraceEvent[] }>(`/api/sso/trace/${encodeURIComponent(moduleId)}?${q}`);
      setEnabled(r.enabled);
      setEvents(r.events);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }, [moduleId, since, all]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [live, load]);
  const count = events?.length || 0;
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [count]);

  async function clear() {
    if (!confirmAction(`¿Vaciar el log de inicio de sesión de ${name}?`)) return;
    try {
      await api.del(`/api/sso/trace/${encodeURIComponent(moduleId)}`);
      toast('Log vaciado');
      load();
    } catch (e: any) {
      toast(e.message, true);
    }
  }

  const list = events || [];
  const identity = [...list].reverse().find((e) => IDENTITY_STEPS.test(e.title) && e.data);
  const lastError = [...list].reverse().find((e) => e.status === 'error');
  const idData = identity?.data || {};
  const pick = (...keys: string[]) => keys.map((k) => idData[k]).find((v) => v != null && v !== '');

  return (
    <Drawer
      onClose={onClose}
      title={
        <div className="col" style={{ gap: 2 }}>
          <span className="xs muted">Log de inicio de sesión{all ? ' · todos los usuarios' : ''}</span>
          <h2 style={{ fontSize: 20 }}>{name}</h2>
        </div>
      }
    >
      <div className="row wrap" style={{ gap: 8 }}>
        <label className="check xs"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Actualizar en directo</label>
        <span className="grow" />
        <button type="button" className="btn sm" onClick={load}><Icon.refresh /> Actualizar</button>
        {all && <button type="button" className="btn sm danger" onClick={clear}><Icon.trash /> Vaciar</button>}
      </div>
      <ErrorBox error={err} />
      {!enabled && <div className="alert warn small">El log está desactivado en esta integración. Actívalo en Integraciones › Autenticación › «Ver log de inicio de sesión».</div>}

      {identity && (
        <div className="card flat sso-identity">
          <span className="xs muted">Usuario que Prime ID envía a la app</span>
          <b style={{ fontSize: 16 }}>{String(pick('email', 'usuario_en_la_app') ?? '(sin email)')}</b>
          <span className="small muted">
            {[pick('name', 'nombre'), pick('tenant') && `tenant ${pick('tenant')}`, pick('sub') && `sub ${pick('sub')}`].filter(Boolean).join(' · ')}
          </span>
          <span className="xs muted">Según el paso «{identity.title}» de las {fmtTime(identity.at)}. La app tiene que encontrar a este usuario con ese dato.</span>
        </div>
      )}
      {lastError && <div className="alert error small"><b>{lastError.title}.</b> {lastError.detail}</div>}

      <ol className="sso-steps">
        {list.map((e) => (
          <li key={e.id} className={`sso-step ${e.status}`}>
            <div className="row wrap" style={{ gap: 8, alignItems: 'baseline' }}>
              <span className="mono xs muted">{fmtTime(e.at)}</span>
              <b className="small grow">{e.title}</b>
              <span className={`tag ${STATUS[e.status].tag}`}>{STATUS[e.status].label}</span>
            </div>
            <span className="xs muted">{CHANNEL[e.channel]}{all && e.userEmail ? ` · ${e.userEmail}` : ''}{!e.userId ? ' · sin sesión todavía' : ''}</span>
            {e.detail && <span className="small">{e.detail}</span>}
            {e.data && <DataTable data={e.data} />}
          </li>
        ))}
        <div ref={endRef} />
      </ol>
      {events && !list.length && enabled && (
        <span className="small muted">
          Todavía no hay pasos. {all ? 'Abre la app desde el portal' : 'Pulsa «Recargar» en la app'} para ver el inicio de sesión paso a paso.
        </span>
      )}
      <span className="xs muted">No se guardan contraseñas, secretos ni tokens: solo los datos que contienen. Los pasos se conservan 24 horas.</span>
    </Drawer>
  );
}
