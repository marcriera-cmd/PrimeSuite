import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { Icon, LogoMark } from './ui';
import { api, initialsOf, PORTAL_ROLE_LABEL, type Category, type PortalApp } from '../api';
import { ModulesProvider, useModules } from '../modules';
import ModuleHost from './ModuleHost';

export default function Layout() {
  // El proveedor de módulos envuelve toda la zona autenticada, de modo que los
  // iframes de los módulos abiertos se mantienen vivos al cambiar de ruta.
  return (
    <ModulesProvider>
      <Shell />
    </ModulesProvider>
  );
}

const NAV_KEY = 'ps.nav.open';

function Shell() {
  const { me, logout } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const { setOnNative } = useModules();
  const [cats, setCats] = useState<Category[]>([]);
  const [adminOpen, setAdminOpen] = useState(loc.pathname.startsWith('/admin'));
  const [navOpen, setNavOpen] = useState(() => {
    try {
      const v = localStorage.getItem(NAV_KEY);
      if (v !== null) return v === '1';
    } catch {}
    return typeof window === 'undefined' || window.innerWidth > 760;
  });

  // Los módulos nativos (p. ej. Prime Insights) navegan a su ruta interna.
  useEffect(() => { setOnNative((url) => nav(url)); }, [setOnNative, nav]);

  // Categorías con al menos una aplicación accesible, para la barra lateral.
  useEffect(() => {
    api.get<{ categories: Category[]; apps: PortalApp[] }>('/api/portal/apps')
      .then((d) => setCats(d.categories.filter((c) => d.apps.some((a) => a.categoryId === c.id))))
      .catch(() => {});
  }, [me?.user.id]);

  useEffect(() => {
    if (loc.pathname.startsWith('/admin')) setAdminOpen(true);
  }, [loc.pathname]);

  // En móvil, al cambiar de ruta se cierra el menú superpuesto.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 760) setNavOpen(false);
  }, [loc.pathname]);

  const toggleNav = () => setNavOpen((v) => {
    const n = !v;
    try { localStorage.setItem(NAV_KEY, n ? '1' : '0'); } catch {}
    return n;
  });

  if (!me) return null;
  const activeCat = new URLSearchParams(loc.search).get('cat');

  return (
    <div className={`shell${navOpen ? '' : ' nav-hidden'}`}>
      {navOpen && <div className="nav-backdrop" onClick={toggleNav} aria-hidden="true" />}
      <aside className="side">
        <div className="brand">
          <LogoMark size={22} color="currentColor" />
          <span className="brand-name">Prime Suite</span>
          <button className="icon-btn side-collapse" title="Ocultar menú" aria-label="Ocultar menú" onClick={toggleNav}>
            <Icon.panel />
          </button>
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
          <button className="icon-btn nav-toggle" title={navOpen ? 'Ocultar menú' : 'Mostrar menú'} aria-label={navOpen ? 'Ocultar menú' : 'Mostrar menú'} onClick={toggleNav}>
            <Icon.menu />
          </button>
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

        <div className="work">
          <div className="work-scroll">
            <main className="content"><Outlet /></main>
          </div>
          <ModuleHost />
        </div>
      </div>
    </div>
  );
}
