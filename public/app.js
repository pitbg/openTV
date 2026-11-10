import { canFallbackToLocal, defaultSource, hasOnlineSource } from './source-policy.js';
import { TIMELINE_PIXELS_PER_MINUTE, timelinePosition, timelinePrograms, timelineRange, timelineTicks } from './guide-timeline.js';
import { prefersProgressiveTdt, shouldRetryProgressiveTdt } from './local-playback-policy.js';

const $ = selector => document.querySelector(selector);
const elements = {
  grid: $('#channels-grid'), stage: $('#player-stage'), video: $('#video'), embed: $('#embedded-player'), embedActions: $('#embed-actions'),
  poster: $('#poster-screen'), error: $('#player-error'), loading: $('#player-loading'), play: $('#play-main'),
  current: $('#current-title'), subtitle: $('#current-subtitle'), posterTitle: $('#poster-channel'),
  currentLogo: $('#now-logo'), favorite: $('#favorite-current'), official: $('#official-link'),
  search: $('#search-input'), status: $('#catalog-status'), empty: $('#empty-state')
};

const safeStored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const state = { channels: [], activeId: safeStored('opentv-last-channel', null), favorites: new Set(safeStored('opentv-favorites', [])), filter: 'all', query: '', sourceMode: 'online', usedFallback: false, sourceIndex: 0, hls: null, mpegts: null, playbackAttempt: 0, started: false, embedAlternative: false, epg: {}, epgReady: false, epgLoading: false, viewMode: 'watch' };
const activeChannel = () => state.channels.find(channel => channel.id === state.activeId);
const guideTime = timestamp => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
const guideRange = programme => programme ? `${guideTime(programme.start)}–${guideTime(programme.stop)}` : '';
const guideProgress = programme => programme ? Math.max(0, Math.min(100, 100 * (Date.now() - programme.start) / (programme.stop - programme.start))) : 0;

function remember(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Almacenamiento bloqueado */ } }

function logoContent(channel, className) {
  const box = document.createElement('div');
  box.className = className;
  const fallback = document.createElement('span');
  fallback.className = 'logo-fallback';
  fallback.textContent = channel.name.replace(/[^A-Za-z0-9À-ÿ]/g, '').slice(0, 3).toUpperCase();
  box.append(fallback);
  const logos = [...new Set([channel.logo, channel.logoFallback].filter(Boolean))];
  if (logos.length) {
    fallback.hidden = true;
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.style.visibility = 'hidden';
    let index = 0;
    image.onload = () => {
      fallback.hidden = true;
      image.style.visibility = 'visible';
    };
    image.onerror = () => {
      image.style.visibility = 'hidden';
      if (++index < logos.length) image.src = logos[index];
      else {
        image.remove();
        fallback.hidden = false;
      }
    };
    image.src = logos[index];
    box.append(image);
  }
  return box;
}

function toggleFavorite(channel) {
  if (state.favorites.has(channel.id)) state.favorites.delete(channel.id);
  else state.favorites.add(channel.id);
  remember('opentv-favorites', [...state.favorites]);
  render();
}

function selectChannel(channel, shouldPlay = false) {
  const sameChannel = state.activeId === channel.id;
  state.activeId = channel.id;
  state.sourceMode = defaultSource(channel);
  state.usedFallback = false;
  state.sourceIndex = 0;
  if (!sameChannel || shouldPlay) {
    stopPlayback();
  }
  remember('opentv-last-channel', channel.id);
  updateNowPlaying(channel);
  render();
  if (shouldPlay) playChannel();
}

