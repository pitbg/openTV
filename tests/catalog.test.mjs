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
      { name: 'Telecinco', web: 'https://private.example', options: [{ format: 'm3u8', url: 'https://private.example/tv.m3u8' }] }
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

test('selecciona solo emisoras públicas y opciones HLS HTTPS sin duplicados', () => {
  const parsed = parseCatalog(sample);
  assert.deepEqual(parsed.map(c => c.id), ['la-1', '24h', 'telemadrid', 'canal-sur']);
  assert.deepEqual(parsed[0].streams, ['https://example.com/la1.m3u8']);
  assert.equal(parsed[0].restricted, true);
  assert.equal(parsed[1].streams.length, 0);
  assert.equal(parsed[2].region, 'Madrid');
});

test('rechaza formatos de catálogo inesperados', () => {
  assert.throws(() => parseCatalog({}), /formato/i);
  assert.throws(() => parseCatalog({ countries: [{ name: 'France' }] }), /España/);
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
  assert.equal(first.channels.length, 5);
  time = 2001;
  const second = await service.get();
  assert.equal(second.channels.length, 5);
  assert.equal(second.stale, true);
  assert.equal(calls, 2);
  await service.get();
  assert.equal(calls, 2);
});
