import test from 'node:test';
import assert from 'node:assert/strict';
import { createLaSeptimaHlsService, resolveYoutubeLiveHls, validYoutubeHlsUrl, YoutubeHlsError, youtubeVideoIdFromEmbed } from '../lib/youtube-hls.mjs';

const id = 'ErraEILevPE';
const embedUrl = `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0`;
const manifest = 'https://manifest.googlevideo.com/api/manifest/hls_playlist?expire=123&sig=abc';

function youtubeFetch({ status = 'OK', reason, url = manifest, playlist = '#EXTM3U\n#EXT-X-VERSION:3\n' } = {}) {
  const calls = [];
  const fetchImpl = async (target, options) => {
    calls.push({ target, options });
    if (target.startsWith('https://www.youtube.com/watch?')) {
      return new Response('<script>var ytcfg = {"INNERTUBE_API_KEY":"test-api-key_123456"};</script>');
    }
    if (target.startsWith('https://www.youtube.com/youtubei/v1/player?')) {
      return Response.json({ playabilityStatus: { status, ...(reason ? { reason } : {}) }, streamingData: { hlsManifestUrl: url } });
    }
    if (target === manifest) return new Response(playlist);
    throw new Error(`Unexpected request ${target}`);
  };
  return { fetchImpl, calls };
}

test('acepta solo IDs y URLs de YouTube, y manifiestos seguros de Googlevideo', () => {
  assert.equal(youtubeVideoIdFromEmbed(embedUrl), id);
  assert.equal(youtubeVideoIdFromEmbed(`https://example.test/embed/${id}`), null);
  assert.equal(youtubeVideoIdFromEmbed(`https://www.youtube.com.evil.test/embed/${id}`), null);
  assert.equal(validYoutubeHlsUrl(manifest), true);
  assert.equal(validYoutubeHlsUrl('https://manifest.googlevideo.com.evil.test/playlist.m3u8'), false);
  assert.equal(validYoutubeHlsUrl('http://manifest.googlevideo.com/a.m3u8'), false);
  assert.equal(validYoutubeHlsUrl('https://localhost/a.m3u8'), false);
});

test('obtiene la URL HLS desde YouTube solo si el CDN entrega una lista M3U', async () => {
  const { fetchImpl, calls } = youtubeFetch();
  assert.equal(await resolveYoutubeLiveHls(id, { fetchImpl }), manifest);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(JSON.parse(calls[1].options.body).videoId, id);
  assert.equal(JSON.parse(calls[1].options.body).context.client.clientName, 'ANDROID');
});

test('rechaza páginas de error en vez de un HLS, y sesiones de YouTube bloqueadas', async () => {
  await assert.rejects(resolveYoutubeLiveHls(id, youtubeFetch({ playlist: '<html>Acceso denegado</html>' })), YoutubeHlsError);
  await assert.rejects(resolveYoutubeLiveHls(id, youtubeFetch({ status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm' })), YoutubeHlsError);
  await assert.rejects(resolveYoutubeLiveHls(id, youtubeFetch({ url: 'https://example.test/evil.m3u8' })), YoutubeHlsError);
  await assert.rejects(resolveYoutubeLiveHls('no-es-valido', youtubeFetch()), YoutubeHlsError);
});

test('caché breve y peticiones simultáneas comparten la resolución del directo', async () => {
  let currentTime = 1_000;
  let lookups = 0;
  const { fetchImpl } = youtubeFetch();
  const service = createLaSeptimaHlsService({
    embedService: { resolve: async () => { lookups++; return { embedUrl }; } },
    fetchImpl,
    now: () => currentTime,
    ttlMs: 30_000
  });
  const [first, second] = await Promise.all([service.resolve(), service.resolve()]);
  assert.deepEqual(first, { streams: [manifest], provider: 'YouTube' });
  assert.equal(first, second);
  assert.equal(lookups, 1);
  assert.equal(await service.resolve(), first);
  currentTime += 30_001;
  await service.resolve();
  assert.equal(lookups, 2);
});

test('un fallo de HLS no envenena la caché y permite reintentar', async () => {
  let blocked = true;
  const service = createLaSeptimaHlsService({
    embedService: { resolve: async () => ({ embedUrl }) },
    fetchImpl: async (target, options) => {
      const { fetchImpl } = youtubeFetch({ playlist: blocked ? '<html>bloqueado</html>' : '#EXTM3U\n' });
      return fetchImpl(target, options);
    }
  });
  await assert.rejects(service.resolve(), YoutubeHlsError);
  blocked = false;
  assert.deepEqual(await service.resolve(), { streams: [manifest], provider: 'YouTube' });
});
