// El dispositivo VA-API es una opción de despliegue local, nunca una URL del usuario.
export function vboxFfmpegArgs({ transcodeVideo = false, encoder = 'cpu', vaapiDevice = '/dev/dri/renderD128' } = {}) {
  const useFullVaapi = transcodeVideo && encoder === 'vaapi-full';
  const useVaapi = transcodeVideo && (encoder === 'vaapi' || useFullVaapi);
  const filter = 'yadif=mode=send_frame:parity=auto:deint=interlaced,scale=1280:720:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1';
  const videoArgs = !transcodeVideo ? ['-c:v', 'copy'] : useVaapi ? [
    '-vf', useFullVaapi
      ? 'deinterlace_vaapi=mode=bob:rate=frame:auto=1,scale_vaapi=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2:format=nv12'
      : `${filter},format=nv12,hwupload`,
    '-c:v', 'h264_vaapi', '-low_power', '1',
    '-profile:v', 'constrained_baseline', '-qp', '23', '-bf', '0', '-g', '50'
  ] : [
    '-vf', filter,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p', '-profile:v', 'baseline',
    '-crf', '23', '-maxrate', '3500k', '-bufsize', '7000k',
    '-g', '50', '-keyint_min', '50', '-sc_threshold', '0'
  ];
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    ...(useVaapi ? ['-vaapi_device', vaapiDevice] : []),
    '-probesize', '5000000', '-analyzeduration', '5000000',
    ...(useFullVaapi ? ['-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi'] : []),
    '-f', 'mpegts', '-i', 'pipe:0',
    '-map', '0:v:0?', '-map', '0:a:0?',
    ...videoArgs, '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-sn', '-dn', '-f', 'mpegts', '-muxdelay', '0', 'pipe:1'
  ];
}
