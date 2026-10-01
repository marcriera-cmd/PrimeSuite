// "Aplicación externa" de demostración. Solo usa lo que tendría cualquier app de terceros:
// el JWKS público de Prime ID y el endpoint de canje. No importa nada del backend del portal.
import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function issuerOf(req: Request) {
  if (process.env.PRIME_ISSUER) return process.env.PRIME_ISSUER.replace(/\/$/, '');
  const u = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || u.host;
  return `${proto}://${host}`;
}
function jwks(iss: string) {
  if (!jwksCache.has(iss)) jwksCache.set(iss, createRemoteJWKSet(new URL(`${iss}/.well-known/jwks.json`)));
  return jwksCache.get(iss)!;
}
const out = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function bearer(req: Request) {
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) throw new Error('Falta el token');
  const iss = issuerOf(req);
  const { payload } = await jwtVerify(h.slice(7), jwks(iss), { issuer: iss, typ: 'at+jwt' });
  return payload;
}

export async function handleDemo(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/$/, '');
  const iss = issuerOf(req);
  try {
    if (path === '/demo-api/session' && req.method === 'POST') {
      const { token } = (await req.json()) as { token?: string };
      const steps: string[] = [];
      // 1) Verificación local con las claves públicas (lo que haría el SDK)
      const { payload, protectedHeader } = await jwtVerify(String(token), jwks(iss), { issuer: iss, typ: 'prime+jwt' });
      steps.push(`Firma ${protectedHeader.alg} válida (kid ${protectedHeader.kid}) contra ${iss}/.well-known/jwks.json`);
      steps.push(`Emisor ${payload.iss} · audiencia ${payload.aud} · caduca en ${Number(payload.exp) - Math.floor(Date.now() / 1000)} s`);
      // 2) Canje en Prime ID para garantizar un solo uso
      const r = await fetch(`${iss}/api/sso/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
      const redeem = (await r.json()) as { valid: boolean; error?: string };
      if (!redeem.valid) return out({ ok: false, error: redeem.error === 'token_already_used' ? 'Este token ya se usó (protección de un solo uso)' : 'Prime ID rechazó el token', steps }, 401);
      steps.push('Canjeado en Prime ID: el token ya no se puede reutilizar');
      return out({ ok: true, claims: payload, steps });
    }
    if (path.startsWith('/demo-api/widgets/')) {
      const p = await bearer(req);
      const who = String(p.given_name || p.name || 'usuario');
      const kind = path.split('/').pop();
      if (kind === 'kpi') return out({ value: 42, label: 'visitas registradas hoy', delta: '+8 vs. ayer', trend: 'up', note: `Datos de ejemplo para ${who} · ${p.tenant}` });
      if (kind === 'chart') return out({ series: [['L', 312], ['M', 348], ['X', 336], ['J', 359], ['V', 290], ['S', 64], ['D', 21]].map(([label, value]) => ({ label, value })), unit: 'accesos' });
      if (kind === 'list') return out({ items: [
        { title: 'Visita · Proveedor de mantenimiento', subtitle: 'Hoy 10:30 · recepción', badge: 'Pendiente' },
        { title: 'Contrata · Limpieza nocturna', subtitle: 'Documentación caducada', badge: 'Revisar' },
        { title: `Solicitud de ${who}`, subtitle: 'Acceso a sala técnica', badge: 'Nueva' }
      ] });
      return out({ error: 'Widget desconocido' }, 404);
    }
    return out({ error: 'No encontrado' }, 404);
  } catch (e: any) {
    return out({ ok: false, error: e?.code === 'ERR_JWT_EXPIRED' ? 'El token ha caducado' : 'Token no válido', detail: e?.message }, 401);
  }
}
