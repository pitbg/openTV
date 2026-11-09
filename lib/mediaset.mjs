// Fuentes HLS publicadas por la API oficial de Mediaset.
// Solo se consultan señales declaradas sin DRM ni políticas de seguridad.
// No se generan tokens, se accede a cuentas ni se retransmite vídeo.
const CHANNEL_URLS = Object.freeze({
  telecinco: 'https://caronte.mediaset.es/delivery/channel/mmc/telecinco/mtweb'
});

export class MediasetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MediasetError';
  }
}

function safeStreamUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!['mediaset.es', 'mitele.es'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
    return url.href;
  } catch { return null; }
}

function priority(source) {
  return (source.location === 'peninsula' ? 0 : 10)
    + (source.quality === 'hd' ? 0 : 3)
    + (source.adtype === 'linear' ? 0 : 1)
    + (source.cdn === 'akamai' ? 0 : 2);
}

export async function resolveMediasetHls(channelId, { fetchImpl = fetch } = {}) {
  const url = CHANNEL_URLS[channelId];
  if (!url) throw new MediasetError('Canal no compatible con Mediaset.');

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'openTV/0.3 (+https://github.com/pitbg/openTV)' },
      signal: AbortSignal.timeout(8000),
      redirect: 'error'
    });
  } catch { throw new MediasetError('No se ha podido conectar con Mediaset.'); }

  if (!response.ok) throw new MediasetError(`Mediaset no ha permitido consultar su directo (HTTP ${response.status}).`);

  let catalog;
  try { catalog = await response.json(); }
  catch { throw new MediasetError('Mediaset ha devuelto una respuesta no válida.'); }

  const options = Array.isArray(catalog?.dls) ? catalog.dls : [];
  const streams = options
    .filter(option => option?.format === 'hls' && option.drm === false && option.securityPolicies === 0)
    .sort((a, b) => priority(a) - priority(b))
    .map(option => safeStreamUrl(option.stream))
    .filter(Boolean);

  const unique = [...new Set(streams)];
  if (!unique.length) throw new MediasetError('Telecinco no ofrece ninguna fuente HLS pública compatible.');
  return { streams: unique, provider: 'Mediaset' };
}
