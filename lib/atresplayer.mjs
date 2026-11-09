// Resolución de fuentes HLS públicas de Atresplayer. No se utilizan cuentas,
// cookies, licencias DRM, proxies de vídeo ni mecanismos para eludir restricciones.
const ROW_URL = 'https://api.atresplayer.com/client/v1/row/live';
const CHANNEL_PATHS = Object.freeze({ 'antena-3': '/directos/antena3/' });
const HLS_PRIORITY = [
  'application/vnd.apple.mpegurl',
  'application/hls+legacyv3',
  'application/hls+legacy',
  'application/hls+ssai',
  'application/hls+hevc'
];

export class AtresplayerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AtresplayerError';
  }
}

function apiUrl(value) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new AtresplayerError('La API oficial ha devuelto una dirección inválida.'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.atresplayer.com' || parsed.username || parsed.password || parsed.port) {
    throw new AtresplayerError('La API oficial ha devuelto una dirección no permitida.');
  }
  return parsed.href;
}

async function getJson(url, fetchImpl) {
  const validatedUrl = apiUrl(url);
  let response;
  try {
    response = await fetchImpl(validatedUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'openTV/0.3 (+https://github.com/pitbg/openTV)' },
      signal: AbortSignal.timeout(8000),
      redirect: 'error'
    });
  } catch {
    throw new AtresplayerError('No se ha podido conectar con Atresplayer.');
  }
  if (!response.ok) {
    throw new AtresplayerError(response.status === 401 || response.status === 403
      ? 'Atresplayer requiere autorización para acceder a esta emisión.'
      : `Atresplayer no ha respondido correctamente (HTTP ${response.status}).`);
  }
  try { return await response.json(); }
  catch { throw new AtresplayerError('Atresplayer ha devuelto una respuesta no válida.'); }
}

function safeHlsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Devuelve URL(s) HLS efímeras desde la API del proveedor, sin retransmitir contenido. */
export async function resolveAtresplayerHls(channelId, { fetchImpl = fetch } = {}) {
  const channelPath = CHANNEL_PATHS[channelId];
  if (!channelPath) throw new AtresplayerError('Canal no compatible con la resolución dinámica.');

  const listing = await getJson(ROW_URL, fetchImpl);
  const channel = Array.isArray(listing?.itemRows)
    ? listing.itemRows.find(item => item?.link?.url === channelPath)
    : null;
  if (!channel?.link?.href) throw new AtresplayerError('Antena 3 no aparece entre los directos disponibles.');

  const page = await getJson(channel.link.href, fetchImpl);
  if (!page?.urlVideo) throw new AtresplayerError('No se ha encontrado información de la señal en directo.');

  const player = await getJson(page.urlVideo, fetchImpl);
  if (player?.error) throw new AtresplayerError('Atresplayer no permite reproducir esta señal directamente. Prueba su web oficial.');

  const sources = Array.isArray(player?.sourcesLive) ? player.sourcesLive : [];
  const streams = sources
    .filter(source => HLS_PRIORITY.includes(source?.type) && !source.drm && !source.licenseUrl)
    .sort((a, b) => HLS_PRIORITY.indexOf(a.type) - HLS_PRIORITY.indexOf(b.type))
    .map(source => safeHlsUrl(source.src))
    .filter(Boolean);

  const unique = [...new Set(streams)];
  if (!unique.length) throw new AtresplayerError('Esta emisión no ofrece una señal HLS directa compatible.');
  return { streams: unique, provider: 'Atresplayer' };
}
