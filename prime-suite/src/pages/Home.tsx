import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type WidgetDef } from '../api';
import { useSession } from '../session';
import { AppIcon, ErrorBox, Icon, Loading, Modal, Spinner, useData, useToast } from '../components/ui';
import SupersetEmbed from '../components/SupersetEmbed';

interface CatalogWidget extends WidgetDef { moduleId: string; moduleName: string; initials: string; color: string }
interface Item { moduleId: string; widgetId: string; size: 's' | 'm' | 'l' }

function today() {
  const t = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function greeting() {
  const h = new Date().getHours();
  return h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
}

export default function Home() {
  const { me } = useSession();
  const toast = useToast();
  const { data, error, setData } = useData(() => api.get<{ items: Item[]; catalog: CatalogWidget[] }>('/api/dashboard'));
  const [edit, setEdit] = useState(false);
  const [adding, setAdding] = useState(false);
  if (!me) return null;

  const items = data?.items || [];
  const catalog = data?.catalog || [];
  const def = (i: Item) => catalog.find((w) => w.moduleId === i.moduleId && w.id === i.widgetId);
  const update = (next: Item[]) => data && setData({ ...data, items: next });
  const move = (i: number, d: number) => {
    const next = [...items];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  async function save() {
    try {
      await api.put('/api/dashboard', { items });
      setEdit(false);
      toast('Panel guardado');
    } catch (e: any) {
      toast(e.message, true);
    }
  }
  const available = catalog.filter((w) => !items.some((i) => i.moduleId === w.moduleId && i.widgetId === w.id));

  return (
    <>
      <div className="page-head">
        <div>
          <span className="small muted">{today()}</span>
          <h1>{greeting()}, {me.user.firstName}</h1>
        </div>
        <div className="row">
          {edit ? (
            <>
              <button className="btn" onClick={() => setAdding(true)}><Icon.plus /> Añadir widget</button>
              <button className="btn primary" onClick={save}>Guardar panel</button>
            </>
          ) : (
            <button className="btn" onClick={() => setEdit(true)}>Personalizar panel</button>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && !catalog.length && (
        <div className="empty">
          <b style={{ color: 'var(--ink)' }}>Todavía no hay widgets</b>
          <span className="small">Los widgets los publica cada aplicación integrada (manifiesto prime-app.json o configuración manual).</span>
          {me.isSuper && <Link className="btn" to="/admin/integraciones">Ir a Integraciones</Link>}
        </div>
      )}
      {data && catalog.length > 0 && (
        <div className="dash">
          {items.map((it, idx) => {
            const w = def(it);
            if (!w) return null;
            return (
              <div key={`${it.moduleId}:${it.widgetId}`} className={`card w-${it.size}`}>
                <div className="widget-head">
                  <AppIcon initials={w.initials} color={w.color} size={26} />
                  <span className="small grow" style={{ fontWeight: 700 }}>{w.title}</span>
                  {edit ? (
                    <span className="row" style={{ gap: 2 }}>
                      <button className="icon-btn" aria-label="Mover antes" onClick={() => move(idx, -1)}><Icon.up /></button>
                      <button className="icon-btn" aria-label="Mover después" onClick={() => move(idx, 1)}><Icon.down /></button>
                      <select className="select" style={{ width: 70, padding: '4px 6px' }} value={it.size} aria-label="Tamaño" onChange={(e) => update(items.map((x, i) => (i === idx ? { ...x, size: e.target.value as Item['size'] } : x)))}>
                        <option value="s">S</option><option value="m">M</option><option value="l">L</option>
                      </select>
                      <button className="icon-btn" aria-label="Quitar" onClick={() => update(items.filter((_, i) => i !== idx))}><Icon.x /></button>
                    </span>
                  ) : (
                    <Link to={w.type === 'superset' ? '/insights' : `/apps/${w.moduleId}`} className="xs muted">{w.moduleName}</Link>
                  )}
                </div>
                <WidgetBody w={w} />
              </div>
            );
          })}
          {edit && (
            <button className={`empty w-s`} style={{ cursor: 'pointer', background: 'transparent' }} onClick={() => setAdding(true)}>
              <Icon.plus /><b style={{ color: 'var(--ink)' }}>Añadir widget</b>
            </button>
          )}
        </div>
      )}
      {adding && (
        <Modal title="Añadir widget" onClose={() => setAdding(false)}>
          {!available.length && <span className="muted small">Ya tienes todos los widgets disponibles en tu panel.</span>}
          <div className="col">
            {available.map((w) => (
              <button key={w.moduleId + w.id} className="choice" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => { update([...items, { moduleId: w.moduleId, widgetId: w.id, size: w.size }]); setAdding(false); }}>
                <AppIcon initials={w.initials} color={w.color} size={32} />
                <span className="col grow" style={{ gap: 2 }}><b className="small">{w.title}</b><span className="xs muted">{w.moduleName}</span></span>
                <span className="tag">{w.type.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function WidgetBody({ w }: { w: CatalogWidget }) {
  if (w.type === 'superset' && w.dashboardId) return <SupersetEmbed dashboardId={w.dashboardId} embedded height={w.size === 'l' ? 480 : 360} compact />;
  return <DataWidget w={w} />;
}

function DataWidget({ w }: { w: CatalogWidget }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.get<any>(`/api/widgets/data?moduleId=${encodeURIComponent(w.moduleId)}&widgetId=${encodeURIComponent(w.id)}`)
        .then((d) => { if (alive) { setData(d); setError(null); } })
        .catch((e) => alive && setError(e.message));
    load();
    const t = setInterval(load, Math.max(15, w.refreshSec) * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [w.moduleId, w.id, w.refreshSec]);

  if (error) return <span className="small" style={{ color: 'var(--bad)' }}>{error}</span>;
  if (!data) return <div style={{ padding: 12 }}><Spinner /></div>;
  if (w.type === 'iframe') return <iframe title={w.title} src={data.url} style={{ border: 0, width: '100%', height: 260, borderRadius: 10 }} />;
  if (w.type === 'kpi')
    return (
      <div className="col" style={{ gap: 6 }}>
        <span className="stat">{String(data.value ?? '—')}</span>
        {data.label && <span className="small muted">{data.label}</span>}
        {data.delta && <span className="small" style={{ fontWeight: 600, color: data.trend === 'down' ? 'var(--bad)' : 'var(--ok-ink)' }}>{data.delta}</span>}
        {data.note && <span className="xs muted">{data.note}</span>}
      </div>
    );
  if (w.type === 'chart') {
    const series: { label: string; value: number }[] = Array.isArray(data.series) ? data.series : [];
    const max = Math.max(1, ...series.map((s) => Number(s.value) || 0));
    return (
      <div className="col" style={{ gap: 8 }}>
        <div className="bars" role="img" aria-label={`${w.title}: ${series.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
          {series.map((s) => (
            <div key={s.label}>
              <span className="xs muted">{s.value}</span>
              <div className="bar" style={{ height: `${Math.round(((Number(s.value) || 0) / max) * 130)}px`, background: s.value === max ? '#1F5FBF' : undefined }} />
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 14, padding: '0 6px' }}>
          {series.map((s) => <span key={s.label} className="xs muted" style={{ flex: 1, textAlign: 'center' }}>{s.label}</span>)}
        </div>
      </div>
    );
  }
  const list: { title: string; subtitle?: string; badge?: string; href?: string }[] = Array.isArray(data.items) ? data.items : [];
  return (
    <div className="col" style={{ gap: 8 }}>
      {list.map((it, i) => (
        <div key={i} className="row" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10 }}>
          <div className="col grow" style={{ gap: 2 }}>
            <span className="small" style={{ fontWeight: 600 }}>{it.title}</span>
            {it.subtitle && <span className="xs muted">{it.subtitle}</span>}
          </div>
          {it.badge && <span className="tag warn">{it.badge}</span>}
        </div>
      ))}
      {!list.length && <span className="small muted">Sin elementos</span>}
    </div>
  );
}