function setViewMode(mode) {
  const guide = mode === 'guide';
  state.viewMode = guide ? 'guide' : 'watch';
  $('#main-content').classList.toggle('guide-mode', guide);
  $('#guide-section').hidden = !guide;
  $('#catalog-section').hidden = guide;
  for (const [name, selector] of [['watch', '#view-watch'], ['guide', '#view-guide']]) {
    const button = $(selector);
    const active = state.viewMode === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  if (guide) renderGuide();
  else scheduleCardMarquees();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateSourceControls(channel) {
  const both = hasOnlineSource(channel) && channel.localStream;
  $('#source-options').hidden = !both;
  for (const [mode, selector] of [['online', '#source-online'], ['local', '#source-local']]) {
    const button = $(selector);
    const active = state.sourceMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const local = state.sourceMode === 'local';
  $('#quality-tag').textContent = local ? 'TDT LOCAL' : hasOnlineSource(channel) ? 'EN VIVO · ONLINE' : 'SOLO WEB';
  $('#poster-subtitle').textContent = local ? 'Señal de tu antena TDT' : hasOnlineSource(channel) ? `${channel.broadcaster} · Emisión online oficial` : 'Disponible a través de la web oficial';
  elements.subtitle.textContent = `${channel.broadcaster} · ${channel.region}${state.usedFallback ? ' · Respaldo TDT activado' : ''}`;
}

function chooseSource(mode) {
  const channel = activeChannel();
  if (!channel || (mode === 'online' && !hasOnlineSource(channel)) || (mode === 'local' && !channel.localStream)) return;
  state.sourceMode = mode;
  state.usedFallback = false;
  state.sourceIndex = 0;
  stopPlayback();
  updateSourceControls(channel);
  playChannel();
}

function fallbackToLocal(channel, reason) {
  if (activeChannel()?.id !== channel.id || !canFallbackToLocal(channel, state.sourceMode)) return false;
  console.warn(`No se ha podido reproducir la señal online de ${channel.name}; usando la TDT local.`, reason);
  state.sourceMode = 'local';
  state.usedFallback = true;
  updateSourceControls(channel);
  playLocalStream(channel);
  return true;
}

function updateNowPlaying(channel) {
  elements.current.textContent = channel.name;
  elements.posterTitle.textContent = channel.name.toUpperCase();
  const newLogo = logoContent(channel, 'now-logo');
  elements.currentLogo.replaceWith(newLogo);
  elements.currentLogo = newLogo;
  elements.favorite.textContent = state.favorites.has(channel.id) ? '★' : '☆';
  elements.favorite.classList.toggle('is-favorite', state.favorites.has(channel.id));
  elements.favorite.title = state.favorites.has(channel.id) ? 'Quitar de favoritos' : 'Añadir a favoritos';
  elements.favorite.setAttribute('aria-label', elements.favorite.title);
  for (const link of [elements.official, $('#error-official-link'), $('#embed-official-link')]) {
    link.hidden = !channel.website;
    if (channel.website) link.href = channel.website;
    else link.removeAttribute('href');
  }
  updateSourceControls(channel);
  $('#retry-button').hidden = !channel.localStream && !channel.streams.length && !channel.embedUrl && !channel.dynamicStream && !channel.dynamicEmbed;
  $('#error-embed-button').hidden = !channel.dynamicStream || !channel.embedUrl;
  updateNowEpg(channel);
}

function updateNowEpg(channel) {
  const guide = state.epg[channel.id];
  const current = guide?.now;
  $('#now-epg').hidden = !current;
  if (!current) return;
  $('#now-epg-title').textContent = current.title;
  $('#now-epg-time').textContent = guideRange(current);
  $('#now-epg-progress').style.width = `${guideProgress(current)}%`;
  $('#next-epg-title').textContent = guide.next?.title || 'Aún sin información';
  $('#next-epg-time').textContent = guideRange(guide.next);
}

function stopPlayback() {
  state.playbackAttempt++;
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  if (state.mpegts) { state.mpegts.destroy(); state.mpegts = null; }
  elements.video.pause();
  elements.video.removeAttribute('src');
  elements.video.load();
  elements.embed.removeAttribute('src');
  elements.embed.hidden = true;
  elements.embedActions.hidden = true;
  elements.loading.hidden = true;
  elements.stage.classList.remove('is-playing', 'is-embedded');
  elements.error.hidden = true;
  elements.poster.hidden = false;
  state.started = false;
  state.embedAlternative = false;
}

function showPlaybackError(title, description) {
  stopPlayback();
  elements.error.hidden = false;
  elements.poster.hidden = true;
  $('#error-title').textContent = title;
  $('#error-description').textContent = description;
}

function playEmbedded(useAlternative = false) {
  const channel = activeChannel();
  if (!channel?.embedUrl) return;
  const embedUrl = useAlternative && channel.alternativeEmbedUrl ? channel.alternativeEmbedUrl : channel.embedUrl;
  stopPlayback();
  state.embedAlternative = useAlternative;
  elements.embed.title = `Emisión oficial de ${channel.name}`;
  elements.embed.src = embedUrl;
  elements.embed.hidden = false;
  elements.embedActions.hidden = false;
  $('#try-embed-button').hidden = !channel.alternativeEmbedUrl;
  $('#try-embed-button').textContent = useAlternative ? 'Probar reproductor nuevo' : 'Probar otro reproductor';
  $('#try-hls-button').hidden = !channel.streams.length && !channel.dynamicStream;
  elements.poster.hidden = true;
  elements.stage.classList.add('is-embedded');
  state.started = true;
}

function playChannel() {
  const channel = activeChannel();
  if (!channel) return;
  if (state.sourceMode === 'local' && channel.localStream) return playLocalStream(channel);
  if (channel.dynamicEmbed) return playDynamicEmbedded(channel);
  if (channel.dynamicStream) return playDynamicStream(channel);
  if (channel.embedUrl && (channel.preferEmbed || !channel.streams.length)) playEmbedded();
  else playStream(0);
}

async function playDynamicEmbedded(channel) {
  stopPlayback();
  const attempt = state.playbackAttempt;
  elements.poster.hidden = true;
  elements.loading.hidden = false;
  $('#loading-provider').textContent = `Abriendo el directo oficial de ${channel.name}`;
  try {
    const response = await fetch(`/api/embeds/${encodeURIComponent(channel.id)}`, { cache: 'no-store' });
    const body = await response.json();
    if (attempt !== state.playbackAttempt || activeChannel()?.id !== channel.id || state.sourceMode !== 'online') return;
    if (!response.ok || typeof body.embedUrl !== 'string' ||
        !/^https:\/\/www\.youtube\.com\/embed\/[a-zA-Z0-9_-]{11}\?/.test(body.embedUrl)) {
      throw new Error(body.error || 'La señal oficial no está disponible.');
    }
    channel.embedUrl = body.embedUrl;
    playEmbedded();
  } catch (error) {
    if (attempt !== state.playbackAttempt || activeChannel()?.id !== channel.id || state.sourceMode !== 'online') return;
    if (fallbackToLocal(channel, error.message)) return;
    showPlaybackError(`No se ha podido abrir ${channel.name}`, `${error.message} Puedes verla en la web oficial.`);
  }
}

function playLocalStream(channel, convertVideo = prefersProgressiveTdt(navigator)) {
  stopPlayback();
  if (!window.mpegts?.getFeatureList()?.mseLivePlayback) {
    showPlaybackError('Navegador no compatible con TDT local', 'Este navegador no puede reproducir la señal MPEG-TS del sintonizador. Prueba Firefox, Chrome o Safari actualizado.');
    return;
  }
  const attempt = state.playbackAttempt;
  elements.poster.hidden = true;
  elements.error.hidden = true;
  elements.stage.classList.add('is-playing');
  state.started = true;
  try {
    const player = window.mpegts.createPlayer({
      type: 'mpegts', isLive: true, url: `${channel.localStreamUrl}${convertVideo ? '?video=progressive' : ''}`
    }, { lazyLoad: false, enableStashBuffer: false, autoCleanupSourceBuffer: true });
    state.mpegts = player;
    player.on(window.mpegts.Events.ERROR, (type, detail, info) => {
      console.error('Error reproduciendo TDT local:', { type, detail, info });
      if (attempt === state.playbackAttempt) {
        if (shouldRetryProgressiveTdt(convertVideo, type, detail)) {
          console.warn('El navegador ha rechazado la señal TDT original; probando vídeo progresivo compatible.');
          playLocalStream(channel, true);
          return;
        }
        showPlaybackError('No se ha podido reproducir la señal TDT', `El reproductor ha indicado: ${detail || type || 'error desconocido'}. Comprueba el registro de la consola del navegador.`);
      }
    });
    player.attachMediaElement(elements.video);
    player.load();
    player.play().catch(() => { /* El navegador puede exigir pulsar Play. */ });
  } catch {
    if (attempt === state.playbackAttempt) showPlaybackError('Error al iniciar la TDT', 'No se ha podido preparar la reproducción del sintonizador local.');
  }
}

async function playDynamicStream(channel) {
  stopPlayback();
  const attempt = state.playbackAttempt;
  elements.poster.hidden = true;
  elements.loading.hidden = false;
  $('#loading-provider').textContent = `Consultando la señal de ${channel.broadcaster}`;
  try {
    const response = await fetch(`/api/streams/${encodeURIComponent(channel.id)}`, { cache: 'no-store' });
    const body = await response.json();
    if (attempt !== state.playbackAttempt || activeChannel()?.id !== channel.id) return;
    if (!response.ok || !Array.isArray(body.streams) || !body.streams.length) {
      throw new Error(body.error || 'No se encontró una señal HLS compatible.');
    }
    channel.streams = body.streams;
    elements.loading.hidden = true;
    playStream(0);
  } catch (error) {
    if (attempt !== state.playbackAttempt || activeChannel()?.id !== channel.id) return;
    if (fallbackToLocal(channel, error.message)) return;
    showPlaybackError(`No se ha podido abrir ${channel.name}`, `${error.message} Puedes verlo en la web oficial del canal.`);
  }
}

async function playStream(index = state.sourceIndex) {
  const channel = activeChannel();
  if (!channel) return;
  if (!channel.streams.length) {
    if (channel.embedUrl && !channel.dynamicStream) return playEmbedded();
    if (fallbackToLocal(channel, 'No hay señales HLS disponibles')) return;
    showPlaybackError('Sin señal directa disponible', 'Esta cadena solo ofrece su emisión en su propia web. Puedes abrirla con el botón inferior.');
    return;
  }
  if (index >= channel.streams.length) {
    if (channel.embedUrl && !channel.dynamicStream) return playEmbedded();
    if (fallbackToLocal(channel, 'Todas las fuentes HLS han fallado')) return;
    showPlaybackError('No podemos reproducir este canal aquí', 'No ha funcionado ninguna fuente HLS. La cadena puede limitar su acceso o impedir la reproducción fuera de su web oficial.');
    return;
  }
  state.sourceIndex = index;
  const attempt = ++state.playbackAttempt;
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  elements.embed.removeAttribute('src');
  elements.embed.hidden = true;
  elements.embedActions.hidden = true;
  elements.video.pause();
  elements.video.removeAttribute('src');
  elements.video.load();
  elements.poster.hidden = true;
  elements.error.hidden = true;
  elements.stage.classList.remove('is-embedded');
  elements.stage.classList.add('is-playing');
  state.started = true;
  const url = channel.streams[index];

  const startVideo = () => {
    if (attempt !== state.playbackAttempt) return;
    elements.video.play().catch(() => {
      // En ciertos navegadores se necesita pulsar Play en los controles nativos.
    });
  };
  const tryNextSource = () => {
    if (attempt === state.playbackAttempt) playStream(index + 1);
  };

  if (elements.video.canPlayType('application/vnd.apple.mpegurl')) {
    elements.video.src = url;
    startVideo();
  } else if (window.Hls?.isSupported()) {
    const hls = new window.Hls({ enableWorker: true, lowLatencyMode: true, liveSyncDurationCount: 3 });
    state.hls = hls;
    hls.on(window.Hls.Events.MANIFEST_PARSED, startVideo);
    hls.on(window.Hls.Events.ERROR, (_, details) => {
      if (details.fatal) tryNextSource();
    });
    hls.loadSource(url);
    hls.attachMedia(elements.video);
  } else {
    if (channel.embedUrl && !channel.dynamicStream) return playEmbedded();
    if (fallbackToLocal(channel, 'El navegador no admite HLS')) return;
    showPlaybackError('Navegador no compatible', 'Este navegador no admite la reproducción HLS. Utiliza una versión reciente o abre la emisión oficial.');
  }
}

elements.video.addEventListener('error', () => {
  if (state.started && !state.hls && !state.mpegts && elements.stage.classList.contains('is-playing')) playStream(state.sourceIndex + 1);
});
elements.play.addEventListener('click', playChannel);
$('#retry-button').addEventListener('click', playChannel);
$('#source-online').addEventListener('click', () => chooseSource('online'));
$('#source-local').addEventListener('click', () => chooseSource('local'));
$('#try-hls-button').addEventListener('click', () => activeChannel()?.dynamicStream ? playChannel() : playStream(0));
$('#try-embed-button').addEventListener('click', () => playEmbedded(!state.embedAlternative));
$('#error-embed-button').addEventListener('click', () => playEmbedded());
$('#fullscreen-button').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (elements.stage.requestFullscreen) elements.stage.requestFullscreen();
  else elements.video.webkitEnterFullscreen?.();
});
elements.favorite.addEventListener('click', () => { const channel = activeChannel(); if (channel) toggleFavorite(channel); });

function matches(channel) {
  if (state.filter === 'favorites' && !state.favorites.has(channel.id)) return false;
  if (state.filter === 'national' && channel.region !== 'Nacional') return false;
  if (state.filter === 'regional' && channel.region === 'Nacional') return false;
  const term = state.query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return `${channel.name} ${channel.region} ${channel.broadcaster}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(term);
}

function makeCard(channel) {
  const card = document.createElement('article');
  card.className = `channel-card${state.activeId === channel.id ? ' active' : ''}`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Ver ${channel.name}`);
  card.onclick = () => { selectChannel(channel, true); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  card.onkeydown = event => { if (event.target === card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); card.click(); } };

  const header = document.createElement('div'); header.className = 'card-header';
  header.append(logoContent(channel, 'card-logo'));
  const favorite = document.createElement('button');
  favorite.className = `card-favorite${state.favorites.has(channel.id) ? ' is-favorite' : ''}`;
  favorite.textContent = state.favorites.has(channel.id) ? '★' : '☆';
  favorite.title = state.favorites.has(channel.id) ? 'Quitar de favoritos' : 'Añadir a favoritos';
  favorite.setAttribute('aria-label', `${favorite.title}: ${channel.name}`);
  favorite.onclick = event => { event.stopPropagation(); toggleFavorite(channel); };
  header.append(favorite);
  const name = document.createElement('div'); name.className = 'card-name'; name.textContent = channel.name;
  const current = state.epg[channel.id]?.now;
  const now = document.createElement('div'); now.className = 'card-now';
  if (current?.title) {
    now.title = `Ahora: ${current.title}`;
    const track = document.createElement('span'); track.className = 'card-now-track';
    const title = document.createElement('span'); title.className = 'card-now-text'; title.textContent = current.title;
    track.append(title); now.append(track);
  }
  card.append(header, name, now);
  return card;
}

