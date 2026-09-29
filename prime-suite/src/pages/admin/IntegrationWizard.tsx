import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, AUTH_LABEL, OPEN_LABEL, type AdminModule, type Category, type Company } from '../../api';
import { useSession } from '../../session';
import { CopyValue, Icon, Modal, Spinner, useToast } from '../../components/ui';
import { AccessEditor, AuthEditor, GeneralFields, WidgetsEditor, draftPayload, emptyDraft, type Draft } from './moduleForm';

interface Analysis {
  finalUrl: string;
  checks: { level: 'ok' | 'warn' | 'info'; title: string; detail: string }[];
  manifestUrl?: string;
  suggestion: Partial<Draft>;
}

const STEPS = ['Aplicación', 'Análisis', 'Datos', 'Autenticación', 'Widgets y acceso'];

export default function IntegrationWizard() {
  const { me } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [d, setD] = useState<Draft>(emptyDraft());
  const [cats, setCats] = useState<Category[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; secret?: string } | null>(null);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  useEffect(() => {
    Promise.all([api.get<Category[]>('/api/admin/categories'), api.get<Company[]>('/api/admin/companies')]).then(([c, cos]) => {
      setCats(c);
      set({ companies: cos.map((co) => ({ id: co.id, name: co.name, code: co.code, enabled: co.id === me?.company.id, url: '' })) });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function analyze(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<Analysis>('/api/admin/analyze', { url: d.url });
      setAnalysis(r);
      const s = r.suggestion;
      set({ ...s, manifestUrl: r.manifestUrl || '', name: d.name || s.name || '', initials: s.initials || d.initials, clientId: d.clientId });
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const m = await api.post<AdminModule & { clientSecret?: string }>('/api/admin/modules', draftPayload(d));
      toast('Integración publicada');
      if (m.clientSecret) setCreated({ id: m.id, secret: m.clientSecret });
      else nav(`/admin/integraciones/${m.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const canNext = step === 3 ? !!d.name && !!d.url : step === 4 ? d.authMethod !== 'oidc' || d.redirectUris.length > 0 : true;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="small muted"><Link to="/admin/integraciones">Integraciones</Link> / Nueva</span>
          <h1>Nueva integración</h1>
        </div>
      </div>
      <div className="steps">
        {STEPS.map((s, i) => (
          <button key={s} className={`step ${step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}`} onClick={() => (i + 1 < step || d.url) && setStep(i + 1)}>
            <i>{step > i + 1 ? '✓' : i + 1}</i> {s}
          </button>
        ))}
      </div>
      <div className="card" style={{ padding: 28, gap: 22 }}>
        {error && <div className="alert error">{error}</div>}

        {step === 1 && (
          <form className="col" style={{ gap: 18 }} onSubmit={analyze}>
            <div className="col" style={{ gap: 4 }}>
              <h2>¿Qué aplicación quieres integrar?</h2>
              <span className="muted small">Pega cualquier URL. Prime Suite la analiza y te propone la mejor forma de integrarla.</span>
            </div>
            <label className="field">URL de la aplicación
              <input className="input mono" style={{ fontSize: 15, padding: '12px 14px' }} value={d.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://app.proveedor.com/" required autoFocus />
            </label>
            <div className="row">
              <button className="btn primary" disabled={busy || !d.url}>{busy ? <><Spinner /> Analizando…</> : 'Analizar URL'}</button>
              <button type="button" className="btn ghost" onClick={() => d.url && setStep(3)} disabled={!d.url}>Configurar a mano</button>
              <span className="xs muted" style={{ marginLeft: 'auto' }}>Prueba con <button type="button" className="btn sm" onClick={() => set({ url: '/demo-app/' })}>/demo-app/</button></span>
            </div>
          </form>
        )}

        {step === 2 && analysis && (
          <div className="row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
            <div className="col grow" style={{ gap: 10, minWidth: 320 }}>
              <h2>Análisis automático</h2>
              <span className="mono muted">{analysis.finalUrl}</span>
              {analysis.checks.map((c, i) => (
                <div key={i} className="checkline">
                  {c.level === 'ok' ? <Icon.ok /> : c.level === 'warn' ? <Icon.warn /> : <Icon.info />}
                  <div className="col" style={{ gap: 2 }}><b className="small">{c.title}</b><span className="xs muted">{c.detail}</span></div>
                </div>
              ))}
            </div>
            <div className="card" style={{ width: 320, background: 'var(--ink)', color: '#fff', border: 0 }}>
              <span className="xs" style={{ letterSpacing: '.08em', color: '#B9B5C2', fontWeight: 600 }}>RECOMENDACIÓN</span>
              <h2 style={{ color: '#fff' }}>{AUTH_LABEL[d.authMethod]} · {OPEN_LABEL[d.openMode].toLowerCase()}</h2>
              <span className="small" style={{ color: '#D6D3DC', lineHeight: 1.5 }}>
                {d.authMethod === 'none'
                  ? 'No se ha detectado soporte de SSO. Se integrará con su propio login; el equipo de la app puede añadir Prime Token con el SDK.'
                  : 'La app publica su manifiesto: autenticación, URLs de retorno y widgets quedan preconfigurados. Puedes revisarlos en los siguientes pasos.'}
              </span>
              {d.widgets.length > 0 && <span className="small" style={{ color: '#D6D3DC' }}>{d.widgets.length} widget(s) detectados.</span>}
            </div>
          </div>
        )}

        {step === 3 && <GeneralFields d={d} set={set} cats={cats} />}
        {step === 4 && <AuthEditor d={d} set={set} isNew />}
        {step === 5 && (
          <div className="col" style={{ gap: 24 }}>
            <div className="col"><h2>Widgets</h2><WidgetsEditor d={d} set={set} /></div>
            <div className="divider" />
            <div className="col"><h2>Acceso</h2><AccessEditor d={d} set={set} /></div>
          </div>
        )}

        <div className="row" style={{ paddingTop: 18, borderTop: '1px solid var(--line-2)' }}>
          <Link to="/admin/integraciones" className="btn ghost">Cancelar</Link>
          <div className="row" style={{ marginLeft: 'auto' }}>
            {step > 1 && <button className="btn" onClick={() => setStep(step === 3 && !analysis ? 1 : step - 1)}>Atrás</button>}
            {step === 1 ? null : step < 5 ? (
              <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Siguiente</button>
            ) : (
              <button className="btn success" disabled={busy} onClick={publish}>{busy ? 'Publicando…' : 'Publicar integración'}</button>
            )}
          </div>
        </div>
        {step === 4 && !canNext && <span className="xs muted" style={{ textAlign: 'right' }}>OIDC necesita al menos una Redirect URI.</span>}
      </div>
      {created?.secret && (
        <Modal title="Integración creada" onClose={() => nav(`/admin/integraciones/${created.id}`)}>
          <span className="small">Secreto del cliente OIDC. Cópialo ahora: no se volverá a mostrar.</span>
          <div className="kv"><CopyValue value={created.secret} /></div>
          <button className="btn primary" onClick={() => nav(`/admin/integraciones/${created.id}`)}>Continuar</button>
        </Modal>
      )}
    </>
  );
}
