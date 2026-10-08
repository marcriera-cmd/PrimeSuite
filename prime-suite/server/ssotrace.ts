// Log de inicio de sesión (depuración de SSO).
// Si una integración tiene activado «Ver log de inicio de sesión» (Module.ssoDebug), Prime ID va apuntando cada paso
// del login con esa app: qué pide la app, qué comprueba Prime ID, qué usuario identifica y qué datos le envía.
// Nunca se guardan secretos ni tokens firmados: solo sus datos (claims) ya decodificados.
import { rawGet, rawSet, id, type Module, type User } from './db.ts';

export type TraceStatus = 'info' | 'ok' | 'warn' | 'error';
export interface TraceEvent {
  id: string;
  at: string;
  /** Usuario de Prime Suite implicado (null si todavía no hay sesión). */
  userId: string | null;
  userEmail?: string;
  /** Petición del navegador del usuario (authorize, lanzamiento) o llamada directa de la app (token, userinfo, canje). */
  channel: 'portal' | 'navegador' | 'app';
  status: TraceStatus;
  title: string;
  detail?: string;
  data?: Record<string, unknown>;
}

const MAX_EVENTS = 200;
const MAX_AGE_MS = 24 * 3600 * 1000;
const key = (moduleId: string) => `sso-trace/${moduleId}`;

/** Campos que no se guardan nunca en el log aunque lleguen en los datos. */
const SECRET_KEYS = /secret|password|passwd|pwd|token$|^code$|code_verifier|assertion/i;

function clean(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 600 ? v.slice(0, 600) + '…' : v;
  if (depth > 3) return '…';
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => clean(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === undefined) continue;
      out[k] = SECRET_KEYS.test(k) ? '(oculto)' : clean(x, depth + 1);
    }
    return out;
  }
  return String(v);
}

// Las escrituras de un mismo módulo se encadenan para no perder pasos que llegan casi a la vez.
const queues = new Map<string, Promise<void>>();

/** Apunta un paso si la integración tiene el log activado. Nunca lanza: el log no debe romper un login. */
export function ssoTrace(m: Pick<Module, 'id' | 'ssoDebug'> | null | undefined, ev: Omit<TraceEvent, 'id' | 'at' | 'userId' | 'userEmail'> & { user?: Pick<User, 'id' | 'email'> | null }) {
  if (!m?.ssoDebug) return Promise.resolve();
  const { user, ...rest } = ev;
  const event: TraceEvent = {
    id: id(), at: new Date().toISOString(), userId: user?.id ?? null, userEmail: user?.email,
    ...rest, data: rest.data ? (clean(rest.data) as Record<string, unknown>) : undefined
  };
  const prev = queues.get(m.id) || Promise.resolve();
  const next = prev.then(async () => {
    const list = (await rawGet<TraceEvent[]>(key(m.id))) || [];
    const cutoff = Date.now() - MAX_AGE_MS;
    const kept = list.filter((e) => Date.parse(e.at) >= cutoff);
    kept.push(event);
    await rawSet(key(m.id), kept.slice(-MAX_EVENTS));
  }).catch(() => { /* el log es best effort */ });
  queues.set(m.id, next);
  return next;
}

/** Pasos de una integración, más antiguos primero. */
export async function readTrace(moduleId: string, opts: { userId?: string; since?: string } = {}): Promise<TraceEvent[]> {
  await queues.get(moduleId);
  const list = (await rawGet<TraceEvent[]>(key(moduleId))) || [];
  const since = opts.since ? Date.parse(opts.since) : NaN;
  return list.filter((e) => {
    if (!Number.isNaN(since) && Date.parse(e.at) < since) return false;
    // Un usuario solo ve sus pasos y los anónimos (antes de iniciar sesión) desde que abrió la app.
    if (opts.userId && e.userId && e.userId !== opts.userId) return false;
    if (opts.userId && !e.userId && Number.isNaN(since)) return false;
    return true;
  });
}

export async function clearTrace(moduleId: string) {
  await queues.get(moduleId);
  await rawSet(key(moduleId), []);
}

/** Datos de un id_token / access_token / Prime Token para el log (sin firma). */
export function claimsForLog(claims: Record<string, unknown>) {
  const { nonce, c_hash, at_hash, ...rest } = claims;
  return { ...rest, ...(nonce !== undefined ? { nonce: '(presente)' } : {}), ...(c_hash ? { c_hash: '(presente)' } : {}), ...(at_hash ? { at_hash: '(presente)' } : {}) };
}
