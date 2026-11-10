// Logotipos alternativos para canales que no cuentan con logo en TDTChannels.
// Los del VBox apuntan en algunos firmwares a maincenter/Logotipos-TV,
// un repositorio retirado. tv-logo/tv-logos mantiene PNG para fondo oscuro.
const SPAIN_LOGOS = 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/spain/';

const FILES = Object.freeze({
  'antena-3': 'antena-3-es.png',
  atreseries: 'atreseries-es.png',
  bemad: 'be-mad-tv-es.png',
  'real-madrid-tv': 'real-madrid-tv-es.png',
  ten: 'ten-es.png',
  fdf: 'fdf-es.png',
  divinity: 'divinity-es.png',
  cuatro: 'cuatro-es.png',
  mega: 'mega-es.png',
  trece: 'trece-es.png',
  energy: 'energy-es.png',
  boing: 'boing-es.png',
  'disney-channel': 'disney-channel-es.png',
  'paramount-network': 'paramount-network-es.png',
  dmax: 'dmax-es.png',
  'gol-play': 'gol-play-es.png',
  'la-sexta': 'lasexta-es.png',
  neox: 'neox-es.png',
  nova: 'nova-es.png',
  'el-toro-tv': 'el-toro-tv-es.png'
});

const EXTRA = Object.freeze({
  'hit-tv': 'https://upload.wikimedia.org/wikipedia/commons/1/1a/HIT_TV_logo.svg',
  'dejate-tv': 'https://pbs.twimg.com/profile_images/1613618677798080526/9NJeNxBx.jpg'
});

export function channelLogoFallback(id) {
  if (Object.hasOwn(FILES, id)) return SPAIN_LOGOS + FILES[id];
  return Object.hasOwn(EXTRA, id) ? EXTRA[id] : null;
}

export function usableVBoxLogo(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (url.hostname === 'raw.githubusercontent.com' && /^\/maincenter\/Logotipos-TV\//i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
