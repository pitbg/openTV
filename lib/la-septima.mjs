const OFFICIAL_LIVE_PAGE = 'https://laseptima.com/la-septima-tv-directo/';
const MAX_PAGE_BYTES = 1024 * 1024;
const CACHE_TTL_MS = 5 * 60_000;

export class LaSeptimaEmbedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LaSeptimaEmbedError';
  }
}

function htmlAttributeDecode(value) {
  return value.replace(/&#(?:x([0-9a-f]+)|(\d+));|&(quot|amp|apos);/gi, (original, hex, decimal, named) => {
    if (named) return { quot: '"', amp: '&', apos: "'" }[named.toLowerCase()] || original;
    const code = hex ? parseInt(hex, 16) : Number(decimal);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : original;
  });
}

// La web de la cadena publica el vídeo actual en el widget de YouTube. No
// reutilizar un ID fijo: YouTube puede cambiarlo al iniciar otro directo.
export function laSeptimaYoutubeId(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > MAX_PAGE_BYTES) {
    throw new LaSeptimaEmbedError('La página oficial del directo no es válida.');
  }
  for (const match of html.matchAll(/<div\b[^>]*\bdata-e-type=["']e-youtube["'][^>]*>/gi)) {
    const encoded = /\bdata-settings="([^"]{1,4096})"/i.exec(match[0])?.[1];
    if (!encoded) continue;
    try {
      const settings = JSON.parse(htmlAttributeDecode(encoded));
      const url = new URL(settings.source);
      if (!['youtube.com', 'www.youtube.com'].includes(url.hostname) ||
          url.protocol !== 'https:' || url.pathname !== '/watch') continue;
      const id = url.searchParams.get('v');
      if (/^[a-zA-Z0-9_-]{11}$/.test(id || '')) return id;
    } catch { /* Continuar buscando otro reproductor oficial. */ }
  }
  throw new LaSeptimaEmbedError('La web de La Séptima no publica un directo de YouTube integrable.');
}

async function readPage(response) {
  if (!response.ok || !response.body) throw new LaSeptimaEmbedError('La web de La Séptima no está disponible.');
  if (Number(response.headers.get('content-length')) > MAX_PAGE_BYTES) {
    throw new LaSeptimaEmbedError('La página oficial es demasiado grande.');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > MAX_PAGE_BYTES) throw new LaSeptimaEmbedError('La página oficial es demasiado grande.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createLaSeptimaEmbedService({ fetchImpl = fetch, now = Date.now, ttlMs = CACHE_TTL_MS } = {}) {
  let cached = null;
  let expiresAt = 0;
  let pending = null;

  async function resolve() {
    if (cached && now() < expiresAt) return cached;
    if (!pending) pending = (async () => {
      try {
        const response = await fetchImpl(OFFICIAL_LIVE_PAGE, {
          signal: AbortSignal.timeout(8_000), redirect: 'error',
          headers: { 'User-Agent': 'openTV/0.4 (+https://github.com/pitbg/openTV)' }
        });
        const id = laSeptimaYoutubeId(await readPage(response));
        cached = { embedUrl: `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0` };
        expiresAt = now() + ttlMs;
      } catch (error) {
        expiresAt = now() + 30_000;
        if (!cached) throw error instanceof LaSeptimaEmbedError ? error : new LaSeptimaEmbedError('No se pudo consultar el directo oficial.');
      } finally { pending = null; }
      return cached;
    })();
    return pending;
  }

  return { resolve };
}
