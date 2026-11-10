import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

test('la parrilla de canales no fuerza el ancho del reproductor en pantallas estrechas', () => {
  assert.match(css, /@media\(max-width:1150px\)\{\s*\.watch-layout\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /\.queue-panel\{overflow:hidden\}/);
  assert.match(css, /\.queue-items\{width:100%;overflow-x:auto\}/);
});

test('el reproductor y la guía no superan el ancho de la pantalla móvil', () => {
  assert.match(css, /\.player-stage\{width:100%;aspect-ratio:16\/9\}/);
  assert.match(css, /main\.guide-mode \.watch-section\{width:100%;max-width:100%\}/);
  assert.match(css, /\.timeline-scroll\{width:100%;max-width:100%\}/);
});
