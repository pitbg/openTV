import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { createCatalogService } from './lib/catalog.mjs';
import { AtresplayerError, resolveAtresplayerHls } from './lib/atresplayer.mjs';
import { MediasetError, resolveMediasetHls } from './lib/mediaset.mjs';
import { createVBoxService, mergeVBoxChannels, VBoxError } from './lib/vbox.mjs';
import { createEpgService } from './lib/epg.mjs';
import { createLaSeptimaEmbedService, LaSeptimaEmbedError } from './lib/la-septima.mjs';
import { vboxFfmpegArgs } from './lib/ffmpeg-args.mjs';
import { renderSocialHtml } from './lib/social-meta.mjs';

const root = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const vendor = resolve(fileURLToPath(new URL('./node_modules/hls.js/dist/hls.min.js', import.meta.url)));
const mpegtsVendor = resolve(fileURLToPath(new URL('./node_modules/mpegts.js/dist/mpegts.js', import.meta.url)));
const port = Number(process.env.PORT || 3080);
const host = process.env.HOST || '0.0.0.0';
const ttl = Number(process.env.OPENTV_CATALOG_TTL_MS) || 21_600_000;
const catalog = createCatalogService({ ttlMs: ttl, ...(process.env.OPENTV_CATALOG_URL ? { sourceUrl: process.env.OPENTV_CATALOG_URL } : {}) });
const vbox = createVBoxService({ playlistUrl: process.env.OPENTV_VBOX_PLAYLIST_URL });
const epg = createEpgService({
  vboxPlaylistUrl: process.env.OPENTV_VBOX_PLAYLIST_URL,
  ...(process.env.OPENTV_EPG_TDT_ENABLED === 'false' ? { externalUrl: null } : {}),
  ...(process.env.OPENTV_EPG_SHARE_ENABLED === 'false' ? { epgshareUrl: null } : {}),
  ...(process.env.OPENTV_EPG_ATRESMEDIA_ENABLED === 'false' ? { atresmediaUrl: null } : {})
});
const laSeptimaEmbed = createLaSeptimaEmbedService();
const vboxTranscodeAudio = process.env.OPENTV_VBOX_TRANSCODE_AUDIO !== 'false' && process.env.OPENTV_VBOX_TRANSCODE_AUDIO !== '0';
const vboxVideoEncoder = process.env.OPENTV_VBOX_VIDEO_ENCODER === 'vaapi' ? 'vaapi' : 'cpu';
const vboxVaapiDevice = process.env.OPENTV_VBOX_VAAPI_DEVICE || '/dev/dri/renderD128';
const vboxVaapiPipeline = process.env.OPENTV_VBOX_VAAPI_PIPELINE === 'full' ? 'full' : 'encode';
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

  if (pathname === '/api/epg') {
    response.setHeader('Cache-Control', 'no-store');
    const [catalogue, local] = await Promise.all([catalog.get(), vbox.get()]);
    const channels = mergeVBoxChannels(catalogue.channels, local.channels);
    return reply(response, 200, await epg.get(channels, local.channels));
  }

  if (pathname === '/api/embeds/la-septima') {
    response.setHeader('Cache-Control', 'no-store');
    try { return reply(response, 200, await laSeptimaEmbed.resolve()); }
    catch (error) {
      if (!(error instanceof LaSeptimaEmbedError)) console.error('Error al consultar el directo de La Séptima:', error?.message);
      return reply(response, 502, { error: error instanceof LaSeptimaEmbedError ? error.message : 'No se pudo consultar la emisión oficial.' });
    }
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
    if (file === resolve(root, 'index.html')) {
      const html = renderSocialHtml(await readFile(file, 'utf8'), request.headers, process.env.OPENTV_PUBLIC_URL, Boolean(request.socket.encrypted));
      response.writeHead(200, { 'Content-Type': mime['.html'], 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-store' });
      return response.end(request.method === 'HEAD' ? undefined : html);
    }
    const revalidate = pathname === '/' || pathname === '/app.js' || pathname === '/styles.css';
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': revalidate ? 'no-cache' : 'public, max-age=3600' });
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
    if (vboxTranscodeAudio || transcodeVideo) {
      await proxyVBoxWithAac(response, streamUrl, upstream.body, controller, transcodeVideo);
      return;
    }
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
// H.264 original y convierte solo la primera pista de audio a AAC. Si el
// navegador no admite el H.264 entrelazado (o si es iOS), el cliente puede
// solicitar vídeo H.264 progresivo mediante ?video=progressive. Se intenta
// VA-API únicamente si se habilita en
// el servidor. Ante un fallo al iniciar la GPU se reabre la señal y se utiliza
// libx264, manteniendo disponible la vía original sin recodificar. La entrada
// procede del fetch ya validado: FFmpeg no puede seguir redirecciones a otros
// servidores ni abrir URLs arbitrarias incluidas en una lista M3U.
async function proxyVBoxWithAac(response, streamUrl, body, controller, transcodeVideo = false) {
  const encoders = transcodeVideo && vboxVideoEncoder === 'vaapi'
    ? (vboxVaapiPipeline === 'full' ? ['vaapi-full', 'vaapi', 'cpu'] : ['vaapi', 'cpu'])
    : ['cpu'];
  let currentBody = body;
  for (let index = 0; index < encoders.length; index++) {
    const encoder = encoders[index];
    try {
      await streamWithFfmpeg(response, currentBody, controller, encoder, transcodeVideo);
      return;
    } catch (error) {
      if (controller.signal.aborted || response.headersSent) return;
      if (index === encoders.length - 1) throw error;
      console.warn(`VBox FFmpeg ${encoder} no disponible; reintentando con ${encoders[index + 1]}:`, error.message.slice(-500));
      const upstream = await fetch(streamUrl, { signal: controller.signal, redirect: 'error', headers: { Accept: 'video/mp2t, */*', 'Accept-Encoding': 'identity' } });
      if (!upstream.ok || !upstream.body) throw new VBoxError(`El sintonizador no ha podido reabrir este canal (HTTP ${upstream.status}).`);
      currentBody = upstream.body;
    }
  }
}

function streamWithFfmpeg(response, body, controller, encoder, transcodeVideo) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', vboxFfmpegArgs({ transcodeVideo, encoder, vaapiDevice: vboxVaapiDevice }), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(encoder.startsWith('vaapi') ? { LIBVA_DRIVER_NAME: encoder === 'vaapi-full' ? 'i965' : 'iHD' } : {}) }
    });
    const input = Readable.fromWeb(body);
    let lastError = '';
    let started = false;
    let failed = false;

    const fail = () => {
      if (failed || response.destroyed || controller.signal.aborted) return;
      failed = true;
      ffmpeg.kill('SIGTERM');
      input.destroy();
      response.off('close', stop);
      const error = new Error(lastError || 'FFmpeg no ha producido señal de vídeo.');
      if (!started) reject(error);
      else { console.error('VBox FFmpeg:', error.message.slice(-500)); response.destroy(); }
    };
    const stop = () => {
      ffmpeg.kill('SIGTERM');
      input.destroy();
      if (!started) reject(new Error('El cliente ha cerrado el stream.'));
    };

    ffmpeg.stderr.on('data', chunk => { lastError = (lastError + chunk.toString()).slice(-1500); });
    ffmpeg.once('error', fail);
    ffmpeg.stdout.once('data', chunk => {
      if (response.destroyed || controller.signal.aborted) return;
      started = true;
      response.writeHead(200, {
        'Content-Type': 'video/mp2t',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
        'X-OpenTV-Video-Encoder': transcodeVideo ? encoder : 'copy'
      });
      response.write(chunk);
      ffmpeg.stdout.pipe(response);
      resolve();
    });
    ffmpeg.once('close', code => {
      if (!started || code !== 0) fail();
      else if (!response.writableEnded && !response.destroyed) response.end();
    });
    response.once('close', stop);
    input.on('error', () => { if (!controller.signal.aborted) fail(); });
    ffmpeg.stdin.on('error', error => { if (error.code !== 'EPIPE' && !controller.signal.aborted) fail(); });
    input.pipe(ffmpeg.stdin);
  });
}

function reply(response, code, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length });
  response.end(bytes);
}

server.listen(port, host, () => console.log(`openTV listo en http://${host}:${port}`));
