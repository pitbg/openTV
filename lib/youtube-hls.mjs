// Resolución de manifiestos HLS públicos para directos de YouTube, inspirada
// en Streamlink. No requiere sesión, cookies ni instala Streamlink en Docker.
const WATCH_PAGE_LIMIT = 2 * 1024 * 1024;
const PLAYER_RESPONSE_LIMIT = 256 * 1024;
const HLS_PLAYLIST_LIMIT = 256 * 1024;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class YoutubeHlsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'YoutubeHlsError';
  }
}

async function limitedText(response, limit) {
  if (!response.ok || !response.body) throw new YoutubeHlsError(`YouTube ha respondido con HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > limit) throw new YoutubeHlsError('YouTube ha devuelto demasiados datos.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) {
      throw new YoutubeHlsError('YouTube ha devuelto demasiados datos.');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function youtubeVideoIdFromEmbed(embedUrl) {
  try {
    const url = new URL(embedUrl);
    const match = /^\/embed\/([\w-]{11})$/.exec(url.pathname);
    return url.protocol === 'https:' && url.hostname === 'www.youtube.com' && !url.username && !url.password && !url.port
      ? match?.[1] || null : null;
  } catch { return null; }
}

export function validYoutubeHlsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com')) &&
      url.pathname.startsWith('/');
  } catch { return false; }
}

/** Devuelve únicamente manifiestos HLS públicos y accesibles desde el servidor. */
export async function resolveYoutubeLiveHls(videoId, { fetchImpl = fetch } = {}) {
  if (!/^[\w-]{11}$/.test(videoId || '')) throw new YoutubeHlsError('Identificador de vídeo no válido.');
  const signal = AbortSignal.timeout(12_000);
  const watch = await fetchImpl(`https://www.youtube.com/watch?v=${videoId}`, {
    signal, redirect: 'error',
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-ES,es;q=0.9' }
  });
  const html = await limitedText(watch, WATCH_PAGE_LIMIT);
  const key = /["']INNERTUBE_API_KEY["']\s*:\s*["']([^"']{10,128})["']/.exec(html)?.[1];
  if (!key || !/^[\w-]+$/.test(key)) throw new YoutubeHlsError('YouTube no ha publicado la configuración del reproductor.');

  const player = await fetchImpl(`https://www.youtube.com/youtubei/v1/player?key=${key}`, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
      context: {
        client: {
          clientName: 'ANDROID', clientVersion: '21.08.266', platform: 'DESKTOP',
          clientScreen: 'EMBED', clientFormFactor: 'UNKNOWN_FORM_FACTOR', browserName: 'Chrome'
        },
        user: { lockedSafetyMode: 'false' },
        request: { useSsl: 'true' }
      }
    })
  });
  let data;
  try { data = JSON.parse(await limitedText(player, PLAYER_RESPONSE_LIMIT)); }
  catch (error) {
    if (error instanceof YoutubeHlsError) throw error;
    throw new YoutubeHlsError('YouTube ha devuelto una respuesta de reproductor incorrecta.');
  }
  if (data?.playabilityStatus?.status !== 'OK' || data?.playabilityStatus?.reason) {
    throw new YoutubeHlsError('YouTube no permite extraer esta emisión directamente.');
  }
  const url = data?.streamingData?.hlsManifestUrl;
  if (!validYoutubeHlsUrl(url)) throw new YoutubeHlsError('YouTube no ofrece un manifiesto HLS público compatible.');

  // No basta con recibir una URL: a veces el CDN responde HTML (bloqueo).
  // Detectarlo aquí evita que el espectador vea un error del reproductor.
  const manifest = await fetchImpl(url, {
    signal, redirect: 'error',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.apple.mpegurl, */*' }
  });
  const playlist = await limitedText(manifest, HLS_PLAYLIST_LIMIT);
  if (!playlist.replace(/^\uFEFF/, '').startsWith('#EXTM3U')) {
    throw new YoutubeHlsError('YouTube ha bloqueado el manifiesto HLS; se usará su reproductor oficial.');
  }
  return url;
}

export function createLaSeptimaHlsService({ embedService, fetchImpl = fetch, now = Date.now, ttlMs = 30_000 } = {}) {
  if (!embedService?.resolve) throw new TypeError('Se necesita el servicio de directos de La Séptima.');
  let cached = null;
  let expiresAt = 0;
  let pending = null;
  return {
    async resolve() {
      if (cached && now() < expiresAt) return cached;
      if (!pending) pending = (async () => {
        try {
          const videoId = youtubeVideoIdFromEmbed((await embedService.resolve()).embedUrl);
          if (!videoId) throw new YoutubeHlsError('No se ha identificado el directo de La Séptima.');
          const url = await resolveYoutubeLiveHls(videoId, { fetchImpl });
          cached = { streams: [url], provider: 'YouTube' };
          expiresAt = now() + ttlMs;
          return cached;
        } finally { pending = null; }
      })();
      return pending;
    }
  };
}
