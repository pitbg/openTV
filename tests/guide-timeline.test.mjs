import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelineRange, timelineTicks, timelinePosition, timelinePrograms } from '../public/guide-timeline.js';

const time = Date.parse('2026-11-10T19:44:00Z');

test('alinea la cuadrícula EPG en medias horas con seis horas de horizonte', () => {
  const range = timelineRange(time);
  assert.equal(range.start, Date.parse('2026-11-10T19:00:00Z'));
  assert.equal(range.end, Date.parse('2026-11-11T01:00:00Z'));
  assert.equal(range.width, 1440);
  assert.equal(timelinePosition(range.start + 30 * 60_000, range), 120);
  assert.equal(timelineTicks(range).length, 13);
});

test('recorta bloques EPG al horizonte, elimina duplicados y conserva los horarios', () => {
  const range = timelineRange(time);
  const current = { title: 'Informativos', start: range.start - 30 * 60_000, stop: range.start + 60 * 60_000 };
  const next = { title: 'Película', start: current.stop, stop: current.stop + 90 * 60_000 };
  const guide = { now: current, next, upcoming: [next] };
  const blocks = timelinePrograms(guide, range);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].left, 0);
  assert.equal(blocks[0].width, 240);
  assert.equal(blocks[0].current, true);
  assert.equal(blocks[1].left, 240);
  assert.equal(blocks[1].width, 360);
});

test('no inventa programas en canales sin datos EPG', () => {
  assert.deepEqual(timelinePrograms(null, timelineRange(time)), []);
});
