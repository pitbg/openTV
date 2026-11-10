import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createEpgService, matchGuide, parseAtresmediaHtml, parseXmltv, xmltvTimestamp } from '../lib/epg.mjs';

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

const supplementalXml = `<tv>
  <channel id="Atreseries.es"><display-name>Atreseries</display-name></channel>
  <channel id="El.Toro.TV.es"><display-name>El Toro TV</display-name></channel>
  <channel id="Aragón.Televisión.es"><display-name>Aragón Televisión</display-name></channel>
  <channel id="TelevisiónCanaria.es"><display-name>Televisión Canaria</display-name></channel>
  <programme channel="Atreseries.es" start="20261110200000 +0100" stop="20261110210000 +0100"><title>Serie de Atreseries</title></programme>
  <programme channel="El.Toro.TV.es" start="20261110200000 +0100" stop="20261110210000 +0100"><title>Debate de El Toro</title></programme>
  <programme channel="Aragón.Televisión.es" start="20261110200000 +0100" stop="20261110210000 +0100"><title>Aragón Noticias</title></programme>
  <programme channel="TelevisiónCanaria.es" start="20261110200000 +0100" stop="20261110210000 +0100"><title>Noticias de Canarias</title></programme>
</tv>`;

const correctedTdtXml = `<tv>
  <channel id="C33.TV"><display-name>33 Catalunya</display-name></channel>
  <channel id="CanalSurA.TV"><display-name>Canal Sur A</display-name></channel>
  <channel id="Dejate.TV"><display-name>Déjate de Historias TV</display-name></channel>
  <channel id="13.TV"><display-name>Canal 13</display-name></channel>
  <programme channel="C33.TV" start="20261110200000 +0100" stop="20261110210000 +0100"><title>Documental del 33</title></programme>
  <programme channel="CanalSurA.TV" start="20261110200000 +0100" stop="20261110210000 +0100"><title>Andalucía Directo</title></programme>
  <programme channel="Dejate.TV" start="20261110200000 +0100" stop="20261110210000 +0100"><title>Programa local</title></programme>
  <programme channel="13.TV" start="20261110200000 +0100" stop="20261110210000 +0100"><title>Informativo TRECE</title></programme>
</tv>`;

const atresmediaHtml = `<!doctype html><html><body>
<div class="programacion-cadena principal a3series today"><ul class="programacion-listado">
  <li class="programacion-item hr-60" data-start="1794333600000" data-end="1794337200000"><div class="item-wrapper"><h2 class="item-title">Bright minds</h2><p class="item-description">Un caso nuevo</p></div></li>
  <li class="programacion-item hr-60" data-start="1794337200000" data-end="1794340800000"><div class="item-wrapper"><h2 class="item-title">Los misterios de Murdoch</h2></div></li>
</ul></div>
<div class="programacion-cadena neox today"><ul class="programacion-listado">
  <li class="programacion-item" data-start="1794333600000" data-end="1794337200000"><h2 class="item-title">Los Simpson</h2></li>
</ul></div>
<div class="programacion-cadena principal a3series tomorrow"><ul class="programacion-listado">
  <li class="programacion-item" data-start="1794420000000" data-end="1794423600000"><h2 class="item-title">Una serie de mañana</h2></li>
</ul></div>
<div class="programacion-cadena principal a3series aftertomorrow"><ul class="programacion-listado">
  <li class="programacion-item" data-start="no-es-numero" data-end="1794423600000"><h2 class="item-title">Dato inválido</h2></li>
</ul></div>
</body></html>`;

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

test('corrige IDs reales de TDTChannels y reutiliza la guía accesible de Canal Sur', () => {
  const channels = [
    { id: '33', name: '33' },
    { id: 'canal-sur', name: 'Canal Sur Andalucía' },
    { id: 'canal-sur-2', name: 'Canal Sur 2 Accesible' },
    { id: 'dejate-tv', name: 'Déjate TV' },
    { id: 'trece', name: 'TRECE' }
  ];
  const guide = matchGuide(channels, [], [{ id: 'tdtchannels', data: parseXmltv(correctedTdtXml) }], testTime);
  assert.equal(guide['33'].now.title, 'Documental del 33');
  assert.equal(guide['canal-sur'].now.title, 'Andalucía Directo');
  assert.equal(guide['canal-sur-2'].now.title, 'Andalucía Directo');
  assert.equal(guide['dejate-tv'].now.title, 'Programa local');
  assert.equal(guide.trece.now.title, 'Informativo TRECE');
});

