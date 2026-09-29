import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type InsightCategory } from '../../api';
import { AppIcon, ErrorBox, Icon, Loading, useData } from '../../components/ui';
import SupersetEmbed from '../../components/SupersetEmbed';
import { DashboardsAdmin, ServersAdmin, CategoriesAdmin } from './InsightsAdmin';

interface MyDash { id: string; name: string; description?: string; categoryId: string | null; embedded: boolean; dashboardUrl?: string; enabled: boolean; showAsWidget: boolean }
interface MyData { canManage: boolean; categories: InsightCategory[]; dashboards: MyDash[] }

const TABS = [
  { k: 'ver', l: 'Dashboards' },
  { k: 'gestion', l: 'Gestión' },
  { k: 'servidores', l: 'Servidores Superset' },
  { k: 'categorias', l: 'Categorías' }
];

export default function Insights() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'ver';
  const { data, error, reload } = useData(() => api.get<MyData>('/api/insights/me'));
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const setTab = (k: string) => setParams(k === 'ver' ? {} : { tab: k });

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ gap: 12, flexDirection: 'row', alignItems: 'center' }}>
          <AppIcon initials="PI" color="#1F5FBF" />
          <div className="col" style={{ gap: 2 }}>
            <h1>Prime Insights</h1>
            <span className="muted small">Dashboards de Superset, sin volver a iniciar sesión y filtrados por tu empresa.</span>
          </div>
        </div>
      </div>
      {data.canManage && (
        <div className="tabs" role="tablist">
          {TABS.map((t) => <button key={t.k} role="tab" aria-selected={tab === t.k} className={tab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>{t.l}</button>)}
        </div>
      )}
      {tab === 'ver' && <DashboardViewer data={data} onManage={data.canManage ? () => setTab('gestion') : undefined} />}
      {data.canManage && tab === 'gestion' && <DashboardsAdmin onChange={reload} />}
      {data.canManage && tab === 'servidores' && <ServersAdmin />}
      {data.canManage && tab === 'categorias' && <CategoriesAdmin onChange={reload} />}
    </>
  );
}

function DashboardViewer({ data, onManage }: { data: MyData; onManage?: () => void }) {
  const [q, setQ] = useState('');
  const visible = data.dashboards.filter((d) => d.enabled);
  const [sel, setSel] = useState<string | null>(visible[0]?.id || null);
  const [full, setFull] = useState(false);
  const groups = useMemo(() => {
    const term = q.toLowerCase();
    const list = visible.filter((d) => !term || d.name.toLowerCase().includes(term));
    const out = data.categories.map((c) => ({ id: c.id, name: c.name, items: list.filter((d) => d.categoryId === c.id) }));
    const rest = list.filter((d) => !d.categoryId || !data.categories.some((c) => c.id === d.categoryId));
    if (rest.length) out.push({ id: 'none', name: 'Sin categoría', items: rest });
    return out.filter((g) => g.items.length);
  }, [visible, data.categories, q]);
  const current = visible.find((d) => d.id === sel);

  if (!visible.length)
    return (
      <div className="empty">
        <b style={{ color: 'var(--ink)' }}>Todavía no tienes dashboards asignados</b>
        {onManage ? <><span className="small">Conecta un servidor Superset e importa sus dashboards.</span><button className="btn" onClick={onManage}>Ir a Gestión</button></> : <span className="small">Pide a un administrador que te asigne dashboards.</span>}
      </div>
    );

  const viewer = (
    <div className="card flat" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: full ? '100vh' : 'calc(100vh - 250px)', minHeight: 520, borderRadius: full ? 0 : undefined }}>
      <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-2)' }}>
        <div className="col grow" style={{ gap: 0 }}>
          <b>{current?.name}</b>
          {current?.description && <span className="xs muted">{current.description}</span>}
        </div>
        {current && !current.embedded && <span className="tag warn" title="Sin UUID de embebido: se carga la URL directa y Superset puede pedir login">Iframe directo</span>}
        <button className="btn sm" onClick={() => setFull(!full)}>{full ? 'Salir de pantalla completa' : 'Pantalla completa'}</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {current && <SupersetEmbed key={current.id} dashboardId={current.id} embedded={current.embedded} dashboardUrl={current.dashboardUrl} />}
      </div>
    </div>
  );

  return (
    <div className="row" style={{ alignItems: 'stretch', gap: 16 }}>
      <aside className="card" style={{ width: 280, flexShrink: 0, padding: 14, gap: 10, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 250px)', overflowY: 'auto' }}>
        <label className="search" style={{ minWidth: 0 }}><Icon.search /><input placeholder="Buscar dashboard…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar dashboard" /></label>
        {groups.map((g) => (
          <div key={g.id} className="col" style={{ gap: 4 }}>
            <span className="xs muted" style={{ fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', padding: '6px 8px 2px' }}>{g.name}</span>
            {g.items.map((d) => (
              <button key={d.id} className="btn ghost" style={{ justifyContent: 'flex-start', fontWeight: sel === d.id ? 700 : 500, background: sel === d.id ? 'var(--surface-2)' : undefined, whiteSpace: 'normal', textAlign: 'left' }} onClick={() => setSel(d.id)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
                {d.name}
              </button>
            ))}
          </div>
        ))}
      </aside>
      {full ? <div className="fullscreen-viewer" style={{ display: 'flex' }}>{viewer}</div> : viewer}
    </div>
  );
}
