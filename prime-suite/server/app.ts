// Punto de entrada común: lo usan la función de Netlify y el servidor local.
import { Router, json, HttpError, assertSameOrigin } from './http.ts';
import { authRoutes } from './routes/auth.ts';
import { oidcRoutes } from './routes/oidc.ts';
import { portalRoutes } from './routes/portal.ts';
import { adminRoutes } from './routes/admin.ts';

const router = new Router();
router.get('/api/health', async () => json({ ok: true, service: 'prime-suite', version: '2.0.0' }));
authRoutes(router);
oidcRoutes(router);
portalRoutes(router);
adminRoutes(router);

// Endpoints llamados desde otras aplicaciones (sin comprobación de Origin).
const CROSS_ORIGIN = ['/api/sso/redeem', '/oidc/token', '/oidc/userinfo'];

export async function handle(req: Request): Promise<Response> {
  try {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/api/') && !CROSS_ORIGIN.includes(path)) assertSameOrigin(req);
    const res = await router.handle(req);
    return res || json({ error: 'No encontrado' }, 404);
  } catch (e: any) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error('[prime-suite]', e);
    return json({ error: 'Error interno' }, 500);
  }
}
