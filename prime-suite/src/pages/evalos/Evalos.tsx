// Atajos de Evalos: módulo nativo con las funciones principales de Evalos 8,
// trabajando directamente sobre su base de datos.
import { Fragment } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import { AppIcon, ErrorBox, Loading } from '../../components/ui';
import { SCREENS, screenByKey } from './screens';
import { ConnectionTag, EVALOS_COLOR, loadEvalosMe, useEvalosMe } from './common';
import EvalosConfig from './Config';

export default function Evalos() {
  const { screen } = useParams();
  const { data: me, error, reload } = useEvalosMe();
  if (error) return <ErrorBox error={error} />;
  if (!me) return <Loading />;

  if (!screen) return <Navigate to={`/evalos/${me.configured || !me.canConfigure ? SCREENS[0].key : 'configuracion'}`} replace />;
  const isConfig = screen === 'configuracion';
  const current = screenByKey(screen);
  if (!isConfig && !current) return <Navigate to="/evalos" replace />;
  if (isConfig && !me.canConfigure) return <Navigate to="/evalos" replace />;

  const groups = Array.from(new Set(SCREENS.map((s) => s.group)));

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ gap: 12, flexDirection: 'row', alignItems: 'center' }}>
          <AppIcon initials="AE" color={EVALOS_COLOR} glyph="clock" shadow />
          <div className="col" style={{ gap: 2 }}>
            <h1>Atajos de Evalos</h1>
            <span className="muted small">Las funciones principales de Evalos 8, directamente sobre su base de datos.</span>
          </div>
        </div>
        <ConnectionTag me={me} />
      </div>

      <div className="ev-layout">
        <nav className="card ev-nav" aria-label="Pantallas de Atajos de Evalos">
          {groups.map((g) => (
            <Fragment key={g}>
              <span className="ev-nav-label">{g}</span>
              {SCREENS.filter((s) => s.group === g).map((s) => (
                <NavLink key={s.key} to={`/evalos/${s.key}`} className="ev-nav-item">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: s.glyph }} />
                  {s.title}
                </NavLink>
              ))}
            </Fragment>
          ))}
          {me.canConfigure && (
            <>
              <span className="ev-nav-label" style={{ marginTop: 10 }}>Administración</span>
              <NavLink to="/evalos/configuracion" className="ev-nav-item">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>
                Configuración
              </NavLink>
            </>
          )}
        </nav>

        <section className="ev-main">
          {isConfig ? (
            <EvalosConfig onSaved={() => { loadEvalosMe(true); reload(); }} />
          ) : (
            current && (
              <>
                <div className="col" style={{ gap: 2 }}>
                  <h2>{current.title}</h2>
                  <span className="xs muted">En Evalos 8: {current.evalosPath}</span>
                </div>
                <current.Page />
              </>
            )
          )}
        </section>
      </div>
    </>
  );
}