let cardMarqueeFrame = null;
function scheduleCardMarquees() {
  if (cardMarqueeFrame !== null) cancelAnimationFrame(cardMarqueeFrame);
  cardMarqueeFrame = requestAnimationFrame(() => {
    cardMarqueeFrame = null;
    for (const viewport of elements.grid.querySelectorAll('.card-now')) {
      const track = viewport.firstElementChild;
      if (!track) continue;
      track.classList.remove('is-scrolling');
      track.querySelector('[aria-hidden="true"]')?.remove();
      const title = track.firstElementChild;
      const width = title.getBoundingClientRect().width;
      if (width <= viewport.clientWidth + 1) continue;
      const clone = title.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.append(clone);
      const distance = width + 18;
      track.style.setProperty('--marquee-offset', `${-distance}px`);
      track.style.setProperty('--marquee-duration', `${Math.max(12, distance / 24)}s`);
      track.classList.add('is-scrolling');
    }
  });
}

function tuneFromGuide(channel) {
  selectChannel(channel, true);
  setViewMode('watch');
}

function makeTimelineRow(channel, range) {
  const row = document.createElement('div');
  row.className = `timeline-row${state.activeId === channel.id ? ' active' : ''}`;

  const selector = document.createElement('button');
  selector.type = 'button'; selector.className = 'timeline-channel';
  selector.title = `Ver ${channel.name} en directo`;
  selector.onclick = () => tuneFromGuide(channel);
  selector.append(logoContent(channel, 'timeline-logo'));
  const identity = document.createElement('span'); identity.className = 'timeline-channel-info';
  const name = document.createElement('strong'); name.textContent = channel.name;
  const region = document.createElement('small'); region.textContent = channel.region;
  identity.append(name, region); selector.append(identity);

  const track = document.createElement('div'); track.className = 'timeline-track';
  track.style.width = `${range.width}px`;
  const programmes = timelinePrograms(state.epg[channel.id], range);
  for (const programme of programmes) {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = `timeline-program${programme.current ? ' is-current' : ''}`;
    block.style.left = `${programme.left}px`;
    block.style.width = `${Math.max(0, programme.width - 3)}px`;
    block.title = `${channel.name} · ${programme.title} (${guideRange(programme)})`;
    block.setAttribute('aria-label', `Ver ${channel.name}: ${programme.title}, ${guideRange(programme)}`);
    block.onclick = () => tuneFromGuide(channel);
    const title = document.createElement('strong'); title.textContent = programme.title;
    const schedule = document.createElement('small'); schedule.textContent = guideRange(programme);
    block.append(title, schedule); track.append(block);
  }
  if (!programmes.length) {
    const unavailable = document.createElement('button');
    unavailable.type = 'button'; unavailable.className = 'timeline-unavailable';
    unavailable.textContent = state.epgReady ? 'Sin información de programación · Ver canal' : 'Consultando programación…';
    unavailable.onclick = () => tuneFromGuide(channel);
    track.append(unavailable);
  }
  const nowLine = document.createElement('span'); nowLine.className = 'timeline-now-line';
  nowLine.style.left = `${timelinePosition(range.now, range)}px`;
  track.append(nowLine);
  row.append(selector, track);
  return row;
}

