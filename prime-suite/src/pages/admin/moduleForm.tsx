// Piezas compartidas por el asistente de alta y la edición de integraciones.
import { useRef, useState } from 'react';
import { api, type AdminModule, type AuthMethod, type Category, type ModuleRole, type WidgetDef } from '../../api';
import { AppIcon, CopyValue, Icon, Modal, Toggle, useToast } from '../../components/ui';

export interface CompanyAccess { id: string; name: string; code: string; enabled: boolean; url: string }
export type Draft = Omit<AdminModule, 'id' | 'hasSecret' | 'createdAt' | 'updatedAt' | 'companyCount'> & { confidential?: boolean; companies: CompanyAccess[] };

export const PALETTE = ['#243A4D', '#FF3E41', '#0E7C66', '#31506A', '#6D28D9', '#B45309', '#9FA5AD', '#BE185D'];

export const emptyDraft = (): Draft => ({
  clientId: '', name: '', description: '', categoryId: null, initials: '', color: '#243A4D', iconUrl: '', url: '', openMode: 'iframe', authMethod: 'none',
  tokenDelivery: 'fragment', tokenParam: 'prime_token', tokenTtlSec: 60, redirectUris: [], postLogoutRedirectUris: [], initiateLoginUri: '', responseTypes: ['code'], alwaysEmail: false,
  defaultRole: 'user', manifestUrl: '', widgets: [], enabled: true, order: 50, companies: []
});

type SetDraft = (patch: Partial<Draft>) => void;

export function GeneralFields({ d, set, cats, native }: { d: Draft; set: SetDraft; cats: Category[]; native?: boolean }) {
  return (
    <div className="col" style={{ gap: 16 }}>
      <label className="field">URL de la aplicación
        <span className="hint">Admite variables: <code className="mono">{'{tenant}'}</code>, <code className="mono">{'{email}'}</code>, <code className="mono">{'{username}'}</code>. Las rutas que empiezan por / se resuelven contra este portal.</span>
        <input className="input mono" value={d.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://app.proveedor.com/" required disabled={native} />
      </label>
      <div className="grid-2">
        <label className="field">Nombre visible<input className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} required /></label>
        <label className="field">Identificador (client_id)
          <span className="hint">Audiencia de los tokens. Se genera del nombre si lo dejas vacío.</span>
          <input className="input mono" value={d.clientId} onChange={(e) => set({ clientId: e.target.value })} placeholder="mi-app" />
        </label>
      </div>
      <label className="field">Descripción<input className="input" value={d.description} onChange={(e) => set({ description: e.target.value })} /></label>
      <div className="grid-2">
        <div className="field">Categoría
          <div className="row wrap">
            <button type="button" className={`btn sm ${!d.categoryId ? 'primary' : ''}`} onClick={() => set({ categoryId: null })}>Sin categoría</button>
            {cats.map((c) => (
              <button type="button" key={c.id} className={`btn sm ${d.categoryId === c.id ? 'primary' : ''}`} onClick={() => set({ categoryId: c.id, color: d.color === '#243A4D' || !d.color ? c.color : d.color })}>{c.name}</button>
            ))}
          </div>
        </div>
        <div className="field">Icono
          <IconField d={d} set={set} />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">Cómo se abre
          {native ? <span className="tag info" style={{ alignSelf: 'flex-start' }}>Módulo nativo</span> : <div className="row wrap">
            {(['iframe', 'tab', 'fullscreen'] as const).map((m) => (
              <button type="button" key={m} className={`btn sm ${d.openMode === m ? 'primary' : ''}`} onClick={() => set({ openMode: m })}>{{ iframe: 'Dentro del portal', tab: 'Pestaña nueva', fullscreen: 'Pantalla completa' }[m]}</button>
            ))}
          </div>}
        </div>
        <label className="field">Orden<input className="input" type="number" value={d.order} onChange={(e) => set({ order: Number(e.target.value) })} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Integración activa</label>
    </div>
  );
}

