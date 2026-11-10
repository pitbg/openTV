import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLaSeptimaEmbedService, LaSeptimaEmbedError, laSeptimaYoutubeId } from '../lib/la-septima.mjs';

const videoMarkup = id => `<html><div data-id="6f2fff4" data-e-type="e-youtube"
 data-settings="&#x7B;&quot;source&quot;&#x3A;&quot;https&#x3A;&#x5C;&#x2F;&#x5C;&#x2F;www.youtube.com&#x5C;&#x2F;watch&#x3F;v&#x3D;${id}&quot;&#x7D;"></div></html>`;

test('obtiene el ID del directo desde la web oficial, incluso con entidades HTML escapadas', () => {
  assert.equal(laSeptimaYoutubeId(videoMarkup('ErraEILevPE')), 'ErraEILevPE');
  assert.throws(() => laSeptimaYoutubeId('<html><h2>Directo sin vídeo</h2></html>'), LaSeptimaEmbedError);
  assert.throws(() => laSeptimaYoutubeId(videoMarkup('too-short')), LaSeptimaEmbedError);
  assert.throws(() => laSeptimaYoutubeId(`<div data-e-type="e-youtube" data-settings="{&quot;source&quot;:&quot;https://otro-dominio.test/watch?v=ErraEILevPE&quot;}"></div>`), LaSeptimaEmbedError);
});

test('resuelve el reproductor de YouTube con caché y actualiza el ID si cambia el directo', async () => {
  let clock = 1000;
  let calls = 0;
  let videoId = 'ErraEILevPE';
  const service = createLaSeptimaEmbedService({
    now: () => clock, ttlMs: 1000,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://laseptima.com/la-septima-tv-directo/');
      assert.equal(options.redirect, 'error');
      return new Response(videoMarkup(videoId));
    }
  });
  assert.deepEqual(await service.resolve(), { embedUrl: 'https://www.youtube.com/embed/ErraEILevPE?autoplay=1&playsinline=1&rel=0' });
  await service.resolve();
  assert.equal(calls, 1);
  clock += 1001;
  videoId = 'ABCdef012_-';
  const updated = await service.resolve();
  assert.match(updated.embedUrl, /\/embed\/ABCdef012_-/);
  assert.equal(calls, 2);
});

test('si falla temporalmente la web conserva el último vídeo y si nunca funcionó informa del error', async () => {
  let fail = false;
  let clock = 1000;
  const service = createLaSeptimaEmbedService({
    now: () => clock, ttlMs: 100,
    fetchImpl: async () => {
      if (fail) throw new Error('Web fuera de servicio');
      return new Response(videoMarkup('ErraEILevPE'));
    }
  });
  await service.resolve();
  clock = 1101;
  fail = true;
  assert.match((await service.resolve()).embedUrl, /ErraEILevPE/);
  const empty = createLaSeptimaEmbedService({ fetchImpl: async () => new Response('Error', { status: 503 }) });
  await assert.rejects(empty.resolve(), LaSeptimaEmbedError);
});
