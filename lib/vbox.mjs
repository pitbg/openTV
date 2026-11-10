import { CHANNEL_DEFINITIONS, normalize } from './catalog.mjs';
import { channelLogoFallback, usableVBoxLogo } from './channel-logos.mjs';

const DEFAULT_TTL = 60_000;
const MAX_PLAYLIST_BYTES = 1024 * 1024;

export class VBoxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VBoxError';
  }
}

export function vboxPlaylistUrl(baseUrl) {
  if (!baseUrl) return null;
  let url;
  try { url = new URL(baseUrl); }
  catch { throw new VBoxError('La dirección del sintonizador VBox no es válida.'); }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash) {
    throw new VBoxError('La dirección del VBox debe ser una URL HTTP local sin credenciales.');
  }
  if (url.pathname === '/' || !url.pathname) url.pathname = '/vboxSimpleIptv.m3u8';
  if (!['/vboxSimpleIptv.m3u8', '/ChannelList.m3u8', '/ChannelList.m3u'].includes(url.pathname)) {
    throw new VBoxError('Selecciona una de las listas IPTV que publica el VBox.');
  }
  return url;
}

function simplifyName(value) {
  return normalize(value).replace(/\b(hd|sd|uhd|4k)\b/g, '').replace(/\s+/g, ' ').trim();
}

// Las fichas que no figuran en la selección online también son canales de
// ámbito nacional o autonómico, aunque se reciban desde un sintonizador local.
// [id, nombre editorial, operador, ámbito]
const VBOX_CHANNEL_DETAILS = new Map([
  ['atreseries', ['atreseries', 'atreseries', 'Atresmedia', 'Nacional']],
  ['la septima', ['la-septima', 'La Séptima', 'La Séptima', 'Nacional']],
  ['bemad tv', ['bemad', 'Be Mad', 'Mediaset', 'Nacional']],
  ['realmadrid tv', ['real-madrid-tv', 'Real Madrid TV', 'Real Madrid', 'Nacional']],
  ['ten', ['ten', 'TEN', 'TEN', 'Nacional']],
  ['fdf', ['fdf', 'FDF', 'Mediaset', 'Nacional']],
  ['divinity', ['divinity', 'Divinity', 'Mediaset', 'Nacional']],
  ['cuatro', ['cuatro', 'Cuatro', 'Mediaset', 'Nacional']],
  ['mega', ['mega', 'MEGA', 'Atresmedia', 'Nacional']],
  ['trece', ['trece', 'TRECE', 'TRECE', 'Nacional']],
  ['energy', ['energy', 'Energy', 'Mediaset', 'Nacional']],
  ['boing', ['boing', 'Boing', 'Mediaset', 'Nacional']],
  ['disney channel', ['disney-channel', 'Disney Channel', 'Disney', 'Nacional']],
  ['paramount network', ['paramount-network', 'Paramount Network', 'Paramount', 'Nacional']],
  ['dmax', ['dmax', 'DMAX', 'Warner Bros. Discovery', 'Nacional']],
  ['gol play', ['gol-play', 'GOL Play', 'GOL', 'Nacional']],
  ['lasexta', ['la-sexta', 'laSexta', 'Atresmedia', 'Nacional']],
  ['la sexta', ['la-sexta', 'laSexta', 'Atresmedia', 'Nacional']],
  ['neox', ['neox', 'Neox', 'Atresmedia', 'Nacional']],
  ['nova', ['nova', 'Nova', 'Atresmedia', 'Nacional']],
  ['el toro tv', ['el-toro-tv', 'El Toro TV', 'El Toro TV', 'Madrid']],
  ['hit tv', ['hit-tv', 'HIT TV', 'HIT TV', 'Madrid']],
  ['dejate tv', ['dejate-tv', 'Déjate TV', 'Déjate TV', 'Madrid']]
]);

const definitionsByName = new Map(CHANNEL_DEFINITIONS.flatMap(([id, name, , , aliases]) =>
  [name, ...aliases].map(alias => [simplifyName(alias), id])
));
// Variantes habituales de los nombres emitidos por el VBox (sin espacio o abreviadas).
definitionsByName.set('antena3', 'antena-3');
definitionsByName.set('tdp', 'teledeporte');

function channelId(name) {
  const simplified = simplifyName(name);
  return definitionsByName.get(simplified) || VBOX_CHANNEL_DETAILS.get(simplified)?.[0] || `vbox-${normalize(name).replaceAll(' ', '-')}`;
}

function parseAttributes(header) {
  const attributes = {};
  for (const match of header.matchAll(/([\w-]+)="([^"]*)"/g)) attributes[match[1]] = match[2];
  return attributes;
}

