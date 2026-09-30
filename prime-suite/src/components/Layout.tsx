import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { Icon, Logo } from './ui';
import { api, initialsOf, PORTAL_ROLE_LABEL, type Category, type PortalApp } from '../api';

export default function Layout() {
  const { me, logout } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [cats, setCats] = useState<Category[]>([]);
  const [adminOpen, setAdminOpen] = useState(loc.pathname.startsWith('/admin'));

  // Categorías con al menos una aplicación accesible, para la barra lateral.
  useEffect(() => {
    api.get<{ categories: Category[]; apps: PortalApp[] }>('/api/portal/apps')
      .then((d) => setCats(d.categories.filter((c) => d.apps.some((a) => a.categoryId === c.id))))
      .catch(() => {});
  }, [me?.user.id]);

  useEffect(() => {
    if (loc.pathname.startsWith('/admin')) setAdminOpen(true);
  }, [loc.pathname]);

  if (!me) return null;
  const inViewer = /^\/apps\/[^/]+/.test(loc.pathname);
  const activeCat = new URLSearchParams(loc.search).get('cat');

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <Logo />
          <div>
            <b>Prime Suite</b>
          </div>
        </div>

        <nav className="nav" aria-label="Principal">
          <NavLink to="/" end><Icon.home /> Inicio</NavLink>
          <NavLink to="/apps" end><Icon.grid /> Todas las aplicaciones</NavLink>
        </nav>

        {cats.length > 0 && (
          <nav className="nav" aria-label="Categorías">
            <span className="nav-label">Aplicaciones</span>
            {cats.map((c) => {
              const on = loc.pathname === '/apps' && activeCat === c.id;
              return (
                <NavLink key={c.id} to={`/apps?cat=${c.id}`} className={on ? 'active' : undefined}>
                  <span className="cat-dot" style={{ background: c.color }} /> {c.name}
                </NavLink>
              );
            })}
          </nav>
        )}

        {me.isAdmin && (
          <nav className="nav" aria-label="Administración">
            <button className="nav-group-btn" aria-expanded={adminOpen} onClick={() => setAdminOpen((v) => !v)}>
              <Icon.settings /> Administración
              <span className={`chev ${adminOpen ? 'open' : ''}`}><Icon.chevron /></span>
            </button>
            {adminOpen && (
              <>
                <NavLink to="/admin/integraciones" className="sub"><Icon.plug /> Integraciones</NavLink>
                <NavLink to="/admin/identidad" className="sub"><Icon.shield /> Identidad y SSO</NavLink>
                <NavLink to="/admin/usuarios" className="sub"><Icon.users /> Usuarios</NavLink>
                <NavLink to="/admin/grupos" className="sub"><Icon.layers /> Grupos y permisos</NavLink>
                <NavLink to="/admin/empresas" className="sub"><Icon.building /> Empresas</NavLink>
                {me.isSuper && <NavLink to="/admin/categorias" className="sub"><Icon.tag /> Categorías</NavLink>}
                <NavLink to="/admin/auditoria" className="sub"><Icon.list /> Auditoría</NavLink>
              </>
            )}
          </nav>
        )}

        <div className="side-foot">
          <b>{me.moduleCount} aplicaciones disponibles</b>
          <span>en {me.company.name}</span>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <span className="tenant" title="Empresa">
            <span className="dot" /> {me.company.name} <span className="mono muted">{me.company.code}</span>
          </span>
          <div className="top-user">
            <NavLink to="/perfil" className="row" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="col" style={{ gap: 0, alignItems: 'flex-end' }}>
                <span className="small" style={{ fontWeight: 600 }}>{me.user.firstName} {me.user.lastName}</span>
                <span className="xs muted">{PORTAL_ROLE_LABEL[me.user.role]}</span>
              </div>
              <span className="avatar">{initialsOf(me.user.firstName, me.user.lastName)}</span>
            </NavLink>
            <button className="icon-btn" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={async () => { await logout(); nav('/login'); }}>
              <Icon.logout />
            </button>
          </div>
        </header>
        {inViewer ? <Outlet /> : <main className="content"><Outlet /></main>}
      </div>
    </div>
  );
}
