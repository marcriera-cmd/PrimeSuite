import { useEffect, useState, type FormEvent } from 'react';
import { api, type Company, type Group, type InsightCategory, type InsightDashboard, type SupersetServer } from '../../api';
import { Drawer, ErrorBox, Icon, Loading, Modal, Spinner, Toggle, confirmAction, useData, useToast } from '../../components/ui';
import SupersetEmbed from '../../components/SupersetEmbed';

interface AdminData { canEdit: boolean; servers: SupersetServer[]; categories: InsightCategory[]; dashboards: InsightDashboard[] }
const load = () => api.get<AdminData>('/api/insights/admin');

// ================= Dashboards =================
export function DashboardsAdmin({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useData(load);
  const [edit, setEdit] = useState<InsightDashboard | 'new' | null>(null);
  const [preview, setPreview] = useState<InsightDashboard | null>(null);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const refresh = () => { reload(); onChange(); };
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const list = data.dashboards.filter((d) => (!cat || d.categoryId === cat) && (!q || d.name.toLowerCase().includes(q.toLowerCase())));
  const catName = (id: string | null) => data.categories.find((c) => c.id === id)?.name || '—';
  const srvName = (id: string | null) => data.servers.find((s) => s.id === id)?.name || '—';

  async function toggle(d: InsightDashboard, patch: Partial<InsightDashboard>) {
    try {
      await api.put(`/api/insights/dashboards/${d.id}`, { ...d, ...patch });
      refresh();
    } catch (e: any) {
      toast(e.message, true);
    }
  }
  async function remove(d: InsightDashboard) {
    if (!confirmAction(`¿Eliminar "${d.name}" de Prime Insights? (No se borra en Superset)`)) return;
    await api.del(`/api/insights/dashboards/${d.id}`);
    toast('Dashboard eliminado');
    refresh();
  }

  return (
    <>
      <div className="row wrap">
        <label className="search grow"><Icon.search /><input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></label>
        <select className="select" style={{ width: 200 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn" disabled={!data.servers.length} title={!data.servers.length ? 'Primero añade un servidor Superset' : ''} onClick={() => setImporting(true)}>Importar desde Superset</button>
        <button className="btn primary" onClick={() => setEdit('new')}><Icon.plus /> Nuevo dashboard</button>
      </div>
      {!data.servers.length && <div className="alert info small">Empieza añadiendo un servidor en la pestaña <b>Servidores Superset</b>. Después podrás importar todos sus dashboards de una vez.</div>}
      <div className="card flat table-wrap">
        <table className="table">
          <thead><tr><th>Orden</th><th>Nombre</th><th>Categoría</th><th>Servidor</th><th>Carga</th><th>Widget en Inicio</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td style={{ width: 70 }}>{d.order}</td>
                <td><b className="small">{d.name}</b>{d.description && <div className="xs muted">{d.description}</div>}</td>
                <td className="small">{catName(d.categoryId)}</td>
                <td className="small muted">{srvName(d.serverId)}</td>
                <td>{d.embeddedUuid && d.serverId ? <span className="tag ok">Embebido · SSO</span> : <span className="tag warn">Iframe directo</span>}</td>
                <td><Toggle on={d.showAsWidget} label={`Widget ${d.name}`} disabled={!d.embeddedUuid} onChange={(v) => toggle(d, { showAsWidget: v })} /></td>
                <td><Toggle on={d.enabled} label={`Activo ${d.name}`} onChange={(v) => toggle(d, { enabled: v })} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="icon-btn" aria-label="Ver" title="Ver" onClick={() => setPreview(d)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg></button>
                  <button className="icon-btn" aria-label="Editar" title="Editar" onClick={() => setEdit(d)}><Icon.edit /></button>
                  <button className="icon-btn" aria-label="Eliminar" title="Eliminar" onClick={() => remove(d)}><Icon.trash /></button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 28 }}>Sin dashboards</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <DashboardDrawer dash={edit === 'new' ? null : edit} data={data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
      {importing && <ImportModal data={data} onClose={() => setImporting(false)} onDone={() => { setImporting(false); refresh(); }} />}
      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)} wide>
          <div style={{ height: 520 }}><SupersetEmbed dashboardId={preview.id} embedded={!!(preview.embeddedUuid && preview.serverId)} dashboardUrl={preview.dashboardUrl} /></div>
        </Modal>
      )}
    </>
  );
}

