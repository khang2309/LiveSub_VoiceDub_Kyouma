// LiveSub Component: whisper-audio
export default {
  cleanupAudioCapture() {
    if (this._vadWatchdogTimer) {
      clearInterval(this._vadWatchdogTimer);
      this._vadWatchdogTimer = null;
    }
    if (this.neuralVAD) {
      const vadToDestroy = this.neuralVAD;
      this.neuralVAD = null;
      this.neuralVADActive = false;
      try { vadToDestroy.destroy().catch(() => {}); } catch (_) {}
    }
    if (this.scriptNode) {
      try { this.scriptNode.disconnect(); } catch (_) {}
      this.scriptNode = null;
    }
    if (Array.isArray(this._vocalFilterNodes)) {
      for (const n of this._vocalFilterNodes) {
        try { n.disconnect(); } catch (_) {}
      }
      this._vocalFilterNodes = null;
    }
    if (this._filteredVadStream) {
      try { this._filteredVadStream.getTracks().forEach(track => track.stop()); } catch (_) {}
      this._filteredVadStream = null;
    }
    if (this._silentRecorderGain) {
      try { this._silentRecorderGain.disconnect(); } catch (_) {}
      this._silentRecorderGain = null;
    }
    if (this.mediaStreamSource) {
      try { this.mediaStreamSource.disconnect(); } catch (_) {}
      this.mediaStreamSource = null;
    }
  },

  setSystemMode(mode) {
    this.currentSystemMode = mode;
    this.isOCRModeActive = (mode === 'ocr' || mode === 'auto');
    this.isHybridModeActive = (mode === 'auto');
    if (mode === 'whisper') {
      this.hasActiveHardSubtitles = false;
    }
    this.detectedOCRLanguage = null;
    this.autoDetectedSourceLang = null;
    this.lastOCRText = '';
    this.lastCleanText = '';
    if (this.systemCaptureMode) {
      const radioVal = mode === 'whisper' ? 'audio_only' : (mode === 'ocr' ? 'hard_sub' : 'auto');
      this.setRadioGroupValue(this.systemCaptureMode, radioVal);
      try { localStorage.setItem('livesub_system_capture_mode', radioVal); } catch (_) {}
    }
    if (this.chkEnableWhisper) {
      this.chkEnableWhisper.checked = (mode === 'whisper' || mode === 'auto');
    }
    if (this.isListening && this.mediaStream) {
      if (mode === 'ocr') {
        if (this.neuralVAD) try { this.neuralVAD.pause(); } catch (_) {}
        this.startHardSubtitleOCR(this.mediaStream);
      } else if (mode === 'whisper') {
        this.stopHardSubtitleOCR();
        this.hasActiveHardSubtitles = false;
        this.setupVADAndRecording(this.mediaStream);
      } else {
        this.startHardSubtitleOCR(this.mediaStream);
        this.setupVADAndRecording(this.mediaStream);
      }
    }
    this.populateSourceLangOptions(mode);
    if (mode === 'ocr') {
      if (this.btnModeSub) this.btnModeSub.classList.add('active');
      if (this.btnModeAudio) this.btnModeAudio.classList.remove('active');
      if (this.btnModeHybrid) this.btnModeHybrid.classList.remove('active');
      if (this.lblSourceLang) this.lblSourceLang.textContent = 'Ngôn Ngữ Phụ Đề:';
      if (!this.isListening && this.btnSystemAudioText) {
        this.btnSystemAudioText.textContent = 'BẮT ĐẦU ĐỌC & LỒNG TIẾNG SUB';
      }
      if (this.oneTouchDetectionPill) {
        this.oneTouchDetectionPill.innerHTML = '📷 Đang đọc sub OCR (~150ms)';
      }
    } else if (mode === 'auto') {
      if (this.btnModeSub) this.btnModeSub.classList.remove('active');
      if (this.btnModeAudio) this.btnModeAudio.classList.remove('active');
      if (this.btnModeHybrid) this.btnModeHybrid.classList.add('active');
      if (this.lblSourceLang) this.lblSourceLang.textContent = 'Ngôn Ngữ Video:';
      if (!this.isListening && this.btnSystemAudioText) {
        this.btnSystemAudioText.textContent = 'BẮT ĐẦU XEM & DỊCH TỰ ĐỘNG';
      }
      if (this.oneTouchDetectionPill) {
        this.oneTouchDetectionPill.innerHTML = '⚡ Chế độ Hybrid: Tự động OCR + Whisper GPU';
      }
    } else {
      if (this.btnModeSub) this.btnModeSub.classList.remove('active');
      if (this.btnModeAudio) this.btnModeAudio.classList.add('active');
      if (this.btnModeHybrid) this.btnModeHybrid.classList.remove('active');
      if (this.lblSourceLang) this.lblSourceLang.textContent = 'Tiếng Nói Nhân Vật:';
      if (!this.isListening && this.btnSystemAudioText) {
        this.btnSystemAudioText.textContent = 'BẮT ĐẦU NGHE & LỒNG TIẾNG (WHISPER)';
      }
      if (this.oneTouchDetectionPill) {
        this.oneTouchDetectionPill.innerHTML = '🎙️ Đang nghe Whisper GPU (~0.3s)';
      }
    }
    this.updateAppliedSettings();
  },

  async toggleSystemAudio() {
    if (this.isListening && this.activeSource === 'system') {
      this.stopListening();
      return;
    }

    this.cleanupYouTubePlayback();
    this.ensureAudioUnlocked();
    const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
    if (AudioCtx) {
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }
    }

    this.stopListening();
    try {
      this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      const audioTracks = this.mediaStream.getAudioTracks();
      const hasAudio = audioTracks.length > 0;
      if (!hasAudio) {
        this.showToast('ℹ️ Chế độ Đọc chữ (OCR) trên video đang hoạt động. Nếu cần nghe âm thanh, hãy chọn lại và tích "Chia sẻ âm thanh"!');
      }

      this.activeSource = 'system';
      this.isListening = true;
      this.detectedOCRLanguage = null;
      this.hasActiveHardSubtitles = false;
      this.hasSeenHardSubtitles = false;
      this._hasNotifiedVietsubMode = false;
      this.lastHardSubTime = 0;
      const isWhisperMode = this.currentSystemMode === 'whisper';
      const isAutoMode = this.currentSystemMode === 'auto';
      this.isOCRModeActive = !isWhisperMode;
      this.isHybridModeActive = isAutoMode;
      this.btnSystemAudioText.textContent = 'Dừng Xem & Lồng Tiếng';
      this.btnToggleSystemAudio.classList.remove('btn-primary');
      this.btnToggleSystemAudio.classList.add('btn-danger');

      this.mediaStream.getVideoTracks().forEach(track => {
        track.onended = () => this.stopListening();
      });

      this.showToast('🎬 Đã kết nối video! Hãy phát phim để tự động lồng tiếng.');
      this.updateMasterDubUI();

      if (isWhisperMode) {
        this.showToast('🎙️ Chế độ Whisper GPU: Đang nghe tiếng nói từ video...');
        if (hasAudio) {
          await this.setupVADAndRecording(this.mediaStream);
        } else {
          this.showToast('⚠️ Hãy nhớ tích "Chia sẻ âm thanh / Share audio" khi chọn tab video để Whisper nghe được tiếng!');
        }
      } else if (isAutoMode) {
        this.showToast('⚡ Chế độ Hybrid: Quét OCR siêu tốc và tự động chuyển nghe Whisper khi không có phụ đề.');
        await this.startHardSubtitleOCR(this.mediaStream);
        if (hasAudio) {
          await this.setupVADAndRecording(this.mediaStream);
        }
      } else {
        this.showToast('📷 Chế độ đọc chữ (OCR): Đang quét phụ đề trên video...');
        await this.startHardSubtitleOCR(this.mediaStream);
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        alert('Lỗi thu âm hệ thống: ' + err.message);
      }
    }
  },

  // --- SOURCE 2: MICROPHONE ---

  async toggleMic() {
    if (this.isListening && this.activeSource === 'mic') {
      this.stopListening();
      return;
    }

    this.stopListening();
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this.activeSource = 'mic';
      this.btnMicText.textContent = 'Dừng Microphone';
      this.btnToggleMic.classList.remove('btn-primary');
      this.btnToggleMic.classList.add('btn-danger');

      this.showToast(' Đang lắng nghe qua Microphone!');
      await this.setupVADAndRecording(this.mediaStream);
    } catch (err) {
      alert('Không thể mở Microphone: ' + err.message);
    }
  },

  // --- SOURCE 4: WEB URL (YOUTUBE WITH MILLISECOND SUBTITLE & VOICE DUB) ---

  async setupVADAndRecording(stream) {
    this.cleanupAudioCapture();
    const audioTracks = stream && stream.getAudioTracks ? stream.getAudioTracks() : [];
    if (audioTracks.length === 0) {
      this.showToast('⚠️ Chưa có âm thanh từ video/tab! Hãy bấm Dừng rồi chọn lại và tích ô "Chia sẻ âm thanh / Share audio".');
      return false;
    }

    this.isListening = true;
    this.lastProcessedText = '';
    this.lastTranscriptContext = '';
    this.recentTranscriptPhrases = [];
    this.autoDetectedSourceLang = null;
    this.autoLanguageProbeCounter = 0;
    this._autoEmptyStreak = 0;
    this._pendingAutoLang = null;
    this._pendingAutoLangCount = 0;
    this.activeTranscriptionCount = 0;
    this.setStatus('recording', 'Đang lắng nghe âm thanh...');

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const audioStream = new MediaStream(audioTracks);
    this.mediaStreamSource = this.audioContext.createMediaStreamSource(audioStream);
    const sampleRate = this.audioContext.sampleRate || 48000;
    const scriptNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.scriptNode = scriptNode;

    this.pcmBuffers = [];
    this.currentChunkMaxRms = 0;
    this.consecutiveQuietBlocks = 0;
    this.preRollBuffers = [];
    this.isCapturingSpeech = false;
    this.captureStartedAt = 0;
    this.vadNoiseFloor = 0.0020;
    this.neuralVADActive = false;
    this._lastVadEventAt = performance.now();
    this._sustainedAudibleBlocks = 0;
    this._vadFlushingCeiling = false;

    const dispatchVadAudio16k = (audio) => {
      if (!this.isListening || (this.isOCRModeActive && this.hasActiveHardSubtitles) || !audio || audio.length < 3200) return;
      const wavBlob = this.encodeWAV16k([audio], 16000);
      wavBlob.livesubCapturedAt = this.captureStartedAt || performance.now();
      wavBlob.livesubFinalizedAt = performance.now();
      this.captureStartedAt = 0;
      this._lastVadEventAt = performance.now();
      this.realtimeMetrics.naturalSpeechSplits++;
      if (wavBlob.size > 800) this.sendSpeechPhraseToAI(wavBlob);
    };

    const triggerSendClause = (reason = 'natural') => {
      const minBlocks = Math.max(3, Math.round((0.4 * sampleRate) / 4096));
      if (this.pcmBuffers.length < minBlocks || this.currentChunkMaxRms < 0.0002) {
        this.pcmBuffers = [];
        this.currentChunkMaxRms = 0;
        this.consecutiveQuietBlocks = 0;
        this.preRollBuffers = [];
        this.isCapturingSpeech = false;
        this.captureStartedAt = 0;
        return;
      }

      const wavBlob = this.encodeWAV16k(this.pcmBuffers, sampleRate);
      wavBlob.livesubCapturedAt = this.captureStartedAt || performance.now();
      wavBlob.livesubFinalizedAt = performance.now();
      this.pcmBuffers = [];
      this.currentChunkMaxRms = 0;
      this.consecutiveQuietBlocks = 0;
      this.preRollBuffers = [];
      this.isCapturingSpeech = false;
      this.captureStartedAt = 0;
      this.zeroAudioCounter = 0;

      if (wavBlob && wavBlob.size > 800) {
        if (reason === 'hard-limit') this.realtimeMetrics.hardSpeechSplits++;
        else this.realtimeMetrics.naturalSpeechSplits++;
        this.sendSpeechPhraseToAI(wavBlob);
      }
    };

    // System audio is filtered into the speech band before VAD/Whisper. This is
    // deliberately mild: it suppresses bass/treble-heavy music without removing
    // quiet dialogue that overlaps the soundtrack.
    let recorderInput = this.mediaStreamSource;
    let vadStream = audioStream;
    if (this.activeSource === 'system') {
      const highPass = this.audioContext.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 90;
      highPass.Q.value = 0.707;
      const voicePresence = this.audioContext.createBiquadFilter();
      voicePresence.type = 'peaking';
      voicePresence.frequency.value = 2400;
      voicePresence.Q.value = 0.8;
      voicePresence.gain.value = 2.5;
      const lowPass = this.audioContext.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.frequency.value = 7600;
      lowPass.Q.value = 0.707;
      const vadDestination = this.audioContext.createMediaStreamDestination();
      this.mediaStreamSource.connect(highPass);
      highPass.connect(voicePresence);
      voicePresence.connect(lowPass);
      lowPass.connect(vadDestination);
      recorderInput = lowPass;
      vadStream = vadDestination.stream;
      this._filteredVadStream = vadStream;
      this._vocalFilterNodes = [highPass, voicePresence, lowPass, vadDestination];
    }

    if ((!this.isOCRModeActive || this.isHybridModeActive) && window.vad && window.vad.MicVAD) {
      try {
        if (window.ort && window.ort.env && window.ort.env.wasm) {
          window.ort.env.wasm.numThreads = 1;
        }
        this.neuralVAD = await window.vad.MicVAD.new({
          model: 'v5',
          baseAssetPath: '/vendor/vad/',
          onnxWASMBasePath: '/vendor/ort/',
          audioContext: this.audioContext,
          processorType: 'AudioWorklet',
          startOnLoad: false,
          getStream: async () => vadStream,
          pauseStream: async () => {},
          resumeStream: async () => vadStream,
          positiveSpeechThreshold: this.activeSource === 'system' ? 0.48 : 0.38,
          negativeSpeechThreshold: this.activeSource === 'system' ? 0.30 : 0.25,
          redemptionMs: 220,
          preSpeechPadMs: 180,
          minSpeechMs: this.activeSource === 'system' ? 220 : 160,
          submitUserSpeechOnPause: true,
          onSpeechStart: () => {
            this.captureStartedAt = performance.now();
            this._lastVadEventAt = performance.now();
          },
          onSpeechRealStart: () => {
            this._lastVadEventAt = performance.now();
          },
          onVADMisfire: () => {
            this.captureStartedAt = 0;
            this._lastVadEventAt = performance.now();
          },
          onFrameProcessed: () => {
            if (this.captureStartedAt && !this._vadFlushingCeiling) {
              const elapsed = performance.now() - this.captureStartedAt;
              if (elapsed > 2600 && this.neuralVAD && this.neuralVAD.frameProcessor && typeof this.neuralVAD.frameProcessor.endSegment === 'function') {
                this._vadFlushingCeiling = true;
                try {
                  this.neuralVAD.frameProcessor.endSegment((ev) => {
                    if (ev && ev.audio && ev.audio.length >= 3200) {
                      this.realtimeMetrics.hardSpeechSplits++;
                      dispatchVadAudio16k(ev.audio);
                    }
                  });
                } catch (_) {
                } finally {
                  this.captureStartedAt = 0;
                  this._vadFlushingCeiling = false;
                }
              }
            }
          },
          onSpeechEnd: (audio) => {
            dispatchVadAudio16k(audio);
          }
        });
        await this.neuralVAD.start();
        this.neuralVADActive = true;
        this._lastVadEventAt = performance.now();
        this.showToast('🎙️ Silero VAD + Whisper GPU đã bật!');
      } catch (error) {
        console.warn('Silero VAD unavailable; using adaptive RMS fallback', error);
        this.neuralVAD = null;
        this.neuralVADActive = false;
        this.showToast('🎙️ Whisper GPU đang nghe bằng bộ tách âm thanh RMS.');
      }
    }

    scriptNode.onaudioprocess = (e) => {
      if (!this.isListening) return;
      const input = e.inputBuffer.getChannelData(0);

      let sumSq = 0;
      for (let i = 0; i < input.length; i++) {
        sumSq += input[i] * input[i];
      }
      const rms = Math.sqrt(sumSq / input.length);
      const percent = Math.min(100, Math.round(rms * 100 * 12));

      if (this.audioMeterFill) this.audioMeterFill.style.width = `${percent}%`;
      if (this.meterPercentText) this.meterPercentText.textContent = `${percent}%`;

      if (rms < 0.0001) {
        this.zeroAudioCounter = (this.zeroAudioCounter || 0) + 1;
        if (this.zeroAudioCounter === 45 && this.isListening && this.activeSource === 'system') {
          this.showToast('⚠️ VAD 0%: Chưa nhận được tiếng! Hãy chắc chắn video đang phát và bạn đã tích ô "Chia sẻ âm thanh" (Share audio) khi chọn Tab.');
        }
      } else {
        this.zeroAudioCounter = 0;
      }

      if (this.neuralVADActive && !(this.isOCRModeActive && this.hasActiveHardSubtitles)) {
        if (rms >= 0.0045) {
          this._sustainedAudibleBlocks++;
        } else {
          this._sustainedAudibleBlocks = Math.max(0, this._sustainedAudibleBlocks - 1);
        }
        if (this._sustainedAudibleBlocks >= 30 && (performance.now() - (this._lastVadEventAt || 0)) > 2800) {
          console.warn('Silero VAD produced no speech events on audible audio; falling back to RMS VAD');
          this.neuralVADActive = false;
          if (this.neuralVAD) { try { this.neuralVAD.pause(); } catch (_) {} }
          this.showToast('⚡ Tự động chuyển sang bộ tách âm thanh RMS cho Whisper.');
        }
      }

      if (this.neuralVADActive || (this.isOCRModeActive && this.hasActiveHardSubtitles)) return;

      const block = new Float32Array(input);
      if (!this.isCapturingSpeech) {
        const speechStartThreshold = Math.max(0.0035, this.vadNoiseFloor * 1.65);
        this.preRollBuffers.push(block);
        if (this.preRollBuffers.length > 3) this.preRollBuffers.shift();
        if (rms >= speechStartThreshold) {
          this.isCapturingSpeech = true;
          this.captureStartedAt = performance.now() - (this.preRollBuffers.length * 4096 / sampleRate * 1000);
          this.pcmBuffers = this.preRollBuffers.slice();
          this.preRollBuffers = [];
          this.currentChunkMaxRms = rms;
          this.consecutiveQuietBlocks = 0;
        } else {
          this.vadNoiseFloor = this.vadNoiseFloor * 0.92 + Math.min(rms, 0.012) * 0.08;
        }
        return;
      }

      this.pcmBuffers.push(block);
      if (rms > this.currentChunkMaxRms) {
        this.currentChunkMaxRms = rms;
      }
      if (rms < this.currentChunkMaxRms * 0.55) {
        this.vadNoiseFloor = this.vadNoiseFloor * 0.95 + Math.min(rms, 0.012) * 0.05;
      }
      const speechEndThreshold = Math.max(0.0028, this.vadNoiseFloor * 1.25);
      if (rms < speechEndThreshold) {
        this.consecutiveQuietBlocks++;
      } else {
        this.consecutiveQuietBlocks = 0;
      }

      const maxBlocks = Math.round((2.8 * sampleRate) / 4096);
      const minSpeechBlocks = Math.round((0.5 * sampleRate) / 4096);
      const clauseSpeechBlocks = Math.round((1.4 * sampleRate) / 4096);

      if (this.pcmBuffers.length >= maxBlocks) {
        triggerSendClause('hard-limit');
      } else if (this.pcmBuffers.length >= clauseSpeechBlocks && this.consecutiveQuietBlocks >= 2 && this.currentChunkMaxRms >= 0.001) {
        triggerSendClause('clause-pause');
      } else if (this.pcmBuffers.length >= minSpeechBlocks && this.consecutiveQuietBlocks >= 3 && this.currentChunkMaxRms >= 0.001) {
        triggerSendClause('natural');
      }
    };

    recorderInput.connect(scriptNode);
    // ScriptProcessor must remain connected to run, but system audio must not be
    // echoed back to the speakers (which used to reinforce music and feedback).
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    scriptNode.connect(silentGain);
    silentGain.connect(this.audioContext.destination);
    this._silentRecorderGain = silentGain;
    return true;
  },

  // Pure 16-bit Mono WAV 16,000 Hz Encoder (Anti-aliased box-averaged downsampling for Whisper)

  encodeWAV16k(samplesArrays, inputSampleRate) {
    let totalInputLen = 0;
    for (let i = 0; i < samplesArrays.length; i++) {
      totalInputLen += samplesArrays[i].length;
    }
    const fullInput = new Float32Array(totalInputLen);
    let pos = 0;
    for (let i = 0; i < samplesArrays.length; i++) {
      fullInput.set(samplesArrays[i], pos);
      pos += samplesArrays[i].length;
    }

    const targetSampleRate = 16000;
    let resampled;
    if (inputSampleRate === targetSampleRate) {
      resampled = fullInput;
    } else {
      const ratio = inputSampleRate / targetSampleRate;
      const targetLength = Math.max(1, Math.floor(fullInput.length / ratio));
      resampled = new Float32Array(targetLength);
      for (let i = 0; i < targetLength; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(fullInput.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
        let sum = 0;
        for (let j = start; j < end; j++) {
          sum += fullInput[j];
        }
        resampled[i] = sum / (end - start);
      }
    }

    const buffer = new ArrayBuffer(44 + resampled.length * 2);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + resampled.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, targetSampleRate, true);
    view.setUint32(28, targetSampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, resampled.length * 2, true);

    let offset = 44;
    for (let i = 0; i < resampled.length; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([view], { type: 'audio/wav' });
  },

  async sendSpeechPhraseToAI(audioBlob) {
    return this.enqueueSpeechPhrase(audioBlob);
  },

  enqueueSpeechPhrase(audioBlob) {
    if (this.isOCRModeActive && this.hasActiveHardSubtitles) return Promise.resolve();
    if (!audioBlob || (typeof audioBlob.size === 'number' && audioBlob.size < 1000)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      // A very small bounded queue prevents an old scene from being recognized
      // after the video has already moved on. Two GPU requests may overlap.
      const now = performance.now();
      while (
        this.speechQueue.length > 0
        && (now - (this.speechQueue[0].finalizedAt || now)) > 2500
      ) {
        const stale = this.speechQueue.shift();
        if (stale && stale.resolve) stale.resolve();
        this.realtimeMetrics.staleSpeechDrops = (this.realtimeMetrics.staleSpeechDrops || 0) + 1;
      }
      while (this.speechQueue.length >= this.maxSpeechQueueSize) {
        const stale = this.speechQueue.shift();
        if (stale && stale.resolve) stale.resolve();
        this.realtimeMetrics.staleSpeechDrops = (this.realtimeMetrics.staleSpeechDrops || 0) + 1;
      }
      this.speechQueue.push({
        audioBlob,
        resolve,
        sequence: ++this.liveSpeechSequence,
        capturedAt: audioBlob.livesubCapturedAt || performance.now(),
        finalizedAt: audioBlob.livesubFinalizedAt || performance.now()
      });
      this.drainSpeechQueue();
    });
  },

  drainSpeechQueue() {
    if (this.isListening === false) return;
    this.isProcessingSpeechQueue = true;
    while (this.activeTranscriptionCount < this.maxConcurrentTranscriptions && this.speechQueue.length > 0) {
      const item = this.speechQueue.shift();
      this.activeTranscriptionCount++;
      this.processSpeechPhrase(item.audioBlob, item.sequence, item)
        .catch(() => {})
        .finally(() => {
          this.activeTranscriptionCount = Math.max(0, this.activeTranscriptionCount - 1);
          item.resolve();
          if (this.speechQueue.length > 0 && this.isListening !== false) this.drainSpeechQueue();
          else if (this.activeTranscriptionCount === 0) this.isProcessingSpeechQueue = false;
        });
    }
  },

  async processSpeechPhrase(audioBlob, sequence = 0, captureMeta = null) {
    if (this.isOCRModeActive && this.hasActiveHardSubtitles) return;

    this.isTranscribing = true;
    this.setStatus('active', 'AI nhận diện GPU & dịch...');

    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.wav');
    const selectedSourceLang = this.sourceLangSelect ? this.sourceLangSelect.value : 'auto';
    // Auto-detect exactly once per capture session, then keep the language
    // fixed. Re-detecting every few lines adds latency and can flip languages
    // because of names, music or a short ambiguous phrase.
    const effectiveSourceLang = selectedSourceLang === 'auto' && this.autoDetectedSourceLang
      ? this.autoDetectedSourceLang
      : selectedSourceLang;
    formData.append('source_lang', effectiveSourceLang || 'auto');
    // Return ASR + translation immediately. TTS is generated on a separate
    // ordered chain so subtitles are not blocked by voice synthesis.
    formData.append('dubbing', 'false');
    formData.append('voice', this.getEffectiveVoice());
    formData.append('previous_context', this.lastTranscriptContext || '');
    if (!this.realtimeSessionId) this.realtimeSessionId = `s-${Date.now()}`;
    formData.append('session_id', this.realtimeSessionId);
    if (!this._transcribeSequence) this._transcribeSequence = 0;
    this._transcribeSequence++;
    formData.append('sequence', String(this._transcribeSequence));

    const requestController = new AbortController();
    this.activeAbortController = requestController;
    if (!this.transcriptionAbortControllers) this.transcriptionAbortControllers = new Set();
    this.transcriptionAbortControllers.add(requestController);
    const requestTimeout = setTimeout(() => requestController.abort(), 4500);

    try {
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
        signal: requestController.signal
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.warn(`Transcribe HTTP ${response.status}:`, errText);
        if (!this._lastWhisperErrAt || (performance.now() - this._lastWhisperErrAt) > 5000) {
          this._lastWhisperErrAt = performance.now();
          this.showToast(`⚠️ Whisper GPU chưa sẵn sàng (${response.status}). Đang thử lại...`);
        }
        return;
      }

      const data = await response.json();
      // The newest valid phrase wins. A slow older request must never block or
      // overwrite the subtitle, context and voice for the current scene.
      const resultAgeMs = captureMeta && captureMeta.finalizedAt
        ? performance.now() - captureMeta.finalizedAt
        : 0;
      if (resultAgeMs > 3200 || sequence <= (this.lastCommittedSpeechSequence || 0)) {
        this.realtimeMetrics.staleSpeechDrops = (this.realtimeMetrics.staleSpeechDrops || 0) + 1;
        return;
      }
      this.lastCommittedSpeechSequence = sequence;
      if (data.timings) this.realtimeMetrics.lastServerTimings = data.timings;
      if (this.isOCRModeActive && this.hasActiveHardSubtitles) return;
      if (data.empty || !data.original) {
        this._autoEmptyStreak = (this._autoEmptyStreak || 0) + 1;
        if (selectedSourceLang === 'auto' && this._autoEmptyStreak >= 2) {
          this.autoDetectedSourceLang = null;
          this._pendingAutoLang = null;
          this._pendingAutoLangCount = 0;
        }
      } else {
        this._autoEmptyStreak = 0;
      }

      if (selectedSourceLang === 'auto' && data.detected_lang && ['vi', 'ja', 'en', 'zh', 'ko', 'th'].includes(data.detected_lang) && data.original) {
        if (this._pendingAutoLang === data.detected_lang) {
          this._pendingAutoLangCount = (this._pendingAutoLangCount || 0) + 1;
        } else {
          this._pendingAutoLang = data.detected_lang;
          this._pendingAutoLangCount = 1;
        }
        // Require 2 consecutive phrases of the same detected language before locking
        // so a single loanword or intro doesn't mis-lock the entire video session.
        if (this._pendingAutoLangCount >= 2) {
          this.autoDetectedSourceLang = data.detected_lang;
        }
      }

      if (!data.empty && data.original) {
        const viText = (data.translated && data.translated.trim()) ? data.translated.trim() : data.original.trim();
        if (data.original.toLowerCase() !== this.lastProcessedText.toLowerCase()) {
          this.lastProcessedText = data.original;
          if (!Array.isArray(this.recentTranscriptPhrases)) this.recentTranscriptPhrases = [];
          this.recentTranscriptPhrases.push(data.original.trim());
          if (this.recentTranscriptPhrases.length > 4) this.recentTranscriptPhrases.shift();
          this.lastTranscriptContext = this.recentTranscriptPhrases.join(' ').trim();
          const record = this.addHistory(data.original, viText, data.detected_lang || 'auto');

          this.displaySubtitle(data.original, viText);
          if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = viText;
          if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = data.original;

          const captureDuration = (captureMeta && captureMeta.capturedAt && captureMeta.finalizedAt)
            ? Math.max(0, (captureMeta.finalizedAt - captureMeta.capturedAt) / 1000)
            : 0;

          if (this.isDubbingEnabled) {
            this.enqueueLiveDubbing(
              viText,
              record.id,
              data.original,
              captureMeta ? captureMeta.capturedAt : performance.now(),
              captureMeta ? captureMeta.finalizedAt : performance.now(),
              data.timings || null,
              captureDuration
            );
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Transcribe error:', err);
      }
    } finally {
      clearTimeout(requestTimeout);
      if (this.transcriptionAbortControllers) this.transcriptionAbortControllers.delete(requestController);
      this.isTranscribing = this.transcriptionAbortControllers && this.transcriptionAbortControllers.size > 0;
      if (this.activeAbortController === requestController) this.activeAbortController = null;
      if (this.isListening && !this.isTranscribing) {
        this.setStatus('recording', 'Đang lắng nghe âm thanh...');
      }
    }
  },

  cancelTranscription() {
    if (this.transcriptionAbortControllers) {
      for (const controller of this.transcriptionAbortControllers) controller.abort();
      this.transcriptionAbortControllers.clear();
    }
    if (this.activeAbortController) this.activeAbortController.abort();
    this.activeAbortController = null;
  },

  stopListening() {
    this.isListening = false;
    if (typeof this.cancelBackendTtsWork === 'function') this.cancelBackendTtsWork();
    this.stopHardSubtitleOCR();
    this.isOCRModeActive = false;
    this.dubbingGeneration++;
    this.liveDubbingQueue = [];
    this.isProcessingLiveDubbing = false;
    this.lastProcessedText = '';
    this.lastTranscriptContext = '';
    this.recentTranscriptPhrases = [];
    this.autoDetectedSourceLang = null;
    this.autoLanguageProbeCounter = 0;
    this._autoEmptyStreak = 0;
    this._pendingAutoLang = null;
    this._pendingAutoLangCount = 0;
    this.isSpeaking = false;
    this.silenceFrames = 0;
    this.pcmBuffers = [];
    this.stopAllAudio();
    this.cancelTranscription();
    while (this.speechQueue.length) {
      const queued = this.speechQueue.shift();
      if (queued && queued.resolve) queued.resolve();
    }
    this.lastCommittedSpeechSequence = this.liveSpeechSequence;

    this.cleanupAudioCapture();

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }

    this.audioMeterFill.style.width = '0%';
    this.meterPercentText.textContent = '0%';

    this.hasActiveHardSubtitles = false;
    this.btnSystemAudioText.textContent = 'BẮT ĐẦU XEM & DỊCH TỰ ĐỘNG (1 CHẠM)';
    this.btnToggleSystemAudio.classList.remove('btn-danger');
    this.btnToggleSystemAudio.classList.add('btn-primary');
    if (this.btnSystemAudioText) {
      this.btnSystemAudioText.textContent = (this.currentSystemMode === 'whisper')
        ? 'BẮT ĐẦU NGHE & LỒNG TIẾNG (WHISPER)'
        : 'BẮT ĐẦU ĐỌC & LỒNG TIẾNG SUB';
    }
    this.updateYouTubeCaptureButtonUI();
    this.updateMasterDubUI();

    if (this.btnMicText) this.btnMicText.textContent = 'Bật Microphone';
    if (this.btnToggleMic) {
      this.btnToggleMic.classList.remove('btn-danger');
      this.btnToggleMic.classList.add('btn-primary');
    }

    this.setStatus('ready', 'Sẵn sàng');
  }

  }
