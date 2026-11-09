import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
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
const vboxTranscodeAudio = process.env.OPENTV_VBOX_TRANSCODE_AUDIO !== 'false' && process.env.OPENTV_VBOX_TRANSCODE_AUDIO !== '0';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  if (request.method !== 'GET' && request.method !== 'HEAD') return reply(response, 405, { error: 'Método no permitido' });

  let pathname, parsedUrl;
  try { parsedUrl = new URL(request.url, 'http://localhost'); pathname = parsedUrl.pathname; }
  catch { return reply(response, 400, { error: 'URL inválida' }); }

  if (pathname === '/api/channels' || pathname === '/api/health') {
    const [state, local] = await Promise.all([catalog.get(), vbox.get()]);
    const channels = mergeVBoxChannels(state.channels, local.channels);
    if (pathname === '/api/health') return reply(response, 200, { status: 'ok', count: channels.length, catalogAvailable: state.channels.length > 0, stale: state.stale, vbox: { enabled: local.enabled, connected: local.online, count: local.channels.length } });
    response.setHeader('Cache-Control', 'no-store');
    return reply(response, channels.length ? 200 : 503, { ...state, channels, vbox: { enabled: local.enabled, connected: local.online, count: local.channels.length } });
  }

  const vboxStream = /^\/api\/vbox\/stream\/([a-z0-9-]+)$/.exec(pathname);
  if (vboxStream) return proxyVBox(request, response, vboxStream[1], parsedUrl.searchParams.get('video') === 'progressive');

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

async function proxyVBox(request, response, channelId, transcodeVideo = false) {
  response.setHeader('Cache-Control', 'no-store');
  let streamUrl;
  try { streamUrl = await vbox.getStreamUrl(channelId); }
  catch (error) { return reply(response, 404, { error: error instanceof VBoxError ? error.message : 'No se ha encontrado el canal local.' }); }
  if (request.method === 'HEAD') {
    response.writeHead(200, { 'Content-Type': 'video/mp2t' });
    return response.end();
  }
  const controller = new AbortController();
  response.once('close', () => controller.abort());
  try {
    const upstream = await fetch(streamUrl, { signal: controller.signal, redirect: 'error', headers: { Accept: 'video/mp2t, */*', 'Accept-Encoding': 'identity' } });
    if (!upstream.ok || !upstream.body) throw new VBoxError(`El sintonizador no ha podido abrir este canal (HTTP ${upstream.status}).`);
    if (vboxTranscodeAudio || transcodeVideo) return proxyVBoxWithAac(response, upstream.body, controller, transcodeVideo);
    response.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', () => { if (!response.destroyed) response.destroy(); });
    stream.pipe(response);
  } catch (error) {
    controller.abort();
    if (response.headersSent) { if (!response.destroyed) response.destroy(); return; }
    return reply(response, 502, { error: error instanceof VBoxError ? error.message : 'No hay conexión con el streaming del VBox.' });
  }
}

// La TDT española puede emitir audio MP2, que VLC entiende pero que los
// navegadores no admiten normalmente dentro de MP4/MSE. FFmpeg copia el vídeo
// H.264 original y convierte solo la primera pista de audio a AAC. Si Firefox
// falla en VideoToolbox/MSE, el cliente puede solicitar vídeo H.264 progresivo
// mediante ?video=progressive. Esta segunda vía sí recodifica y consume CPU.
// La entrada
// procede del fetch ya validado: FFmpeg no puede seguir redirecciones a otros
// servidores ni abrir URLs arbitrarias incluidas en una lista M3U.
function proxyVBoxWithAac(response, body, controller, transcodeVideo = false) {
  const videoArgs = transcodeVideo ? [
    '-vf', 'yadif=mode=send_frame:parity=auto:deint=interlaced,scale=1280:720:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p', '-profile:v', 'baseline',
    '-crf', '23', '-maxrate', '3500k', '-bufsize', '7000k',
    '-g', '50', '-keyint_min', '50', '-sc_threshold', '0'
  ] : ['-c:v', 'copy'];
  const ffmpeg = spawn('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-probesize', '5000000', '-analyzeduration', '5000000',
    '-f', 'mpegts', '-i', 'pipe:0',
    '-map', '0:v:0?', '-map', '0:a:0?',
    ...videoArgs, '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-sn', '-dn', '-f', 'mpegts', '-muxdelay', '0', 'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  const input = Readable.fromWeb(body);
  let lastError = '';
  let started = false;
  let failed = false;

  const fail = () => {
    if (failed || response.destroyed || controller.signal.aborted) return;
    failed = true;
    if (lastError) console.error('VBox FFmpeg:', lastError.slice(-500));
    if (!response.headersSent) reply(response, 502, { error: 'No se ha podido preparar la señal TDT compatible con este navegador.' });
    else response.destroy();
    controller.abort();
  };

  ffmpeg.stderr.on('data', chunk => { lastError = (lastError + chunk.toString()).slice(-1500); });
  ffmpeg.once('error', fail);
  ffmpeg.stdout.once('data', chunk => {
    if (response.destroyed || controller.signal.aborted) return;
    started = true;
    response.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    response.write(chunk);
    ffmpeg.stdout.pipe(response);
  });
  ffmpeg.once('close', code => {
    if (!started || code !== 0) fail();
  });
  response.once('close', () => {
    ffmpeg.kill('SIGTERM');
    input.destroy();
  });
  input.on('error', () => { if (!controller.signal.aborted) fail(); });
  ffmpeg.stdin.on('error', error => { if (error.code !== 'EPIPE' && !controller.signal.aborted) fail(); });
  input.pipe(ffmpeg.stdin);
}

function reply(response, code, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length });
  response.end(bytes);
}

server.listen(port, host, () => console.log(`openTV listo en http://${host}:${port}`));
