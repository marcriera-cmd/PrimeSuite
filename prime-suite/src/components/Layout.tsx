import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { Icon, Logo } from './ui';
import { initialsOf, PORTAL_ROLE_LABEL } from '../api';

export default function Layout() {
  const { me, logout } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  if (!me) return null;
  const inViewer = /^\/apps\/[^/]+/.test(loc.pathname);

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <Logo />
          <div>
            <b>Prime Suite</b>
            <small>v2 · Prime ID</small>
          </div>
        </div>
        <nav className="nav" aria-label="Principal">
          <NavLink to="/" end><Icon.home /> Inicio</NavLink>
          <NavLink to="/apps"><Icon.grid /> Aplicaciones</NavLink>
        </nav>
        {me.isAdmin && (
          <nav className="nav" aria-label="Administración">
            <span className="nav-label">Administración</span>
            <NavLink to="/admin/integraciones"><Icon.plug /> Integraciones</NavLink>
            <NavLink to="/admin/identidad"><Icon.shield /> Identidad y SSO</NavLink>
            <NavLink to="/admin/usuarios"><Icon.users /> Usuarios</NavLink>
            <NavLink to="/admin/grupos"><Icon.layers /> Grupos y permisos</NavLink>
            <NavLink to="/admin/empresas"><Icon.building /> Empresas</NavLink>
            {me.isSuper && <NavLink to="/admin/categorias"><Icon.tag /> Categorías</NavLink>}
            <NavLink to="/admin/auditoria"><Icon.list /> Auditoría</NavLink>
          </nav>
        )}
        <div className="side-foot">
          <span>Sesión única activa</span>
          <b>{me.moduleCount} aplicaciones disponibles</b>
          <span>vía Prime ID</span>
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
