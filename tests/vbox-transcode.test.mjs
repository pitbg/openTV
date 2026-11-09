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
  } finally {
    app.kill('SIGTERM');
    await new Promise(resolve => upstream.close(resolve));
  }
});
