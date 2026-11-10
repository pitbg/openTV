import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createEpgService, matchGuide, parseXmltv, xmltvTimestamp } from '../lib/epg.mjs';

const testTime = Date.parse('2026-11-10T19:30:00Z'); // 20:30 en Madrid
const vboxXml = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="www.Telecinco%20HD.co.un"><display-name>Telecinco HD</display-name></channel>
  <channel id="laSexta-HD"><display-name>laSexta HD</display-name></channel>
  <programme start="20261110200000 +0100" stop="20261110210000 +0100" channel="www.Telecinco%20HD.co.un">
    <title lang="es">Noticias &amp; actualidad</title><sub-title><![CDATA[Edición especial]]></sub-title>
  </programme>
  <programme start="20261110210000 +0100" stop="20261110220000 +0100" channel="www.Telecinco%20HD.co.un">
    <title>La noche</title>
  </programme>
  <programme start="20261110200000 +0100" stop="20261110210000 +0100" channel="laSexta-HD">
    <title>Programa de laSexta</title>
  </programme>
</tv>`;

const tdtXml = `<tv>
  <channel id="La1.TV"><display-name>La 1</display-name></channel>
  <channel id="Telecinco.TV"><display-name>Telecinco</display-name></channel>
  <programme start="20261110200000 +0100" stop="20261110210000 +0100" channel="La1.TV"><title>Telediario de La 1</title></programme>
  <programme start="20261110210000 +0100" stop="20261110220000 +0100" channel="La1.TV"><title>Programa siguiente</title></programme>
  <programme start="20261110200000 +0100" stop="20261110210000 +0100" channel="Telecinco.TV"><title>Alternativa online</title></programme>
</tv>`;

test('convierte horarios XMLTV con desfase UTC y decodifica los títulos', () => {
  assert.equal(xmltvTimestamp('20261110200000 +0100'), Date.parse('2026-11-10T19:00:00Z'));
  assert.equal(xmltvTimestamp('20261110200000 -0500'), Date.parse('2026-11-11T01:00:00Z'));
  assert.equal(xmltvTimestamp('fecha-inválida'), null);
  const guide = parseXmltv(vboxXml);
  assert.equal(guide.programmes.get('www.Telecinco%20HD.co.un')[0].title, 'Noticias & actualidad');
  assert.equal(guide.programmes.get('www.Telecinco%20HD.co.un')[0].subtitle, 'Edición especial');
  assert.throws(() => parseXmltv('no es XMLTV'), /formato XMLTV/);
});

test('combina EPG del VBox y TDTChannels, priorizando emisiones disponibles', () => {
  const channels = [
    { id: 'telecinco', name: 'Telecinco' },
    { id: 'la-1', name: 'La 1' },
    { id: 'la-sexta', name: 'laSexta' },
    { id: 'fdf', name: 'FDF' }
  ];
  const local = [
    { id: 'telecinco', name: 'Telecinco HD', epgId: 'www.Telecinco%20HD.co.un' },
    { id: 'la-sexta', name: 'laSexta HD', epgId: 'laSexta-HD' }
  ];
  const guide = matchGuide(channels, local, [
    { id: 'vbox', data: parseXmltv(vboxXml) },
    { id: 'tdtchannels', data: parseXmltv(tdtXml) }
  ], testTime);
  assert.equal(guide.telecinco.now.title, 'Noticias & actualidad');
  assert.equal(guide.telecinco.next.title, 'La noche');
  assert.equal(guide.telecinco.source, 'vbox');
  assert.equal(guide['la-1'].now.title, 'Telediario de La 1');
  assert.equal(guide['la-1'].source, 'tdtchannels');
  assert.equal(guide['la-sexta'].now.title, 'Programa de laSexta');
  assert.equal(guide.fdf, undefined);
});

test('descarga XMLTV y gzip una sola vez por TTL y conserva la EPG en caso de error', async () => {
  let clock = testTime;
  let calls = 0;
  let offline = false;
  const service = createEpgService({
    vboxPlaylistUrl: 'http://192.168.1.15:55555/vboxSimpleIptv.m3u8',
    externalUrl: 'https://www.tdtchannels.com/epg/TV.xml.gz',
    now: () => clock,
    vboxTtlMs: 1_000,
    externalTtlMs: 1_000,
    fetchImpl: async url => {
      calls++;
      if (offline) throw new Error('Sin conexión');
      return url.includes('vboxXmltv') ? new Response(vboxXml) : new Response(gzipSync(tdtXml));
    }
  });
  const channel = [{ id: 'la-1', name: 'La 1' }];
  const first = await service.get(channel, []);
  assert.equal(first.channels['la-1'].now.title, 'Telediario de La 1');
  assert.equal(first.sources.vbox.available, true);
  assert.equal(first.sources.tdtchannels.available, true);
  assert.equal(calls, 2);
  await service.get(channel, []);
  assert.equal(calls, 2);
  clock += 1_200;
  offline = true;
  const stale = await service.get(channel, []);
  assert.equal(calls, 4);
  assert.equal(stale.channels['la-1'].now.title, 'Telediario de La 1');
  assert.equal(stale.sources.tdtchannels.available, false);
  assert.equal(stale.sources.tdtchannels.cached, true);
});
