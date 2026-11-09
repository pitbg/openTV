const $ = selector => document.querySelector(selector);
const elements = {
  grid: $('#channels-grid'), queue: $('#queue-items'), stage: $('#player-stage'), video: $('#video'), embed: $('#embedded-player'), embedActions: $('#embed-actions'),
  poster: $('#poster-screen'), error: $('#player-error'), loading: $('#player-loading'), play: $('#play-main'),
  current: $('#current-title'), subtitle: $('#current-subtitle'), posterTitle: $('#poster-channel'),
  currentLogo: $('#now-logo'), favorite: $('#favorite-current'), official: $('#official-link'),
  search: $('#search-input'), status: $('#catalog-status'), empty: $('#empty-state')
};

const safeStored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const state = { channels: [], activeId: safeStored('opentv-last-channel', null), favorites: new Set(safeStored('opentv-favorites', [])), filter: 'all', query: '', region: null, sourceIndex: 0, hls: null, mpegts: null, playbackAttempt: 0, started: false, embedAlternative: false };
const activeChannel = () => state.channels.find(channel => channel.id === state.activeId);

function remember(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Almacenamiento bloqueado */ } }

function logoContent(channel, className) {
  const box = document.createElement('div');
  box.className = className;
  box.textContent = channel.name.replace(/[^A-Za-z0-9À-ÿ]/g, '').slice(0, 3).toUpperCase();
  if (channel.logo) {
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.src = channel.logo;
    image.onerror = () => image.remove();
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
  if (!sameChannel) {
    state.sourceIndex = 0;
    stopPlayback();
  }
  remember('opentv-last-channel', channel.id);
  updateNowPlaying(channel);
  render();
  if (shouldPlay) playChannel();
}

function updateNowPlaying(channel) {
  elements.current.textContent = channel.name;
  elements.subtitle.textContent = `${channel.broadcaster} · ${channel.region}`;
  elements.posterTitle.textContent = channel.name.toUpperCase();
  $('#poster-subtitle').textContent = channel.localStream ? 'Señal TDT desde tu sintonizador VBox' : channel.streams.length || channel.embedUrl || channel.dynamicStream ? `${channel.broadcaster} · Emisión online oficial` : 'Disponible a través de la web oficial';
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
  $('#quality-tag').textContent = channel.localStream ? 'TDT LOCAL' : channel.streams.length || channel.embedUrl || channel.dynamicStream ? 'EN VIVO' : 'SOLO WEB';
  $('#retry-button').hidden = !channel.localStream && !channel.streams.length && !channel.embedUrl && !channel.dynamicStream;
  $('#error-embed-button').hidden = !channel.dynamicStream || !channel.embedUrl;
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
  if (channel.localStream) return playLocalStream(channel);
  if (channel.dynamicStream) return playDynamicStream(channel);
  if (channel.embedUrl && (channel.preferEmbed || !channel.streams.length)) playEmbedded();
  else playStream(0);
}

function playLocalStream(channel, convertVideo = false) {
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
        if (!convertVideo && /Firefox\//.test(navigator.userAgent) && detail === 'MediaMSEError') {
          console.warn('Firefox ha rechazado el H.264 original; probando vídeo progresivo compatible.');
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
    showPlaybackError(`No se ha podido abrir ${channel.name}`, `${error.message} Puedes verlo en la web oficial del canal.`);
  }
}

async function playStream(index = state.sourceIndex) {
  const channel = activeChannel();
  if (!channel) return;
  if (!channel.streams.length) {
    if (channel.embedUrl && !channel.dynamicStream) return playEmbedded();
    showPlaybackError('Sin señal directa disponible', 'Esta cadena solo ofrece su emisión en su propia web. Puedes abrirla con el botón inferior.');
    return;
  }
  if (index >= channel.streams.length) {
    if (channel.embedUrl && !channel.dynamicStream) return playEmbedded();
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
    showPlaybackError('Navegador no compatible', 'Este navegador no admite la reproducción HLS. Utiliza una versión reciente o abre la emisión oficial.');
  }
}

elements.video.addEventListener('error', () => {
  if (state.started && !state.hls && !state.mpegts && elements.stage.classList.contains('is-playing')) playStream(state.sourceIndex + 1);
});
elements.play.addEventListener('click', playChannel);
$('#retry-button').addEventListener('click', playChannel);
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
  const foot = document.createElement('div'); foot.className = 'card-foot';
  const signal = document.createElement('span'); signal.className = channel.localStream || channel.streams.length || channel.embedUrl ? '' : 'not-embedded';
  signal.textContent = channel.localStream ? '● TDT LOCAL' : channel.dynamicStream ? '● HLS DINÁMICO' : channel.embedUrl ? '● PLAYER OFICIAL' : channel.streams.length ? '● SEÑAL ONLINE' : '↗ WEB OFICIAL';
  const arrow = document.createElement('span'); arrow.textContent = '↗';
  foot.append(signal, arrow); card.append(header, name, region, foot);
  return card;
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
}

function changeFilter(filter, region = null) {
  state.filter = filter;
  state.region = region;
  render();
  if (window.matchMedia('(max-width: 760px)').matches) $('.catalog-section').scrollIntoView({ behavior: 'smooth' });
}

document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => changeFilter(button.dataset.filter)));
elements.search.addEventListener('input', () => { state.query = elements.search.value.trim(); render(); });
$('#reset-filters').addEventListener('click', () => { elements.search.value = ''; state.query = ''; changeFilter('all'); });
document.addEventListener('keydown', event => {
  if (event.target.matches('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === '/') { event.preventDefault(); elements.search.focus(); }
  if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && !event.target.closest('button, video')) {
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
    if (activeChannel()) updateNowPlaying(activeChannel());
    elements.status.textContent = data.vbox?.connected
      ? `VBox conectado · ${data.vbox.count} canales locales`
      : data.vbox?.enabled ? 'VBox sin conexión · canales online disponibles'
        : data.stale ? 'Catálogo en caché · actualización pendiente' : 'Catálogo actualizado automáticamente';
    render();
  } catch {
    elements.grid.replaceChildren();
    const message = document.createElement('div'); message.className = 'loading-card';
    message.textContent = 'No se pudo cargar el catálogo de canales. Comprueba que el servidor tenga acceso a Internet y recarga la página.';
    elements.grid.append(message);
    elements.status.textContent = 'No se pudo actualizar el catálogo';
  }
}

initialize();
