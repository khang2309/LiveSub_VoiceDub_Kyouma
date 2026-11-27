export function isVieNeuVoice(voice = '') {
  return String(voice).toLowerCase().startsWith('vieneu');
}

export function isVieNeuPcmResponse(response) {
  return (response?.headers?.get('x-audio-format') || '').toLowerCase() === 'pcm_s16le';
}

export function getVieNeuPcmMetadata(response) {
  return {
    sampleRate: parseInt(response?.headers?.get('x-audio-sample-rate') || '48000', 10),
    channels: parseInt(response?.headers?.get('x-audio-channels') || '1', 10),
    serverRateCap: parseFloat(response?.headers?.get('x-safe-playback-rate') || '2.0')
  };
}
