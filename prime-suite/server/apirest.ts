// Integraciones · API REST: datos para que Prime Suite llame a la API de una aplicación (OAuth2 client credentials).
// El Client Secret se guarda cifrado (AES-256-GCM) y nunca sale del servidor: el formulario solo sabe si existe.
import { HttpError } from './http.ts';
import { Modules, rawGet, rawSet, now, type ApiRest, type Module } from './db.ts';
import { encryptSecret, decryptSecret } from './crypto.ts';
import { safeFetch } from './netguard.ts';

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanUrl(v: unknown, label: string) {
  const s = str(v, 500).replace(/\/+$/, '');
  if (!s) return '';
  let u: URL;
  try { u = new URL(s); } catch { throw new HttpError(400, `${label}: URL no válida`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, `${label}: debe empezar por https://`);
  return s;
}

/** Lo que ve el formulario: sin el secreto, solo si está guardado. */
export function publicApiRest(a?: ApiRest) {
  if (!a) return undefined;
  const { clientSecretEnc, ...rest } = a;
  return { ...rest, hasSecret: !!clientSecretEnc };
}

/**
 * Valida la sección API REST recibida del formulario. undefined = sin cambios.
 * clientSecret: si llega con texto se cifra y sustituye al guardado; clearSecret lo borra; si no, se conserva.
 */
export async function sanitizeApiRest(b: any, existing: ApiRest | undefined, actor: string): Promise<ApiRest | undefined> {
  if (b === undefined) return existing;
  if (b === null) return undefined;
  const apiUrl = cleanUrl(b.apiUrl, 'URL API');
  const tokenUrl = cleanUrl(b.tokenUrl, 'URL token');
  const clientId = str(b.clientId, 200);
  const soapUrl = cleanUrl(b.soapUrl, 'URL servicios SOAP');
  const secret = typeof b.clientSecret === 'string' ? b.clientSecret.trim().slice(0, 500) : '';
  let clientSecretEnc = existing?.clientSecretEnc;
  if (b.clearSecret) clientSecretEnc = undefined;
  if (secret) clientSecretEnc = await encryptSecret(secret);
  if (!apiUrl && !tokenUrl && !clientId && !clientSecretEnc && !soapUrl) return undefined;
  const changed = !existing || existing.apiUrl !== apiUrl || existing.tokenUrl !== tokenUrl || existing.clientId !== clientId || existing.clientSecretEnc !== clientSecretEnc || (existing.soapUrl || '') !== soapUrl;
  return { apiUrl, tokenUrl, clientId, clientSecretEnc, ...(soapUrl ? { soapUrl } : {}), updatedAt: changed ? now() : existing!.updatedAt, updatedBy: changed ? actor : existing!.updatedBy };
}

export interface ApiRestTest {
  ok: boolean;
  ms: number;
  status?: number;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  error?: string;
}

/**
 * Pide un token (grant_type=client_credentials, credenciales en el cuerpo) para comprobar URL token, Client ID y secreto.
 * Usa los valores del formulario; si no trae secreto, el guardado. El token obtenido no se devuelve ni se guarda.
 */
export async function testApiRest(m: Module, b: any, portalOrigin: string): Promise<ApiRestTest> {
  const tokenUrl = cleanUrl(b?.tokenUrl ?? m.apiRest?.tokenUrl, 'URL token');
  const clientId = str(b?.clientId ?? m.apiRest?.clientId, 200);
  let secret = typeof b?.clientSecret === 'string' ? b.clientSecret.trim() : '';
  if (!secret && m.apiRest?.clientSecretEnc) {
    secret = await decryptSecret(m.apiRest.clientSecretEnc).catch(() => {
      throw new HttpError(500, 'No se pudo descifrar el Client Secret guardado. Vuelve a introducirlo.');
    });
  }
  if (!tokenUrl) throw new HttpError(400, 'Indica la URL token');
  if (!clientId) throw new HttpError(400, 'Indica el Client ID');
  if (!secret) throw new HttpError(400, 'Indica el Client Secret');
  const started = Date.now();
  try {
    const { res } = await safeFetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }).toString(),
      portalOrigin,
      timeoutMs: 10000
    });
    const text = await res.text();
    let j: any = null;
    try { j = JSON.parse(text); } catch { /* respuesta no JSON */ }
    const ms = Date.now() - started;
    if (res.ok && j?.access_token) {
      return { ok: true, ms, status: res.status, tokenType: j.token_type, expiresIn: Number(j.expires_in) || undefined, scope: j.scope };
    }
    const why = j?.error_description || j?.error || j?.message || text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    return { ok: false, ms, status: res.status, error: `${res.status}${why ? ` · ${why}` : ''}${res.status === 400 || res.status === 401 ? ' (revisa Client ID y Client Secret)' : ''}` };
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    const msg = e?.name === 'AbortError' ? 'Sin respuesta en 10 s' : String(e?.cause?.code || e?.message || e);
    return { ok: false, ms: Date.now() - started, error: `No se pudo conectar con la URL token: ${msg}` };
  }
}

/**
 * Precarga (una sola vez) las URLs de EvalosRest en la integración Evalos8. Las credenciales no van en el código
 * (el repositorio es público): las introduce el superadministrador en Integraciones › Evalos8 › API REST.
 */
export async function ensureEvalosApiRestDefaults() {
  const flag = 'migrations/evalos8-apirest-urls';
  if (await rawGet(flag)) return;
  const m = (await Modules.all()).find((x) => x.clientId === 'evalos8');
  if (!m) return; // se volverá a intentar cuando exista
  if (!m.apiRest) {
    m.apiRest = {
      apiUrl: 'https://evalos-d.digitekcloud.com/Digitek/EvalosRest133',
      tokenUrl: 'https://evalos-c.digitekcloud.com:813/Digitek/EvalosOAuth/token',
      clientId: '',
      updatedAt: now(),
      updatedBy: 'Prime Suite'
    };
    m.updatedAt = now();
    await Modules.put(m);
  }
  await rawSet(flag, { at: now() });
}

/** Precarga (una sola vez) la URL de los servicios SOAP (ServiciosCliente) en la integración Evalos8. */
export async function ensureEvalosSoapDefaults() {
  const flag = 'migrations/evalos8-soap-url';
  if (await rawGet(flag)) return;
  const m = (await Modules.all()).find((x) => x.clientId === 'evalos8');
  if (!m) return;
  if (!m.apiRest?.soapUrl) {
    m.apiRest = { apiUrl: '', tokenUrl: '', clientId: '', ...m.apiRest, soapUrl: 'https://evalos-d.digitekcloud.com/Digitek/suiteclient133/servicioscliente.asmx', updatedAt: now(), updatedBy: 'Prime Suite' };
    m.updatedAt = now();
    await Modules.put(m);
  }
  await rawSet(flag, { at: now() });
}
