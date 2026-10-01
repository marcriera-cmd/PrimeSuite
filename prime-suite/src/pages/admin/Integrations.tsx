import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, AUTH_LABEL, OPEN_LABEL, type AdminModule, type Category } from '../../api';
import { useSession } from '../../session';
import { AppIcon, ErrorBox, Icon, Loading, useData } from '../../components/ui';

export default function Integrations() {
  const { me } = useSession();
  const nav = useNavigate();
  const { data, error } = useData(() => Promise.all([api.get<AdminModule[]>('/api/admin/modules'), api.get<Category[]>('/api/admin/categories')]));
  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const mods = data?.[0] || [];
  const cats = data?.[1] || [];
  const list = useMemo(
    () => mods.filter((m) => (cat === 'all' || m.categoryId === cat) && (!q || (m.name + m.url + m.clientId).toLowerCase().includes(q.toLowerCase()))),
    [mods, cat, q]
  );
  const stats = [
    { v: mods.filter((m) => m.enabled).length, l: 'integraciones activas' },
    { v: mods.filter((m) => m.enabled && m.authMethod !== 'none').length, l: 'con SSO de Prime ID' },
    { v: mods.filter((m) => m.widgets.length > 0).length, l: 'publican widgets' },
    { v: mods.filter((m) => m.enabled && m.authMethod === 'none').length, l: 'aún con login propio' }
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Integraciones</h1>
          <span className="muted small">Añade cualquier aplicación con su URL y decide qué empresas y grupos la ven.</span>
        </div>
        {me?.isSuper && <Link to="/admin/integraciones/nueva" className="btn primary"><Icon.plus /> Nueva integración</Link>}
      </div>
      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="grid-4">
            {stats.map((s) => (
              <div key={s.l} className="card" style={{ gap: 2 }}><span className="stat">{s.v}</span><span className="small muted">{s.l}</span></div>
            ))}
          </div>
          <div className="row wrap">
            <button className={`btn sm ${cat === 'all' ? 'primary' : ''}`} onClick={() => setCat('all')}>Todas</button>
            {cats.map((c) => <button key={c.id} className={`btn sm ${cat === c.id ? 'primary' : ''}`} onClick={() => setCat(c.id)}>{c.name}</button>)}
            <label className="search" style={{ marginLeft: 'auto' }}><Icon.search /><input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar integración" /></label>
          </div>
          <div className="card flat table-wrap">
            <table className="table">
              <thead><tr><th>Aplicación</th><th>Categoría</th><th>Autenticación</th><th>Apertura</th><th>Empresas</th><th>Widgets</th><th>Estado</th></tr></thead>
              <tbody>
                {list.map((m) => {
                  const c = cats.find((x) => x.id === m.categoryId);
                  return (
                    <tr key={m.id} className="clickable" onClick={() => nav(`/admin/integraciones/${m.id}`)}>
                      <td>
                        <div className="row">
                          <AppIcon initials={m.initials} color={m.color} iconUrl={m.iconUrl} glyph={m.iconGlyph} size={32} />
                          <div className="col" style={{ gap: 0, minWidth: 0 }}>
                            <Link to={`/admin/integraciones/${m.id}`} style={{ color: 'inherit', fontWeight: 600 }} onClick={(e) => e.stopPropagation()}>{m.name}</Link>
                            <span className="mono muted" style={{ fontSize: 11, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.url}</span>
                          </div>
                        </div>
                      </td>
                      <td>{c ? <span className="tag" style={{ color: c.color }}>{c.name}</span> : <span className="muted">—</span>}</td>
                      <td><span className={`tag ${m.authMethod === 'none' ? 'outline' : 'ok'}`}>{AUTH_LABEL[m.authMethod]}</span></td>
                      <td className="muted">{OPEN_LABEL[m.openMode]}</td>
                      <td>{m.companyCount ?? 0}</td>
                      <td>{m.widgets.length || '—'}</td>
                      <td>{m.enabled ? <span className="tag ok">Activa</span> : <span className="tag outline">Desactivada</span>}</td>
                    </tr>
                  );
                })}
                {!list.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 28 }}>Sin integraciones</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
