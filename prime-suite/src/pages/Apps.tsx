import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AUTH_LABEL, OPEN_LABEL, type Category, type PortalApp } from '../api';
import { AppIcon, ErrorBox, Icon, Loading, useData } from '../components/ui';

export default function Apps() {
  const { data, error } = useData(() => api.get<{ categories: Category[]; apps: PortalApp[] }>('/api/portal/apps'));
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    const apps = data.apps.filter((a) => !term || a.name.toLowerCase().includes(term) || a.description.toLowerCase().includes(term));
    const out = data.categories.map((c) => ({ id: c.id, name: c.name, color: c.color, apps: apps.filter((a) => a.categoryId === c.id) }));
    const known = new Set(data.categories.map((c) => c.id));
    const rest = apps.filter((a) => !a.categoryId || !known.has(a.categoryId));
    if (rest.length) out.push({ id: 'none', name: 'SIN CATEGORÍA', color: '#52525B', apps: rest });
    return out.filter((g) => g.apps.length);
  }, [data, q]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Aplicaciones</h1>
          <span className="muted small">Tu sesión de Prime Suite sirve para todas las aplicaciones con SSO.</span>
        </div>
        <label className="search"><Icon.search /><input placeholder="Buscar aplicación…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar aplicación" /></label>
      </div>
      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && !groups.length && <div className="empty">No tienes aplicaciones asignadas todavía. Pide acceso a un administrador.</div>}
      {groups.map((g) => (
        <section key={g.id} className="col" style={{ gap: 12 }}>
          <div className="row">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: g.color }} />
            <h3 style={{ fontSize: 13, letterSpacing: '.08em' }}>{g.name}</h3>
            <span className="xs muted">{g.apps.length}</span>
          </div>
          <div className="grid-4">
            {g.apps.map((a) => (
              <Link key={a.id} to={a.openMode === 'native' ? '/insights' : `/apps/${a.id}`} className="app-card">
                <span className="row" style={{ gap: 12 }}>
                  <AppIcon initials={a.initials} color={a.color} />
                  <span className="col" style={{ gap: 2, minWidth: 0 }}>
                    <b style={{ fontSize: 14 }}>{a.name}</b>
                    <span className="xs muted">{a.description}</span>
                  </span>
                </span>
                <span className="row wrap" style={{ gap: 6 }}>
                  {a.openMode === 'native' ? <span className="tag info">Integrado en Prime Suite</span> : <span className={`tag ${a.authMethod === 'none' ? 'outline' : 'ok'}`}>{a.authMethod === 'none' ? 'Login propio' : `SSO · ${AUTH_LABEL[a.authMethod]}`}</span>}
                  <span className="tag">{OPEN_LABEL[a.openMode]}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
