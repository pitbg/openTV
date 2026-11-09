import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalogService } from './lib/catalog.mjs';

const root = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const vendor = resolve(fileURLToPath(new URL('./node_modules/hls.js/dist/hls.min.js', import.meta.url)));
const port = Number(process.env.PORT || 3080);
const host = process.env.HOST || '0.0.0.0';
const ttl = Number(process.env.OPENTV_CATALOG_TTL_MS) || 21_600_000;
const catalog = createCatalogService({ ttlMs: ttl, ...(process.env.OPENTV_CATALOG_URL ? { sourceUrl: process.env.OPENTV_CATALOG_URL } : {}) });
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  if (request.method !== 'GET' && request.method !== 'HEAD') return reply(response, 405, { error: 'Método no permitido' });

  let pathname;
  try { pathname = new URL(request.url, 'http://localhost').pathname; }
  catch { return reply(response, 400, { error: 'URL inválida' }); }

  if (pathname === '/api/channels' || pathname === '/api/health') {
    const state = await catalog.get();
    if (pathname === '/api/health') return reply(response, 200, { status: 'ok', count: state.channels.length, catalogAvailable: state.channels.length > 0, stale: state.stale });
    response.setHeader('Cache-Control', 'no-store');
    return reply(response, state.channels.length ? 200 : 503, state);
  }

  let file;
  try { file = pathname === '/' ? resolve(root, 'index.html') : pathname === '/vendor/hls.min.js' ? vendor : resolve(root, '.' + decodeURIComponent(pathname)); }
  catch { return reply(response, 400, { error: 'Ruta inválida' }); }
  if (file !== vendor && !file.startsWith(root + '/')) return reply(response, 403, { error: 'Acceso denegado' });
  try {
    const stat = statSync(file);
    if (!stat.isFile()) throw Error('Not a file');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': pathname === '/' ? 'no-cache' : 'public, max-age=3600' });
    if (request.method === 'HEAD') return response.end();
    createReadStream(file).pipe(response);
  } catch { reply(response, 404, { error: 'No encontrado' }); }
});

function reply(response, code, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length });
  response.end(bytes);
}

server.listen(port, host, () => console.log(`openTV listo en http://${host}:${port}`));
