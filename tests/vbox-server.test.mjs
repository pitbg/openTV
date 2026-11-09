import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';

const directory = resolve(import.meta.dirname, '..');

async function openServer(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function freePort() {
  const server = createServer();
  const port = await openServer(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('la API importa el VBox y retransmite una señal sin cambiar sus bytes', { timeout: 15_000 }, async () => {
  let signalRequests = 0;
  const upstream = createServer((request, response) => {
    if (request.url === '/vboxSimpleIptv.m3u8') {
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end(`#EXTM3U\n#EXTINF:-1,Telecinco HD\nhttp://127.0.0.1:${upstream.address().port}/Telecinco%20HD\n`);
    } else if (request.url === '/Telecinco%20HD') {
      signalRequests++;
      response.writeHead(200, { 'Content-Type': 'video/mp2t' });
      response.end(Buffer.alloc(188, 0x47));
    } else if (request.url === '/catalog.json') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ countries: [{ name: 'Spain', ambits: [{ channels: [
        { name: 'La 1', web: 'https://rtve.es' },
        { name: 'La 2', web: 'https://rtve.es' }
      ] }] }] }));
    } else {
      response.writeHead(404).end();
    }
  });
  const upstreamPort = await openServer(upstream);
  const appPort = await freePort();
  const app = spawn(process.execPath, ['server.mjs'], {
    cwd: directory,
    env: {
      ...process.env, HOST: '127.0.0.1', PORT: String(appPort),
      OPENTV_CATALOG_URL: `http://127.0.0.1:${upstreamPort}/catalog.json`,
      OPENTV_VBOX_PLAYLIST_URL: `http://127.0.0.1:${upstreamPort}/vboxSimpleIptv.m3u8`
    },
    stdio: 'ignore'
  });
  try {
    let health;
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${appPort}/api/health`);
        health = await response.json();
        break;
      } catch { await delay(80); }
    }
    assert.ok(health, 'La API debe arrancar');
    assert.equal(health.vbox.connected, true);
    assert.equal(health.vbox.count, 1);

    const response = await fetch(`http://127.0.0.1:${appPort}/api/channels`);
    const channels = (await response.json()).channels;
    const telecinco = channels.find(channel => channel.id === 'telecinco');
    assert.equal(telecinco.localStream, true);
    assert.equal(telecinco.localStreamUrl, '/api/vbox/stream/telecinco');

    const stream = await fetch(`http://127.0.0.1:${appPort}${telecinco.localStreamUrl}`);
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type'), /video\/mp2t/);
    const bytes = Buffer.from(await stream.arrayBuffer());
    assert.equal(bytes.length, 188);
    assert.equal(bytes[0], 0x47);
    assert.equal(signalRequests, 1);

    const script = await fetch(`http://127.0.0.1:${appPort}/vendor/mpegts.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
  } finally {
    app.kill('SIGTERM');
    await new Promise(resolve => upstream.close(resolve));
  }
});