function useAssignables() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  useEffect(() => {
    api.get<Company[]>('/api/admin/companies').then(setCompanies).catch(() => {});
    api.get<Group[]>('/api/admin/groups').then(setGroups).catch(() => {});
  }, []);
  return { companies, groups };
}

function DashboardDrawer({ dash, data, onClose, onSaved }: { dash: InsightDashboard | null; data: AdminData; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { companies, groups } = useAssignables();
  const [f, setF] = useState<Partial<InsightDashboard>>(
    dash || { name: '', description: '', categoryId: data.categories[0]?.id || null, serverId: data.servers[0]?.id || null, embeddedUuid: '', dashboardUrl: '', order: 50, enabled: true, showAsWidget: false, companyIds: [], groupIds: [], rlsClause: '' }
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<InsightDashboard>) => setF({ ...f, ...p });
  const toggleIn = (k: 'companyIds' | 'groupIds', v: string) => set({ [k]: (f[k] || []).includes(v) ? (f[k] || []).filter((x) => x !== v) : [...(f[k] || []), v] });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (dash) await api.put(`/api/insights/dashboards/${dash.id}`, f);
      else await api.post('/api/insights/dashboards', f);
      toast('Dashboard guardado');
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function enableEmbed() {
    if (!dash) return;
    try {
      const d = await api.post<InsightDashboard>(`/api/insights/dashboards/${dash.id}/enable-embed`);
      set({ embeddedUuid: d.embeddedUuid });
      toast('Embebido activado en Superset');
    } catch (err: any) {
      setError(err.message);
    }
  }
  const visibleGroups = groups.filter((g) => !f.companyIds?.length || g.companyId === null || f.companyIds.includes(g.companyId));

  return (
    <Drawer title={<h2>{dash ? 'Editar dashboard' : 'Nuevo dashboard'}</h2>} onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <ErrorBox error={error} />
        <label className="field">Nombre<input className="input" value={f.name || ''} onChange={(e) => set({ name: e.target.value })} required /></label>
        <label className="field">Descripción<textarea className="textarea" value={f.description || ''} onChange={(e) => set({ description: e.target.value })} /></label>
        <div className="grid-2">
          <label className="field">Categoría
            <select className="select" value={f.categoryId || ''} onChange={(e) => set({ categoryId: e.target.value || null })}>
              <option value="">Sin categoría</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">Orden<input className="input" type="number" value={f.order ?? 50} onChange={(e) => set({ order: Number(e.target.value) })} /></label>
        </div>
        <h3>Origen en Superset</h3>
        <label className="field">Servidor
          <select className="select" value={f.serverId || ''} onChange={(e) => set({ serverId: e.target.value || null })}>
            <option value="">— Ninguno (solo iframe directo) —</option>
            {data.servers.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.baseUrl}</option>)}
          </select>
        </label>
        <label className="field">UUID de embebido<span className="hint">Superset › Dashboard › ··· › Embed dashboard. Con UUID el usuario entra sin login de Superset (guest token).</span>
          <div className="row">
            <input className="input mono grow" value={f.embeddedUuid || ''} onChange={(e) => set({ embeddedUuid: e.target.value })} placeholder="ee283b18-1494-43f1-9708-df0879f4f1ba" />
            {dash?.supersetId && !f.embeddedUuid && <button type="button" className="btn sm" onClick={enableEmbed}>Activar en Superset</button>}
          </div>
        </label>
        <label className="field">URL directa del dashboard<span className="hint">Opcional. Se usa si no hay UUID (iframe plano; Superset pedirá login).</span>
          <input className="input mono" value={f.dashboardUrl || ''} onChange={(e) => set({ dashboardUrl: e.target.value })} placeholder="https://superset.empresa.com/superset/dashboard/27/" />
        </label>
        <label className="field">Filtro por empresa (RLS)<span className="hint">Cláusula SQL que Superset aplica a todos los gráficos. Variables: {'{tenant}'}, {'{email}'}, {'{company_id}'}. Ej.: <code className="mono">empresa = '{'{tenant}'}'</code></span>
          <input className="input mono" value={f.rlsClause || ''} onChange={(e) => set({ rlsClause: e.target.value })} placeholder="empresa = '{tenant}'" />
        </label>
        <h3>Acceso</h3>
        <div className="field">Empresas<span className="hint">Ninguna marcada = todas las empresas con Prime Insights.</span>
          <div className="row wrap">
            {companies.map((c) => <label key={c.id} className="check tag" style={{ padding: '6px 10px' }}><input type="checkbox" checked={!!f.companyIds?.includes(c.id)} onChange={() => toggleIn('companyIds', c.id)} />{c.name}</label>)}
          </div>
        </div>
        <div className="field">Grupos<span className="hint">Ninguno marcado = todos los usuarios de esas empresas.</span>
          <div className="row wrap">
            {visibleGroups.map((g) => <label key={g.id} className="check tag" style={{ padding: '6px 10px' }}><input type="checkbox" checked={!!f.groupIds?.includes(g.id)} onChange={() => toggleIn('groupIds', g.id)} />{g.name}</label>)}
            {!visibleGroups.length && <span className="xs muted">Sin grupos</span>}
          </div>
        </div>
        <label className="check"><input type="checkbox" checked={!!f.showAsWidget} onChange={(e) => set({ showAsWidget: e.target.checked })} /> Ofrecerlo como widget en el Inicio (requiere UUID)</label>
        <label className="check"><input type="checkbox" checked={!!f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Activo</label>
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </form>
    </Drawer>
  );
}

