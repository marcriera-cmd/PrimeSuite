// Piezas compartidas por el asistente de alta y la edición de integraciones.
import { useRef, useState, type CSSProperties } from 'react';
import { api, type AdminModule, type AuthMethod, type AutoLoginView, type Category, type ModuleRole, type WidgetDef } from '../../api';
import { AppIcon, APP_GLYPHS, APP_GLYPH_KEYS, CopyValue, Icon, Modal, Toggle, iconGradient, useToast } from '../../components/ui';
import { SsoTracePanel } from '../../components/SsoTrace';

export interface CompanyAccess { id: string; name: string; code: string; enabled: boolean; url: string }
export type Draft = Omit<AdminModule, 'id' | 'hasSecret' | 'createdAt' | 'updatedAt' | 'companyCount'> & { confidential?: boolean; companies: CompanyAccess[] };

export const PALETTE = ['#243A4D', '#FF3E41', '#0E7C66', '#31506A', '#6D28D9', '#B45309', '#9FA5AD', '#BE185D'];

export const emptyDraft = (): Draft => ({
  clientId: '', name: '', description: '', categoryId: null, initials: '', color: '#243A4D', iconUrl: '', iconGlyph: '', url: '', openMode: 'iframe', authMethod: 'none',
  tokenDelivery: 'fragment', tokenParam: 'prime_token', tokenTtlSec: 60, redirectUris: [], postLogoutRedirectUris: [], initiateLoginUri: '', responseTypes: ['code'], alwaysEmail: false, ssoDebug: false,
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

// Icono del módulo: galería de iconos integrados, imagen propia o iniciales.
type IconTab = 'lib' | 'image' | 'initials';
function IconField({ d, set }: { d: Draft; set: SetDraft }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<IconTab>(d.iconUrl ? 'image' : d.iconGlyph ? 'lib' : 'initials');

  function pick(file?: File | null) {
    if (!file) return;
    if (!/^image\/(png|svg\+xml|jpeg|jpg|webp|gif)$/.test(file.type)) return toast('Formato no válido. Usa PNG, SVG, JPG o WEBP.', true);
    if (file.size > 200 * 1024) return toast('El icono es demasiado grande (máximo 200 KB).', true);
    const r = new FileReader();
    r.onload = () => set({ iconUrl: String(r.result), iconGlyph: '' });
    r.onerror = () => toast('No se pudo leer el archivo', true);
    r.readAsDataURL(file);
  }
  function go(t: IconTab) {
    setTab(t);
    if (t === 'initials') set({ iconUrl: '', iconGlyph: '' });
    if (t === 'lib' && !d.iconGlyph) set({ iconUrl: '', iconGlyph: 'bars' });
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="icon-drop">
        <AppIcon initials={d.initials || '?'} color={d.color} iconUrl={d.iconUrl} glyph={d.iconGlyph} size={60} shadow />
        <div className="tabs" style={{ border: 0, gap: 6 }}>
          <button type="button" className={tab === 'lib' ? 'on' : ''} onClick={() => go('lib')} style={tabStyle(tab === 'lib')}>Iconos integrados</button>
          <button type="button" className={tab === 'image' ? 'on' : ''} onClick={() => go('image')} style={tabStyle(tab === 'image')}>Subir imagen</button>
          <button type="button" className={tab === 'initials' ? 'on' : ''} onClick={() => go('initials')} style={tabStyle(tab === 'initials')}>Iniciales</button>
        </div>
      </div>

      {tab === 'lib' && (
        <div className="col" style={{ gap: 10 }}>
          <div className="glyph-grid">
            {APP_GLYPH_KEYS.map((k) => (
              <button type="button" key={k} className={`glyph-opt ${d.iconGlyph === k ? 'on' : ''}`} onClick={() => set({ iconGlyph: k, iconUrl: '' })} aria-label={k}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: APP_GLYPHS[k] }} />
              </button>
            ))}
          </div>
          <span className="hint">Color de fondo</span>
          <div className="row wrap" style={{ gap: 8 }}>
            {PALETTE.map((c) => <button type="button" key={c} className={`swatch ${d.color === c ? 'on' : ''}`} style={{ background: iconGradient(c) }} aria-label={`Color ${c}`} onClick={() => set({ color: c })} />)}
          </div>
        </div>
      )}

      {tab === 'image' && (
        <div className="col" style={{ gap: 8 }}>
          <input ref={ref} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="row wrap" style={{ gap: 6 }}>
            <button type="button" className="btn sm" onClick={() => ref.current?.click()}><Icon.up /> {d.iconUrl ? 'Cambiar imagen' : 'Subir imagen'}</button>
            {d.iconUrl && <button type="button" className="btn sm danger" onClick={() => set({ iconUrl: '' })}>Quitar</button>}
          </div>
          <span className="hint">PNG, SVG, JPG o WEBP (máx. 200 KB).</span>
        </div>
      )}

      {tab === 'initials' && (
        <div className="col" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
            <input className="input" style={{ width: 66 }} maxLength={3} value={d.initials} onChange={(e) => set({ initials: e.target.value.toUpperCase() })} aria-label="Iniciales" placeholder="PI" />
            {PALETTE.map((c) => <button type="button" key={c} className={`swatch ${d.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => set({ color: c })} />)}
          </div>
          <span className="hint">Se usan las iniciales con el color elegido.</span>
        </div>
      )}
    </div>
  );
}

const tabStyle = (on: boolean): CSSProperties => ({
  border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: on ? 'var(--ink)' : '#fff',
  color: on ? '#fff' : 'var(--muted)', borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 0
});

const METHODS: { k: AuthMethod | 'saml' | 'gateway'; name: string; line: string; change: string; soon?: boolean }[] = [
  { k: 'oidc', name: 'OpenID Connect', line: 'Estándar. La app confía en Prime ID como proveedor de identidad.', change: 'La app debe admitir OIDC' },
  { k: 'prime_token', name: 'Prime Token', line: 'JWT firmado de un solo uso que la app valida con el JWKS. Sustituye al sso_token.', change: 'Unas 10 líneas de código' },
  { k: 'none', name: 'Sin SSO', line: 'La app usa su propio login. El portal puede entrar por ti con credenciales guardadas.', change: 'Ninguno' },
  { k: 'saml', name: 'SAML 2.0', line: 'Para software corporativo de terceros.', change: 'Próxima versión', soon: true },
  { k: 'gateway', name: 'Prime Gateway', line: 'Proxy que inyecta la identidad sin tocar la app.', change: 'Próxima versión', soon: true }
];

export const slug = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);

export function AuthEditor({ d, set, isNew, moduleId, hasSecret, onSecret }: { d: Draft; set: SetDraft; isNew?: boolean; moduleId?: string; hasSecret?: boolean; onSecret?: () => void }) {
  const iss = window.location.origin;
  const toast = useToast();
  const [secret, setSecret] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);
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

      <div className="col" style={{ gap: 6 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="check">
            <input type="checkbox" checked={!!d.ssoDebug} onChange={(e) => set({ ssoDebug: e.target.checked })} />
            Ver log de inicio de sesión
          </label>
          {moduleId && <button type="button" className="btn sm" onClick={() => setShowTrace(true)}>Ver log</button>}
        </div>
        <span className="hint" style={{ marginLeft: 26 }}>
          Para depurar el SSO: Prime ID apunta cada paso del login con esta app (qué pide, qué comprueba y qué usuario le envía) y el portal muestra el botón «Log de acceso» al abrirla. Desactívalo cuando funcione.
          {moduleId && ' Guarda los cambios para que se aplique.'}
        </span>
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

      {d.authMethod === 'none' && <AutoLoginEditor d={d} set={set} />}

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
      {showTrace && moduleId && <SsoTracePanel moduleId={moduleId} name={d.name} all onClose={() => setShowTrace(false)} />}
      {secret && (
        <Modal title="Secreto del cliente" onClose={() => setSecret(null)}>
          <div className="alert warn small">Cópialo ahora: no se volverá a mostrar.</div>
          <div className="kv"><CopyValue value={secret} /></div>
        </Modal>
      )}
    </div>
  );
}

const AUTOLOGIN_DEFAULT: AutoLoginView = { enabled: false, method: 'form', loginUrl: '', userField: 'username', passField: 'password', extraFields: [], credentials: 'user' };

interface DetectedForm { loginUrl: string; method: string; userField: string; passField: string; hidden: { name: string; value: string }[]; warnings: string[] }

// Sin SSO: el portal entra por el usuario enviando el formulario de login de la app con credenciales guardadas.
function AutoLoginEditor({ d, set }: { d: Draft; set: SetDraft }) {
  const toast = useToast();
  const al: AutoLoginView = { ...AUTOLOGIN_DEFAULT, ...(d.autoLogin || {}) };
  const upd = (p: Partial<AutoLoginView>) => set({ autoLogin: { ...al, ...p } });
  const [page, setPage] = useState('');
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<string[]>([]);
  const extras = al.extraFields.map((f) => `${f.name}=${f.value}`).join('\n');

  async function detect() {
    setBusy(true);
    setWarn([]);
    try {
      const r = await api.post<DetectedForm>('/api/admin/modules/autologin/detect', { url: page.trim() || d.url });
      upd({ method: 'form', loginUrl: r.loginUrl, userField: r.userField || al.userField, passField: r.passField || al.passField, extraFields: r.hidden });
      setWarn(r.warnings);
      toast(r.warnings.length ? 'Formulario detectado, con avisos' : 'Formulario detectado');
    } catch (e: any) {
      setWarn([e.message]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ gap: 14 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <Toggle on={al.enabled} onChange={(v) => upd({ enabled: v })} label="Inicio de sesión automático" />
        <div className="col grow" style={{ gap: 2 }}>
          <h3>Inicio de sesión automático</h3>
          <span className="xs muted">Mientras la aplicación no tenga SSO, el portal entra por el usuario con unas credenciales guardadas (cifradas en el servidor), como si lo hiciera él. Así parece que entra directamente.</span>
        </div>
      </div>

      {al.enabled && (
        <>
          <div className="field">De quién son las credenciales
            <div className="row wrap">
              <label className="check"><input type="radio" name="al-cred" checked={al.credentials === 'user'} onChange={() => upd({ credentials: 'user' })} /> Cada usuario las suyas</label>
              <label className="check"><input type="radio" name="al-cred" checked={al.credentials === 'shared'} onChange={() => upd({ credentials: 'shared' })} /> Una cuenta compartida para todos</label>
            </div>
            <span className="hint">
              {al.credentials === 'user'
                ? 'La primera vez que alguien abra la aplicación, el portal le pedirá su usuario y contraseña y los recordará. Puede cambiarlos en «Mi acceso» o borrarlos desde su perfil.'
                : 'Todos los usuarios con acceso a la aplicación entrarán con esta misma cuenta. La aplicación no sabrá quién es cada uno.'}
            </span>
          </div>

          {al.credentials === 'shared' && (
            <div className="grid-2">
              <label className="field">Usuario de la cuenta compartida
                <input className="input" value={al.sharedUser || ''} onChange={(e) => upd({ sharedUser: e.target.value })} autoComplete="off" />
              </label>
              <label className="field">Contraseña
                <span className="hint">{al.hasSharedPassword ? 'Guardada. Déjala vacía para mantenerla.' : 'Se guarda cifrada y no se vuelve a mostrar.'}</span>
                <div className="row" style={{ gap: 6 }}>
                  <input className="input grow" type="password" value={al.sharedPassword || ''} onChange={(e) => upd({ sharedPassword: e.target.value, clearSharedPassword: false })} placeholder={al.hasSharedPassword ? '••••••••' : ''} autoComplete="new-password" />
                  {al.hasSharedPassword && <button type="button" className="btn sm danger" onClick={() => upd({ sharedPassword: '', clearSharedPassword: true, hasSharedPassword: false })}>Borrar</button>}
                </div>
              </label>
            </div>
          )}

          <div className="field">Cómo entra
            <div className="row wrap">
              <label className="check"><input type="radio" name="al-method" checked={al.method === 'form'} onChange={() => upd({ method: 'form' })} /> Enviando su formulario de login (recomendado)</label>
              <label className="check"><input type="radio" name="al-method" checked={al.method === 'url'} onChange={() => upd({ method: 'url' })} /> Abriendo una URL con las credenciales</label>
            </div>
          </div>

          {al.method === 'form' ? (
            <>
              <div className="row wrap" style={{ alignItems: 'flex-end' }}>
                <label className="field grow">Página de login de la aplicación
                  <span className="hint">Opcional: Prime Suite la lee y rellena los campos de abajo.</span>
                  <input className="input mono" value={page} onChange={(e) => setPage(e.target.value)} placeholder={d.url || 'https://app.proveedor.com/login'} />
                </label>
                <button type="button" className="btn" disabled={busy} onClick={detect}>{busy ? 'Leyendo…' : 'Detectar formulario'}</button>
              </div>
              {warn.length > 0 && <div className="alert warn small">{warn.map((w, i) => <div key={i}>{w}</div>)}</div>}
              <label className="field">URL a la que se envía el formulario (action)
                <input className="input mono" value={al.loginUrl} onChange={(e) => upd({ loginUrl: e.target.value })} placeholder="https://app.proveedor.com/login" />
              </label>
              <div className="grid-2">
                <label className="field">Campo del usuario<input className="input mono" value={al.userField} onChange={(e) => upd({ userField: e.target.value })} /></label>
                <label className="field">Campo de la contraseña<input className="input mono" value={al.passField} onChange={(e) => upd({ passField: e.target.value })} /></label>
              </div>
              <label className="field">Campos adicionales
                <span className="hint">Opcional. Uno por línea, <code className="mono">nombre=valor</code> (p. ej. <code className="mono">remember=1</code>). Admiten <code className="mono">{'{usuario}'}</code> y <code className="mono">{'{password}'}</code>.</span>
                <textarea
                  className="textarea mono"
                  defaultValue={extras}
                  key={extras}
                  onBlur={(e) => upd({ extraFields: lines(e.target.value).map((l) => { const i = l.indexOf('='); return i > 0 ? { name: l.slice(0, i).trim(), value: l.slice(i + 1) } : { name: l, value: '' }; }) })}
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">URL de login con credenciales
                <span className="hint">Usa <code className="mono">{'{usuario}'}</code> y <code className="mono">{'{password}'}</code> donde la aplicación los espera.</span>
                <input className="input mono" value={al.loginUrl} onChange={(e) => upd({ loginUrl: e.target.value })} placeholder="https://app.proveedor.com/login?user={usuario}&pass={password}" />
              </label>
              <div className="alert warn small">Con este modo la contraseña viaja en la URL y puede quedar en el historial del navegador y en los registros del servidor de la aplicación. Úsalo solo si la aplicación no admite otra forma.</div>
            </>
          )}

          <div className="alert info xs" style={{ lineHeight: 1.55 }}>
            Funciona con formularios de login clásicos. No funcionará si la aplicación exige un token que genera en cada visita (anti-CSRF, <span className="mono">__VIEWSTATE</span>), un captcha o doble factor, o si su login es una aplicación JavaScript. Dentro del portal, la aplicación también debe permitir sus cookies de sesión en iframe; si no, configúrala para abrirse en pestaña nueva. Pulsa <b>Probar</b> tras guardar.
          </div>
        </>
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
