import {
  canUseEdgeMediaSource,
  isEdgeVoice,
  isStreamingEdgeResponse,
  playEdgeMp3Stream
} from './tts-providers/edge-provider.js';
import {
  isVieNeuVoice
} from './tts-providers/vieneu-provider.js';

// LiveSub Component: tts-player
export default {
  sanitizeDubbingText(text) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';

    // Musical-note captions are lyrics/music rather than spoken dialogue.
    if (/[\u266a\u266b\u2669\u266c\uD83C\uDFB5\uD83C\uDFB6♪♫♬♩]/u.test(raw)) return '';

    // Remove known non-speech caption cues. If a cue is embedded in a real
    // sentence, keep and speak the dialogue around it; a cue-only line becomes
    // empty and is never submitted to TTS.
    const cuePattern = /\s*[\[(]\s*(?:âm\s*nhạc|nhạc(?:\s*nền)?|music|applause|tiếng\s*vỗ\s*tay|vỗ\s*tay|cheering|reo\s*hò|laughter|tiếng\s*cười|cười|sound\s*track|soundtrack|ost|bgm|instrumental)\s*[\])]\s*/giu;
    return raw
      .replace(cuePattern, ' ')
      .replace(/[~～]+/gu, ' ')
      .replace(/\s+([.,!?;:])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  },

  ensureAudioUnlocked() {
    try {
      if (typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
    } catch (_) {}
  },

  getSafePlaybackRate(extra = 0, originalDuration = 0, textLength = 0) {
    const selected = parseFloat(this.rateRange && this.rateRange.value) || 1.15;
    if (!this.isAdaptiveSpeedEnabled) {
      return Math.min(2.0, Math.max(0.5, selected + extra));
    }
    let rate = Math.min(1.50, Math.max(0.8, selected + extra));
    if (textLength > 0) {
      const estimatedSyllables = Math.max(1, textLength / 3.8);
      const estimatedSpeechSeconds = estimatedSyllables * 0.21;
      const targetDuration = originalDuration > 0 ? originalDuration : Math.min(2.5, Math.max(1.2, textLength * 0.045));
      if (estimatedSpeechSeconds > targetDuration) {
        const fitRate = estimatedSpeechSeconds / targetDuration;
        rate = Math.min(2.0, Math.max(rate, fitRate));
      }
    }
    return rate;
  },

  getSafeStreamingPlaybackRate(queueDepth = 0, serverCap = 2.0, originalDuration = 0, textLength = 0, queueLagMs = 0) {
    const manualRate = parseFloat(this.rateRange && this.rateRange.value) || 1.15;
    const safeCap = (serverCap && serverCap >= 1.5) ? serverCap : 2.0;
    if (!this.isAdaptiveSpeedEnabled) {
      return Math.min(safeCap, Math.max(0.5, manualRate));
    }
    let rate = manualRate;
    // Cap adaptive overdrive to keep natural voice prosody (prevents VieNeu from
    // accelerating to 1.7x-2.0x chipmunk speed simply due to local synthesis time).
    const adaptiveCap = Math.min(safeCap, Math.max(manualRate, 1.65));

    if (queueLagMs > 3000 || queueDepth >= 4) {
      rate = Math.max(rate, Math.min(adaptiveCap, 1.62));
    } else if (queueLagMs > 2000 || queueDepth >= 3) {
      rate = Math.max(rate, Math.min(adaptiveCap, 1.48));
    } else if (queueLagMs > 1000 || queueDepth >= 2) {
      rate = Math.max(rate, Math.min(adaptiveCap, 1.32));
    } else if (queueLagMs > 550) {
      rate = Math.max(rate, Math.min(adaptiveCap, 1.20));
    }

    // Adaptive Speech Pacing: fit dialogue length gently without rushing
    if (textLength > 0) {
      const estimatedSyllables = Math.max(1, textLength / 3.8);
      const estimatedSpeechSeconds = estimatedSyllables * 0.22;
      const targetDuration = originalDuration > 0
        ? originalDuration
        : Math.max(1.2, textLength * 0.052);
      if (targetDuration > 0 && estimatedSpeechSeconds > targetDuration) {
        const fitRate = estimatedSpeechSeconds / targetDuration;
        rate = Math.max(rate, Math.min(adaptiveCap, fitRate));
      }
    }

    return Math.min(safeCap, Math.max(0.8, rate));
  },

  getVoiceProfile(voiceName = null) {
    const rawVoice = voiceName || (this.voiceSelect ? this.voiceSelect.value : 'vieneu:Trúc Ly');
    const v = String(rawVoice).toLowerCase();

    // Genuine Edge Neural AI Voices (Microsoft Studio - Native Human Vocals, No Pitch Shift Needed)
    if (v.includes('namminh') || v === 'vi-vn-namminhneural') {
      return {
        id: 'namminh',
        pitchFactor: 1.0,
        eq: null,
        highCut: null
      };
    }
    if (v.includes('hoaimy') || v === 'vi-vn-hoaimyneural') {
      return {
        id: 'hoaimy',
        pitchFactor: 1.0,
        eq: null,
        highCut: null
      };
    }

    // Thái Sơn: Deep masculine Southern baritone voice
    if (v.includes('thái sơn') || v.includes('thaison')) {
      return {
        id: 'thaison',
        pitchFactor: 1.0,
        eq: null,
        highCut: null
      };
    }
    // Thiện Minh: Warm masculine Northern narrator voice
    if (v.includes('thiện minh') || v.includes('thienminh') || v.includes('adam')) {
      return {
        id: 'thienminh',
        pitchFactor: 1.0,
        eq: null,
        highCut: null
      };
    }
    // Thùy Dung: Sweet, melodic Southern female voice
    if (v.includes('thùy dung') || v.includes('thuydung')) {
      return {
        id: 'thuydung',
        pitchFactor: 1.0,
        eq: null,
        highCut: null
      };
    }
    // Trúc Ly: Standard natural Northern female voice
    if (v.includes('trúc ly') || v.includes('trucly') || v.includes('mai anh')) {
      return {
        id: 'trucly',
        pitchFactor: 1.0,
        eq: null,
        highCut: null
      };
    }
    // Default / Google-vi
    return {
      id: 'default',
      pitchFactor: 1.0,
      eq: null,
      highCut: null
    };
  },

  pitchShiftWSOLA(input, sampleRate, pitchFactor) {
    if (!input || input.length < 128 || Math.abs(pitchFactor - 1.0) < 0.02) return input;

    const inLen = input.length;
    // Step 1: Resample
    const resampledLen = Math.round(inLen / pitchFactor);
    if (resampledLen < 128) return input;
    const resampled = new Float32Array(resampledLen);
    for (let i = 0; i < resampledLen; i++) {
      const srcPos = i * pitchFactor;
      const idx0 = Math.floor(srcPos);
      const frac = srcPos - idx0;
      const s0 = input[idx0] || 0;
      const s1 = input[idx0 + 1] !== undefined ? input[idx0 + 1] : s0;
      resampled[i] = s0 + frac * (s1 - s0);
    }

    // Step 2: WSOLA overlap-add back to inLen
    const windowSize = Math.max(128, Math.floor(sampleRate * 0.025)); // 25ms
    const hopOut = Math.floor(windowSize / 2); // 12.5ms
    const timeScale = inLen / resampledLen;
    const searchRadius = Math.max(8, Math.floor(sampleRate * 0.003)); // 3ms correlation window

    const output = new Float32Array(inLen);
    const normWeights = new Float32Array(inLen);

    const win = new Float32Array(windowSize);
    for (let i = 0; i < windowSize; i++) {
      win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
    }

    let inOffset = 0;
    let outOffset = 0;

    while (outOffset + windowSize <= inLen && inOffset + windowSize + searchRadius <= resampledLen) {
      let bestDelta = 0;
      let maxCorr = -Infinity;
      const centerIn = Math.floor(inOffset);

      if (outOffset > 0) {
        for (let delta = -searchRadius; delta <= searchRadius; delta++) {
          const candidateIn = centerIn + delta;
          if (candidateIn < 0 || candidateIn + hopOut >= resampledLen) continue;
          let corr = 0;
          for (let k = 0; k < hopOut; k += 2) {
            corr += output[outOffset + k] * resampled[candidateIn + k];
          }
          if (corr > maxCorr) {
            maxCorr = corr;
            bestDelta = delta;
          }
        }
      }

      const matchedIn = centerIn + bestDelta;
      for (let i = 0; i < windowSize; i++) {
        const s = resampled[matchedIn + i] * win[i];
        output[outOffset + i] += s;
        normWeights[outOffset + i] += win[i];
      }

      outOffset += hopOut;
      inOffset += hopOut / timeScale;
    }

    // Copy trailing samples if any
    while (outOffset < inLen && inOffset < resampledLen) {
      output[outOffset] = resampled[Math.floor(inOffset)] || 0;
      normWeights[outOffset] = 1.0;
      outOffset++;
      inOffset += 1.0 / timeScale;
    }

    // Normalize overlapping window weights
    for (let i = 0; i < inLen; i++) {
      if (normWeights[i] > 1e-3) {
        output[i] /= normWeights[i];
      }
    }

    return output;
  },

  applyVoiceCharacteristics(audioBuffer, voiceName = null) {
    if (!audioBuffer || !this.audioContext || typeof this.audioContext.createBuffer !== 'function') return audioBuffer;
    const rawVoice = String(voiceName || (this.voiceSelect ? this.voiceSelect.value : '')).toLowerCase();
    if (rawVoice.includes('vieneu') || rawVoice.includes('trúc ly') || rawVoice.includes('hải đăng') || rawVoice.includes('thiện minh') || rawVoice.includes('mai anh') || rawVoice.includes('thùy dung') || rawVoice.includes('thái sơn') || rawVoice.includes('ngọc huyền') || rawVoice.includes('quỳnh anh') || rawVoice.includes('đức trí') || rawVoice.includes('minh đức') || rawVoice.includes('kim thanh')) {
      return audioBuffer;
    }
    const profile = this.getVoiceProfile(voiceName);
    if (Math.abs(profile.pitchFactor - 1.0) < 0.02) return audioBuffer;

    try {
      const sampleRate = audioBuffer.sampleRate;
      const numChannels = audioBuffer.numberOfChannels;
      const length = audioBuffer.length;
      const newBuffer = this.audioContext.createBuffer(numChannels, length, sampleRate);

      for (let ch = 0; ch < numChannels; ch++) {
        const inputData = audioBuffer.getChannelData(ch);
        const outputData = newBuffer.getChannelData(ch);
        const shifted = this.pitchShiftWSOLA(inputData, sampleRate, profile.pitchFactor);
        outputData.set(shifted.subarray(0, length));
      }
      return newBuffer;
    } catch (e) {
      console.warn('applyVoiceCharacteristics error:', e);
      return audioBuffer;
    }
  },

  createVoiceNodes(voiceName = null) {
    if (!this.audioContext || typeof this.audioContext.createBiquadFilter !== 'function' || this.audioContext.state === 'closed') return [];
    const rawVoice = String(voiceName || (this.voiceSelect ? this.voiceSelect.value : '')).toLowerCase();
    if (rawVoice.includes('vieneu') || rawVoice.includes('trúc ly') || rawVoice.includes('hải đăng') || rawVoice.includes('thiện minh') || rawVoice.includes('mai anh') || rawVoice.includes('thùy dung') || rawVoice.includes('thái sơn') || rawVoice.includes('ngọc huyền') || rawVoice.includes('quỳnh anh') || rawVoice.includes('đức trí') || rawVoice.includes('minh đức') || rawVoice.includes('kim thanh')) {
      return [];
    }
    const profile = this.getVoiceProfile(voiceName);
    const nodes = [];

    if (profile.eq) {
      try {
        const filter = this.audioContext.createBiquadFilter();
        filter.type = profile.eq.type;
        filter.frequency.value = profile.eq.frequency;
        filter.gain.value = profile.eq.gain;
        nodes.push(filter);
      } catch (_) {}
    }

    if (profile.highCut) {
      try {
        const cut = this.audioContext.createBiquadFilter();
        cut.type = 'highshelf';
        cut.frequency.value = profile.highCut.frequency;
        cut.gain.value = profile.highCut.gain;
        nodes.push(cut);
      } catch (_) {}
    }

    return nodes;
  },

  // Audition sample in the exact selected voice

  async auditionSelectedVoice() {
    const selectedVoice = this.voiceSelect.value;
    const voice = this.getEffectiveVoice();
    const sampleTexts = {
      'edge:Hoài My': 'Xin chào, tôi là Hoài My, giọng đọc nữ nhẹ nhàng và truyền cảm của Microsoft Edge Neural.',
      'edge:Nam Minh': 'Xin chào quý vị và các bạn, tôi là Nam Minh, giọng đọc nam trầm ấm của Microsoft Edge Neural.',
      'auto-fast': 'Xin chào, đây là giọng đọc được hệ thống đo và chọn tự động theo tốc độ thực tế.',
      'vieneu:Trúc Ly': 'Xin chào, tôi là Trúc Ly từ mô hình VieNeu-TTS, phong cách nói tự nhiên và truyền cảm.',
      'vieneu:Thiện Minh': 'Chào bạn, tôi là Thiện Minh, giọng đọc kể chuyện truyền cảm của VieNeu-TTS.',
      'vieneu:Thùy Dung': 'Kính chào quý vị, đây là giọng đọc Thùy Dung miền Nam từ VieNeu-TTS.',
      'vieneu:Thái Sơn': 'Chào các bạn, đây là giọng đọc Thái Sơn miền Nam của VieNeu-TTS.',
      'vieneu:Quang Sơn': 'Xin chào bà con, đây là giọng đọc Quang Sơn miền Trung của VieNeu-TTS.',
      'vieneu:Mai Anh': 'Bản tin hôm nay được truyền tải qua giọng đọc Mai Anh của VieNeu-TTS.',
      'vieneu:Adam bựa': 'Chào anh em nha, tôi là Adam, giọng đọc hài hước cực kỳ tự nhiên của VieNeu-TTS!',
      'google-vi': 'Xin chào bạn, đây là giọng đọc tiếng Việt siêu tốc của Google, phản hồi không phẩy một giây.',
      'vi-VN-HoaiMyNeural': 'Xin chào, tôi là Hoài My, giọng đọc nữ nhẹ nhàng và truyền cảm của Microsoft.',
      'vi-VN-NamMinhNeural': 'Xin chào quý vị và các bạn, tôi là Nam Minh, giọng đọc nam trầm ấm và truyền cảm.',
      'piper-vi': 'Xin chào, đây là giọng đọc ngoại tuyến cục bộ Piper chạy trên máy tính của bạn.'
    };
    const text = sampleTexts[selectedVoice] || sampleTexts[voice] || 'Xin chào, đây là giọng đọc tiếng Việt chất lượng cao.';

    this.setStatus('active', 'Đang tải âm thanh giọng mẫu...');
    this.showToast(` Đang phát giọng: ${this.voiceSelect.selectedOptions[0].text}`);

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice })
      });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        await this.playAudioBuffer(arrayBuf);
        this.setStatus('ready', `Đang phát giọng: ${this.voiceSelect.selectedOptions[0].text}`);
      }
    } catch (e) {
      console.warn('Audition error:', e);
      this.setStatus('ready', 'Sẵn sàng');
    }
  },

  // Speaker & Audio Test

  async testSpeaker() {
    this.showToast(' Đang kiểm tra âm thanh loa máy tính...');
    const voice = this.getEffectiveVoice();
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Xin chào bạn! Hệ thống loa và âm thanh của bạn đang hoạt động rất tốt!',
          voice
        })
      });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        await this.playAudioBuffer(buf);
        this.showToast(' Loa hoạt động hoàn hảo!');
      } else {
        this.showToast(' Lỗi kiểm tra loa từ máy chủ');
      }
    } catch (e) {
      this.showToast(' Không thể phát âm thanh: ' + e.message);
    }
  },

  // --- SOURCE 1: SYSTEM AUDIO ---

  splitSentenceIntoClauses(text) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    // Newlines inside one subtitle cue are visual layout only. VieNeu now
    // streams one persistent autoregressive + codec session, so keep even very
    // long cues intact: transport chunks must never become prosody boundaries.
    const utterance = raw
      .split(/[\r\n]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return utterance ? [utterance] : [];
  },

  enqueueLiveDubbing(text, historyId, sourceText = '', capturedAt = null, finalizedAt = null, serverTimings = null, originalDuration = 0, source = 'unknown', onStart = null) {
    const speakableText = this.sanitizeDubbingText(text);
    if (!speakableText || !this.isDubbingEnabled) return Promise.resolve();

    const effectiveVoice = this.getEffectiveVoice();
    // Both providers stream a complete utterance. Transport chunks are never
    // sentence boundaries, so short hesitations and long dramatic lines retain
    // their authored timing and prosody.
    const clauses = this.splitSentenceIntoClauses(speakableText);
    if (clauses.length > 1) {
      const totalLen = speakableText.length;
      for (let i = 0; i < clauses.length; i++) {
        const clause = clauses[i];
        const clauseRatio = clause.length / Math.max(1, totalLen);
        const clauseDuration = originalDuration ? (originalDuration * clauseRatio) : 0;
        const isFirst = (i === 0);
        this.enqueueSingleLiveDubbing(
          clause,
          historyId,
          sourceText,
          capturedAt,
          finalizedAt,
          serverTimings,
          clauseDuration,
          source,
          speakableText,
          (isFirst ? onStart : null),
          !isFirst // isChained: true for all subsequent clauses
        );
      }
      return this.drainLiveDubbingQueue();
    }

    this.enqueueSingleLiveDubbing(speakableText, historyId, sourceText, capturedAt, finalizedAt, serverTimings, originalDuration, source, speakableText, onStart, false);
    return this.drainLiveDubbingQueue();
  },

  enqueueSingleLiveDubbing(text, historyId, sourceText = '', capturedAt = null, finalizedAt = null, serverTimings = null, originalDuration = 0, source = 'unknown', fullText = null, onStart = null, isChained = false) {
    text = this.sanitizeDubbingText(text);
    if (!text || !this.isDubbingEnabled) return;
    // Cross-source dedup: if an equivalent sourceText from a different source
    // (e.g. OCR vs ASR) is already queued, skip the duplicate.
    const normSource = String(sourceText || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!?,;:]+$/, '');
    if (normSource && this.liveDubbingQueue.length > 0) {
      for (const queued of this.liveDubbingQueue) {
        const qNorm = String(queued.sourceText || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!?,;:]+$/, '');
        if (qNorm && qNorm === normSource && queued.source !== source) {
          return; // cross-source duplicate
        }
      }
    }
    const duration = originalDuration || (capturedAt && finalizedAt ? Math.max(0, (finalizedAt - capturedAt) / 1000) : 0);
    const effectiveVoice = this.getEffectiveVoice();
    const now = performance.now();
    if (this.lastEnqueueTime) {
      this.lastSentenceArrivalGapMs = now - this.lastEnqueueTime;
    }
    this.lastEnqueueTime = now;
    this.liveDubbingQueue.push({
      text,
      fullText: fullText || text,
      sourceText,
      historyId,
      capturedAt,
      finalizedAt,
      enqueuedAt: performance.now(),
      serverTimings,
      originalDuration: duration,
      generation: this.dubbingGeneration,
      voice: effectiveVoice,
      source,
      onStart,
      isChained
    });
    // Edge synthesis is network-bound and does not contend with the local GPU.
    if (isEdgeVoice(effectiveVoice)) {
      this.prefetchLiveTts(text, effectiveVoice);
    } else if (isVieNeuVoice(effectiveVoice) && this.isProcessingLiveDubbing) {
      // Keep exactly one VieNeu cue warm. The active cue now streams from the
      // same autoregressive session; extra speculative GPU jobs would increase
      // p95 latency and risk starving that stream.
      const prefix = `${effectiveVoice}:::`;
      const alreadyPrefetchingVieNeu = this.liveTtsPrefetch
        && Array.from(this.liveTtsPrefetch.keys()).some(key => key.startsWith(prefix));
      if (!alreadyPrefetchingVieNeu) this.prefetchLiveTts(text, effectiveVoice);
    }
  },

  getLivePcmBufferPolicy(text) {
    // Ultra-low latency 48kHz mono 16-bit PCM buffer policy (~200ms initial response time)
    return { initialBytes: 24000, sliceBytes: 19200, fullLinePreferred: false };
  },

  prefetchLiveTts(text, voice) {
    if (!text || !voice || !(voice.startsWith('vieneu') || voice.startsWith('edge') || voice.startsWith('ms:'))) return;
    if (!this.liveTtsPrefetch) this.liveTtsPrefetch = new Map();
    const key = `${voice}:::${text}`;
    if (this.liveTtsPrefetch.has(key)) return;

    // Allow generous prefetch buffer (up to 40 items) so video dubbing is completely smooth
    while (this.liveTtsPrefetch.size >= 40) {
      const oldestKey = this.liveTtsPrefetch.keys().next().value;
      if (!oldestKey) break;
      const oldEntry = this.liveTtsPrefetch.get(oldestKey);
      if (oldEntry && oldEntry.controller) {
        try { oldEntry.controller.abort(); } catch (_) {}
      }
      this.liveTtsPrefetch.delete(oldestKey);
    }

    const controller = new AbortController();
    const promise = (async () => {
      try {
        const res = await fetch('/api/tts-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice }),
          signal: controller.signal
        });
        if (!res.ok || !res.body) return null;
        const reader = res.body.getReader();
        const chunks = [];
        let totalLen = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (value && value.byteLength > 0) {
            chunks.push(value);
            totalLen += value.byteLength;
          }
          if (done) break;
        }
        const merged = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.byteLength;
        }
        return {
          ok: true,
          pcmBytes: merged,
          sampleRate: parseInt(res.headers.get('X-Audio-Sample-Rate') || '48000', 10),
          serverRateCap: parseFloat(res.headers.get('X-Safe-Playback-Rate') || '2.0')
        };
      } catch (err) {
        if (this.liveTtsPrefetch) this.liveTtsPrefetch.delete(key);
        return null;
      }
    })();

    this.liveTtsPrefetch.set(key, { promise, controller });
  },

  async drainLiveDubbingQueue() {
    if (this.isProcessingLiveDubbing) return;
    this.isProcessingLiveDubbing = true;
    try {
      while (this.liveDubbingQueue.length > 0) {
        const item = this.liveDubbingQueue.shift();
        if (!item) break;
        const isStale = () => (
          !this.isDubbingEnabled
          || item.generation !== this.dubbingGeneration
        );
        if (isStale()) continue;
        // Audio is ephemeral while subtitles/history are durable. If a whole
        // sentence is stale, discard all of its chained clauses together so the
        // voice catches the current scene instead of reading a suffix alone.
        const itemLagMs = item.enqueuedAt ? (performance.now() - item.enqueuedAt) : 0;
        const maxLagMs = this.maxLiveVoiceLagMs || 2200;
        if (!item.isChained && this.liveDubbingQueue.length > 0 && itemLagMs > maxLagMs) {
          const groupId = `${item.generation}:${item.historyId || item.fullText}`;
          const removed = [item];
          this.liveDubbingQueue = this.liveDubbingQueue.filter(queued => {
            const queuedGroupId = `${queued.generation}:${queued.historyId || queued.fullText}`;
            if (queuedGroupId === groupId) {
              removed.push(queued);
              return false;
            }
            return true;
          });
          for (const staleItem of removed) {
            const key = `${staleItem.voice}:::${staleItem.text}`;
            const entry = this.liveTtsPrefetch && this.liveTtsPrefetch.get(key);
            if (entry && entry.controller) entry.controller.abort();
            if (this.liveTtsPrefetch) this.liveTtsPrefetch.delete(key);
          }
          this.realtimeMetrics.staleVoiceDrops = (this.realtimeMetrics.staleVoiceDrops || 0) + 1;
          continue;
        }

        // Start the current line before submitting another GPU synthesis request.
        try {
          const revealSubtitle = () => {
            if (typeof item.onStart === 'function') {
              try { item.onStart(); } catch (_) {}
            }
            if (item.capturedAt) {
              const totalMs = Math.round(performance.now() - item.capturedAt);
              this.realtimeMetrics.lastSpeechStartToVoiceMs = totalMs;
            }
            if (item.finalizedAt) {
              const endToVoiceMs = Math.round(performance.now() - item.finalizedAt);
              this.realtimeMetrics.lastSpeechEndToVoiceMs = endToVoiceMs;
              this.realtimeMetrics.samples.push(endToVoiceMs);
              if (this.realtimeMetrics.samples.length > 100) this.realtimeMetrics.samples.shift();
            }
            // Subtitle UI is updated on OCR/ASR completion, not on TTS start.
            // Repainting here would let an old queued voice overwrite the newest cue.
            // Pipeline prefetch: start synthesizing next queued item in background the exact moment this one plays!
            if (this.liveDubbingQueue.length > 0) {
              const nextItem = this.liveDubbingQueue[0];
              if (nextItem && nextItem.voice && nextItem.text) {
                this.prefetchLiveTts(nextItem.text, nextItem.voice);
              }
            }
          };
          const originalDuration = item.originalDuration || (item.finalizedAt && item.capturedAt ? Math.max(0, (item.finalizedAt - item.capturedAt) / 1000) : 0);
          const queueLagMs = item.enqueuedAt ? (performance.now() - item.enqueuedAt) : 0;
          const currentQueueDepth = this.liveDubbingQueue.length + 1;
          if (item.voice.startsWith('vieneu') || item.voice.startsWith('edge') || item.voice.startsWith('ms:')) {
            await this.playStreamingTts(
              item.text,
              item.voice,
              true,
              revealSubtitle,
              null,
              currentQueueDepth,
              originalDuration,
              queueLagMs,
              item.isChained
            );
            continue;
          }
          const response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: item.text, voice: item.voice })
          });
          if (!response.ok) {
            continue;
          }
          if (isStale()) continue;
          const audio = await response.arrayBuffer();
          if (isStale()) continue;
          await this.playAudioBuffer(audio, true, revealSubtitle, originalDuration, item.text ? item.text.length : 0, currentQueueDepth, queueLagMs, item.isChained);
        } catch (error) {
          console.warn('Live dubbing error:', error);
          // Subtitle was already published by OCR/ASR and remains independent
          // from synthesis or playback failures.
        }
      }
    } finally {
      this.isProcessingLiveDubbing = false;
      if (this.liveDubbingQueue.length > 0) this.drainLiveDubbingQueue();
    }
  },

  // Unblockable Web Audio API buffer playback with Adaptive Pacing

  async playBase64Audio(base64Audio, historyId, mime = 'audio/mpeg', expectedSlotDuration = 0, token = null, onStart = null) {
    if (token && !this.isPlaybackCurrent(token)) return;
    this.stopDubbingAudio(false, !token);
    if (token && !this.isPlaybackCurrent(token)) return;
    this.dubbingIndicator.classList.add('active');

    try {
      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      this.ensureAudioUnlocked();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }

      const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer.slice(0));
      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;

      // Adaptive speech pacing: if speech is longer than video slot, gently accelerate to fit perfectly!
      const userRate = this.getSafePlaybackRate();
      let effectiveRate = userRate;
      if (this.isAdaptiveSpeedEnabled && expectedSlotDuration > 0 && audioBuffer.duration > expectedSlotDuration) {
        const fitRate = audioBuffer.duration / expectedSlotDuration;
        effectiveRate = Math.min(2.0, Math.max(userRate, fitRate));
      }
      sourceNode.playbackRate.value = effectiveRate;

      const gainNode = this.audioContext.createGain();
      const targetGain = (parseInt(this.volumeRange.value, 10) || 100) / 100;
      const now = this.audioContext.currentTime;
      // Micro fade-in (6ms) and fade-out (8ms) to completely eliminate DC offset clicks / pops
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.006);
      const playDuration = audioBuffer.duration / (sourceNode.playbackRate.value || 1.0);
      const endTime = now + playDuration;
      if (playDuration > 0.02) {
        gainNode.gain.setValueAtTime(targetGain, Math.max(now + 0.006, endTime - 0.008));
        gainNode.gain.linearRampToValueAtTime(0.0001, endTime);
      }

      sourceNode.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      this.currentActiveAudioSource = sourceNode;
      this.currentGainNode = gainNode;
      sourceNode.onended = () => {
        if (this.dubbingIndicator && this.dubbingIndicator.classList) {
      this.dubbingIndicator.classList.remove('active');
    }
        if (this.currentActiveAudioSource === sourceNode) {
          this.currentActiveAudioSource = null;
          this.currentGainNode = null;
        }
        this.releaseYouTubeDubbingHold();
      };
      if (typeof onStart === 'function') onStart();
      sourceNode.start(0);

      const item = this.history.find(h => h.id === historyId);
      if (item) item.audioBlobUrl = `data:${mime};base64,` + base64Audio;
      // Prune history audio cache so only the 3 most recent voice lines remain in memory
      if (!this.recentSpokenHistoryIds) this.recentSpokenHistoryIds = [];
      this.recentSpokenHistoryIds.push(historyId);
      while (this.recentSpokenHistoryIds.length > 3) {
        const oldId = this.recentSpokenHistoryIds.shift();
        const oldItem = this.history.find(h => h.id === oldId);
        if (oldItem && oldItem.audioBlobUrl) {
          oldItem.audioBlobUrl = null;
        }
      }
    } catch (err) {
      console.warn('Web Audio API playback fallback to HTML5 Audio:', err);
      const audioUrl = `data:${mime};base64,` + base64Audio;
      this.dubbingAudio.src = audioUrl;
      this.dubbingAudio.volume = parseInt(this.volumeRange.value, 10) / 100;
      this.dubbingAudio.playbackRate = this.getSafePlaybackRate();
      if (typeof onStart === 'function') onStart();
      this.dubbingAudio.play().catch(e => console.warn('HTML5 audio play error:', e));
    }
  },

  async playAudioBuffer(arrayBuffer, waitForEnd = false, onStart = null, originalDuration = 0, textLength = 0, queueDepth = 0, queueLagMs = 0, isChained = false) {
    if (!isChained) {
      this.stopDubbingAudio(false, false);
    }
    try {
      this.ensureAudioUnlocked();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }

      let audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
      const voice = this.getEffectiveVoice();
      const profile = this.getVoiceProfile(voice);
      if (audioBuffer && audioBuffer._livesubVoice !== profile.id) {
        audioBuffer = this.applyVoiceCharacteristics(audioBuffer, voice);
        audioBuffer._livesubVoice = profile.id;
      }

      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.playbackRate.value = this.getSafeStreamingPlaybackRate(queueDepth, 2.0, originalDuration, textLength, queueLagMs);

      const gainNode = this.audioContext.createGain();
      const targetGain = (parseInt(this.volumeRange.value, 10) || 100) / 100;
      const now = this.audioContext.currentTime;
      // Micro fade-in (4ms) and fade-out (6ms) to completely eliminate DC offset clicks / pops
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.004);
      const playDuration = audioBuffer.duration / (sourceNode.playbackRate.value || 1.0);
      const endTime = now + playDuration;
      if (playDuration > 0.02) {
        gainNode.gain.setValueAtTime(targetGain, Math.max(now + 0.004, endTime - 0.006));
        gainNode.gain.linearRampToValueAtTime(0.0001, endTime);
      }

      const voiceNodes = this.createVoiceNodes(voice);
      let lastNode = sourceNode;
      if (voiceNodes && voiceNodes.length) {
        for (const vn of voiceNodes) {
          lastNode.connect(vn);
          lastNode = vn;
        }
      }
      lastNode.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      this.currentActiveAudioSource = sourceNode;
      this.currentGainNode = gainNode;
      let resolveEnded;
      const ended = waitForEnd ? new Promise(resolve => { resolveEnded = resolve; }) : null;
      sourceNode.onended = () => {
        if (this.currentActiveAudioSource === sourceNode) {
          this.currentActiveAudioSource = null;
          this.currentGainNode = null;
        }
        if (resolveEnded) resolveEnded();
      };
      if (typeof onStart === 'function') onStart();
      sourceNode.start(0);
      if (ended) await ended;
    } catch (e) {
      console.warn('playAudioBuffer error:', e);
    }
  },

  // Play raw PCM as each VieNeu chunk arrives. This removes the old wait for
  // the complete WAV (typically several seconds) while preserving queue order.

  async playStreamingTts(text, voice, waitForEnd = true, onStart = null, token = null, queueDepth = 0, originalDuration = 0, queueLagMs = 0, isChained = false) {
    if (token && !this.isPlaybackCurrent(token)) return;
    if (token && !isChained) this.stopDubbingAudio(false, false);
    if (token && !this.isPlaybackCurrent(token)) return;

    const prefetchKey = `${voice}:::${text}`;
    let prefetched = this.liveTtsPrefetch ? this.liveTtsPrefetch.get(prefetchKey) : null;
    if (prefetched) {
      this.liveTtsPrefetch.delete(prefetchKey);
    }

    const controller = new AbortController();
    this.streamingAbortController = controller;
    const localSources = new Set();
    let readingDone = false;
    let resolveEnded;
    let startCallbackTimer = null;
    let safetyTimeout = null;
    const ended = new Promise(resolve => { resolveEnded = resolve; });
    let pendingChunks = [];
    let pendingBytesLen = 0;

    try {
      let prefetchedData = null;
      let response = null;
      if (prefetched) {
        const resolved = await prefetched.promise;
        if (resolved && resolved.pcmBytes) {
          prefetchedData = resolved;
        } else if (resolved && resolved.ok) {
          response = resolved;
        }
      }
      if (!prefetchedData && !response) {
        response = await fetch('/api/tts-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice }),
          signal: controller.signal
        });
      }
      if (prefetchedData && prefetchedData.pcmBytes) {
        const b = prefetchedData.pcmBytes;
        const isWav = (b.length > 4 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46);
        const isMp3 = (b.length > 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b.length > 2 && b[0] === 0xFF && (b[1] & 0xE0) === 0xE0);
        if (isWav || isMp3) {
          if (token && !this.isPlaybackCurrent(token)) return;
          await this.playAudioBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), waitForEnd, onStart, originalDuration, text ? text.length : 0, queueDepth, queueLagMs, isChained);
          return;
        }
      }
      if (!prefetchedData && (!response || !response.ok)) {
        throw new Error(`TTS stream HTTP ${response ? response.status : 'network error'}`);
      }
      const cType = response ? (response.headers.get('content-type') || '') : '';
      if (response && isStreamingEdgeResponse(response) && canUseEdgeMediaSource()) {
        const playbackRate = this.getSafeStreamingPlaybackRate(queueDepth, 2.0, originalDuration, text ? text.length : 0, queueLagMs);
        await playEdgeMp3Stream(this, response, {
          waitForEnd,
          onStart,
          playbackRate,
          signal: controller.signal
        });
        return;
      }
      if (cType.includes('audio/mpeg') || cType.includes('audio/mp3') || cType.includes('audio/wav')) {
        const audioBuf = await response.arrayBuffer();
        if (token && !this.isPlaybackCurrent(token)) return;
        await this.playAudioBuffer(audioBuf, waitForEnd, onStart, originalDuration, text ? text.length : 0, queueDepth, queueLagMs, isChained);
        return;
      }
      if (token && !this.isPlaybackCurrent(token)) return;

      this.ensureAudioUnlocked();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }

      const sampleRate = prefetchedData ? prefetchedData.sampleRate : parseInt(response.headers.get('X-Audio-Sample-Rate') || '48000', 10);
      const serverRateCap = prefetchedData ? prefetchedData.serverRateCap : parseFloat(response.headers.get('X-Safe-Playback-Rate') || '2.0');
      const gainNode = this.audioContext.createGain();
      const targetGain = (parseInt(this.volumeRange.value, 10) || 100) / 100;
      const now = this.audioContext.currentTime;
      if (isChained) {
        gainNode.gain.setValueAtTime(targetGain, now);
      } else {
        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.006);
      }
      gainNode.connect(this.audioContext.destination);
      this.currentGainNode = gainNode;
      this.dubbingIndicator.classList.add('active');

      const playbackRate = this.getSafeStreamingPlaybackRate(queueDepth, serverRateCap, originalDuration, text ? text.length : 0, queueLagMs);
      let nextStart = 0;
      let carry = null;
      let started = false;

      // Realtime Streaming: Pre-buffer ~250ms of audio (bufferPolicy.initialBytes)
      // to eliminate stuttering while starting playback within ~250ms of GPU synthesis.
      const bufferPolicy = this.getLivePcmBufferPolicy(text);
      const INITIAL_PREBUFFER_BYTES = bufferPolicy.initialBytes;
      const MIN_SLICE_BYTES = bufferPolicy.sliceBytes;
      pendingChunks = [];
      pendingBytesLen = 0;

      const finishIfDone = (force = false) => {
        if (force || (readingDone && localSources.size === 0)) {
          if (safetyTimeout) clearTimeout(safetyTimeout);
          if (resolveEnded) resolveEnded();
        }
      };

      const setSafetyTimeout = (extraSec = 3.5) => {
        if (safetyTimeout) clearTimeout(safetyTimeout);
        const curTime = this.audioContext ? this.audioContext.currentTime : 0;
        const durSec = (nextStart > curTime ? nextStart - curTime : 1.2) + extraSec;
        safetyTimeout = setTimeout(() => {
          finishIfDone(true);
        }, Math.max(1500, durSec * 1000));
      };

      const scheduleSlice = (sliceBytes) => {
        if (!sliceBytes || sliceBytes.byteLength < 2) return;
        const frameCount = Math.floor(sliceBytes.byteLength / 2);
        const audioBuffer = this.audioContext.createBuffer(1, frameCount, sampleRate);
        const channel = audioBuffer.getChannelData(0);
        const view = new DataView(sliceBytes.buffer, sliceBytes.byteOffset, sliceBytes.byteLength);
        for (let i = 0; i < frameCount; i++) channel[i] = view.getInt16(i * 2, true) / 32768;

        const sourceNode = this.audioContext.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.playbackRate.value = playbackRate;
        sourceNode.connect(gainNode);
        localSources.add(sourceNode);
        this.streamingAudioSources.add(sourceNode);
        this.currentActiveAudioSource = sourceNode;
        sourceNode.onended = () => {
          localSources.delete(sourceNode);
          this.streamingAudioSources.delete(sourceNode);
          if (this.currentActiveAudioSource === sourceNode) this.currentActiveAudioSource = null;
          finishIfDone();
        };

        const now = this.audioContext.currentTime;
        let startAt;
        if (!started) {
          started = true;
          this.lastDubbingStartedAt = performance.now();
          startAt = now + 0.05;
          if (this.liveDubbingQueue && this.liveDubbingQueue.length > 0) {
            const nextItem = this.liveDubbingQueue[0];
            this.prefetchLiveTts(nextItem.text, nextItem.voice);
          }
          const callbackDelay = Math.max(0, (startAt - now) * 1000);
          startCallbackTimer = setTimeout(() => {
            startCallbackTimer = null;
            if (!token || this.isPlaybackCurrent(token)) {
              if (typeof onStart === 'function') onStart();
              this.releaseYouTubeDubbingHold();
            }
          }, callbackDelay);
        } else {
          startAt = (nextStart >= now) ? nextStart : now;
        }
        sourceNode.start(startAt);
        nextStart = startAt + audioBuffer.duration / playbackRate;
      };

      if (prefetchedData && prefetchedData.pcmBytes) {
        scheduleSlice(prefetchedData.pcmBytes);
      } else if (response && response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (token && !this.isPlaybackCurrent(token)) {
            controller.abort();
            return;
          }

          if (value && value.byteLength > 0) {
            let bytes = value;
            if (carry !== null) {
              const joined = new Uint8Array(value.byteLength + 1);
              joined[0] = carry;
              joined.set(value, 1);
              bytes = joined;
              carry = null;
            }
            if (bytes.byteLength % 2) {
              carry = bytes[bytes.byteLength - 1];
              bytes = bytes.subarray(0, bytes.byteLength - 1);
            }
            if (bytes.byteLength > 0) {
              pendingChunks.push(bytes);
              pendingBytesLen += bytes.byteLength;
            }
          }

          // True low-latency streaming without stuttering:
          // For short subtitle lines (< 130 chars), collect full PCM (GPU finishes in ~150-250ms)
          // so the complete sentence plays as ONE uninterrupted buffer, preserving the final syllable completely.
          const threshold = started ? MIN_SLICE_BYTES : INITIAL_PREBUFFER_BYTES;
          const shouldSchedule = (pendingBytesLen >= threshold || (done && pendingBytesLen > 0));
          if (shouldSchedule) {
            let sliceBytes;
            if (pendingChunks.length === 1) {
              sliceBytes = pendingChunks[0];
            } else {
              sliceBytes = new Uint8Array(pendingBytesLen);
              let offset = 0;
              for (const chunk of pendingChunks) {
                sliceBytes.set(chunk, offset);
                offset += chunk.byteLength;
              }
            }
            pendingChunks = [];
            pendingBytesLen = 0;
            scheduleSlice(sliceBytes);
          }

          if (done) break;
        }
      }
      if (pendingBytesLen > 0) {
        let sliceBytes = (pendingChunks.length === 1) ? pendingChunks[0] : new Uint8Array(pendingBytesLen);
        if (pendingChunks.length > 1) {
          let offset = 0;
          for (const chunk of pendingChunks) {
            sliceBytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
        }
        pendingChunks = [];
        pendingBytesLen = 0;
        scheduleSlice(sliceBytes);
      }
      readingDone = true;
      setSafetyTimeout(3.5);
      finishIfDone();
      if (waitForEnd) await ended;
    } catch (error) {
      if (pendingBytesLen > 0 && !started) {
        let sliceBytes = (pendingChunks.length === 1) ? pendingChunks[0] : new Uint8Array(pendingBytesLen);
        if (pendingChunks.length > 1) {
          let offset = 0;
          for (const chunk of pendingChunks) {
            sliceBytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
        }
        pendingChunks = [];
        pendingBytesLen = 0;
        scheduleSlice(sliceBytes);
        readingDone = true;
        setSafetyTimeout(3.5);
        finishIfDone();
        if (waitForEnd) await ended;
      }
      if (error.name !== 'AbortError') throw error;
    } finally {
      if (safetyTimeout) clearTimeout(safetyTimeout);
      if (resolveEnded) resolveEnded();
      if (typeof startCallbackTimer !== 'undefined' && startCallbackTimer) clearTimeout(startCallbackTimer);
      if (this.streamingAbortController === controller) this.streamingAbortController = null;
      if (waitForEnd) {
        if (this.dubbingIndicator && this.dubbingIndicator.classList) {
      this.dubbingIndicator.classList.remove('active');
    }
        this.currentGainNode = null;
      }
    }
  },

  stopDubbingAudio(invalidatePlayback = true, restoreOriginalVolume = true) {
    if (invalidatePlayback) {
      this.playbackGeneration++;
      if (this.liveTtsPrefetch) {
        for (const entry of this.liveTtsPrefetch.values()) {
          try { entry.controller.abort(); } catch (_) {}
        }
        this.liveTtsPrefetch.clear();
      }
    }
    // Smooth gain ramp-down to eliminate DC offset click/pop ("tiếng bụp")
    if (this.currentGainNode && this.audioContext && this.audioContext.state === 'running') {
      try {
        const now = this.audioContext.currentTime;
        this.currentGainNode.gain.cancelScheduledValues(now);
        this.currentGainNode.gain.setValueAtTime(this.currentGainNode.gain.value, now);
        this.currentGainNode.gain.linearRampToValueAtTime(0.0001, now + 0.008);
      } catch (_) {}
    }
    if (this.streamingAbortController) {
      try { this.streamingAbortController.abort(); } catch (_) {}
      this.streamingAbortController = null;
    }
    if (this.currentEdgeStreamAudio) {
      try {
        this.currentEdgeStreamAudio.pause();
        this.currentEdgeStreamAudio.removeAttribute('src');
        this.currentEdgeStreamAudio.load();
      } catch (_) {}
      this.currentEdgeStreamAudio = null;
    }
    if (this.currentEdgeStreamUrl) {
      try { URL.revokeObjectURL(this.currentEdgeStreamUrl); } catch (_) {}
      this.currentEdgeStreamUrl = null;
    }
    const sourcesToStop = [];
    if (this.currentActiveAudioSource) {
      sourcesToStop.push(this.currentActiveAudioSource);
      this.currentActiveAudioSource = null;
    }
    if (this.streamingAudioSources) {
      this.streamingAudioSources.forEach(source => sourcesToStop.push(source));
      this.streamingAudioSources.clear();
    }
    if (sourcesToStop.length > 0) {
      setTimeout(() => {
        sourcesToStop.forEach(source => {
          try { source.stop(); } catch (e) {}
        });
      }, 10);
    }
    this.currentGainNode = null;
    if (this.ytOverrunHoldTimer) {
      clearTimeout(this.ytOverrunHoldTimer);
      this.ytOverrunHoldTimer = null;
    }
    if (this.dubbingAudio) {
      this.dubbingAudio.pause();
      this.dubbingAudio.currentTime = 0;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (this.dubbingIndicator && this.dubbingIndicator.classList) {
      this.dubbingIndicator.classList.remove('active');
    }
    if (restoreOriginalVolume) {
      this.restoreYouTubeVolumeNow();
    }
  },

  stopAllAudio() {
    this.stopDubbingAudio();
  },

  async handleTestText() {
    const text = this.testTextInput.value.trim();
    if (!text) return;
    this.testTextInput.value = '';

    this.setStatus('active', 'Đang dịch & phát âm...');
    try {
      const srcLang = this.sourceLangSelect.value;
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, from_lang: srcLang, to_lang: 'vi' })
      });
      const data = await res.json();

      if (data.translated) {
        this.displaySubtitle(data.original, data.translated);
        const record = this.addHistory(data.original, data.translated, data.from || 'en');

        const voice = this.getEffectiveVoice();
        const ttsRes = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: data.translated, voice })
        });
        if (ttsRes.ok) {
          const arrayBuf = await ttsRes.arrayBuffer();
          await this.playAudioBuffer(arrayBuf);
        }
      }
    } catch (e) {
      console.error('Test text error:', e);
    } finally {
      if (!this.isListening) this.setStatus('ready', 'Sẵn sàng');
    }
  }

  }
