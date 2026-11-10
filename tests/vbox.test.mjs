import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VBoxError, createVBoxService, mergeVBoxChannels, parseVBoxPlaylist, vboxPlaylistUrl } from '../lib/vbox.mjs';

const playlistUrl = 'http://192.168.1.15:55555/vboxSimpleIptv.m3u8';
const sample = `#EXTM3U
#EXTINF:-1 tvg-id="telecinco" tvg-logo="http://192.168.1.15:55555/images/t5.jpg",Telecinco SD
http://192.168.1.15:55555/Telecinco%20SD
#EXTINF:-1 tvg-name="Telecinco HD",Telecinco HD
http://192.168.1.15:55555/Telecinco%20HD
#EXTINF:-1,La 1 HD
http://192.168.1.15:55555/La%201%20HD
#EXTINF:-1,Radio Nuevo
http://192.168.1.15:55555/Radio%20Nuevo
#EXTINF:-1,Malicioso
http://not-the-vbox.local/stream
`;

test('acepta solo las listas M3U del VBox configurado', () => {
  assert.equal(vboxPlaylistUrl('http://192.168.1.15:55555').href, playlistUrl);
  assert.equal(vboxPlaylistUrl(playlistUrl).href, playlistUrl);
  assert.throws(() => vboxPlaylistUrl('https://example.org/foo.m3u8'), VBoxError);
  assert.throws(() => vboxPlaylistUrl('http://test:test@192.168.1.15:55555/ChannelList.m3u8'), VBoxError);
});

test('interpreta playlist VBox, unifica HD/SD y no admite streams ajenos', () => {
  const parsed = parseVBoxPlaylist(sample, playlistUrl);
  assert.deepEqual(parsed.map(c => c.id), ['telecinco', 'la-1', 'vbox-radio-nuevo']);
  assert.equal(parsed[0].name, 'Telecinco HD');
  assert.equal(parsed[0].url, 'http://192.168.1.15:55555/Telecinco%20HD');
  assert.throws(() => parseVBoxPlaylist('No soy un M3U', playlistUrl), VBoxError);
});

test('añade señales locales sin modificar el catálogo original', () => {
  const original = [{ id: 'telecinco', name: 'Telecinco', streams: [], website: 'https://telecinco.es' }];
  const parsed = parseVBoxPlaylist(sample, playlistUrl);
  const merged = mergeVBoxChannels(original, parsed);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].localStream, true);
  assert.equal(merged[0].localStreamUrl, '/api/vbox/stream/telecinco');
  assert.equal(original[0].localStream, undefined);
  assert.equal(merged[2].region, 'TDT local');
  assert.equal(merged[2].website, null);
});

test('reconoce variantes VBox de Antena 3 y Teledeporte sin duplicar las fichas online', () => {
  const playlist = `${sample}#EXTINF:-1,antena3 HD
http://192.168.1.15:55555/antena3%20HD
#EXTINF:-1,tdp HD
http://192.168.1.15:55555/tdp%20HD
`;
  const parsed = parseVBoxPlaylist(playlist, playlistUrl);
  assert.ok(parsed.some(channel => channel.id === 'antena-3'));
  assert.ok(parsed.some(channel => channel.id === 'teledeporte'));
  const catalog = [
    { id: 'antena-3', name: 'Antena 3', dynamicStream: true, streams: [] },
    { id: 'teledeporte', name: 'Teledeporte', streams: ['https://example.com/teledeporte.m3u8'] }
  ];
  const merged = mergeVBoxChannels(catalog, parsed);
  assert.equal(merged.filter(channel => channel.id === 'antena-3').length, 1);
  assert.equal(merged.filter(channel => channel.id === 'teledeporte').length, 1);
  assert.equal(merged.find(channel => channel.id === 'antena-3').localStream, true);
  assert.equal(merged.find(channel => channel.id === 'teledeporte').streams.length, 1);
});

test('clasifica los canales generalistas del VBox en el ámbito nacional y conserva las emisoras locales', () => {
  const playlist = `#EXTM3U
#EXTINF:-1 tvg-id="www.laSexta%20HD.co.un",laSexta HD
http://192.168.1.15:55555/laSexta%20HD
#EXTINF:-1,Cuatro HD
http://192.168.1.15:55555/Cuatro%20HD
#EXTINF:-1,FDF
http://192.168.1.15:55555/FDF
#EXTINF:-1,Dejate TV
http://192.168.1.15:55555/Dejate%20TV
`;
  const parsed = parseVBoxPlaylist(playlist, playlistUrl);
  assert.deepEqual(parsed.map(channel => channel.id), ['la-sexta', 'cuatro', 'fdf', 'dejate-tv']);
  assert.equal(parsed[0].epgId, 'www.laSexta%20HD.co.un');
  const merged = mergeVBoxChannels([{ id: 'la-1', name: 'La 1', region: 'Nacional', streams: [] }], parsed);
  assert.deepEqual(merged.slice(0, 4).map(channel => channel.region), ['Nacional', 'Nacional', 'Nacional', 'Nacional']);
  assert.equal(merged.find(channel => channel.id === 'la-sexta').name, 'laSexta');
  assert.equal(merged.find(channel => channel.id === 'cuatro').broadcaster, 'Mediaset');
  assert.equal(merged.find(channel => channel.id === 'dejate-tv').region, 'Madrid');
});

test('recarga la lista con caché y conserva la última copia si falla el VBox', async () => {
  let time = 100;
  let calls = 0;
  const service = createVBoxService({
    playlistUrl,
    now: () => time,
    ttlMs: 1000,
    fetchImpl: async () => {
      calls++;
      if (calls > 1) throw Error('VBox temporalmente desconectado');
      return { ok: true, text: async () => sample, headers: new Headers() };
    }
  });
  const first = await service.get();
  assert.equal(first.channels.length, 3);
  assert.equal(first.online, true);
  assert.equal(await service.getStreamUrl('telecinco'), 'http://192.168.1.15:55555/Telecinco%20HD');
  assert.equal(calls, 1);
  time = 1101;
  const stale = await service.get();
  assert.equal(stale.online, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.channels.length, 3);
  assert.equal(calls, 2);
  await assert.rejects(service.getStreamUrl('unlisted'), VBoxError);
});

test('no consulta el VBox si no se ha configurado', async () => {
  const service = createVBoxService();
  assert.deepEqual(await service.get(), { enabled: false, online: false, channels: [], stale: false });
});
