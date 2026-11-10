import { canFallbackToLocal, defaultSource, hasOnlineSource } from './source-policy.js';
import { TIMELINE_PIXELS_PER_MINUTE, timelinePosition, timelinePrograms, timelineRange, timelineTicks } from './guide-timeline.js';
import { prefersProgressiveTdt, shouldRetryProgressiveTdt } from './local-playback-policy.js';

const $ = selector => document.querySelector(selector);
const elements = {
  grid: $('#channels-grid'), queue: $('#queue-items'), stage: $('#player-stage'), video: $('#video'), embed: $('#embedded-player'), embedActions: $('#embed-actions'),
  poster: $('#poster-screen'), error: $('#player-error'), loading: $('#player-loading'), play: $('#play-main'),
  current: $('#current-title'), subtitle: $('#current-subtitle'), posterTitle: $('#poster-channel'),
  currentLogo: $('#now-logo'), favorite: $('#favorite-current'), official: $('#official-link'),
  search: $('#search-input'), status: $('#catalog-status'), empty: $('#empty-state')
};

const safeStored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const state = { channels: [], activeId: safeStored('opentv-last-channel', null), favorites: new Set(safeStored('opentv-favorites', [])), filter: 'all', query: '', region: null, sourceMode: 'online', usedFallback: false, sourceIndex: 0, hls: null, mpegts: null, playbackAttempt: 0, started: false, embedAlternative: false, epg: {}, epgReady: false, epgLoading: false, viewMode: 'watch' };
const activeChannel = () => state.channels.find(channel => channel.id === state.activeId);
const guideTime = timestamp => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
const guideRange = programme => programme ? `${guideTime(programme.start)}–${guideTime(programme.stop)}` : '';
const guideProgress = programme => programme ? Math.max(0, Math.min(100, 100 * (Date.now() - programme.start) / (programme.stop - programme.start))) : 0;

function remember(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Almacenamiento bloqueado */ } }

function logoContent(channel, className) {
  const box = document.createElement('div');
  box.className = className;
  box.textContent = channel.name.replace(/[^A-Za-z0-9À-ÿ]/g, '').slice(0, 3).toUpperCase();
  const logos = [...new Set([channel.logo, channel.logoFallback].filter(Boolean))];
  if (logos.length) {
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    let index = 0;
    image.onerror = () => {
      if (++index < logos.length) image.src = logos[index];
      else image.remove();
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
  $('#poster-subtitle').textContent = local ? 'Señal TDT desde tu sintonizador VBox' : hasOnlineSource(channel) ? `${channel.broadcaster} · Emisión online oficial` : 'Disponible a través de la web oficial';
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
  console.warn(`No se ha podido reproducir la señal online de ${channel.name}; usando el VBox.`, reason);
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
  $('#retry-button').hidden = !channel.localStream && !channel.streams.length && !channel.embedUrl && !channel.dynamicStream;
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
  if (channel.dynamicStream) return playDynamicStream(channel);
  if (channel.embedUrl && (channel.preferEmbed || !channel.streams.length)) playEmbedded();
  else playStream(0);
}

function playLocalStream(channel, convertVideo = prefersProgressiveTdt(navigator)) {
  stopPlayback();
  if (!window.mpegts?.getFeatureList()?.mseLivePlayback) {
    showPlaybackError('Navegador no compatible con TDT local', 'Este navegador no puede reproducir la señal MPEG-TS del VBox. Prueba Firefox, Chrome o Safari actualizado.');
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
        showPlaybackError('No se ha podido reproducir la señal del VBox', `El reproductor ha indicado: ${detail || type || 'error desconocido'}. Comprueba el registro de la consola del navegador.`);
      }
    });
    player.attachMediaElement(elements.video);
    player.load();
    player.play().catch(() => { /* El navegador puede exigir pulsar Play. */ });
  } catch {
    if (attempt === state.playbackAttempt) showPlaybackError('Error al iniciar la TDT', 'No se ha podido preparar la reproducción local del VBox.');
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
  if (state.region && channel.region !== state.region) return false;
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
  const region = document.createElement('div'); region.className = 'card-region'; region.textContent = channel.region;
  const guide = state.epg[channel.id];
  const programme = guide?.now || guide?.next;
  let guideDetails = null;
  if (programme) {
    guideDetails = document.createElement('div'); guideDetails.className = 'card-epg';
    const label = document.createElement('span'); label.className = 'card-epg-label'; label.textContent = guide?.now ? 'AHORA EN EMISIÓN' : 'PRÓXIMAMENTE';
    const title = document.createElement('strong'); title.className = 'card-epg-title'; title.textContent = programme.title; title.title = programme.title;
    const time = document.createElement('small'); time.className = 'card-epg-time'; time.textContent = guideRange(programme);
    guideDetails.append(label, title, time);
    if (guide?.now) {
      const progress = document.createElement('div'); progress.className = 'epg-progress';
      const bar = document.createElement('span'); bar.style.width = `${guideProgress(programme)}%`;
      progress.append(bar); guideDetails.append(progress);
      if (guide.next) {
        const next = document.createElement('span'); next.className = 'card-epg-next'; next.textContent = `Después: ${guide.next.title}`;
        guideDetails.append(next);
      }
    }
  }
  const foot = document.createElement('div'); foot.className = 'card-foot';
  const signal = document.createElement('span'); signal.className = channel.localStream || hasOnlineSource(channel) ? '' : 'not-embedded';
  const sourceLabel = channel.dynamicStream ? '● HLS DINÁMICO' : channel.preferEmbed && channel.embedUrl ? '● PLAYER OFICIAL' : channel.streams.length ? '● SEÑAL ONLINE' : channel.embedUrl ? '● PLAYER OFICIAL' : channel.localStream ? '● TDT LOCAL' : '↗ WEB OFICIAL';
  signal.textContent = hasOnlineSource(channel) && channel.localStream ? `${sourceLabel} · TDT` : sourceLabel;
  const arrow = document.createElement('span'); arrow.textContent = '↗';
  foot.append(signal, arrow); card.append(header, name, region);
  if (guideDetails) card.append(guideDetails);
  card.append(foot);
  return card;
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

function makeQueueItem(channel) {
  const item = document.createElement('button');
  item.className = `queue-item${state.activeId === channel.id ? ' active' : ''}`;
  item.onclick = () => selectChannel(channel, true);
  item.append(logoContent(channel, 'queue-logo'));
  const text = document.createElement('span'); text.className = 'queue-text';
  const name = document.createElement('strong'); name.textContent = channel.name;
  const meta = document.createElement('small'); meta.textContent = channel.region;
  text.append(name, meta);
  const arrow = document.createElement('span'); arrow.className = 'queue-arrow'; arrow.textContent = state.activeId === channel.id ? '▶' : '›';
  item.append(text, arrow);
  return item;
}

function render() {
  const filtered = state.channels.filter(matches);
  elements.grid.replaceChildren(...filtered.map(makeCard));
  const queue = state.channels.slice(0, 18);
  elements.queue.replaceChildren(...queue.map(makeQueueItem));
  $('#queue-counter').textContent = `${queue.length} CANALES`;
  $('#channel-count').textContent = `${filtered.length} / ${state.channels.length}`;
  $('#side-count').textContent = state.channels.length;
  $('#favorites-count').textContent = state.favorites.size;
  elements.empty.hidden = filtered.length !== 0 || state.channels.length === 0;
  document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === state.filter && !state.region));
  document.querySelectorAll('[data-region]').forEach(button => button.classList.toggle('active', button.dataset.region === state.region));
  renderGuide();
}