interface Remote { supersetId: number; title: string; url: string; published: boolean; changedOn?: string; embeddedUuid: string | null; imported: boolean }

function ImportModal({ data, onClose, onDone }: { data: AdminData; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { companies } = useAssignables();
  const [serverId, setServerId] = useState(data.servers[0]?.id || '');
  const [remote, setRemote] = useState<Remote[] | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [opts, setOpts] = useState({ categoryId: data.categories[0]?.id || '', enableEmbed: true, showAsWidget: false, companyIds: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!serverId) return;
    setRemote(null);
    setError(null);
    api.get<Remote[]>(`/api/insights/servers/${serverId}/discover`).then((r) => { setRemote(r); setSel(r.filter((x) => !x.imported).map((x) => x.supersetId)); }).catch((e) => setError(e.message));
  }, [serverId]);

  async function doImport() {
    setBusy(true);
    try {
      const items = (remote || []).filter((r) => sel.includes(r.supersetId));
      const r = await api.post<{ created: number; errors: string[] }>(`/api/insights/servers/${serverId}/import`, { items, ...opts });
      toast(`${r.created} dashboard(s) importados`);
      if (r.errors.length) toast(`No se pudo activar el embebido en: ${r.errors.join(' · ')}`, true);
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Importar dashboards desde Superset" onClose={onClose} wide>
      <label className="field">Servidor
        <select className="select" value={serverId} onChange={(e) => setServerId(e.target.value)}>
          {data.servers.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.baseUrl}</option>)}
        </select>
      </label>
      <ErrorBox error={error} />
      {!remote && !error && <div className="row"><Spinner /> <span className="small muted">Consultando Superset…</span></div>}
      {remote && (
        <>
          <div className="card flat" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th><input type="checkbox" aria-label="Todos" checked={sel.length === remote.filter((r) => !r.imported).length && sel.length > 0} onChange={(e) => setSel(e.target.checked ? remote.filter((r) => !r.imported).map((r) => r.supersetId) : [])} /></th><th>Dashboard</th><th>Embebido</th><th></th></tr></thead>
              <tbody>
                {remote.map((r) => (
                  <tr key={r.supersetId}>
                    <td><input type="checkbox" aria-label={r.title} disabled={r.imported} checked={sel.includes(r.supersetId)} onChange={(e) => setSel(e.target.checked ? [...sel, r.supersetId] : sel.filter((x) => x !== r.supersetId))} /></td>
                    <td className="small"><b>{r.title}</b> <span className="xs muted">#{r.supersetId}{r.published ? '' : ' · borrador'}</span></td>
                    <td>{r.embeddedUuid ? <span className="tag ok">Sí</span> : <span className="tag outline">No</span>}</td>
                    <td>{r.imported && <span className="tag">Ya importado</span>}</td>
                  </tr>
                ))}
                {!remote.length && <tr><td colSpan={4} className="muted small" style={{ padding: 20 }}>El usuario de servicio no ve ningún dashboard</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="grid-2">
            <label className="field">Categoría
              <select className="select" value={opts.categoryId} onChange={(e) => setOpts({ ...opts, categoryId: e.target.value })}>
                <option value="">Sin categoría</option>
                {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div className="field">Empresas<span className="hint">Ninguna = todas</span>
              <div className="row wrap">{companies.map((c) => <label key={c.id} className="check tag" style={{ padding: '4px 8px' }}><input type="checkbox" checked={opts.companyIds.includes(c.id)} onChange={() => setOpts({ ...opts, companyIds: opts.companyIds.includes(c.id) ? opts.companyIds.filter((x) => x !== c.id) : [...opts.companyIds, c.id] })} />{c.name}</label>)}</div>
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={opts.enableEmbed} onChange={(e) => setOpts({ ...opts, enableEmbed: e.target.checked })} /> Activar "Embed dashboard" en Superset para los que no lo tengan (dominio permitido: este portal)</label>
          <label className="check"><input type="checkbox" checked={opts.showAsWidget} onChange={(e) => setOpts({ ...opts, showAsWidget: e.target.checked })} /> Ofrecerlos como widgets en el Inicio</label>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !sel.length} onClick={doImport}>{busy ? 'Importando…' : `Importar ${sel.length} dashboard(s)`}</button>
        </>
      )}
    </Modal>
  );
}

