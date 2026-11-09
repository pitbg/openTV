const SOURCE_URL = 'https://www.tdtchannels.com/lists/tv.json';
const SIX_HOURS = 6 * 60 * 60 * 1000;

// Lista editorial deliberada: emisoras públicas estatales y autonómicas,
// no todo el catálogo TDT (que también contiene operadores privados).
export const PUBLIC_CHANNELS = [
  ['la-1', 'La 1', 'RTVE', 'Nacional', ['La 1']],
  ['la-2', 'La 2', 'RTVE', 'Nacional', ['La 2']],
  ['24h', '24 Horas', 'RTVE', 'Nacional', ['24h']],
  ['teledeporte', 'Teledeporte', 'RTVE', 'Nacional', ['Teledeporte']],
  ['clan', 'Clan', 'RTVE', 'Nacional', ['Clan']],
  ['telemadrid', 'Telemadrid', 'RTVM', 'Madrid', ['Telemadrid']],
  ['la-otra', 'La Otra', 'RTVM', 'Madrid', ['La Otra']],
  ['canal-sur', 'Canal Sur Andalucía', 'RTVA', 'Andalucía', ['Canal Sur Andalucía', 'Canal Sur']],
  ['canal-sur-2', 'Canal Sur 2 Accesible', 'RTVA', 'Andalucía', ['Canal Sur 2 Accesible']],
  ['canal-sur-noticias', 'Canal Sur Más Noticias', 'RTVA', 'Andalucía', ['Canal Sur Más Noticias']],
  ['tv3', 'TV3', '3Cat', 'Cataluña', ['TV3']],
  ['33', '33', '3Cat', 'Cataluña', ['33']],
  ['324', '3/24', '3Cat', 'Cataluña', ['3/24']],
  ['sx3', 'SX3', '3Cat', 'Cataluña', ['SX3']],
  ['etb-1', 'ETB 1', 'EITB', 'País Vasco', ['ETB 1']],
  ['etb-2', 'ETB 2', 'EITB', 'País Vasco', ['ETB 2']],
  ['etb-3', 'ETB 3', 'EITB', 'País Vasco', ['ETB 3']],
  ['etb-4', 'ETB 4', 'EITB', 'País Vasco', ['ETB 4']],
  ['tvg', 'TVG', 'CRTVG', 'Galicia', ['TVG Galicia', 'TVG', 'TVG Europa']],
  ['tv-g2', 'G2', 'CRTVG', 'Galicia', ['G2', 'TVG 2']],
  ['a-punt', 'À Punt', 'À Punt', 'Comunidad Valenciana', ['À Punt', 'À Punt TV']],
  ['aragon-tv', 'Aragón TV', 'CARTV', 'Aragón', ['Aragón TV']],
  ['cmm', 'Castilla-La Mancha Media', 'CMM', 'Castilla-La Mancha', ['Castilla-La Mancha Media (CMM)', 'Castilla-La Mancha Media']],
  ['tv-canaria', 'Televisión Canaria', 'RTVC', 'Canarias', ['TV Canaria (RTVC)', 'TV Canaria']],
  ['ib3', 'IB3', 'EPRTVIB', 'Islas Baleares', ['IB3', 'IB3 Televisió']],
  ['tpa', 'TPA', 'RTPA', 'Asturias', ['TPA', 'TPA 1']],
  ['tpa2', 'TPA 2', 'RTPA', 'Asturias', ['TPA 2']],
  ['canal-extremadura', 'Canal Extremadura', 'CEXMA', 'Extremadura', ['Canal Extremadura']],
  ['7rm', 'La 7 (Murcia)', 'RTRM', 'Región de Murcia', ['7RM', 'La 7 (7RM)', 'La 7 (Murcia)']],
  ['rtvce', 'RTVCE', 'RTVCE', 'Ceuta', ['RTVCE']],
  ['tvm-melilla', 'Televisión Melilla', 'RTVMelilla', 'Melilla', ['Televisión Melilla', 'TV Melilla']]
];

export function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function parseCatalog(raw) {
  if (!Array.isArray(raw?.countries)) throw new Error('Formato del catálogo inesperado');
  const spain = raw.countries.find(country => normalize(country.name) === 'spain' || normalize(country.name) === 'espana');
  if (!spain || !Array.isArray(spain.ambits)) throw new Error('No se encuentra España en el catálogo');
  const all = spain.ambits.flatMap(ambit => Array.isArray(ambit.channels) ? ambit.channels : []);

  return PUBLIC_CHANNELS.flatMap(([id, name, broadcaster, region, aliases]) => {
    const channel = all.find(item => aliases.some(alias => normalize(item.name) === normalize(alias)));
    if (!channel) return [];
    const streams = (Array.isArray(channel.options) ? channel.options : [])
      .filter(option => String(option.format).toLowerCase() === 'm3u8')
      .map(option => option.url)
      .filter(url => {
        try { return new URL(url).protocol === 'https:' && !url.includes('['); }
        catch { return false; }
      });
    const website = secureHttps(channel.web);
    return [{
      id, name, broadcaster, region,
      logo: secureHttps(channel.logo),
      website,
      streams: [...new Set(streams)].slice(0, 4),
      restricted: Array.isArray(channel.extra_info) && channel.extra_info.includes('GEO')
    }];
  });
}

function secureHttps(value) {
  try { return new URL(value).protocol === 'https:' ? value : null; }
  catch { return null; }
}

export function createCatalogService({ fetchImpl = fetch, now = Date.now, ttlMs = SIX_HOURS, sourceUrl = SOURCE_URL } = {}) {
  let channels = [];
  let lastSuccess = 0;
  let nextAttempt = 0;
  let pending = null;
  let lastError = null;

  async function get() {
    const timestamp = now();
    if (timestamp >= nextAttempt && (lastSuccess === 0 || timestamp - lastSuccess >= ttlMs)) {
      if (!pending) {
        pending = (async () => {
          try {
            const response = await fetchImpl(sourceUrl, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'openTV/0.1 (+https://github.com/pitbg/openTV)' } });
            if (!response.ok) throw new Error(`Origen HTTP ${response.status}`);
            const parsed = parseCatalog(await response.json());
            if (parsed.length < 4) throw new Error('El catálogo recibido contiene muy pocos canales');
            channels = parsed;
            lastSuccess = now();
            lastError = null;
            nextAttempt = lastSuccess + ttlMs;
          } catch (error) {
            lastError = error.message;
            nextAttempt = now() + 60_000;
          } finally {
            pending = null;
          }
        })();
      }
      await pending;
    } else if (pending && !channels.length) {
      await pending;
    }
    return { channels, updatedAt: lastSuccess ? new Date(lastSuccess).toISOString() : null, stale: Boolean(lastError), error: lastError };
  }

  return { get };
}
