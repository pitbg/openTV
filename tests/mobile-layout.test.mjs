import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('la interfaz compacta no incorpora barras laterales, contadores ni el nombre del sintonizador', () => {
  assert.doesNotMatch(html, /class="sidebar"|class="queue-panel"|id="channel-count"/);
  assert.doesNotMatch(html, /VBox/i);
  assert.match(css, /\.app-shell\{display:block;min-height:100vh\}/);
  assert.match(css, /\.channels-grid\{grid-template-columns:repeat\(auto-fill,minmax\(132px,1fr\)\)/);
});

test('las tarjetas muestran logo y nombre; la programación está en la guía', () => {
  const card = app.split('function makeCard(channel) {')[1].split('let cardMarqueeFrame = null')[0];
  assert.match(card, /logoContent\(channel, 'card-logo'\)/);
  assert.doesNotMatch(card, /card-epg|card-foot|card-region/);
  assert.match(app, /image\.onload\s*=\s*\(\)\s*=>\s*\{\s*fallback\.hidden = true/);
  assert.match(app, /if \(logos\.length\) \{\s*fallback\.hidden = true/);
  assert.match(app, /image\.onerror[\s\S]*?image\.remove\(\);\s*fallback\.hidden = false/);
});

test('solo aparece el programa actual con marquesina para títulos largos', () => {
  const card = app.split('function makeCard(channel) {')[1].split('let cardMarqueeFrame = null')[0];
  assert.match(card, /state\.epg\[channel\.id\]\?\.now/);
  assert.doesNotMatch(card, /state\.epg\[channel\.id\]\?\.next/);
  assert.match(card, /now\.title = `Ahora: \$\{current\.title\}`/);
  assert.match(app, /if \(width <= viewport\.clientWidth \+ 1\) continue/);
  assert.match(app, /clone\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(css, /@keyframes card-now-marquee/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\s*\.card-now-track\.is-scrolling\{animation:none/);
});

test('el reproductor y la guía no superan el ancho de la pantalla móvil', () => {
  assert.match(css, /\.player-stage\{width:100%;aspect-ratio:16\/9\}/);
  assert.match(css, /main\.guide-mode \.watch-section\{width:100%;max-width:100%\}/);
  assert.match(css, /\.timeline-scroll\{width:100%;max-width:100%\}/);
});
