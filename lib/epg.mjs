import { gunzipSync } from 'node:zlib';
import { normalize } from './catalog.mjs';

const TDTCHANNELS_EPG_URL = 'https://www.tdtchannels.com/epg/TV.xml.gz';
const MAX_COMPRESSED_BYTES = 4 * 1024 * 1024;
const MAX_XML_BYTES = 32 * 1024 * 1024;
const MAX_PROGRAMMES = 40_000;
const REFRESH_RETRY_MS = 60_000;

// IDs publicados por la EPG de TDTChannels. El VBox utiliza sus propios IDs;
// para este también se coteja el tvg-id de su lista y el nombre del canal.
const EPG_IDS = {
  'la-1': 'La1.TV', 'la-2': 'La2.TV', '24h': '24Horas.TV',
  teledeporte: 'TDP.TV', clan: 'Clan.TV', telecinco: 'Telecinco.TV',
  cuatro: 'Cuatro.TV', fdf: 'FDF.TV', divinity: 'Divinity.TV',
  energy: 'Energy.TV', boing: 'Boing.TV', bemad: 'BeMad.TV',
  'real-madrid-tv': 'RealMadrid.TV', ten: 'TEN.TV', trece: 'Trece.TV',
  'paramount-network': 'ParamountNetwork.TV', dmax: 'DMAX.TV',
  'gol-play': 'GOL.TV', tv3: 'TV3.TV', '33': '33.TV', sx3: 'SX3.TV',
  'etb-1': 'ETB1.TV', 'etb-2': 'ETB2.TV', tvg: 'TVGAL.TV',
  'tv-g2': 'TVG2.TV', 'a-punt': 'APUNT.TV', 'canal-extremadura': 'Extremadura.TV',
  cmm: 'CMM.TV', telemadrid: 'Telemadrid.TV', 'la-otra': 'LaOtra.TV'
};

function xmlAttribute(attributes, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'is').exec(attributes);
  return match?.[2] || null;
}

function xmlDecode(value = '') {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (original, entity) => {
    if (entity[0] === '#') {
      const numeric = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isInteger(numeric) && numeric > 0 && numeric <= 0x10ffff && !(numeric >= 0xd800 && numeric <= 0xdfff)
        ? String.fromCodePoint(numeric) : original;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity.toLowerCase()] || original;
  });
}

function tagText(body, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(body);
  return match ? xmlDecode(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').trim()) : '';
}

export function xmltvTimestamp(value) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/.exec(value || '');
  if (!match) return null;
  const [, year, month, day, hour, minute, second, sign, offsetHours, offsetMinutes] = match;
  const utc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  if (!Number.isFinite(utc)) return null;
  const timezone = sign ? (sign === '+' ? 1 : -1) * (+offsetHours * 60 + +offsetMinutes) * 60_000 : 0;
  return utc - timezone;
}

export function parseXmltv(xml) {
  if (typeof xml !== 'string' || !/<tv(?:\s|>)/i.test(xml)) throw new Error('La guía no tiene formato XMLTV.');
  if (Buffer.byteLength(xml) > MAX_XML_BYTES) throw new Error('La guía XMLTV es demasiado grande.');
  const names = new Map();
  const programmes = new Map();
  for (const match of xml.matchAll(/<channel\b([^>]*)>([\s\S]*?)<\/channel>/gi)) {
    const id = xmlDecode(xmlAttribute(match[1], 'id') || '');
    if (!id) continue;
    const displayNames = [...match[2].matchAll(/<display-name(?:\s[^>]*)?>([\s\S]*?)<\/display-name>/gi)]
      .map(item => xmlDecode(item[1].trim()));
    names.set(id, displayNames);
  }
  let count = 0;
  for (const match of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi)) {
    if (++count > MAX_PROGRAMMES) break;
    const id = xmlDecode(xmlAttribute(match[1], 'channel') || '');
    const start = xmltvTimestamp(xmlAttribute(match[1], 'start'));
    const stop = xmltvTimestamp(xmlAttribute(match[1], 'stop'));
    const title = tagText(match[2], 'title');
    if (!id || !title || start === null || stop === null || stop <= start) continue;
    const list = programmes.get(id) || [];
    list.push({ title: title.slice(0, 180), subtitle: tagText(match[2], 'sub-title').slice(0, 160), start, stop });
    programmes.set(id, list);
  }
  for (const list of programmes.values()) list.sort((a, b) => a.start - b.start);
  return { names, programmes };
}

function normalizedGuideName(value) {
  let decoded = value || '';
  try { decoded = decodeURIComponent(decoded); } catch { /* IDs sin codificar */ }
  return normalize(decoded.replace(/\.tv$/i, '')).replace(/\b(hd|sd|uhd|4k)\b/g, '').replace(/\s+/g, ' ').trim();
}

