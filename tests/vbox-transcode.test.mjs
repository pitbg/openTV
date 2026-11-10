import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';

const available = ['ffmpeg', 'ffprobe'].every(command => spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0);
const directory = resolve(import.meta.dirname, '..');

async function listening(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

test('convierte audio DVB MP2 a AAC y conserva H.264 mediante el proxy', { skip: !available, timeout: 30_000 }, async () => {
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000',
    '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'mp2', '-b:a', '128k', '-f', 'mpegts', 'pipe:1'
  ], { maxBuffer: 4 * 1024 * 1024 });
  assert.equal(generated.status, 0, generated.stderr.toString());

  const upstream = createServer((request, response) => {
    if (request.url === '/vboxSimpleIptv.m3u8') {
      response.setHeader('Content-Type', 'audio/x-mpegurl');
      response.end(`#EXTM3U\n#EXTINF:-1,Telecinco HD\nhttp://127.0.0.1:${upstream.address().port}/Telecinco%20HD\n`);
    } else if (request.url === '/Telecinco%20HD') {
      response.setHeader('Content-Type', 'video/MP2T');
      response.end(generated.stdout);
    } else if (request.url === '/catalog.json') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ countries: [{ name: 'Spain', ambits: [{ channels: [] }] }] }));
    } else response.writeHead(404).end();
  });
  const upstreamPort = await listening(upstream);
  const portServer = createServer();
  const appPort = await listening(portServer);
  await new Promise(resolve => portServer.close(resolve));
  const app = spawn(process.execPath, ['server.mjs'], {
    cwd: directory,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(appPort), OPENTV_CATALOG_URL: `http://127.0.0.1:${upstreamPort}/catalog.json`, OPENTV_VBOX_PLAYLIST_URL: `http://127.0.0.1:${upstreamPort}/vboxSimpleIptv.m3u8`, OPENTV_VBOX_TRANSCODE_AUDIO: 'true' },
    stdio: 'ignore'
  });

  try {
    let stream;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        stream = await fetch(`http://127.0.0.1:${appPort}/api/vbox/stream/telecinco`, { signal: AbortSignal.timeout(12_000) });
        break;
      } catch { await delay(70); }
    }
    assert.ok(stream);
    assert.equal(stream.status, 200);
    assert.equal(stream.headers.get('x-opentv-video-encoder'), 'copy');
    const output = Buffer.from(await stream.arrayBuffer());
    assert.ok(output.length > 10000, `Salida MPEG-TS demasiado corta: ${output.length}`);

    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', '-i', 'pipe:0'
    ], { input: output, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(probe.status, 0, probe.stderr.toString());
    const codecs = JSON.parse(probe.stdout).streams;
    assert.ok(codecs.some(stream => stream.codec_type === 'video' && stream.codec_name === 'h264'));
    assert.ok(codecs.some(stream => stream.codec_type === 'audio' && stream.codec_name === 'aac'));
    assert.ok(!codecs.some(stream => stream.codec_name === 'mp2'));

    // Firefox/macOS puede fallar al decodificar algunos GOP H.264 con MSE.
    // La vía de compatibilidad debe generar un nuevo H.264 progresivo a 720p.
    const compatible = await fetch(`http://127.0.0.1:${appPort}/api/vbox/stream/telecinco?video=progressive`, { signal: AbortSignal.timeout(15_000) });
    assert.equal(compatible.status, 200);
    assert.equal(compatible.headers.get('x-opentv-video-encoder'), 'cpu');
    const compatibleBytes = Buffer.from(await compatible.arrayBuffer());
    const compatibleProbe = spawnSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,profile,width,height,field_order',
      '-of', 'json', '-i', 'pipe:0'
    ], { input: compatibleBytes, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(compatibleProbe.status, 0, compatibleProbe.stderr.toString());
    const compatibleCodecs = JSON.parse(compatibleProbe.stdout).streams;
    const video = compatibleCodecs.find(stream => stream.codec_type === 'video');
    assert.equal(video.codec_name, 'h264');
    assert.equal(video.width, 1280);
    assert.equal(video.height, 720);
    assert.equal(video.field_order, 'progressive');
    assert.ok(compatibleCodecs.some(stream => stream.codec_type === 'audio' && stream.codec_name === 'aac'));

    // Una GPU no disponible no debe impedir que Firefox reciba vídeo compatible:
    // el servidor vuelve a abrir la señal del VBox y reintenta con libx264.
    const gpuPortServer = createServer();
    const gpuPort = await listening(gpuPortServer);
    await new Promise(resolve => gpuPortServer.close(resolve));
    const gpuApp = spawn(process.execPath, ['server.mjs'], {
      cwd: directory,
      env: {
        ...process.env, HOST: '127.0.0.1', PORT: String(gpuPort),
        OPENTV_CATALOG_URL: `http://127.0.0.1:${upstreamPort}/catalog.json`,
        OPENTV_VBOX_PLAYLIST_URL: `http://127.0.0.1:${upstreamPort}/vboxSimpleIptv.m3u8`,
        OPENTV_VBOX_VIDEO_ENCODER: 'vaapi',
        OPENTV_VBOX_VAAPI_PIPELINE: 'full',
        OPENTV_VBOX_VAAPI_DEVICE: '/dev/dri/no-such-device'
      },
      stdio: 'ignore'
    });
    try {
      let fallback;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          fallback = await fetch(`http://127.0.0.1:${gpuPort}/api/vbox/stream/telecinco?video=progressive`, { signal: AbortSignal.timeout(15_000) });
          break;
        } catch { await delay(70); }
      }
      assert.ok(fallback);
      assert.equal(fallback.status, 200);
      assert.equal(fallback.headers.get('x-opentv-video-encoder'), 'cpu');
      const fallbackBytes = Buffer.from(await fallback.arrayBuffer());
      const fallbackProbe = spawnSync('ffprobe', [
        '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,profile,width,height,field_order',
        '-of', 'json', '-i', 'pipe:0'
      ], { input: fallbackBytes, maxBuffer: 2 * 1024 * 1024 });
      assert.equal(fallbackProbe.status, 0, fallbackProbe.stderr.toString());
      const fallbackStreams = JSON.parse(fallbackProbe.stdout).streams;
      assert.equal(fallbackStreams.find(stream => stream.codec_type === 'video')?.field_order, 'progressive');
      assert.ok(fallbackStreams.some(stream => stream.codec_type === 'audio' && stream.codec_name === 'aac'));
    } finally {
      gpuApp.kill('SIGTERM');
    }
  } finally {
    app.kill('SIGTERM');
    await new Promise(resolve => upstream.close(resolve));
  }
});
