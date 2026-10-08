// Inicio de sesión automático para módulos SIN SSO.
//
// Mientras una aplicación no habla Prime ID (OIDC / Prime Token), el portal puede entrar por el
// usuario enviando su formulario de login (POST) o abriendo una URL con las credenciales.
// Las credenciales se guardan cifradas (AES-256-GCM) en el servidor:
//   - por usuario: cada persona guarda las suyas la primera vez que abre el módulo;
//   - compartidas: una cuenta común que configura el administrador en la integración.
// Inevitablemente, la contraseña llega al navegador en el momento de entrar (el navegador es quien
// envía el formulario a la aplicación); nunca se devuelve en ninguna otra respuesta.
import { rawGet, rawSet, rawDel, now, type Module, type AutoLogin } from './db.ts';
import { encryptSecret, decryptSecret } from './crypto.ts';
import { HttpError } from './http.ts';
import { safeFetch } from './netguard.ts';

export interface StoredCred { username: string; passEnc: string; updatedAt: string }
export interface Creds { username: string; password: string }

const credKey = (userId: string, moduleId: string) => `module-creds/${userId}/${moduleId}`;
const credIndexKey = (userId: string) => `module-creds-index/${userId}`;

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const FIELD = /^[A-Za-z0-9_.:$\-\[\]]{1,120}$/;

export const autoLoginActive = (m: Module) => m.authMethod === 'none' && m.openMode !== 'native' && !!m.autoLogin?.enabled && !!m.autoLogin.loginUrl;

/** Valida la configuración recibida del formulario de integración (sin la contraseña compartida, que va aparte). */
export function sanitizeAutoLogin(v: any, existing?: AutoLogin): AutoLogin | undefined {
  if (v === undefined) return existing;
  if (!v || typeof v !== 'object') return undefined;
  const method = v.method === 'url' ? 'url' : 'form';
  const loginUrl = str(v.loginUrl, 1000);
  if (v.enabled && !loginUrl) throw new HttpError(400, 'Inicio de sesión automático: indica la URL de login');
  if (loginUrl && !/^https?:\/\//.test(loginUrl)) throw new HttpError(400, 'Inicio de sesión automático: la URL de login debe empezar por https://');
  if (method === 'url' && v.enabled && !/\{(password|contraseña|contrasena)\}/i.test(loginUrl)) {
    throw new HttpError(400, 'Inicio de sesión automático: en modo URL incluye {usuario} y {password} donde van las credenciales');
  }
  const field = (x: unknown, def: string) => {
    const s = str(x, 120) || def;
    if (!FIELD.test(s)) throw new HttpError(400, `Nombre de campo no válido: "${s}"`);
    return s;
  };
  const extraFields = Array.isArray(v.extraFields)
    ? v.extraFields
        .map((f: any) => ({ name: str(f?.name, 120), value: str(f?.value, 500) }))
        .filter((f: { name: string }) => f.name)
        .slice(0, 20)
    : existing?.extraFields || [];
  for (const f of extraFields) if (!FIELD.test(f.name)) throw new HttpError(400, `Nombre de campo no válido: "${f.name}"`);
  const credentials = v.credentials === 'shared' ? 'shared' : 'user';
  const out: AutoLogin = {
    enabled: !!v.enabled,
    method,
    loginUrl,
    userField: field(v.userField, 'username'),
    passField: field(v.passField, 'password'),
    extraFields,
    credentials,
    sharedUser: credentials === 'shared' ? str(v.sharedUser, 200) || undefined : undefined,
    sharedPassEnc: credentials === 'shared' ? existing?.sharedPassEnc : undefined
  };
  return out;
}

/** Aplica la contraseña compartida nueva (o la borra). Va aparte porque cifrar es asíncrono. */
export async function applySharedPassword(al: AutoLogin | undefined, v: any): Promise<AutoLogin | undefined> {
  if (!al || al.credentials !== 'shared' || !v || typeof v !== 'object') return al;
  if (v.clearSharedPassword) return { ...al, sharedPassEnc: undefined };
  const pw = typeof v.sharedPassword === 'string' ? v.sharedPassword : '';
  if (pw) {
    if (pw.length > 500) throw new HttpError(400, 'Contraseña demasiado larga');
    return { ...al, sharedPassEnc: await encryptSecret(pw) };
  }
  return al;
}

/** Vista pública de la configuración: nunca incluye la contraseña cifrada. */
export function publicAutoLogin(al?: AutoLogin) {
  if (!al) return undefined;
  const { sharedPassEnc, ...rest } = al;
  return { ...rest, hasSharedPassword: !!sharedPassEnc };
}

// ---------- Credenciales por usuario ----------
export async function getUserCred(userId: string, moduleId: string) {
  return rawGet<StoredCred>(credKey(userId, moduleId));
}

export async function setUserCred(userId: string, moduleId: string, username: string, password: string) {
  await rawSet(credKey(userId, moduleId), { username, passEnc: await encryptSecret(password), updatedAt: now() } satisfies StoredCred);
  const idx = new Set((await rawGet<string[]>(credIndexKey(userId))) || []);
  idx.add(moduleId);
  await rawSet(credIndexKey(userId), [...idx]);
}

export async function delUserCred(userId: string, moduleId: string) {
  await rawDel(credKey(userId, moduleId));
  const idx = ((await rawGet<string[]>(credIndexKey(userId))) || []).filter((x) => x !== moduleId);
  await rawSet(credIndexKey(userId), idx);
}

/** Módulos para los que el usuario tiene credenciales guardadas (sin contraseñas). */
export async function listUserCreds(userId: string) {
  const out: { moduleId: string; username: string; updatedAt: string }[] = [];
  for (const mid of (await rawGet<string[]>(credIndexKey(userId))) || []) {
    const c = await getUserCred(userId, mid);
    if (c) out.push({ moduleId: mid, username: c.username, updatedAt: c.updatedAt });
  }
  return out;
}

/** Borra todas las credenciales guardadas de un usuario (al eliminarlo). */
export async function purgeUserCreds(userId: string) {
  for (const mid of (await rawGet<string[]>(credIndexKey(userId))) || []) await rawDel(credKey(userId, mid));
  await rawDel(credIndexKey(userId));
}

/** Credenciales con las que entrar en el módulo, o null si faltan. */
export async function resolveCredentials(m: Module, userId: string): Promise<Creds | null> {
  const al = m.autoLogin;
  if (!al) return null;
  if (al.credentials === 'shared') {
    if (!al.sharedUser || !al.sharedPassEnc) return null;
    return { username: al.sharedUser, password: await decryptSecret(al.sharedPassEnc) };
  }
  const c = await getUserCred(userId, m.id);
  if (!c) return null;
  try {
    return { username: c.username, password: await decryptSecret(c.passEnc) };
  } catch {
    return null; // clave de cifrado cambiada: se vuelven a pedir
  }
}

const fill = (tpl: string, c: Creds, enc: (s: string) => string) =>
  tpl
    .replace(/\{(usuario|user|username)\}/gi, enc(c.username))
    .replace(/\{(password|contraseña|contrasena)\}/gi, enc(c.password));

/** Cómo abre el navegador el módulo ya autenticado: POST de formulario o URL. */
export function buildLaunch(al: AutoLogin, c: Creds): { url?: string; formPost?: { action: string; fields: Record<string, string> } } {
  if (al.method === 'url') return { url: fill(al.loginUrl, c, encodeURIComponent) };
  const fields: Record<string, string> = {};
  for (const f of al.extraFields || []) fields[f.name] = fill(f.value, c, (s) => s);
  fields[al.userField] = c.username;
  fields[al.passField] = c.password;
  return { formPost: { action: al.loginUrl, fields } };
}

// ---------- Detección del formulario de login ----------
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
};
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export interface DetectedForm {
  loginUrl: string;
  method: string;
  userField: string;
  passField: string;
  hidden: { name: string; value: string }[];
  warnings: string[];
}

