// Peticiones salientes seguras (evita SSRF hacia redes internas).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { HttpError } from './http.ts';

function privateIp(ip: string) {
  if (ip.includes(':')) {
    const l = ip.toLowerCase();
    return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l === '::' || l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export async function assertPublicUrl(raw: string, portalOrigin?: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, 'URL no válida');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'Solo se admiten URLs http(s)');
  // Las llamadas al propio portal (p. ej. la app demo) siempre están permitidas.
  if (portalOrigin && u.origin === portalOrigin) return u;
  if (process.env.PRIME_ALLOW_PRIVATE_FETCH === '1') return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  if (!ips.length) throw new HttpError(400, `No se pudo resolver ${host}`);
  if (ips.some(privateIp)) throw new HttpError(400, 'La URL apunta a una red privada');
  return u;
}

export async function safeFetch(raw: string, init: RequestInit & { timeoutMs?: number; portalOrigin?: string } = {}) {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current, init.portalOrigin);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 6000);
    try {
      const res = await fetch(current, { ...init, redirect: 'manual', signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, current).toString();
        continue;
      }
      return { res, finalUrl: current };
    } finally {
      clearTimeout(t);
    }
  }
  throw new HttpError(400, 'Demasiadas redirecciones');
}