// ================= Servidores =================
export function ServersAdmin() {
  const toast = useToast();
  const { data, error, reload } = useData(load);
  const [edit, setEdit] = useState<SupersetServer | 'new' | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  async function test(s: SupersetServer) {
    setTesting(s.id);
    try {
      const r = await api.post<{ user: string; dashboards: number }>(`/api/insights/servers/${s.id}/test`);
      toast(`Conexión correcta · usuario ${r.user} · ${r.dashboards} dashboards visibles`);
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setTesting(null);
    }
  }
  async function remove(s: SupersetServer) {
    if (!confirmAction(`¿Eliminar el servidor ${s.name}?`)) return;
    try {
      await api.del(`/api/insights/servers/${s.id}`);
      reload();
    } catch (e: any) {
      toast(e.message, true);
    }
  }
  const origin = window.location.origin;
  return (
    <>
      <div className="row"><span className="grow muted small">Prime Suite usa una cuenta de servicio de cada Superset para listar dashboards y emitir guest tokens. La contraseña se guarda cifrada.</span><button className="btn primary" onClick={() => setEdit('new')}><Icon.plus /> Añadir servidor</button></div>
      <div className="grid-2">
        {data.servers.map((s) => (
          <div key={s.id} className="card">
            <div className="row"><b className="grow">{s.name}</b><button className="icon-btn" aria-label="Editar" onClick={() => setEdit(s)}><Icon.edit /></button><button className="icon-btn" aria-label="Eliminar" onClick={() => remove(s)}><Icon.trash /></button></div>
            <span className="mono muted">{s.baseUrl}</span>
            <span className="small">Usuario de servicio: <b>{s.username}</b> · {s.provider.toUpperCase()}</span>
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={testing === s.id} onClick={() => test(s)}>{testing === s.id ? 'Probando…' : 'Probar conexión'}</button>
          </div>
        ))}
        {!data.servers.length && <div className="empty">Sin servidores Superset</div>}
      </div>
      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Configuración necesaria en Superset (superset_config.py)</summary>
        <pre className="code">{`FEATURE_FLAGS = { "EMBEDDED_SUPERSET": True }

# Rol que reciben los usuarios de Prime Suite (guest token). Dale permisos de lectura
# sobre los datasets de los dashboards embebidos.
GUEST_ROLE_NAME = "Gamma"
GUEST_TOKEN_JWT_EXP_SECONDS = 300

# Permitir que el portal muestre Superset dentro de un iframe
TALISMAN_ENABLED = True
TALISMAN_CONFIG = {
    "content_security_policy": {
        "frame-ancestors": ["'self'", "${origin}"],
    },
    "force_https": False,
}
# Si Superset está detrás de otro proxy, que tampoco envíe X-Frame-Options: DENY`}</pre>
        <span className="small muted">Además, en cada dashboard, <b>Embed dashboard › Allowed domains</b> debe incluir <code className="mono">{origin}</code> (el importador lo añade solo al activar el embebido).</span>
      </details>
      {edit && <ServerModal server={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function ServerModal({ server, onClose, onSaved }: { server: SupersetServer | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: server?.name || '', baseUrl: server?.baseUrl || '', username: server?.username || '', password: '', provider: server?.provider || 'db' });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (server) await api.put(`/api/insights/servers/${server.id}`, f);
      else await api.post('/api/insights/servers', f);
      toast('Servidor guardado');
      onSaved();
    } catch (err: any) {
      setError(err.message);
    }
  }
  return (
    <Modal title={server ? `Editar ${server.name}` : 'Nuevo servidor Superset'} onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <ErrorBox error={error} />
        <label className="field">Nombre<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Superset Evalos" /></label>
        <label className="field">URL base<span className="hint">Sin /superset al final. Ej.: https://evalos-c.digitekcloud.com:8802</span><input className="input mono" value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} required /></label>
        <div className="grid-2">
          <label className="field">Usuario de servicio<input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required autoComplete="off" /></label>
          <label className="field">Autenticación
            <select className="select" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value as 'db' | 'ldap' })}><option value="db">Base de datos</option><option value="ldap">LDAP</option></select>
          </label>
        </div>
        <label className="field">Contraseña<span className="hint">{server?.hasPassword ? 'Hay una contraseña guardada. Déjalo vacío para mantenerla.' : 'Se guarda cifrada y nunca se envía al navegador.'}</span>
          <input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required={!server} />
        </label>
        <div className="alert info small">Recomendado: un usuario dedicado (no "admin") con permiso para listar dashboards, gestionar el embebido y crear guest tokens (<code className="mono">can_grant_guest_token</code>).</div>
        <button className="btn primary" style={{ alignSelf: 'flex-start' }}>Guardar</button>
      </form>
    </Modal>
  );
}

