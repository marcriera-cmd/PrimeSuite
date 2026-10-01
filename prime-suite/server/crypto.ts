// Claves de firma de Prime ID (RS256), JWKS, sesiones y utilidades.
import { SignJWT, jwtVerify, generateKeyPair, exportJWK, importJWK, createLocalJWKSet, type JWK, type JWTPayload } from 'jose';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { rawGet, rawSet, getSettings } from './db.ts';

interface StoredKey {
  kid: string;
  createdAt: string;
  privateJwk: JWK;
  publicJwk: JWK;
}
interface KeyRing {
  current: StoredKey;
  previous: StoredKey[]; // se siguen publicando en JWKS para validar tokens emitidos antes de rotar
}

let cache: { ring: KeyRing; at: number } | null = null;

async function newKey(): Promise<StoredKey> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const kid = randomBytes(8).toString('hex');
  const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: 'RS256', use: 'sig' };
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { kid, createdAt: new Date().toISOString(), privateJwk, publicJwk };
}

export async function keyRing(): Promise<KeyRing> {
  if (cache && Date.now() - cache.at < 60_000) return cache.ring;
  let ring = await rawGet<KeyRing>('keys/ring');
  if (!ring) {
    const created: KeyRing = { current: await newKey(), previous: [] };
    await rawSet('keys/ring', created, { onlyIfNew: true });
    ring = (await rawGet<KeyRing>('keys/ring')) || created;
  }
  cache = { ring, at: Date.now() };
  return ring;
}

export async function rotateKeys() {
  const ring = await keyRing();
  const next: KeyRing = { current: await newKey(), previous: [ring.current, ...ring.previous].slice(0, 2) };
  await rawSet('keys/ring', next);
  cache = { ring: next, at: Date.now() };
  return next;
}

export async function jwks() {
  const ring = await keyRing();
  return { keys: [ring.current.publicJwk, ...ring.previous.map((k) => k.publicJwk)] };
}

export async function sign(payload: JWTPayload, opts: { issuer: string; audience: string | string[]; ttlSec: number; subject?: string; jti?: string; typ?: string }) {
  const ring = await keyRing();
  const key = await importJWK(ring.current.privateJwk, 'RS256');
  let jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: ring.current.kid, typ: opts.typ || 'JWT' })
    .setIssuer(opts.issuer)
    .setAudience(opts.audience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + opts.ttlSec);
  if (opts.subject) jwt = jwt.setSubject(opts.subject);
  if (opts.jti) jwt = jwt.setJti(opts.jti);
  return jwt.sign(key);
}

export async function verify(token: string, opts: { issuer: string; audience?: string | string[]; typ?: string }) {
  const set = createLocalJWKSet(await jwks());
  const { payload, protectedHeader } = await jwtVerify(token, set, { issuer: opts.issuer, audience: opts.audience, algorithms: ['RS256'] });
  if (opts.typ && protectedHeader.typ !== opts.typ) throw new Error('typ inválido');
  return payload;
}

// ---- Sesión del portal (cookie HttpOnly con JWT firmado) ----
export const SESSION_COOKIE = 'ps_session';
const SESSION_AUD = 'prime-suite-session';
// Emisor fijo para la sesión: NO depende del host de la petición, que en Netlify
// puede variar entre llamadas y haría que la sesión no validara (401 tras entrar).
const SESSION_ISS = 'prime-suite';

export async function createSession(_issuer: string, user: { id: string; sessionVersion: number }) {
  const s = await getSettings();
  const ttl = Math.max(1, s.sessionHours) * 3600;
  const token = await sign({ sv: user.sessionVersion }, { issuer: SESSION_ISS, audience: SESSION_AUD, subject: user.id, ttlSec: ttl, typ: 'session+jwt' });
  return { token, ttl };
}

export async function readSession(_issuer: string, token: string | undefined) {
  if (!token) return null;
  try {
    const p = await verify(token, { issuer: SESSION_ISS, audience: SESSION_AUD, typ: 'session+jwt' });
    return { userId: String(p.sub), sv: Number(p.sv ?? 0), iat: Number(p.iat) };
  } catch {
    return null;
  }
}

// ---- Contraseñas y secretos ----
export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const checkPassword = (p: string, h: string) => bcrypt.compare(p, h);
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const pkceS256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

let dummyHash: string | null = null;
export async function dummyCheck() {
  dummyHash ??= await bcrypt.hash('dummy-password', 10);
  await bcrypt.compare('not-the-password', dummyHash);
}

// ---- Cifrado de secretos (contraseñas de Superset) ----
// Clave: variable PRIME_SECRET_KEY (recomendado) o, si no existe, una clave aleatoria guardada en el almacén.
let secretKey: Buffer | null = null;
async function getSecretKey() {
  if (secretKey) return secretKey;
  if (process.env.PRIME_SECRET_KEY) {
    secretKey = createHash('sha256').update(process.env.PRIME_SECRET_KEY).digest();
    return secretKey;
  }
  let stored = await rawGet<{ key: string }>('keys/secret');
  if (!stored) {
    await rawSet('keys/secret', { key: randomBytes(32).toString('base64') }, { onlyIfNew: true });
    stored = await rawGet<{ key: string }>('keys/secret');
  }
  secretKey = Buffer.from(stored!.key, 'base64');
  return secretKey;
}
export async function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', await getSecretKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export async function decryptSecret(blob: string) {
  const [iv, tag, enc] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = createDecipheriv('aes-256-gcm', await getSecretKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