function programmeForChannel(source, channel, localChannel, time) {
  if (!source?.data) return null;
  const { names, programmes } = source.data;
  const candidateIds = new Set([source.id === 'vbox' ? localChannel?.epgId : EPG_IDS[channel.id]].filter(Boolean));
  const channelNames = new Set([channel.name, localChannel?.name].filter(Boolean).map(normalizedGuideName));
  for (const [id, aliases] of names) {
    if ([id, ...aliases].some(alias => channelNames.has(normalizedGuideName(alias)))) candidateIds.add(id);
  }
  for (const id of programmes.keys()) {
    if (channelNames.has(normalizedGuideName(id))) candidateIds.add(id);
  }
  let upcomingOnly = null;
  for (const id of candidateIds) {
    const list = programmes.get(id);
    if (!list?.length) continue;
    // En la EPG puede haber franjas solapadas; prevalece la más reciente.
    const now = [...list].reverse().find(p => p.start <= time && time < p.stop) || null;
    const following = list.filter(p => p.start >= (now?.stop ?? time) && p.start <= time + 12 * 60 * 60 * 1000).slice(0, 4);
    const result = { now, next: following[0] || null, upcoming: following, source: source.id };
    if (now) return result;
    if (result.next && !upcomingOnly) upcomingOnly = result;
  }
  return upcomingOnly;
}

export function matchGuide(channels, localChannels, sources, time = Date.now()) {
  const locals = new Map(localChannels.map(channel => [channel.id, channel]));
  const result = {};
  for (const channel of channels) {
    let nextOnly = null;
    for (const source of sources) {
      const guide = programmeForChannel(source, channel, locals.get(channel.id), time);
      if (guide?.now) { result[channel.id] = guide; break; }
      if (guide?.next && !nextOnly) nextOnly = guide;
    }
    if (!result[channel.id] && nextOnly) result[channel.id] = nextOnly;
  }
  return result;
}

async function readLimitedResponse(response, maxBytes) {
  if (!response.ok || !response.body) throw new Error(`EPG HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('EPG demasiado grande.');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new Error('EPG demasiado grande.');
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  return (buffer[0] === 0x1f && buffer[1] === 0x8b
    ? gunzipSync(buffer, { maxOutputLength: MAX_XML_BYTES }) : buffer).toString('utf8');
}

export function createEpgService({ vboxPlaylistUrl = null, fetchImpl = fetch, now = Date.now,
  vboxTtlMs = 15 * 60_000, externalTtlMs = 60 * 60_000, externalUrl = TDTCHANNELS_EPG_URL } = {}) {
  const vboxUrl = vboxPlaylistUrl ? new URL('/vboxXmltv.xml', vboxPlaylistUrl).href : null;
  const sources = [
    { id: 'vbox', url: vboxUrl, ttl: vboxTtlMs },
    { id: 'tdtchannels', url: externalUrl, ttl: externalTtlMs }
  ].filter(source => source.url).map(source => ({ ...source, data: null, pending: null, nextAttempt: 0, online: false, fetchedAt: null }));

  async function refresh(source) {
    if (now() < source.nextAttempt) return;
    if (source.pending) return source.pending;
    source.pending = (async () => {
      try {
        const response = await fetchImpl(source.url, {
          signal: AbortSignal.timeout(9_000),
          redirect: source.id === 'vbox' ? 'error' : 'follow',
          headers: source.id === 'vbox' ? {} : { 'User-Agent': 'openTV/0.4 (+https://github.com/pitbg/openTV)' }
        });
        // Algunos servidores entregan el .gz como archivo; otros lo descomprimen
        // por Content-Encoding antes de que llegue al cliente HTTP.
        const limit = source.id === 'vbox' || response.headers.get('content-encoding')?.includes('gzip')
          ? MAX_XML_BYTES : MAX_COMPRESSED_BYTES;
        const xml = await readLimitedResponse(response, limit);
        const data = parseXmltv(xml);
        if (data.programmes.size === 0) throw new Error('La guía no contiene programas.');
        source.data = data;
        source.fetchedAt = now();
        source.online = true;
        source.nextAttempt = now() + source.ttl;
      } catch (error) {
        console.warn(`EPG ${source.id}:`, error?.message || 'no disponible');
        source.online = false;
        source.nextAttempt = now() + REFRESH_RETRY_MS;
      } finally { source.pending = null; }
    })();
    return source.pending;
  }

  async function get(channels, localChannels) {
    await Promise.all(sources.map(refresh));
    return {
      channels: matchGuide(channels, localChannels, sources, now()),
      sources: Object.fromEntries(sources.map(source => [source.id, {
        available: source.online, cached: !!source.data, fetchedAt: source.fetchedAt
      }]))
    };
  }

  return { get };
}