// ================= Categorías =================
export function CategoriesAdmin({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useData(load);
  const [name, setName] = useState('');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const refresh = () => { reload(); onChange(); };
  async function create() {
    if (!name.trim()) return;
    await api.post('/api/insights/categories', { name, order: data!.categories.length });
    setName('');
    toast('Categoría creada');
    refresh();
  }
  return (
    <>
      <div className="row">
        <input className="input" style={{ maxWidth: 280 }} placeholder="Nueva categoría (p. ej. Evalos)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} aria-label="Nueva categoría" />
        <button className="btn primary" onClick={create}><Icon.plus /> Añadir</button>
      </div>
      <div className="card flat" style={{ maxWidth: 640 }}>
        <table className="table">
          <thead><tr><th>Orden</th><th>Nombre</th><th>Dashboards</th><th></th></tr></thead>
          <tbody>
            {data.categories.map((c) => (
              <tr key={c.id}>
                <td style={{ width: 90 }}><input className="input" type="number" defaultValue={c.order} aria-label="Orden" onBlur={(e) => Number(e.target.value) !== c.order && api.put(`/api/insights/categories/${c.id}`, { ...c, order: Number(e.target.value) }).then(refresh)} /></td>
                <td><input className="input" defaultValue={c.name} aria-label="Nombre" onBlur={(e) => e.target.value !== c.name && api.put(`/api/insights/categories/${c.id}`, { ...c, name: e.target.value }).then(refresh)} /></td>
                <td>{data.dashboards.filter((d) => d.categoryId === c.id).length}</td>
                <td><button className="icon-btn" aria-label="Eliminar" onClick={() => confirmAction(`¿Eliminar ${c.name}?`) && api.del(`/api/insights/categories/${c.id}`).then(refresh)}><Icon.trash /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
