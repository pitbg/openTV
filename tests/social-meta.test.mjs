import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSocialHtml, socialOrigin } from '../lib/social-meta.mjs';

test('usa la URL pública configurada por encima del dominio y del proxy', () => {
  assert.equal(socialOrigin({ host: 'localhost:3080', 'x-forwarded-proto': 'http' }, 'https://tv.ejemplo.es/ruta'), 'https://tv.ejemplo.es');
});

test('reconstruye el protocolo HTTPS cuando hay un proxy inverso', () => {
  assert.equal(socialOrigin({ host: 'tv.ejemplo.es', 'x-forwarded-proto': 'https, http' }), 'https://tv.ejemplo.es');
});

test('escapa dominios inválidos y solo admite URLs HTTP(S) explícitas', () => {
  assert.equal(socialOrigin({ host: 'ejemplo.es" onload="bad' }), 'http://localhost');
  assert.throws(() => socialOrigin({}, 'javascript:alert(1)'), TypeError);
  assert.throws(() => socialOrigin({}, 'https://usuario:clave@ejemplo.es'), TypeError);
});

test('produce enlaces absolutos para Open Graph y Twitter', () => {
  const template = '<link href="__OPENTV_PAGE_URL__"><meta content="__OPENTV_IMAGE_URL__"><meta content="__OPENTV_IMAGE_URL__">';
  const html = renderSocialHtml(template, { host: 'tv.ejemplo.es', 'x-forwarded-proto': 'https' });
  assert.equal(html, '<link href="https://tv.ejemplo.es/"><meta content="https://tv.ejemplo.es/social-preview.png"><meta content="https://tv.ejemplo.es/social-preview.png">');
});
