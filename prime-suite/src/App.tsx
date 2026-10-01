import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './session';
import { Loading } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Register from './pages/Register';
import Home from './pages/Home';
import Apps from './pages/Apps';
import Viewer from './pages/Viewer';
import Profile from './pages/Profile';
import Integrations from './pages/admin/Integrations';
import IntegrationWizard from './pages/admin/IntegrationWizard';
import IntegrationEdit from './pages/admin/IntegrationEdit';
import Identity from './pages/admin/Identity';
import Users from './pages/admin/Users';
import Groups from './pages/admin/Groups';
import Companies from './pages/admin/Companies';
import Categories from './pages/admin/Categories';
import Audit from './pages/admin/Audit';
import Insights from './pages/insights/Insights';

export default function App() {
  const { me, loading, needsSetup } = useSession();
  const loc = useLocation();
  if (loading) return <Loading />;

  if (!me) {
    return (
      <Routes>
        <Route path="/setup" element={needsSetup ? <Setup /> : <Navigate to="/login" replace />} />
        <Route path="/login" element={needsSetup ? <Navigate to="/setup" replace /> : <Login />} />
        <Route path="/registro" element={<Register />} />
        <Route path="*" element={<Navigate to={needsSetup ? '/setup' : `/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginRedirect />} />
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="apps" element={<Apps />} />
        <Route path="apps/:id" element={<Viewer />} />
        <Route path="perfil" element={<Profile />} />
        <Route path="insights" element={<Insights />} />
        {me.isAdmin && (
          <Route path="admin">
            <Route path="integraciones" element={<Integrations />} />
            <Route path="integraciones/nueva" element={me.isSuper ? <IntegrationWizard /> : <Navigate to="/admin/integraciones" />} />
            <Route path="integraciones/:id" element={<IntegrationEdit />} />
            <Route path="identidad" element={<Identity />} />
            <Route path="usuarios" element={<Users />} />
            <Route path="grupos" element={<Groups />} />
            <Route path="empresas" element={<Companies />} />
            <Route path="categorias" element={<Categories />} />
            <Route path="auditoria" element={<Audit />} />
          </Route>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

// Tras iniciar sesión, vuelve a la URL pedida (p. ej. /oidc/authorize de una app).
function LoginRedirect() {
  const next = new URLSearchParams(useLocation().search).get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    if (next.startsWith('/oidc/')) {
      window.location.replace(next);
      return <Loading />;
    }
    return <Navigate to={next} replace />;
  }
  return <Navigate to="/" replace />;
}