// The VBox .m3u8 is a channel list, not a media HLS manifest. Each entry
// points to an HTTP MPEG-TS stream, which needs a separate browser player.
export function parseVBoxPlaylist(text, playlistUrl) {
  const base = vboxPlaylistUrl(playlistUrl);
  if (typeof text !== 'string' || !text.trimStart().startsWith('#EXTM3U')) throw new VBoxError('La lista del VBox no es un M3U válido.');
  if (Buffer.byteLength(text) > MAX_PLAYLIST_BYTES) throw new VBoxError('La lista de canales del VBox es demasiado grande.');
  const entries = new Map();
  let metadata = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF:')) {
      const comma = trimmed.indexOf(',');
      const attrs = parseAttributes(trimmed);
      metadata = { name: (comma < 0 ? attrs['tvg-name'] : trimmed.slice(comma + 1).trim()) || attrs['tvg-name'], logo: attrs['tvg-logo'], epgId: attrs['tvg-id'] };
      continue;
    }
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!metadata?.name) { metadata = null; continue; }
    let stream;
    try { stream = new URL(trimmed, base); }
    catch { metadata = null; continue; }
    // Never proxy arbitrary destinations supplied by a playlist. Only the
    // configured VBox is allowed to provide a live stream.
    if (stream.protocol !== base.protocol || stream.host !== base.host || stream.username || stream.password) {
      metadata = null;
      continue;
    }
    const id = channelId(metadata.name);
    const candidate = { id, name: metadata.name, url: stream.href, logo: metadata.logo, epgId: metadata.epgId };
    if (!entries.has(id) || (/(?:^|\W)HD(?:\W|$)/i.test(metadata.name) && !/(?:^|\W)HD(?:\W|$)/i.test(entries.get(id).name))) entries.set(id, candidate);
    metadata = null;
  }
  return [...entries.values()];
}

export function mergeVBoxChannels(catalogChannels, vboxChannels) {
  const result = catalogChannels.map(channel => ({ ...channel }));
  const byId = new Map(result.map(channel => [channel.id, channel]));
  for (const entry of vboxChannels) {
    const existing = byId.get(entry.id);
    if (existing) {
      existing.localStream = true;
      existing.localStreamUrl = `/api/vbox/stream/${encodeURIComponent(entry.id)}`;
      const fallback = channelLogoFallback(entry.id);
      if (!existing.logo) existing.logo = fallback || usableVBoxLogo(entry.logo);
      else if (fallback && existing.logo !== fallback) existing.logoFallback = fallback;
      continue;
    }
    const details = VBOX_CHANNEL_DETAILS.get(simplifyName(entry.name));
    const fallback = channelLogoFallback(entry.id);
    const channel = {
      id: entry.id, name: details?.[1] || entry.name, broadcaster: details?.[2] || 'TDT · VBox', region: details?.[3] || 'TDT local',
      logo: fallback || usableVBoxLogo(entry.logo), logoFallback: null,
      website: entry.id === 'la-septima' ? 'https://laseptima.com/la-septima-tv-directo/' : null,
      embedUrl: null, alternativeEmbedUrl: null,
      preferEmbed: false, dynamicStream: entry.id === 'la-septima', dynamicEmbed: entry.id === 'la-septima', streams: [], restricted: false,
      localStream: true, localStreamUrl: `/api/vbox/stream/${encodeURIComponent(entry.id)}`
    };
    result.push(channel);
    byId.set(channel.id, channel);
  }
  // Mantener el orden editorial y colocar los nacionales del VBox junto al
  // resto de cadenas nacionales, sin un bloque artificial "TDT local".
  const regionOrder = new Map(CHANNEL_DEFINITIONS.map(([, , , region], index) => [region, index]).reverse());
  return result.sort((a, b) => (regionOrder.get(a.region) ?? 1000) - (regionOrder.get(b.region) ?? 1000));
}

export function createVBoxService({ playlistUrl, fetchImpl = fetch, now = Date.now, ttlMs = DEFAULT_TTL } = {}) {
  const url = vboxPlaylistUrl(playlistUrl);
  let entries = [];
  let nextAttempt = 0;
  let pending = null;
  let online = false;

  async function get() {
    if (!url) return { enabled: false, online: false, channels: [], stale: false };
    if (now() >= nextAttempt) {
      if (!pending) pending = (async () => {
        try {
          const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
          if (!response.ok) throw new VBoxError(`El VBox ha respondido HTTP ${response.status}.`);
          if (Number(response.headers?.get?.('content-length')) > MAX_PLAYLIST_BYTES) throw new VBoxError('La lista es demasiado grande.');
          const parsed = parseVBoxPlaylist(await response.text(), url);
          if (!parsed.length) throw new VBoxError('El VBox no ha publicado canales compatibles.');
          entries = parsed;
          online = true;
          nextAttempt = now() + ttlMs;
        } catch {
          online = false;
          nextAttempt = now() + Math.min(ttlMs, 15_000);
        } finally { pending = null; }
      })();
      await pending;
    }
    return { enabled: true, online, channels: entries, stale: !online && entries.length > 0 };
  }

  async function getStreamUrl(id) {
    await get();
    const channel = entries.find(entry => entry.id === id);
    if (!channel) throw new VBoxError('Canal no encontrado en el VBox.');
    return channel.url;
  }

  return { get, getStreamUrl };
}
