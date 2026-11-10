// La TDT HD puede llegar en H.264 entrelazado (1080i). En iOS conviene
// entregar H.264 progresivo desde el inicio para evitar fallos del decodificador.
export function prefersProgressiveTdt(navigatorInfo = {}) {
  const agent = navigatorInfo.userAgent || '';
  return /iPhone|iPad|iPod/i.test(agent) ||
    (/Macintosh/i.test(agent) && navigatorInfo.maxTouchPoints > 1);
}

// Un fallo de MSE o del decodificador puede resolverse reabriendo el mismo
// canal con vídeo progresivo. No reintentar cuando ya se está transcodificando.
export function shouldRetryProgressiveTdt(convertVideo, type, detail) {
  return !convertVideo && (type === 'MediaError' || detail === 'MediaMSEError');
}
