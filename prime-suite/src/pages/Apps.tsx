import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type Category, type PortalApp } from '../api';
import { AppIcon, ErrorBox, Icon, Loading, useData } from '../components/ui';

type View = 'grid' | 'cards' | 'list';
const VIEW_KEY = 'ps.apps.view';

function loadView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'grid' || v === 'cards' || v === 'list') return v;
  } catch {}
  return 'grid';
}

const linkTo = (a: PortalApp) => (a.openMode === 'native' ? a.nativeUrl || '/insights' : `/apps/${a.id}`);

export default function Apps() {
  const { data, error } = useData(() => api.get<{ categories: Category[]; apps: PortalApp[] }>('/api/portal/apps'));
  const [q, setQ] = useState('');
  const [view, setView] = useState<View>(loadView);
  const [params] = useSearchParams();
  const cat = params.get('cat');
  const activeCat = data?.categories.find((c) => c.id === cat);

  const setV = (v: View) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch {}
  };

  const groups = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    const apps = data.apps.filter(
      (a) => (!cat || a.categoryId === cat) && (!term || a.name.toLowerCase().includes(term) || a.description.toLowerCase().includes(term))
    );
    const cats = cat ? data.categories.filter((c) => c.id === cat) : data.categories;
    const out = cats.map((c) => ({ id: c.id, name: c.name, color: c.color, apps: apps.filter((a) => a.categoryId === c.id) }));
    if (!cat) {
      const known = new Set(data.categories.map((c) => c.id));
      const rest = apps.filter((a) => !a.categoryId || !known.has(a.categoryId));
      if (rest.length) out.push({ id: 'none', name: 'SIN CATEGORÍA', color: '#5C6B78', apps: rest });
    }
    return out.filter((g) => g.apps.length);
  }, [data, q, cat]);

  return (
    <div className="ios-home">
      <div className="page-head">
        <div>
          <h1>{activeCat ? activeCat.name.charAt(0) + activeCat.name.slice(1).toLowerCase() : 'Aplicaciones'}</h1>
          <span className="muted small">
            {activeCat ? <>Categoría · <Link to="/apps">ver todas</Link></> : 'Todas las aplicaciones disponibles para ti.'}
          </span>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="viewseg" role="tablist" aria-label="Estilo de visualización">
            <button role="tab" aria-selected={view === 'grid'} className={view === 'grid' ? 'on' : ''} onClick={() => setV('grid')} title="Cuadrícula">
              <Icon.grid /><span className="lbl">Cuadrícula</span>
            </button>
            <button role="tab" aria-selected={view === 'cards'} className={view === 'cards' ? 'on' : ''} onClick={() => setV('cards')} title="Tarjetas">
              <ViewCardsIcon /><span className="lbl">Tarjetas</span>
            </button>
            <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setV('list')} title="Lista">
              <Icon.list /><span className="lbl">Lista</span>
            </button>
          </div>
          <label className="search"><Icon.search /><input placeholder="Buscar aplicación…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar aplicación" /></label>
        </div>
      </div>

      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && !groups.length && <div className="empty">No tienes aplicaciones asignadas todavía. Pide acceso a un administrador.</div>}

      {groups.map((g) => (
        <section key={g.id} className="col" style={{ gap: 14 }}>
          <div className="row">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: g.color }} />
            <h3 style={{ fontSize: 13, letterSpacing: '.08em' }}>{g.name}</h3>
            <span className="xs muted">{g.apps.length}</span>
          </div>

          {view === 'grid' && (
            <div className="app-grid">
              {g.apps.map((a) => (
                <Link key={a.id} to={linkTo(a)} className="app-cell">
                  <AppIcon initials={a.initials} color={a.color} iconUrl={a.iconUrl} glyph={a.iconGlyph} size={96} shadow />
                  <span className="nm">{a.name}</span>
                </Link>
              ))}
            </div>
          )}

          {view === 'cards' && (
            <div className="app-cards">
              {g.apps.map((a) => (
                <Link key={a.id} to={linkTo(a)} className="app-card-lg">
                  <div className="r1">
                    <AppIcon initials={a.initials} color={a.color} iconUrl={a.iconUrl} glyph={a.iconGlyph} size={54} shadow />
                    <div className="nm">{a.name}</div>
                  </div>
                  <div className="ds">{a.description}</div>
                  <div className="foot"><span className="app-open">Abrir</span></div>
                </Link>
              ))}
            </div>
          )}

          {view === 'list' && (
            <div className="app-list">
              {g.apps.map((a) => (
                <Link key={a.id} to={linkTo(a)} className="app-row">
                  <AppIcon initials={a.initials} color={a.color} iconUrl={a.iconUrl} glyph={a.iconGlyph} size={44} shadow />
                  <div className="col" style={{ gap: 1, minWidth: 0 }}>
                    <span className="nm">{a.name}</span>
                    {a.description && <span className="ds">{a.description}</span>}
                  </div>
                  <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function ViewCardsIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /></svg>;
}
