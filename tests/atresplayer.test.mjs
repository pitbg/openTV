import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AtresplayerError, resolveAtresplayerHls } from '../lib/atresplayer.mjs';

const urls = [
  'https://api.atresplayer.com/client/v1/row/live',
  'https://api.atresplayer.com/client/v1/page/antena3',
  'https://api.atresplayer.com/client/v1/video/antena3'
];

function mockFetch(items) {
  const requested = [];
  const fetchImpl = async (url, options) => {
    requested.push(url);
    assert.equal(options.redirect, 'error');
    assert.equal(url, urls[requested.length - 1]);
    return { ok: true, json: async () => items[requested.length - 1] };
  };
  return { fetchImpl, requested };
}

const listing = { itemRows: [{ link: { url: '/directos/antena3/', href: urls[1] } }] };
const page = { urlVideo: urls[2] };

test('resuelve HLS oficial sin retransmitirlo y prioriza H.264 frente a HEVC', async () => {
  const { fetchImpl, requested } = mockFetch([listing, page, { sourcesLive: [
    { type: 'application/dash+xml', src: 'https://cdn.example.com/live.mpd' },
    { type: 'application/hls+hevc', src: 'https://cdn.example.com/hevc.m3u8' },
    { type: 'application/vnd.apple.mpegurl', src: 'https://cdn.example.com/live.m3u8' },
    { type: 'application/vnd.apple.mpegurl', src: 'https://cdn.example.com/live.m3u8' }
  ] }]);
  assert.deepEqual(await resolveAtresplayerHls('antena-3', { fetchImpl }), {
    provider: 'Atresplayer',
    streams: ['https://cdn.example.com/live.m3u8', 'https://cdn.example.com/hevc.m3u8']
  });
  assert.deepEqual(requested, urls);
});

test('rechaza enlaces de API externos e inseguros antes de consultarlos', async () => {
  const { fetchImpl, requested } = mockFetch([{ itemRows: [{ link: { url: '/directos/antena3/', href: 'https://evil.example/private' } }] }]);
  await assert.rejects(resolveAtresplayerHls('antena-3', { fetchImpl }), /dirección no permitida/);
  assert.deepEqual(requested, [urls[0]]);
});

test('no ofrece DASH, HTTP ni fuentes marcadas como DRM', async () => {
  const { fetchImpl } = mockFetch([listing, page, { sourcesLive: [
    { type: 'application/dash+xml', src: 'https://cdn.example.com/live.mpd' },
    { type: 'application/vnd.apple.mpegurl', src: 'http://cdn.example.com/live.m3u8' },
    { type: 'application/vnd.apple.mpegurl', src: 'https://cdn.example.com/protected.m3u8', drm: { type: 'widevine' } }
  ] }]);
  await assert.rejects(resolveAtresplayerHls('antena-3', { fetchImpl }), /no ofrece una señal HLS/);
});

test('propaga restricciones del proveedor con un mensaje legible', async () => {
  const { fetchImpl } = mockFetch([listing, page, { error: 'no_access', error_description: 'unauthorized' }]);
  await assert.rejects(resolveAtresplayerHls('antena-3', { fetchImpl }), AtresplayerError);
});

test('no permite solicitar canales arbitrarios', async () => {
  await assert.rejects(resolveAtresplayerHls('something-else'), /no compatible/);
});
