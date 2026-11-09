import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediasetError, resolveMediasetHls } from '../lib/mediaset.mjs';

const endpoint = 'https://caronte.mediaset.es/delivery/channel/mmc/telecinco/mtweb';

function mockFetch(body, status = 200) {
  return async (url, options) => {
    assert.equal(url, endpoint);
    assert.equal(options.redirect, 'error');
    return { ok: status === 200, status, json: async () => body };
  };
}

test('obtiene fuentes Telecinco HLS no DRM y prioriza HD peninsular', async () => {
  const actual = await resolveMediasetHls('telecinco', { fetchImpl: mockFetch({
    bbx: 'valor_privado_que_no_debe_devolverse',
    cerbero: 'https://cerbero.mediaset.es',
    dls: [
      { format: 'hls', stream: 'https://directos.mitele.es/sd.m3u8', drm: false, securityPolicies: 0, location: 'peninsula', quality: 'sd', adtype: 'csai', cdn: 'akamai' },
      { format: 'hls', stream: 'https://directos.mediaset.es/hd.m3u8', drm: false, securityPolicies: 0, location: 'peninsula', quality: 'hd', adtype: 'linear', cdn: 'akamai' },
      { format: 'hls', stream: 'https://directos.mediaset.es/hd.m3u8', drm: false, securityPolicies: 0, location: 'peninsula', quality: 'hd', adtype: 'linear', cdn: 'akamai' },
      { format: 'dash', stream: 'https://directos.mediaset.es/hd.mpd', drm: false, securityPolicies: 0 },
      { format: 'hls', stream: 'https://directos.mediaset.es/drm.m3u8', drm: true, securityPolicies: 0 },
      { format: 'hls', stream: 'https://livek.mediaset.es/protected.m3u8', drm: false, securityPolicies: 1 },
      { format: 'hls', stream: 'https://evil.example/live.m3u8', drm: false, securityPolicies: 0 },
      { format: 'hls', stream: 'http://directos.mediaset.es/insecure.m3u8', drm: false, securityPolicies: 0 }
    ]
  }) });
  assert.deepEqual(actual, {
    streams: ['https://directos.mediaset.es/hd.m3u8', 'https://directos.mitele.es/sd.m3u8'],
    provider: 'Mediaset'
  });
  assert.equal(JSON.stringify(actual).includes('valor_privado'), false);
});

test('maneja ausencia de señales HLS públicas', async () => {
  await assert.rejects(resolveMediasetHls('telecinco', { fetchImpl: mockFetch({ dls: [
    { format: 'hls', stream: 'https://directos.mediaset.es/protected.m3u8', drm: true, securityPolicies: 1 }
  ] }) }), /ninguna fuente HLS pública/);
});

test('informa de fallos HTTP de Mediaset sin datos sensibles', async () => {
  await assert.rejects(resolveMediasetHls('telecinco', { fetchImpl: mockFetch({}, 403) }), MediasetError);
});

test('no acepta canales arbitrarios', async () => {
  await assert.rejects(resolveMediasetHls('another-channel'), /no compatible/);
});
