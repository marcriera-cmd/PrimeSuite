import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, AUTH_LABEL, fmtDate, type AdminModule, type Category } from '../../api';
import { useSession } from '../../session';
import { AppIcon, ErrorBox, Icon, Loading, confirmAction, useToast } from '../../components/ui';
import { AccessEditor, AuthEditor, GeneralFields, WidgetsEditor, draftPayload, type CompanyAccess, type Draft } from './moduleForm';

type Full = AdminModule & { companies: CompanyAccess[]; resolvedUrl: string };
const TABS = ['General', 'Autenticación', 'Widgets', 'Acceso'];

export default function IntegrationEdit() {
  const { id = '' } = useParams();
  const { me } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [m, setM] = useState<Full | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const readOnly = !me?.isSuper;

  const load = () =>
    Promise.all([api.get<Full>(`/api/admin/modules/${id}`), api.get<Category[]>('/api/admin/categories')])
      .then(([mod, c]) => {
        setM(mod);
        setCats(c);
        const { id: _i, hasSecret, createdAt, updatedAt, companyCount, resolvedUrl, ...rest } = mod;
        setD({ ...rest, initiateLoginUri: rest.initiateLoginUri || '', manifestUrl: rest.manifestUrl || '' });
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error && !m) return <ErrorBox error={error} />;
  if (!m || !d) return <Loading />;
  const set = (p: Partial<Draft>) => setD((x) => (x ? { ...x, ...p } : x));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/admin/modules/${id}`, draftPayload(d!));
      toast('Cambios guardados');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirmAction(`¿Eliminar la integración "${m!.name}"? Se quitará de todas las empresas y grupos.`)) return;
    await api.del(`/api/admin/modules/${id}`);
    toast('Integración eliminada');
    nav('/admin/integraciones');
  }

  return (
    <>
      <div className="page-head">
        <div>
          <span className="small muted"><Link to="/admin/integraciones">Integraciones</Link> / {m.name}</span>
          <div className="row" style={{ gap: 12 }}>
            <AppIcon initials={d.initials} color={d.color} />
            <div className="col" style={{ gap: 2 }}>
              <h1>{m.name}</h1>
              <span className="xs muted">
                <span className="mono">{m.clientId}</span> · {AUTH_LABEL[m.authMethod]} · actualizada {fmtDate(m.updatedAt)}
              </span>
            </div>
          </div>
        </div>
        <div className="row">
          <Link to={`/apps/${m.id}`} className="btn"><Icon.ext /> Probar</Link>
          {!readOnly && <button className="btn danger" onClick={remove}><Icon.trash /> Eliminar</button>}
          {!readOnly && <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>}
        </div>
      </div>
      {readOnly && <div className="alert info small">Solo un superadministrador puede modificar integraciones.</div>}
      <ErrorBox error={error} />
      <div className="tabs" role="tablist">
        {TABS.map((t, i) => <button key={t} role="tab" aria-selected={tab === i} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>{t}</button>)}
      </div>
      <fieldset disabled={readOnly} className="card" style={{ padding: 24, border: '1px solid var(--line)' }}>
        {tab === 0 && <GeneralFields d={d} set={set} cats={cats} />}
        {tab === 1 && <AuthEditor d={d} set={set} moduleId={m.id} hasSecret={m.hasSecret} onSecret={() => api.get<Full>(`/api/admin/modules/${id}`).then(setM)} />}
        {tab === 2 && <WidgetsEditor d={d} set={set} />}
        {tab === 3 && <AccessEditor d={d} set={set} />}
      </fieldset>
    </>
  );
}
