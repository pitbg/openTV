import assert from 'node:assert/strict';
import test from 'node:test';
import { prefersProgressiveTdt, shouldRetryProgressiveTdt } from '../public/local-playback-policy.js';

test('iPhone, iPad y iPadOS solicitan vídeo progresivo desde el inicio', () => {
  assert.equal(prefersProgressiveTdt({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X)' }), true);
  assert.equal(prefersProgressiveTdt({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 26_6 like Mac OS X)' }), true);
  assert.equal(prefersProgressiveTdt({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 5 }), true);
});

test('escritorio mantiene la señal original si puede decodificarla', () => {
  assert.equal(prefersProgressiveTdt({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 0 }), false);
  assert.equal(prefersProgressiveTdt({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/158.0' }), false);
});

test('se reintenta con vídeo progresivo tras un error de decodificación, sin bucles', () => {
  assert.equal(shouldRetryProgressiveTdt(false, 'MediaError', 'MediaMSEError'), true);
  assert.equal(shouldRetryProgressiveTdt(false, 'MediaError', 'MediaCodecUnsupported'), true);
  assert.equal(shouldRetryProgressiveTdt(true, 'MediaError', 'MediaMSEError'), false);
  assert.equal(shouldRetryProgressiveTdt(false, 'NetworkError', 'NetworkUnreachable'), false);
});