test('extrae exclusivamente la parrilla española de Atresmedia con horarios exactos', () => {
  const data = parseAtresmediaHtml(atresmediaHtml);
  assert.equal(data.programmes.get('atreseries').length, 3);
  assert.equal(data.programmes.get('atreseries')[0].title, 'Bright minds');
  assert.equal(data.programmes.get('atreseries')[0].subtitle, 'Un caso nuevo');
  assert.equal(data.programmes.get('neox')[0].title, 'Los Simpson');
  assert.equal(data.programmes.has('antena-3'), false);
  assert.throws(() => parseAtresmediaHtml('<div class="programacion-cadena a3series"></div>'), /No se encontró/);
});

test('Atresmedia completa Atreseries sin sustituir una EPG prioritaria válida', async () => {
  const service = createEpgService({
    now: () => 1794335400000, // Dentro de Bright minds.
    externalUrl: null, epgshareUrl: null,
    fetchImpl: async () => new Response(atresmediaHtml)
  });
  const first = await service.get([{ id: 'atreseries', name: 'atreseries' }], []);
  assert.equal(first.sources.atresmedia.available, true);
  assert.equal(first.channels.atreseries.now.title, 'Bright minds');
  assert.equal(first.channels.atreseries.next.title, 'Los misterios de Murdoch');
  assert.equal(first.channels.atreseries.source, 'atresmedia');
  const priority = matchGuide([{ id: 'neox', name: 'Neox' }], [], [
    { id: 'vbox', data: parseXmltv('<tv><channel id="Neox"><display-name>Neox</display-name></channel><programme channel="Neox" start="20261110190000 +0100" stop="20261110230000 +0100"><title>Guía local</title></programme></tv>') },
    { id: 'atresmedia', data: parseAtresmediaHtml(atresmediaHtml) }
  ], Date.parse('2026-11-10T19:30:00Z'));
  assert.equal(priority.neox.now.title, 'Guía local');
});

test('EPGSHARE01 completa las cadenas que no cubren VBox ni TDTChannels', async () => {
  let requests = 0;
  const service = createEpgService({
    vboxPlaylistUrl: null, now: () => testTime, atresmediaUrl: null,
    externalUrl: 'https://www.tdtchannels.com/epg/TV.xml.gz',
    epgshareUrl: 'https://epgshare01.online/epgshare01/epg_ripper_ES1.xml.gz',
    fetchImpl: async url => {
      requests++;
      return new Response(gzipSync(url.includes('epgshare01') ? supplementalXml : tdtXml));
    }
  });
  const channels = [
    { id: 'la-1', name: 'La 1' },
    { id: 'atreseries', name: 'atreseries' },
    { id: 'el-toro-tv', name: 'El Toro TV' },
    { id: 'aragon-tv', name: 'Aragón TV' },
    { id: 'tv-canaria', name: 'Televisión Canaria' },
    { id: 'hit-tv', name: 'HIT TV' }
  ];
  const first = await service.get(channels, []);
  assert.equal(first.sources.epgshare.available, true);
  assert.equal(first.channels['la-1'].source, 'tdtchannels');
  assert.equal(first.channels.atreseries.now.title, 'Serie de Atreseries');
  assert.equal(first.channels['el-toro-tv'].now.title, 'Debate de El Toro');
  assert.equal(first.channels['aragon-tv'].now.title, 'Aragón Noticias');
  assert.equal(first.channels['tv-canaria'].now.title, 'Noticias de Canarias');
  assert.equal(first.channels['hit-tv'], undefined); // No inventar la programación local.
  await service.get(channels, []);
  assert.equal(requests, 2);
});

test('descarga XMLTV y gzip una sola vez por TTL y conserva la EPG en caso de error', async () => {
  let clock = testTime;
  let calls = 0;
  let offline = false;
  const service = createEpgService({
    vboxPlaylistUrl: 'http://192.168.1.15:55555/vboxSimpleIptv.m3u8',
    externalUrl: 'https://www.tdtchannels.com/epg/TV.xml.gz', atresmediaUrl: null,
    epgshareUrl: null,
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