function changeFilter(filter, region = null) {
  state.filter = filter;
  state.region = region;
  render();
  if (window.matchMedia('(max-width: 760px)').matches) (state.viewMode === 'guide' ? $('#guide-section') : $('#catalog-section')).scrollIntoView({ behavior: 'smooth' });
}

document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => changeFilter(button.dataset.filter)));
elements.search.addEventListener('input', () => { state.query = elements.search.value.trim(); render(); });
$('#reset-filters').addEventListener('click', () => { elements.search.value = ''; state.query = ''; changeFilter('all'); });
$('#view-watch').addEventListener('click', () => setViewMode('watch'));
$('#view-guide').addEventListener('click', () => setViewMode('guide'));
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
    const regions = [...new Set(state.channels.map(c => c.region).filter(r => r !== 'Nacional'))];
    const container = $('#region-links');
    for (const region of regions) {
      const button = document.createElement('button');
      button.className = 'region-link'; button.dataset.region = region; button.textContent = region;
      button.onclick = () => changeFilter('all', region);
      container.append(button);
    }
    if (!state.channels.some(c => c.id === state.activeId)) state.activeId = state.channels[0]?.id || null;
    state.sourceMode = defaultSource(activeChannel());
    if (activeChannel()) updateNowPlaying(activeChannel());
    elements.status.textContent = data.vbox?.connected
      ? `VBox conectado · ${data.vbox.count} canales locales`
      : data.vbox?.enabled ? 'VBox sin conexión · canales online disponibles'
        : data.stale ? 'Catálogo en caché · actualización pendiente' : 'Catálogo actualizado automáticamente';
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
    const sourceNames = { vbox: 'VBox', tdtchannels: 'TDTChannels', epgshare: 'EPGSHARE01' };
    const available = Object.entries(data.sources || {}).filter(([, source]) => source.cached).map(([id]) => sourceNames[id] || id);
    const current = state.channels.filter(channel => Boolean(data.channels[channel.id]?.now)).length;
    $('#guide-status').textContent = available.length
      ? `Programación: ${available.join(' + ')} · ${current}/${state.channels.length} con datos actuales`
      : 'Aún sin datos de programación';
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
