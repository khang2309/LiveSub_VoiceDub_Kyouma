// LiveSub engine component: youtube-audio-prefetch
export default {
  async playSegmentAudio(segIdx, expectedSlotDuration = 0, onStart = null) {
    if (!this.isDubbingEnabled) return;
    const token = {
      playback: ++this.playbackGeneration,
      session: this.ytSessionGeneration,
      segment: segIdx
    };

    // Fast Path: Decoded Audio Buffer already in memory (0ms Latency!)
    if (this.audioPreCache.has(segIdx)) {
      const cached = this.audioPreCache.get(segIdx);
      if (cached.voiceGeneration === this.voiceGeneration) {
        await this.playDecodedAudioBuffer(cached.buffer, expectedSlotDuration, token, onStart);
        return;
      }
      this.audioPreCache.delete(segIdx);
    }

    const seg = this.ytSegments[segIdx];
    if (!seg) return;

    // Fast fallback translation if segment isn't translated yet
    const isVietnameseCc = String(this.ytCaptionLanguage || '').toLowerCase().startsWith('vi');
    if ((!seg.translated || (!isVietnameseCc && seg.translated === seg.original)) && seg.original) {
      try {
        const transRes = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: seg.original, from_lang: 'auto', to_lang: 'vi' })
        });
        if (transRes.ok) {
          const transData = await transRes.json();
          if (transData.translated) seg.translated = transData.translated;
        }
      } catch (_) {}
    }
    if (!seg.translated) return;
    const speakText = this.sanitizeDubbingText(seg.translated);
    if (!speakText) return;

    try {
      const voice = this.getEffectiveVoice();
      await this.playStreamingTts(speakText, voice, true, onStart, token, 0, expectedSlotDuration);
      return;
    } catch (err) {
      console.warn('On-demand dub error for seg ' + segIdx, err);
    }
  },

  async playDecodedAudioBuffer(audioBuffer, expectedSlotDuration = 0, token = null, onStart = null) {
    if (token && !this.isPlaybackCurrent(token)) return;
    this.stopDubbingAudio(false, false);
    if (token && !this.isPlaybackCurrent(token)) return;
    this.dubbingIndicator.classList.add('active');

    try {
      this.ensureAudioUnlocked();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }

      const voice = this.getEffectiveVoice();
      const profile = this.getVoiceProfile(voice);
      if (audioBuffer && audioBuffer._livesubVoice !== profile.id) {
        audioBuffer = this.applyVoiceCharacteristics(audioBuffer, voice);
        audioBuffer._livesubVoice = profile.id;
      }

      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;

      // Smart adaptive speech pacing: accelerate speech rate to fit subtitle slot without pausing video
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

      sourceNode.onended = () => {
        if (this.currentActiveAudioSource === sourceNode) {
          this.currentActiveAudioSource = null;
          this.currentGainNode = null;
        }
        if (this.dubbingIndicator && this.dubbingIndicator.classList) {
      this.dubbingIndicator.classList.remove('active');
    }
        this.releaseYouTubeDubbingHold();
        this.scheduleRestoreYouTubeVolume(4500);
      };

      if (typeof onStart === 'function') onStart();
      sourceNode.start(0);
    } catch (err) {
      console.warn('Decoded audio playback error:', err);
      if (this.dubbingIndicator && this.dubbingIndicator.classList) {
      this.dubbingIndicator.classList.remove('active');
    }
    }
  },

  startYouTubePrefetchWorker(startIdx = 0) {
    if (this.currentYtMode !== 'has_captions' || !this.isDubbingEnabled || !this.ytSegments || this.ytSegments.length === 0) return;
    this._ytPrefetchTargetIdx = Math.max(0, startIdx);
    if (!Number.isInteger(this._ytSequentialPrefetchCursor) || this._ytSequentialPrefetchCursor < 0) {
      this._ytSequentialPrefetchCursor = this._ytPrefetchTargetIdx;
    }
    if (this._isYtPrefetchWorkerRunning) return;

    this._isYtPrefetchWorkerRunning = true;
    const workerGeneration = (this._ytPrefetchGeneration || 0) + 1;
    this._ytPrefetchGeneration = workerGeneration;
    if (!this.ytPrefetchAbortController || this.ytPrefetchAbortController.signal.aborted) {
      this.ytPrefetchAbortController = new AbortController();
    }
    const workerLoop = async () => {
      try {
        while (this._isYtPrefetchWorkerRunning && workerGeneration === this._ytPrefetchGeneration && this.currentYtMode === 'has_captions' && this.isDubbingEnabled && this.ytSegments && this.ytSegments.length > 0) {
          const curIdx = Math.max(this._ytPrefetchTargetIdx || 0, this.currentYtSegmentIdx >= 0 ? this.currentYtSegmentIdx : 0);
          const generation = this.voiceGeneration;
          const voice = this.getEffectiveVoice();
          const batch = [];

          // First keep the immediate playback neighborhood decoded in RAM. If a
          // distant section was already generated, this becomes a fast cache hit.
          const priorityEnd = Math.min(this.ytSegments.length, curIdx + 8);
          for (let i = curIdx; i < priorityEnd && batch.length < 4; i++) {
            const seg = this.ytSegments[i];
            if (!seg || !seg.translated) continue;
            const speakText = this.sanitizeDubbingText(seg.translated);
            if (!speakText) {
              this.ytPrefetchedAudioIndices?.add(i);
              continue;
            }
            const key = `${generation}:${i}`;
            if (!this.audioPreCache.has(i) && !this.isFetchingPreCache.has(key)) {
              this.isFetchingPreCache.add(key);
              batch.push({ index: i, segment: seg, fetchKey: key, speakText });
            }
          }

          // Once the next few sentences are safe, continue sequentially in small
          // chunks until the end of the known CC track. Generated distant audio is
          // retained by the backend TTS cache; only nearby PCM stays decoded in RAM.
          if (batch.length === 0) {
            let cursor = Math.max(0, this._ytSequentialPrefetchCursor || 0);
            while (cursor < this.ytSegments.length && batch.length < 4) {
              const seg = this.ytSegments[cursor];
              if (!seg || !seg.translated) break; // Wait for background translation.
              if (this.ytPrefetchedAudioIndices?.has(cursor)) {
                cursor++;
                continue;
              }
              const speakText = this.sanitizeDubbingText(seg.translated);
              if (!speakText) {
                this.ytPrefetchedAudioIndices?.add(cursor);
                cursor++;
                continue;
              }
              const key = `${generation}:${cursor}`;
              if (!this.isFetchingPreCache.has(key)) {
                this.isFetchingPreCache.add(key);
                batch.push({ index: cursor, segment: seg, fetchKey: key, speakText });
              }
              cursor++;
            }
            this._ytSequentialPrefetchCursor = cursor;
          }

          if (batch.length === 0) {
            // All lookahead segments cached or current window filled, sleep and re-check as video plays
            await new Promise(r => setTimeout(r, 400));
            continue;
          }

          try {
            const res = await fetch('/api/tts-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                texts: batch.map(b => b.speakText),
                voice,
                generation: this.ttsRequestGeneration
              }),
              signal: this.ytPrefetchAbortController?.signal
            });

            if (res.ok && generation === this.voiceGeneration) {
              const data = await res.json();
              const items = data && Array.isArray(data.items) ? data.items : [];
              const AudioCtx = window.AudioContext || window.webkitAudioContext;
              if (!this.audioContext || this.audioContext.state === 'closed') this.audioContext = new AudioCtx();

              await Promise.all(batch.map(async (entry, pos) => {
                const item = items[pos];
                if (!item || !item.audio_base64) return;
                this.ytPrefetchedAudioIndices?.add(entry.index);
                try {
                  const cacheAnchor = Math.max(this._ytPrefetchTargetIdx || 0, this.currentYtSegmentIdx >= 0 ? this.currentYtSegmentIdx : 0);
                  if (entry.index < cacheAnchor - 8 || entry.index > cacheAnchor + 48) return;
                  const binary = atob(item.audio_base64);
                  const bytes = new Uint8Array(binary.length);
                  for (let b = 0; b < binary.length; b++) bytes[b] = binary.charCodeAt(b);
                  let decoded = await this.audioContext.decodeAudioData(bytes.buffer.slice(0));
                  const profile = this.getVoiceProfile(voice);
                  if (decoded && decoded._livesubVoice !== profile.id) {
                    decoded = this.applyVoiceCharacteristics(decoded, voice);
                    decoded._livesubVoice = profile.id;
                  }
                  this.audioPreCache.set(entry.index, {
                    buffer: decoded,
                    translated: entry.segment.translated,
                    original: entry.segment.original,
                    voice,
                    voiceGeneration: generation
                  });
                  while (this.audioPreCache.size > 72) {
                    let evictIndex = null;
                    let farthest = -1;
                    for (const cachedIndex of this.audioPreCache.keys()) {
                      const distance = Math.abs(cachedIndex - cacheAnchor);
                      if (distance > farthest && (cachedIndex < cacheAnchor - 8 || cachedIndex > cacheAnchor + 16)) {
                        evictIndex = cachedIndex;
                        farthest = distance;
                      }
                    }
                    if (evictIndex === null) break;
                    this.audioPreCache.delete(evictIndex);
                  }
                } catch (e) {
                  console.warn('Worker audio decode error:', e);
                }
              }));
            }
          } catch (e) {
            if (e?.name !== 'AbortError') {
              console.warn('Worker batch fetch error:', e);
              await new Promise(r => setTimeout(r, 500));
            }
          } finally {
            batch.forEach(b => this.isFetchingPreCache.delete(b.fetchKey));
            const firstMissing = batch.find(entry => !this.ytPrefetchedAudioIndices?.has(entry.index));
            if (firstMissing) {
              this._ytSequentialPrefetchCursor = Math.min(
                this._ytSequentialPrefetchCursor || firstMissing.index,
                firstMissing.index
              );
            }
          }

          await new Promise(r => setTimeout(r, 60));
        }
      } finally {
        if (workerGeneration === this._ytPrefetchGeneration) {
          this._isYtPrefetchWorkerRunning = false;
        }
      }
    };

    workerLoop();
  },

  prefetchUpcomingAudio(fromIdx) {
    if (!this.isDubbingEnabled || !this.ytSegments || this.ytSegments.length === 0) return;
    this._ytPrefetchTargetIdx = fromIdx;
    this.startYouTubePrefetchWorker(fromIdx);
  }

  // =========================================================================
  // CONTINUOUS 16kHz MONO WAV CHUNKING ENGINE (RTX 3050 GPU OPTIMIZED)
  // Never drops speech syllables, resamples to 16kHz for instant GPU Whisper!
  // =========================================================================
}
