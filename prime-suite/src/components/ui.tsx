import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// ---------- Iconos (trazo, heredan currentColor) ----------
const P = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
export const Icon = {
  home: () => <svg {...P}><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" /></svg>,
  grid: () => <svg {...P}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
  plug: () => <svg {...P}><path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5" /></svg>,
  shield: () => <svg {...P}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>,
  users: () => <svg {...P}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5c2.3 0 4 1.5 4.5 4" /></svg>,
  layers: () => <svg {...P}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></svg>,
  building: () => <svg {...P}><path d="M4 21V5l8-3v19M12 8h8v13M8 9h.01M8 13h.01M8 17h.01M16 12h.01M16 16h.01" /></svg>,
  tag: () => <svg {...P}><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1" /></svg>,
  list: () => <svg {...P}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>,
  plus: () => <svg {...P} strokeWidth={2.2}><path d="M12 5v14M5 12h14" /></svg>,
  search: () => <svg {...P} width={16} height={16}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  x: () => <svg {...P}><path d="M6 6l12 12M18 6 6 18" /></svg>,
  ext: () => <svg {...P} width={16} height={16}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>,
  refresh: () => <svg {...P} width={16} height={16}><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>,
  back: () => <svg {...P} width={16} height={16}><path d="M15 6l-6 6 6 6" /></svg>,
  copy: () => <svg {...P} width={15} height={15}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>,
  trash: () => <svg {...P} width={16} height={16}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  edit: () => <svg {...P} width={16} height={16}><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>,
  logout: () => <svg {...P} width={16} height={16}><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></svg>,
  up: () => <svg {...P} width={14} height={14}><path d="M12 19V5M6 11l6-6 6 6" /></svg>,
  down: () => <svg {...P} width={14} height={14}><path d="M12 5v14M6 13l6 6 6-6" /></svg>,
  ok: () => <svg {...P} width={20} height={20} stroke="#15803D" strokeWidth={2.2}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>,
  warn: () => <svg {...P} width={20} height={20} stroke="#B45309" strokeWidth={2.2}><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></svg>,
  info: () => <svg {...P} width={20} height={20} stroke="#5E5B66" strokeWidth={2.2}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>,
  user: () => <svg {...P}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>
};

export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="8" cy="13" r="5" fill="#E2323C" />
      <path d="M15 5l8 8-8 8" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function soft(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * 0.87);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function AppIcon({ initials, color, size = 44 }: { initials: string; color: string; size?: number }) {
  return (
    <span className="app-icon" style={{ width: size, height: size, borderRadius: Math.round(size / 3.4), background: soft(color || '#52525B'), color: color || '#52525B', fontSize: size > 36 ? 14 : 11 }}>
      {initials}
    </span>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Cargando" />;
}

export function Loading() {
  return (
    <div className="row" style={{ padding: 40, justifyContent: 'center' }}>
      <Spinner />
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(760px, 100%)' } : undefined}>
        <div className="row">
          <h2 className="grow">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon.x /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="row">
          <div className="grow">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon.x /></button>
        </div>
        {children}
      </aside>
    </div>
  );
}

// ---------- Toasts ----------
interface Toast { id: number; msg: string; error?: boolean }
const ToastCtx = createContext<(msg: string, error?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((msg: string, error?: boolean) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, msg, error }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Datos ----------
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    loader()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message || 'Error'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN((x) => x + 1), setData };
}

export function CopyValue({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className="v">
      <span>{value}</span>
      <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Copiar" onClick={() => navigator.clipboard.writeText(value).then(() => toast('Copiado'))}>
        <Icon.copy />
      </button>
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="alert error">{error}</div> : null;
}

export function confirmAction(msg: string) {
  return window.confirm(msg);
}
