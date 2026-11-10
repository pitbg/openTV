// La TDT complementa el catálogo online: no desplaza una señal oficial válida.
export function hasOnlineSource(channel) {
  return Boolean(channel && (channel.dynamicStream || channel.dynamicEmbed || channel.embedUrl || channel.streams?.length));
}

export function defaultSource(channel) {
  return hasOnlineSource(channel) ? 'online' : channel?.localStream ? 'local' : 'web';
}

export function canFallbackToLocal(channel, selectedSource) {
  return Boolean(channel?.localStream && selectedSource === 'online');
}
