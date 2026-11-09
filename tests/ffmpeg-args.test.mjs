import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vboxFfmpegArgs } from '../lib/ffmpeg-args.mjs';

test('el modo de reproducción habitual conserva el vídeo original', () => {
  const args = vboxFfmpegArgs();
  assert.deepEqual(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2), ['-c:v', 'copy']);
  assert.ok(!args.includes('-vaapi_device'));
});

test('el modo de compatibilidad CPU sigue usando H.264 Baseline progresivo', () => {
  const args = vboxFfmpegArgs({ transcodeVideo: true });
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(args[args.indexOf('-profile:v') + 1], 'baseline');
  assert.ok(args.includes('-vf'));
  assert.ok(!args.includes('-vaapi_device'));
});

test('Intel UHD 630 utiliza VA-API en modo de codificación de bajo consumo', () => {
  const args = vboxFfmpegArgs({ transcodeVideo: true, encoder: 'vaapi', vaapiDevice: '/dev/dri/renderD128' });
  assert.equal(args[args.indexOf('-vaapi_device') + 1], '/dev/dri/renderD128');
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_vaapi');
  assert.equal(args[args.indexOf('-low_power') + 1], '1');
  assert.equal(args[args.indexOf('-profile:v') + 1], 'constrained_baseline');
  assert.ok(args[args.indexOf('-vf') + 1].includes('format=nv12,hwupload'));
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
});

test('i965 puede decodificar, desentrelazar, escalar y codificar H.264 sin pasar fotogramas por CPU', () => {
  const args = vboxFfmpegArgs({ transcodeVideo: true, encoder: 'vaapi-full' });
  assert.equal(args[args.indexOf('-hwaccel') + 1], 'vaapi');
  assert.equal(args[args.indexOf('-hwaccel_output_format') + 1], 'vaapi');
  assert.ok(args.indexOf('-hwaccel') < args.indexOf('-i'));
  assert.ok(args[args.indexOf('-vf') + 1].includes('deinterlace_vaapi=mode=bob:rate=frame:auto=1'));
  assert.ok(args[args.indexOf('-vf') + 1].includes('scale_vaapi=w=1280:h=720:force_original_aspect_ratio=decrease'));
  assert.ok(!args[args.indexOf('-vf') + 1].includes('hwupload'));
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_vaapi');
  assert.equal(args[args.indexOf('-low_power') + 1], '1');
});
