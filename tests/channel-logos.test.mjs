import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelLogoFallback, usableVBoxLogo } from '../lib/channel-logos.mjs';
import { parseCatalog } from '../lib/catalog.mjs';

const missingInScreenshot = [
  'antena-3', 'atreseries', 'bemad', 'real-madrid-tv', 'ten', 'fdf',
  'divinity', 'cuatro', 'mega', 'trece', 'energy', 'boing', 'disney-channel',
  'paramount-network', 'dmax', 'gol-play', 'la-sexta', 'neox', 'nova',
  'el-toro-tv', 'hit-tv', 'dejate-tv'
];

test('todos los canales sin logo de la captura tienen alternativa HTTPS', () => {
  for (const id of missingInScreenshot) {
    assert.match(channelLogoFallback(id) || '', /^https:\/\//, `Sin logo para ${id}`);
  }
  assert.equal(channelLogoFallback('canal-desconocido'), null);
});

test('descarta el repositorio retirado del VBox y conserva logos válidos', () => {
  assert.equal(usableVBoxLogo('https://raw.githubusercontent.com/maincenter/Logotipos-TV/master/main/transparentes/FDF.png'), null);
  assert.equal(usableVBoxLogo('http://192.168.1.15:55555/images/FDF.png'), null);
  assert.equal(usableVBoxLogo('https://cdn.example.org/FDF.png'), 'https://cdn.example.org/FDF.png');
});

test('Antena 3 obtiene su logo aunque el catálogo online no lo incluya', () => {
  const parsed = parseCatalog({ countries: [{ name: 'Spain', ambits: [{ channels: [] }] }] });
  const antena = parsed.find(channel => channel.id === 'antena-3');
  assert.equal(antena.logo, channelLogoFallback('antena-3'));
});