/** Lee la página de login y propone action y nombres de campo. Avisa si el formulario lleva tokens dinámicos. */
export async function detectLoginForm(pageUrl: string, portalOrigin: string): Promise<DetectedForm> {
  if (!/^https?:\/\//.test(pageUrl)) throw new HttpError(400, 'Indica la URL de la página de login (https://…)');
  let html = '';
  let finalUrl = pageUrl;
  try {
    const r = await safeFetch(pageUrl, { portalOrigin, timeoutMs: 8000, headers: { accept: 'text/html' } });
    finalUrl = r.finalUrl;
    html = (await r.res.text()).slice(0, 600_000);
  } catch (e: any) {
    throw new HttpError(502, `No se pudo leer la página de login: ${e?.message || e}. Rellena los campos a mano.`);
  }
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) || [];
  const form = forms.find((f) => /type\s*=\s*["']?password/i.test(f));
  if (!form) {
    throw new HttpError(422, 'No hay un formulario con contraseña en esa página. Puede que el login se cargue con JavaScript (SPA): en ese caso el envío automático de formulario no funcionará.');
  }
  const open = form.match(/<form\b[^>]*>/i)![0];
  const action = decode(attr(open, 'action'));
  const inputs = form.match(/<input\b[^>]*>/gi) || [];
  const typed = inputs.map((t) => ({ type: (attr(t, 'type') || 'text').toLowerCase(), name: decode(attr(t, 'name')), value: decode(attr(t, 'value')) })).filter((i) => i.name);
  const pass = typed.find((i) => i.type === 'password');
  const passIdx = pass ? typed.indexOf(pass) : -1;
  const user = typed.slice(0, Math.max(0, passIdx)).reverse().find((i) => ['text', 'email', 'tel', ''].includes(i.type)) || typed.find((i) => ['text', 'email'].includes(i.type));
  const hidden = typed.filter((i) => i.type === 'hidden');
  const warnings: string[] = [];
  const dynamic = hidden.filter((h) => /^__(VIEWSTATE|EVENTVALIDATION|VIEWSTATEGENERATOR|RequestVerificationToken)$/i.test(h.name) || /csrf|xsrf|token|nonce/i.test(h.name));
  if (dynamic.length) {
    warnings.push(`El formulario lleva campos que la aplicación genera en cada visita (${dynamic.map((d) => d.name).join(', ')}). El envío automático probablemente será rechazado: la aplicación necesitará SSO (Prime Token u OIDC).`);
  }
  if (!/post/i.test(attr(open, 'method') || 'get')) warnings.push('El formulario no usa POST; prueba el modo «URL con credenciales».');
  if (/onsubmit\s*=/i.test(open)) warnings.push('El formulario ejecuta JavaScript al enviarse; puede que el envío automático no funcione.');
  return {
    loginUrl: new URL(action || finalUrl, finalUrl).toString(),
    method: (attr(open, 'method') || 'get').toUpperCase(),
    userField: user?.name || '',
    passField: pass?.name || '',
    hidden: hidden.filter((h) => !dynamic.includes(h)).map((h) => ({ name: h.name, value: h.value })),
    warnings
  };
}
