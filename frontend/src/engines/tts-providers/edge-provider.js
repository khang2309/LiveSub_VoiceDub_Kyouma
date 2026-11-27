export function isEdgeVoice(voice = '') {
  const normalized = String(voice).toLowerCase();
  return normalized.startsWith('edge') || normalized.startsWith('ms:');
}

export function isStreamingEdgeResponse(response) {
  const format = (response?.headers?.get('x-audio-format') || '').toLowerCase();
  const streaming = response?.headers?.get('x-tts-streaming') === '1';
  return format === 'mp3' && streaming;
}

export function canUseEdgeMediaSource() {
  return typeof window !== 'undefined'
    && typeof window.MediaSource !== 'undefined'
    && window.MediaSource.isTypeSupported('audio/mpeg');
}

function once(target, eventName) {
  return new Promise((resolve, reject) => {
    const onEvent = (event) => {
      cleanup();
      resolve(event);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Edge MediaSource ${eventName} failed`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

async function appendChunk(sourceBuffer, chunk) {
  if (!chunk || chunk.byteLength === 0) return;
  const updated = once(sourceBuffer, 'updateend');
  sourceBuffer.appendBuffer(chunk);
  await updated;
}

export async function playEdgeMp3Stream(studio, response, {
  waitForEnd = true,
  onStart = null,
  playbackRate = 1,
  signal = null
} = {}) {
  if (!response?.body || !canUseEdgeMediaSource()) return false;

  const mediaSource = new window.MediaSource();
  const audio = document.createElement('audio');
  const objectUrl = URL.createObjectURL(mediaSource);
  const targetVolume = (parseInt(studio.volumeRange?.value || '100', 10) || 100) / 100;
  audio.preload = 'auto';
  audio.src = objectUrl;
  audio.volume = Math.max(0, Math.min(1, targetVolume));
  audio.playbackRate = playbackRate;
  studio.currentEdgeStreamAudio = audio;
  studio.currentEdgeStreamUrl = objectUrl;

  let started = false;
  let aborted = false;
  const abort = () => {
    aborted = true;
    try { audio.pause(); } catch (_) {}
  };
  if (signal) signal.addEventListener('abort', abort, { once: true });

  const cleanup = () => {
    if (signal) signal.removeEventListener('abort', abort);
    if (studio.currentEdgeStreamAudio === audio) studio.currentEdgeStreamAudio = null;
    if (studio.currentEdgeStreamUrl === objectUrl) studio.currentEdgeStreamUrl = null;
    try { URL.revokeObjectURL(objectUrl); } catch (_) {}
  };

  const startPlayback = async () => {
    if (started || aborted) return;
    started = true;
    studio.lastDubbingStartedAt = performance.now();
    await audio.play();
    if (typeof onStart === 'function') onStart();
    if (typeof studio.releaseYouTubeDubbingHold === 'function') {
      studio.releaseYouTubeDubbingHold();
    }
  };

  try {
    await once(mediaSource, 'sourceopen');
    if (aborted) throw new DOMException('Aborted', 'AbortError');
    const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
    try { sourceBuffer.mode = 'sequence'; } catch (_) {}
    const reader = response.body.getReader();

    while (true) {
      const { value, done } = await reader.read();
      if (aborted) {
        await reader.cancel().catch(() => {});
        throw new DOMException('Aborted', 'AbortError');
      }
      if (value?.byteLength) {
        // Copy because fetch is allowed to reuse the underlying stream buffer.
        await appendChunk(sourceBuffer, value.slice().buffer);
        if (!started && audio.buffered.length > 0) {
          const bufferedSeconds = audio.buffered.end(audio.buffered.length - 1) - audio.buffered.start(0);
          if (bufferedSeconds >= 0.10) await startPlayback();
        }
      }
      if (done) break;
    }

    if (mediaSource.readyState === 'open' && !sourceBuffer.updating) {
      mediaSource.endOfStream();
    }
    if (!started) await startPlayback();
    if (waitForEnd && !audio.ended) await once(audio, 'ended');
    return true;
  } finally {
    cleanup();
  }
}
