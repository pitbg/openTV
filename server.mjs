import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createCatalogService } from './lib/catalog.mjs';
import { AtresplayerError, resolveAtresplayerHls } from './lib/atresplayer.mjs';
import { MediasetError, resolveMediasetHls } from './lib/mediaset.mjs';
import { createVBoxService, mergeVBoxChannels, VBoxError } from './lib/vbox.mjs';

const root = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const vendor = resolve(fileURLToPath(new URL('./node_modules/hls.js/dist/hls.min.js', import.meta.url)));
const mpegtsVendor = resolve(fileURLToPath(new URL('./node_modules/mpegts.js/dist/mpegts.js', import.meta.url)));
const port = Number(process.env.PORT || 3080);
const host = process.env.HOST || '0.0.0.0';
const ttl = Number(process.env.OPENTV_CATALOG_TTL_MS) || 21_600_000;
const catalog = createCatalogService({ ttlMs: ttl, ...(process.env.OPENTV_CATALOG_URL ? { sourceUrl: process.env.OPENTV_CATALOG_URL } : {}) });
const vbox = createVBoxService({ playlistUrl: process.env.OPENTV_VBOX_PLAYLIST_URL });
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
    const [state, local] = await Promise.all([catalog.get(), vbox.get()]);
    const channels = mergeVBoxChannels(state.channels, local.channels);
    if (pathname === '/api/health') return reply(response, 200, { status: 'ok', count: channels.length, catalogAvailable: state.channels.length > 0, stale: state.stale, vbox: { enabled: local.enabled, connected: local.online, count: local.channels.length } });
    response.setHeader('Cache-Control', 'no-store');
    return reply(response, channels.length ? 200 : 503, { ...state, channels, vbox: { enabled: local.enabled, connected: local.online, count: local.channels.length } });
  }

  const vboxStream = /^\/api\/vbox\/stream\/([a-z0-9-]+)$/.exec(pathname);
  if (vboxStream) return proxyVBox(request, response, vboxStream[1]);

  if (pathname === '/api/streams/antena-3' || pathname === '/api/streams/telecinco') {
    response.setHeader('Cache-Control', 'no-store');
    const telecinco = pathname.endsWith('/telecinco');
    try { return reply(response, 200, await (telecinco ? resolveMediasetHls('telecinco') : resolveAtresplayerHls('antena-3'))); }
    catch (error) {
      if (!(error instanceof AtresplayerError || error instanceof MediasetError)) console.error('Error al consultar el proveedor:', error?.message);
      return reply(response, 502, { error: error instanceof AtresplayerError || error instanceof MediasetError ? error.message : 'No se pudo consultar la señal del canal.' });
    }
  }

  let file;
  try { file = pathname === '/' ? resolve(root, 'index.html') : pathname === '/vendor/hls.min.js' ? vendor : pathname === '/vendor/mpegts.js' ? mpegtsVendor : resolve(root, '.' + decodeURIComponent(pathname)); }
  catch { return reply(response, 400, { error: 'Ruta inválida' }); }
  if (file !== vendor && file !== mpegtsVendor && !file.startsWith(root + '/')) return reply(response, 403, { error: 'Acceso denegado' });
  try {
    const stat = statSync(file);
    if (!stat.isFile()) throw Error('Not a file');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': pathname === '/' ? 'no-cache' : 'public, max-age=3600' });
    if (request.method === 'HEAD') return response.end();
    createReadStream(file).pipe(response);
  } catch { reply(response, 404, { error: 'No encontrado' }); }
});

async function proxyVBox(request, response, channelId) {
  response.setHeader('Cache-Control', 'no-store');
  let streamUrl;
  try { streamUrl = await vbox.getStreamUrl(channelId); }
  catch (error) { return reply(response, 404, { error: error instanceof VBoxError ? error.message : 'No se ha encontrado el canal local.' }); }
  if (request.method === 'HEAD') {
    response.writeHead(200, { 'Content-Type': 'video/mp2t' });
    return response.end();
  }
  const controller = new AbortController();
  try {
    const upstream = await fetch(streamUrl, { signal: controller.signal, redirect: 'error', headers: { Accept: 'video/mp2t, */*', 'Accept-Encoding': 'identity' } });
    if (!upstream.ok || !upstream.body) throw new VBoxError(`El sintonizador no ha podido abrir este canal (HTTP ${upstream.status}).`);
    response.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    response.once('close', () => controller.abort());
    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', () => { if (!response.destroyed) response.destroy(); });
    stream.pipe(response);
  } catch (error) {
    controller.abort();
    if (response.headersSent) { if (!response.destroyed) response.destroy(); return; }
    return reply(response, 502, { error: error instanceof VBoxError ? error.message : 'No hay conexión con el streaming del VBox.' });
  }
}

function reply(response, code, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length });
  response.end(bytes);
}

server.listen(port, host, () => console.log(`openTV listo en http://${host}:${port}`));