function renderGuide() {
  if (state.viewMode !== 'guide') return;
  const scroller = $('#timeline-scroll');
  const previousLeft = scroller.scrollLeft;
  const previousTop = scroller.scrollTop;
  const range = timelineRange();
  const channels = state.channels.filter(matches);
  const board = $('#timeline-board');
  const header = document.createElement('div'); header.className = 'timeline-header';
  const corner = document.createElement('span'); corner.className = 'timeline-corner'; corner.textContent = 'CANALES';
  const times = document.createElement('div'); times.className = 'timeline-hours';
  times.style.width = `${range.width}px`;
  for (const tick of timelineTicks(range)) {
    const mark = document.createElement('span'); mark.className = 'timeline-hour';
    mark.style.left = `${tick.left}px`;
    mark.textContent = guideTime(tick.time);
    times.append(mark);
  }
  const now = document.createElement('span'); now.className = 'timeline-now-label';
  now.style.left = `${timelinePosition(range.now, range)}px`;
  now.textContent = 'AHORA'; times.append(now);
  header.append(corner, times);
  board.replaceChildren(header, ...channels.map(channel => makeTimelineRow(channel, range)));
  $('#guide-empty').hidden = channels.length > 0 || !state.epgReady;
  scroller.scrollLeft = previousLeft;
  scroller.scrollTop = previousTop;
}