// Icono del módulo: subir imagen propia (PNG/SVG/JPG/WEBP) o, en su defecto, iniciales + color.
function IconField({ d, set }: { d: Draft; set: SetDraft }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  function pick(file?: File | null) {
    if (!file) return;
    if (!/^image\/(png|svg\+xml|jpeg|jpg|webp|gif)$/.test(file.type)) return toast('Formato no válido. Usa PNG, SVG, JPG o WEBP.', true);
    if (file.size > 200 * 1024) return toast('El icono es demasiado grande (máximo 200 KB).', true);
    const r = new FileReader();
    r.onload = () => set({ iconUrl: String(r.result) });
    r.onerror = () => toast('No se pudo leer el archivo', true);
    r.readAsDataURL(file);
  }
  return (
    <div className="icon-drop">
      <AppIcon initials={d.initials || '?'} color={d.color} iconUrl={d.iconUrl} size={56} shadow />
      <div className="acts">
        <input ref={ref} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="row wrap" style={{ gap: 6 }}>
          <button type="button" className="btn sm" onClick={() => ref.current?.click()}><Icon.up /> {d.iconUrl ? 'Cambiar icono' : 'Subir icono'}</button>
          {d.iconUrl && <button type="button" className="btn sm danger" onClick={() => set({ iconUrl: '' })}>Quitar</button>}
        </div>
        {!d.iconUrl && (
          <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
            <input className="input" style={{ width: 66 }} maxLength={3} value={d.initials} onChange={(e) => set({ initials: e.target.value.toUpperCase() })} aria-label="Iniciales" placeholder="PI" />
            {PALETTE.map((c) => <button type="button" key={c} className={`swatch ${d.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => set({ color: c })} />)}
          </div>
        )}
        <span className="hint">PNG o SVG (máx. 200 KB). Si no subes icono, se usan las iniciales con el color.</span>
      </div>
    </div>
  );
}

const METHODS: { k: AuthMethod | 'saml' | 'gateway'; name: string; line: string; change: string; soon?: boolean }[] = [
  { k: 'oidc', name: 'OpenID Connect', line: 'Estándar. La app confía en Prime ID como proveedor de identidad.', change: 'La app debe admitir OIDC' },
  { k: 'prime_token', name: 'Prime Token', line: 'JWT firmado de un solo uso que la app valida con el JWKS. Sustituye al sso_token.', change: 'Unas 10 líneas de código' },
  { k: 'none', name: 'Sin SSO', line: 'La app se abre con su propio login. Útil mientras se migra.', change: 'Ninguno' },
  { k: 'saml', name: 'SAML 2.0', line: 'Para software corporativo de terceros.', change: 'Próxima versión', soon: true },
  { k: 'gateway', name: 'Prime Gateway', line: 'Proxy que inyecta la identidad sin tocar la app.', change: 'Próxima versión', soon: true }
];

export const slug = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);

export function AuthEditor({ d, set, isNew, moduleId, hasSecret, onSecret }: { d: Draft; set: SetDraft; isNew?: boolean; moduleId?: string; hasSecret?: boolean; onSecret?: () => void }) {
  const iss = window.location.origin;
  const toast = useToast();
  const [secret, setSecret] = useState<string | null>(null);
  const aud = d.clientId || slug(d.name) || 'tu-client-id';

  async function rotate(remove = false) {
    if (!moduleId) return;
    const r = await api.post<{ clientSecret?: string }>(`/api/admin/modules/${moduleId}/secret`, { remove });
    if (r.clientSecret) setSecret(r.clientSecret);
    else toast('Ahora es un cliente público (PKCE obligatorio)');
    onSecret?.();
  }

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        {METHODS.map((m) => (
          <button type="button" key={m.k} disabled={m.soon} className={`choice ${d.authMethod === m.k ? 'on' : ''}`} onClick={() => !m.soon && set({ authMethod: m.k as AuthMethod })}>
            <b>{m.name}</b>
            <span className="xs muted" style={{ lineHeight: 1.45 }}>{m.line}</span>
            <span className="xs muted" style={{ marginTop: 'auto' }}>Cambios en la app</span>
            <span className="small" style={{ fontWeight: 600 }}>{m.change}</span>
            {m.soon && <span className="tag outline" style={{ alignSelf: 'flex-start' }}>Próximamente</span>}
          </button>
        ))}
      </div>

      {d.authMethod === 'oidc' && (
        <div className="card" style={{ background: '#FBFAF8' }}>
          <h3>Configuración OpenID Connect</h3>
          <div className="grid-2">
            <label className="field">Redirect URIs<span className="hint">Una por línea. Deben coincidir exactamente.</span>
              <textarea className="textarea mono" value={d.redirectUris.join('\n')} onChange={(e) => set({ redirectUris: lines(e.target.value) })} placeholder="https://app.proveedor.com/oidc/callback" />
            </label>
            <label className="field">Post-logout redirect URIs<span className="hint">Opcional. Una por línea.</span>
              <textarea className="textarea mono" value={d.postLogoutRedirectUris.join('\n')} onChange={(e) => set({ postLogoutRedirectUris: lines(e.target.value) })} />
            </label>
            <label className="field">Initiate login URI<span className="hint">URL de la app que arranca el login con Prime ID. Si existe, el portal la usa para entrar sin pedir credenciales.</span>
              <input className="input mono" value={d.initiateLoginUri || ''} onChange={(e) => set({ initiateLoginUri: e.target.value })} placeholder="https://app.proveedor.com/login/prime" />
            </label>
            <div className="field">Tipo de cliente
              {isNew ? (
                <label className="check"><input type="checkbox" checked={!!d.confidential} onChange={(e) => set({ confidential: e.target.checked })} /> Confidencial (backend con client_secret)</label>
              ) : (
                <div className="row wrap">
                  <span className="tag">{hasSecret ? 'Confidencial' : 'Público (PKCE)'}</span>
                  <button type="button" className="btn sm" onClick={() => rotate(false)}>{hasSecret ? 'Rotar secreto' : 'Generar secreto'}</button>
                  {hasSecret && <button type="button" className="btn sm" onClick={() => rotate(true)}>Quitar secreto</button>}
                </div>
              )}
              <span className="hint">Los clientes públicos (SPA, móvil) deben usar PKCE S256.</span>
            </div>
          </div>
          <div className="col" style={{ gap: 8, padding: '4px 0' }}>
            <label className="check">
              <input type="checkbox" checked={(d.responseTypes || []).some((t) => t !== 'code')}
                onChange={(e) => set({ responseTypes: e.target.checked ? ['code', 'code id_token', 'code id_token token'] : ['code'] })} />
              Permitir flujo híbrido (<code className="mono">code id_token</code> / <code className="mono">code id_token token</code>)
            </label>
            <span className="hint" style={{ marginLeft: 26 }}>Necesario para apps ASP.NET/Katana (OWIN) que usan <code className="mono">response_mode=form_post</code>, como Evalos8. Por defecto solo se permite <code className="mono">code</code>.</span>
            <label className="check">
              <input type="checkbox" checked={!!d.alwaysEmail} onChange={(e) => set({ alwaysEmail: e.target.checked })} />
              Incluir <code className="mono">email</code> siempre en el id_token
            </label>
            <span className="hint" style={{ marginLeft: 26 }}>Añade <code className="mono">email</code> y <code className="mono">email_verified</code> aunque la app no pida el scope <code className="mono">email</code>.</span>
          </div>
          <div className="grid-2">
            <div className="kv"><span className="xs muted">Discovery (dáselo al proveedor)</span><CopyValue value={`${iss}/.well-known/openid-configuration`} /></div>
            <div className="kv"><span className="xs muted">Client ID</span><CopyValue value={aud} /></div>
            <div className="kv"><span className="xs muted">Scopes</span><CopyValue value="openid profile email tenant roles" /></div>
            <div className="kv"><span className="xs muted">Issuer</span><CopyValue value={iss} /></div>
          </div>
        </div>
      )}

      {d.authMethod === 'prime_token' && (
        <div className="card" style={{ background: '#FBFAF8' }}>
          <h3>Configuración Prime Token</h3>
          <div className="grid-3">
            <label className="field">Entrega del token
              <select className="select" value={d.tokenDelivery} onChange={(e) => set({ tokenDelivery: e.target.value as Draft['tokenDelivery'] })}>
                <option value="fragment">Fragmento de URL (#) · recomendado</option>
                <option value="form_post">POST de formulario</option>
                <option value="query">Parámetro de URL (?) · compatibilidad</option>
              </select>
            </label>
            <label className="field">Nombre del parámetro<span className="hint">Usa sso_token para apps del portal antiguo.</span>
              <input className="input mono" value={d.tokenParam} onChange={(e) => set({ tokenParam: e.target.value })} />
            </label>
            <label className="field">Caducidad (segundos)<input className="input" type="number" min={10} max={3600} value={d.tokenTtlSec} onChange={(e) => set({ tokenTtlSec: Number(e.target.value) })} /></label>
          </div>
          {d.tokenDelivery === 'query' && <div className="alert warn small">Con ?parámetro el token puede quedar en logs e historial. Úsalo solo para compatibilidad con apps antiguas.</div>}
          <span className="small muted">Guía para el equipo de la aplicación. Valida firma, emisor, audiencia y caducidad con las claves públicas, y canjea el token para garantizar un solo uso:</span>
          <pre className="code">{`// Node.js con la librería "jose"
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(new URL('${iss}/.well-known/jwks.json'));

export async function loginWithPrimeToken(token) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: '${iss}',
    audience: '${aud}',
    typ: 'prime+jwt',
  });
  // Un solo uso: Prime ID rechaza un segundo canje del mismo jti
  const r = await fetch('${iss}/api/sso/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  }).then((r) => r.json());
  if (!r.valid) throw new Error(r.error);
  return payload; // sub, email, name, tenant, company_name, roles, groups
}`}</pre>
        </div>
      )}
      {secret && (
        <Modal title="Secreto del cliente" onClose={() => setSecret(null)}>
          <div className="alert warn small">Cópialo ahora: no se volverá a mostrar.</div>
          <div className="kv"><CopyValue value={secret} /></div>
        </Modal>
      )}
    </div>
  );
}

export function WidgetsEditor({ d, set }: { d: Draft; set: SetDraft }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const upd = (i: number, patch: Partial<WidgetDef>) => set({ widgets: d.widgets.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  async function importManifest() {
    if (!d.manifestUrl) return toast('Indica la URL del manifiesto', true);
    setBusy(true);
    try {
      const r = await api.post<{ widgets: WidgetDef[] }>('/api/admin/manifest', { url: d.manifestUrl });
      set({ widgets: r.widgets });
      toast(`${r.widgets.length} widget(s) importados`);
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field grow">Manifiesto prime-app.json<span className="hint">Si la app lo publica, los widgets se importan solos.</span>
          <input className="input mono" value={d.manifestUrl || ''} onChange={(e) => set({ manifestUrl: e.target.value })} placeholder="https://app.proveedor.com/prime-app.json" />
        </label>
        <button type="button" className="btn" disabled={busy} onClick={importManifest}>{busy ? 'Importando…' : 'Importar'}</button>
      </div>
      {d.widgets.map((w, i) => (
        <div key={i} className="card" style={{ padding: 14, gap: 10 }}>
          <div className="grid-4">
            <label className="field">Id<input className="input mono" value={w.id} onChange={(e) => upd(i, { id: e.target.value })} /></label>
            <label className="field">Título<input className="input" value={w.title} onChange={(e) => upd(i, { title: e.target.value })} /></label>
            <label className="field">Tipo
              <select className="select" value={w.type} onChange={(e) => upd(i, { type: e.target.value as WidgetDef['type'] })}>
                <option value="kpi">KPI</option><option value="list">Lista</option><option value="chart">Gráfico</option><option value="iframe">Mini-iframe</option>
              </select>
            </label>
            <label className="field">Tamaño
              <select className="select" value={w.size} onChange={(e) => upd(i, { size: e.target.value as WidgetDef['size'] })}>
                <option value="s">Pequeño</option><option value="m">Mediano</option><option value="l">Ancho</option>
              </select>
            </label>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field grow">{w.type === 'iframe' ? 'URL a embeber' : 'Endpoint JSON'}<input className="input mono" value={w.endpoint || ''} onChange={(e) => upd(i, { endpoint: e.target.value })} /></label>
            <label className="field" style={{ width: 130 }}>Refresco (s)<input className="input" type="number" min={15} value={w.refreshSec} onChange={(e) => upd(i, { refreshSec: Number(e.target.value) })} /></label>
            <button type="button" className="btn danger" onClick={() => set({ widgets: d.widgets.filter((_, j) => j !== i) })} aria-label="Quitar widget"><Icon.trash /></button>
          </div>
        </div>
      ))}
      <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => set({ widgets: [...d.widgets, { id: `widget-${d.widgets.length + 1}`, title: 'Nuevo widget', type: 'kpi', endpoint: '', size: 's', refreshSec: 300 }] })}>
        <Icon.plus /> Añadir widget
      </button>
      <details className="small">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Contrato de datos de los widgets</summary>
        <p className="muted">El portal llama al endpoint desde el servidor con <code className="mono">Authorization: Bearer &lt;token de acceso&gt;</code> (audiencia = client_id de la app, validable con el JWKS) y espera:</p>
        <pre className="code">{`KPI:     { "value": 42, "label": "visitas hoy", "delta": "+8", "trend": "up" }
Lista:   { "items": [ { "title": "…", "subtitle": "…", "badge": "Nuevo" } ] }
Gráfico: { "series": [ { "label": "L", "value": 312 }, … ] }`}</pre>
      </details>
    </div>
  );
}

const ROLE_OPTS: { v: ModuleRole | ''; l: string }[] = [
  { v: 'user', l: 'Usuario' }, { v: 'viewer', l: 'Solo lectura' }, { v: 'admin', l: 'Administrador' }, { v: '', l: 'Nadie (solo grupos asignados)' }
];

export function AccessEditor({ d, set }: { d: Draft; set: SetDraft }) {
  const upd = (id: string, patch: Partial<CompanyAccess>) => set({ companies: d.companies.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  return (
    <div className="col" style={{ gap: 16 }}>
      <label className="field" style={{ maxWidth: 420 }}>Rol por defecto para los usuarios de las empresas habilitadas
        <span className="hint">Los grupos pueden dar un rol superior (Grupos y permisos). Los administradores del portal siempre son administradores.</span>
        <select className="select" value={d.defaultRole || ''} onChange={(e) => set({ defaultRole: (e.target.value || null) as ModuleRole | null })}>
          {ROLE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      </label>
      <div className="card flat table-wrap">
        <table className="table">
          <thead><tr><th>Empresa</th><th>Habilitada</th><th>URL específica (opcional)</th></tr></thead>
          <tbody>
            {d.companies.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b> <span className="mono muted">{c.code}</span></td>
                <td><Toggle on={c.enabled} onChange={(v) => upd(c.id, { enabled: v })} label={`Habilitar para ${c.name}`} /></td>
                <td><input className="input mono" value={c.url} onChange={(e) => upd(c.id, { url: e.target.value })} placeholder="Usa la URL general" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function draftPayload(d: Draft) {
  return { ...d, initiateLoginUri: d.initiateLoginUri || '', manifestUrl: d.manifestUrl || '' };
}
