// Servidor local para desarrollo: sirve la API en :8888 (Vite hace de proxy desde :5173).
process.env.PRIME_STORE = 'file';
process.env.PRIME_ALLOW_PRIVATE_FETCH ??= '1';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { handle } from './app.ts';
import { handleDemo } from './demo.ts';

const port = Number(process.env.API_PORT || 8888);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const url = `http://${req.headers.host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method!) ? undefined : Buffer.concat(chunks) });
  const p = new URL(url).pathname;
  const isApi = p.startsWith('/api/') || p.startsWith('/oidc/') || p.startsWith('/.well-known/');
  let response: Response;
  if (p.startsWith('/demo-api/')) response = await handleDemo(request);
  else if (isApi || !process.env.SERVE_DIST) response = await handle(request);
  else response = await serveStatic(p);
  const out: Record<string, string | string[]> = {};
  response.headers.forEach((v, k) => (out[k] = v));
  const setCookie = (response.headers as any).getSetCookie?.();
  if (setCookie?.length) out['set-cookie'] = setCookie;
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`Prime Suite API en http://localhost:${port}`));

// Con SERVE_DIST=1 sirve también el build (dist/) como haría Netlify: útil para probar todo en un solo puerto.
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
async function serveStatic(p: string): Promise<Response> {
  const root = path.resolve('dist');
  let file = path.join(root, decodeURIComponent(p));
  if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 });
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    await stat(file);
  } catch {
    file = path.join(root, 'index.html');
  }
  return new Response(await readFile(file), { headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' } });
}