function render() {
  const filtered = state.channels.filter(matches);
  elements.grid.replaceChildren(...filtered.map(makeCard));
  if (state.viewMode === 'watch') scheduleCardMarquees();
  elements.empty.hidden = filtered.length !== 0 || state.channels.length === 0;
  document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === state.filter));
  renderGuide();
}

function changeFilter(filter) {
  state.filter = filter;
  render();
  if (window.matchMedia('(max-width: 760px)').matches) (state.viewMode === 'guide' ? $('#guide-section') : $('#catalog-section')).scrollIntoView({ behavior: 'smooth' });
}

document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => changeFilter(button.dataset.filter)));
elements.search.addEventListener('input', () => { state.query = elements.search.value.trim(); render(); });
$('#reset-filters').addEventListener('click', () => { elements.search.value = ''; state.query = ''; changeFilter('all'); });
$('#view-watch').addEventListener('click', () => setViewMode('watch'));
$('#view-guide').addEventListener('click', () => setViewMode('guide'));
window.addEventListener('resize', scheduleCardMarquees);
$('#guide-now').addEventListener('click', () => { $('#timeline-scroll').scrollTo({ left: 0, behavior: 'smooth' }); });
$('#guide-prev-time').addEventListener('click', () => { $('#timeline-scroll').scrollBy({ left: -60 * TIMELINE_PIXELS_PER_MINUTE, behavior: 'smooth' }); });
$('#guide-next-time').addEventListener('click', () => { $('#timeline-scroll').scrollBy({ left: 60 * TIMELINE_PIXELS_PER_MINUTE, behavior: 'smooth' }); });
document.addEventListener('keydown', event => {
  if (event.target.matches('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === '/') { event.preventDefault(); elements.search.focus(); }
  if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && !event.target.closest('button, video, .timeline-scroll')) {
    const at = state.channels.findIndex(c => c.id === state.activeId);
    if (at !== -1) {
      event.preventDefault();
      const next = (at + (event.key === 'ArrowRight' ? 1 : -1) + state.channels.length) % state.channels.length;
      selectChannel(state.channels[next], true);
    }
  }
});

async function initialize() {
  try {
    const response = await fetch('/api/channels', { cache: 'no-store' });
    if (!response.ok) throw new Error('El servicio de canales no está disponible');
    const data = await response.json();
    state.channels = data.channels;
    if (!state.channels.some(c => c.id === state.activeId)) state.activeId = state.channels[0]?.id || null;
    state.sourceMode = defaultSource(activeChannel());
    if (activeChannel()) updateNowPlaying(activeChannel());
    elements.status.textContent = data.stale ? 'Catálogo en caché · actualización pendiente' : 'Canales actualizados';
    render();
    refreshEpg();
    setInterval(refreshEpg, 120_000);
    setInterval(() => { if (state.viewMode === 'guide') renderGuide(); }, 60_000);
  } catch {
    elements.grid.replaceChildren();
    const message = document.createElement('div'); message.className = 'loading-card';
    message.textContent = 'No se pudo cargar el catálogo de canales. Comprueba que el servidor tenga acceso a Internet y recarga la página.';
    elements.grid.append(message);
    elements.status.textContent = 'No se pudo actualizar el catálogo';
  }
}

async function refreshEpg() {
  if (state.epgLoading) return;
  state.epgLoading = true;
  try {
    const response = await fetch('/api/epg', { cache: 'no-store' });
    if (!response.ok) throw new Error('La guía no está disponible');
    const data = await response.json();
    if (!data.channels || typeof data.channels !== 'object') throw new Error('Formato de EPG inválido');
    state.epg = data.channels;
    const available = Object.values(data.sources || {}).some(source => source.cached);
    $('#guide-status').textContent = available ? 'Programación actualizada' : 'Aún sin datos de programación';
  } catch (error) {
    console.warn('No se ha podido actualizar la EPG:', error);
    $('#guide-status').textContent = 'Guía temporalmente no disponible';
  } finally {
    state.epgReady = true;
    state.epgLoading = false;
    if (activeChannel()) updateNowEpg(activeChannel());
    render();
  }
}

initialize();
