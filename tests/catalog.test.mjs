import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parseCatalog, createCatalogService } from '../lib/catalog.mjs';

const sample = {
  countries: [{ name: 'Spain', ambits: [
    { name: 'Generalistas', channels: [
      { name: 'La 1', logo: 'https://example.com/la1.png', web: 'https://www.rtve.es/play/', options: [
        { format: 'm3u8', url: 'https://example.com/la1.m3u8' },
        { format: 'm3u8', url: 'https://example.com/la1.m3u8' },
        { format: 'm3u8', url: 'http://insecure.test/stream.m3u8' },
        { format: 'youtube', url: 'https://youtube.com/live/foo' }
      ], extra_info: ['GEO'] },
      { name: 'Telecinco', web: 'https://www.mediasetinfinity.es/directo/telecinco/', options: [] }
    ] },
    { name: 'Informativos', channels: [{ name: '24h', web: 'https://www.rtve.es/play/', options: [] }] },
    { name: 'C. de Madrid', channels: [{ name: 'Telemadrid', web: 'https://www.telemadrid.es/', options: [{ format: 'm3u8', url: 'https://example.com/tm.m3u8' }] }] },
    { name: 'Andalucía', channels: [{ name: 'Canal Sur Andalucía', web: 'https://www.canalsurmas.es/', options: [{ format: 'm3u8', url: 'https://example.com/cs.m3u8' }] }] }
  ] }]
};

test('normalización de nombres y acentos', () => {
  assert.equal(normalize('Canal Sur Andalucía'), 'canal sur andalucia');
  assert.equal(normalize('À Punt'), 'a punt');
});

test('selecciona canales oficiales, incluida TV privada sin HLS, y descarta fuentes inseguras', () => {
  const parsed = parseCatalog(sample);
  assert.deepEqual(parsed.map(c => c.id), ['la-1', '24h', 'antena-3', 'telecinco', 'telemadrid', 'canal-sur']);
  assert.deepEqual(parsed[0].streams, ['https://example.com/la1.m3u8']);
  assert.match(parsed[0].embedUrl, /secure-embed\.rtve\.es/);
  assert.equal(parsed[0].preferEmbed, true);
  assert.equal(parsed[0].restricted, true);
  assert.equal(parsed[1].streams.length, 0);
  assert.match(parsed[2].embedUrl, /embed\/live\/antena3\//);
  assert.match(parsed[2].alternativeEmbedUrl, /embebido-directos\/antena3/);
  assert.equal(parsed[2].dynamicStream, true);
  assert.equal(parsed[2].preferEmbed, false);
  assert.equal(parsed[2].streams.length, 0);
  assert.equal(parsed[3].streams.length, 0);
  assert.equal(parsed[3].website, 'https://www.telecinco.es/endirecto/');
  assert.equal(parsed[3].dynamicStream, true);
  assert.equal(parsed[4].region, 'Madrid');
});

test('rechaza formatos de catálogo inesperados', () => {
  assert.throws(() => parseCatalog({}), /formato/i);
  assert.throws(() => parseCatalog({ countries: [{ name: 'France' }] }), /España/);
});

test('integra La Séptima como canal nacional con su ficha oficial y sin inventar HLS', () => {
  const fixture = structuredClone(sample);
  fixture.countries[0].ambits[0].channels.push({
    name: 'La Séptima', logo: 'https://pbs.twimg.com/profile_images/2074450480743297024/UTvLXCSQ_200x200.jpg',
    web: 'https://laseptima.com/la-septima-tv-directo/',
    options: [{ format: 'youtube', url: 'https://www.youtube.com/channel/example/live' }]
  });
  const channel = parseCatalog(fixture).find(item => item.id === 'la-septima');
  assert.equal(channel.name, 'La Séptima');
  assert.equal(channel.region, 'Nacional');
  assert.equal(channel.website, 'https://laseptima.com/la-septima-tv-directo/');
  assert.equal(channel.streams.length, 0);
});

test('mantiene la última versión correcta si falla la actualización', async () => {
  let time = 1000;
  let calls = 0;
  const larger = structuredClone(sample);
  larger.countries[0].ambits[0].channels.push({ name: 'La 2', options: [], web: 'https://rtve.es' });
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return { ok: true, json: async () => larger };
    throw Error('Red caída');
  };
  const service = createCatalogService({ fetchImpl, now: () => time, ttlMs: 1000 });
  const first = await service.get();
  assert.equal(first.channels.length, 7);
  time = 2001;
  const second = await service.get();
  assert.equal(second.channels.length, 7);
  assert.equal(second.stale, true);
  assert.equal(calls, 2);
  await service.get();
  assert.equal(calls, 2);
});
