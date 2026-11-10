import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canFallbackToLocal, defaultSource, hasOnlineSource } from '../public/source-policy.js';

test('prioriza la señal online sobre el VBox cuando ambas existen', () => {
  for (const channel of [
    { streams: ['https://example.com/stream.m3u8'], localStream: true },
    { dynamicStream: true, streams: [], localStream: true },
    { embedUrl: 'https://example.com/embed', streams: [], localStream: true }
  ]) {
    assert.equal(hasOnlineSource(channel), true);
    assert.equal(defaultSource(channel), 'online');
    assert.equal(canFallbackToLocal(channel, 'online'), true);
    assert.equal(canFallbackToLocal(channel, 'local'), false);
  }
});

test('mantiene la señal VBox por defecto cuando no hay alternativa online', () => {
  const channel = { streams: [], localStream: true };
  assert.equal(hasOnlineSource(channel), false);
  assert.equal(defaultSource(channel), 'local');
  assert.equal(canFallbackToLocal(channel, 'local'), false);
});

test('no intenta un respaldo local sin VBox', () => {
  assert.equal(defaultSource({ streams: [], dynamicStream: false }), 'web');
  assert.equal(canFallbackToLocal({ streams: ['https://example.com/live.m3u8'] }, 'online'), false);
});
