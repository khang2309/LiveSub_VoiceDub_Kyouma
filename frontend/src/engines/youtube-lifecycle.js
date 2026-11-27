// LiveSub engine component: youtube-lifecycle
export default {
  cancelBackendTtsWork() {
    this.ttsRequestGeneration = Math.max(Date.now(), (this.ttsRequestGeneration || 0) + 1);
    if (typeof fetch === 'function') {
      fetch('/api/tts-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generation: this.ttsRequestGeneration }),
        keepalive: true
      }).catch(() => {});
    }
  },

  stopYouTubePrefetch({ stopAudio = true } = {}) {
    this.cancelBackendTtsWork();
    this._isYtPrefetchWorkerRunning = false;
    this._ytPrefetchGeneration = (this._ytPrefetchGeneration || 0) + 1;
    if (this.ytPrefetchAbortController) {
      try { this.ytPrefetchAbortController.abort(); } catch (_) {}
      this.ytPrefetchAbortController = null;
    }
    if (this.liveTtsPrefetch && typeof this.liveTtsPrefetch.values === 'function') {
      for (const entry of this.liveTtsPrefetch.values()) {
        if (entry && entry.controller) {
          try { entry.controller.abort(); } catch (_) {}
        }
      }
      this.liveTtsPrefetch.clear();
    }
    if (this.isFetchingPreCache?.clear) this.isFetchingPreCache.clear();
    if (this.audioPreCache?.clear) this.audioPreCache.clear();
    if (this.ytPrefetchedAudioIndices?.clear) this.ytPrefetchedAudioIndices.clear();
    this._ytSequentialPrefetchCursor = 0;
    this.liveDubbingQueue = [];
    this.isProcessingLiveDubbing = false;
    this.voiceGeneration = (this.voiceGeneration || 0) + 1;
    this.playbackGeneration = (this.playbackGeneration || 0) + 1;
    this.dubbingGeneration = (this.dubbingGeneration || 0) + 1;
    if (stopAudio && typeof this.stopDubbingAudio === 'function') {
      this.stopDubbingAudio(true, false);
    }
  },

  cleanupYouTubePlayback() {
    this.youtubeLoadGeneration = (this.youtubeLoadGeneration || 0) + 1;
    if (this.youtubeSubtitleAbortController) {
      try { this.youtubeSubtitleAbortController.abort(); } catch (_) {}
      this.youtubeSubtitleAbortController = null;
    }
    this.stopYouTubePrefetch({ stopAudio: false });
    if (this.ytSyncRemainingTimer) {
      clearTimeout(this.ytSyncRemainingTimer);
      this.ytSyncRemainingTimer = null;
    }
    if (this.ytSyncInterval) {
      clearInterval(this.ytSyncInterval);
      this.ytSyncInterval = null;
    }
    if (this.ytRestoreVolumeTimer) {
      clearTimeout(this.ytRestoreVolumeTimer);
      this.ytRestoreVolumeTimer = null;
    }
    if (this.ytOverrunHoldTimer) {
      clearTimeout(this.ytOverrunHoldTimer);
      this.ytOverrunHoldTimer = null;
    }
    if (this.ytInitialGateTimer) {
      clearTimeout(this.ytInitialGateTimer);
      this.ytInitialGateTimer = null;
    }
    if (this.ytPlayer) {
      try {
        if (typeof this.ytPlayer.pauseVideo === 'function') this.ytPlayer.pauseVideo();
        if (typeof this.ytPlayer.stopVideo === 'function') this.ytPlayer.stopVideo();
        if (typeof this.ytPlayer.destroy === 'function') this.ytPlayer.destroy();
      } catch (_) {}
      this.ytPlayer = null;
    }
    if (typeof document !== 'undefined') {
      const playerContainer = document.getElementById('webVideoPlayer');
      if (playerContainer) playerContainer.innerHTML = '';
      if (this.webVideoContainer) {
        this.webVideoContainer.style.display = 'none';
        this.webVideoContainer.classList.remove('show-controls');
        if (document.fullscreenElement === this.webVideoContainer && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }
    }
    this.ytSegments = [];
    this.ytCaptionLanguage = null;
    if (this.ytPrefetchedAudioIndices?.clear) this.ytPrefetchedAudioIndices.clear();
    this._ytSequentialPrefetchCursor = 0;
    this.currentYtSegmentIdx = -1;
    this.lastSentenceArrivalGapMs = 0;
    this.lastEnqueueTime = 0;
    this.isHoldingYtForDubbing = false;
    this.ytShouldResumeAfterHold = false;
    this.ytInitialStartGate = false;
    this.ytInitialPlayerReady = false;
    this.ytInitialVoiceReady = false;
    this._ytSeekGeneration = (this._ytSeekGeneration || 0) + 1;
    this._ytSeekInProgress = false;
    this._cropOcrToEmbeddedVideo = false;
    if (typeof this.updateOcrFeedbackGuard === 'function') this.updateOcrFeedbackGuard();
    this.isYtDucked = false;

    this.liveDubbingQueue = [];
    this.isProcessingLiveDubbing = false;
    this.speechQueue = [];
    this.isProcessingSpeechQueue = false;
    this.playbackGeneration = (this.playbackGeneration || 0) + 1;
    this.dubbingGeneration = (this.dubbingGeneration || 0) + 1;

    if (typeof this.stopDubbingAudio === 'function') {
      this.stopDubbingAudio(false, false);
    }
    if (this.isListening && this.activeSource === 'weburl' && typeof this.stopListening === 'function') {
      this.stopListening();
    }
    if (typeof this.releaseYouTubeDubbingHold === 'function') {
      this.releaseYouTubeDubbingHold();
    }
    if (typeof this.restoreYouTubeVolumeNow === 'function') {
      this.restoreYouTubeVolumeNow();
    }
    if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = '';
    if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = '';
    this.lastOCRText = '';
    this.lastCleanText = '';
    this.recentOCRHistory = [];
    this.ocrConsecutiveEmpty = 0;
  },

  toggleWebVideoFullscreen() {
    const container = this.webVideoContainer;
    if (!container) return;
    const isDoc = typeof document !== 'undefined';
    const isFs = isDoc && Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFs) {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      } else if (container.webkitRequestFullscreen) {
        container.webkitRequestFullscreen();
      }
    } else if (isDoc) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen().catch(() => {});
      }
    }
  },

  handleFullscreenChange() {
    const isDoc = typeof document !== 'undefined';
    const isFs = isDoc && Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (this.btnFullscreenWebVideoText) {
      this.btnFullscreenWebVideoText.textContent = isFs ? '🗗 Thu Nhỏ (Esc)' : '⛶ Toàn Màn Hình';
    }
    if (this.btnFullscreenWebVideo) {
      this.btnFullscreenWebVideo.title = isFs ? 'Thoát chế độ toàn màn hình (Phím Esc)' : 'Phóng to toàn màn hình (Luôn hiện phụ đề)';
    }

    if (this._fsHideTimer) {
      clearTimeout(this._fsHideTimer);
      this._fsHideTimer = null;
    }

    if (isFs && this.webVideoContainer) {
      const topBar = this.webVideoContainer.querySelector('.video-top-bar');
      const resetFsTimer = () => {
        const currentlyFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
        if (!currentlyFs || !this.webVideoContainer) return;
        this.webVideoContainer.classList.add('show-controls');
        if (this._fsHideTimer) clearTimeout(this._fsHideTimer);
        this._fsHideTimer = setTimeout(() => {
          if (this.webVideoContainer && !this._isTopBarHovered) {
            this.webVideoContainer.classList.remove('show-controls');
          }
        }, 2500);
      };

      if (!this._fsMouseMoveBound && isDoc) {
        this._fsMouseMoveBound = true;
        document.addEventListener('mousemove', (e) => {
          const currentlyFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
          if (!currentlyFs) return;
          if (e.clientY <= 100) {
            this.webVideoContainer.classList.add('show-controls');
          }
          resetFsTimer();
        });
      }

      if (topBar && !this._topBarHoverBound) {
        this._topBarHoverBound = true;
        topBar.addEventListener('mouseenter', () => {
          this._isTopBarHovered = true;
          if (this._fsHideTimer) clearTimeout(this._fsHideTimer);
          if (this.webVideoContainer) this.webVideoContainer.classList.add('show-controls');
        });
        topBar.addEventListener('mouseleave', () => {
          this._isTopBarHovered = false;
          resetFsTimer();
        });
      }

      // Enter fullscreen: reveal controls and schedule auto-hide after 2.5s of idle
      this.webVideoContainer.classList.add('show-controls');
      this._fsHideTimer = setTimeout(() => {
        if (this.webVideoContainer && !this._isTopBarHovered) {
          this.webVideoContainer.classList.remove('show-controls');
        }
      }, 2500);
    } else if (this.webVideoContainer) {
      this.webVideoContainer.classList.remove('show-controls');
      if (this._fsHideTimer) {
        clearTimeout(this._fsHideTimer);
        this._fsHideTimer = null;
      }
    }
  },

  setYouTubeMode(mode) {
    const valid = ['has_captions', 'hard_sub', 'audio_only'].includes(mode) ? mode : 'has_captions';
    const previousMode = this.currentYtMode;
    if (previousMode === 'has_captions' && valid !== 'has_captions') {
      this.youtubeLoadGeneration = (this.youtubeLoadGeneration || 0) + 1;
      if (this.youtubeSubtitleAbortController) {
        try { this.youtubeSubtitleAbortController.abort(); } catch (_) {}
        this.youtubeSubtitleAbortController = null;
      }
      this.stopYouTubePrefetch();
    }
    this.currentYtMode = valid;
    if (this.webCaptionMode) {
      this.setRadioGroupValue(this.webCaptionMode, valid);
    }
    try { localStorage.setItem('livesub_caption_mode', valid); } catch (_) {}

    if (this.btnYtModeCC) this.btnYtModeCC.classList.toggle('active', valid === 'has_captions');
    if (this.btnYtModeOCR) this.btnYtModeOCR.classList.toggle('active', valid === 'hard_sub');
    if (this.btnYtModeWhisper) this.btnYtModeWhisper.classList.toggle('active', valid === 'audio_only');

    if (this.ytLiveCaptureControls) {
      this.ytLiveCaptureControls.style.display = (valid === 'hard_sub' || valid === 'audio_only') ? 'flex' : 'none';
    }
    if (this.ytOcrZoneSelect) {
      this.ytOcrZoneSelect.style.display = (valid === 'hard_sub') ? 'inline-block' : 'none';
      this.ytOcrZoneSelect.value = this.ocrScanZone || 'bottom';
    }
    this.updateYouTubeCaptureButtonUI();
    this.updateSourceIntelligenceControls();
    this.updateAppliedSettings();
  },

  updateYouTubeCaptureButtonUI() {
    if (!this.btnYtLiveCapture || !this.btnYtLiveCaptureText) return;
    const isYtCapturing = this.isListening && this.activeSource === 'weburl';
    if (isYtCapturing) {
      this.btnYtLiveCapture.classList.remove('btn-primary');
      this.btnYtLiveCapture.classList.add('btn-danger');
      this.btnYtLiveCaptureText.textContent = (this.currentYtMode === 'hard_sub')
        ? '⏹ Dừng Quét Sub OCR'
        : '⏹ Dừng Nghe Whisper';
    } else {
      this.btnYtLiveCapture.classList.remove('btn-danger');
      this.btnYtLiveCapture.classList.add('btn-primary');
      this.btnYtLiveCaptureText.textContent = (this.currentYtMode === 'hard_sub')
        ? '📷 Bắt Đầu Quét Sub OCR'
        : '🎙️ Bắt Đầu Nghe Whisper';
    }
  },

  renderYouTubeNoCaptionsFallback(message) {
    if (!this.webSyncNotice) return;
    this.webSyncNotice.innerHTML = `
      <div>⚠️ <strong>${this.escapeHtml(message)}</strong></div>
      <div style="margin-top: 4px; color: var(--text-muted);">Video này không có phụ đề CC sẵn. Chọn trực tiếp bên dưới để tiếp tục dịch & lồng tiếng:</div>
      <div class="yt-fallback-actions">
        <button type="button" class="btn btn-primary btn-sm" id="btnYtFallbackWhisper">🎙️ Bật Nghe Whisper ngay</button>
        <button type="button" class="btn btn-secondary btn-sm" id="btnYtFallbackOCR">📷 Bật Quét Sub OCR ngay</button>
      </div>
    `;
    this.webSyncNotice.style.display = 'block';
    const btnW = document.getElementById('btnYtFallbackWhisper');
    const btnO = document.getElementById('btnYtFallbackOCR');
    if (btnW) btnW.addEventListener('click', () => this.startYouTubeLiveCapture('audio_only'));
    if (btnO) btnO.addEventListener('click', () => this.startYouTubeLiveCapture('hard_sub'));
  },

  async startYouTubeLiveCapture(forcedMode = null) {
    if (forcedMode) {
      this.setYouTubeMode(forcedMode);
    }
    if (this.isListening && this.activeSource === 'weburl') {
      this.stopListening();
      return;
    }

    const mode = this.currentYtMode === 'hard_sub' ? 'hard_sub' : 'audio_only';
    // CC synthesis can occupy both global TTS workers. Release it before OCR or
    // Whisper starts so the new live source is never queued behind stale audio.
    this.stopYouTubePrefetch();
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

    if (this.isListening) {
      this.stopListening();
    }

    const resumeEmbeddedVideo = Boolean(
      this.ytPlayer
      && typeof this.ytPlayer.getPlayerState === 'function'
      && this.ytPlayer.getPlayerState() === 1
    );
    if (resumeEmbeddedVideo && typeof this.ytPlayer.pauseVideo === 'function') {
      try { this.ytPlayer.pauseVideo(); } catch (_) {}
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        preferCurrentTab: true,
        selfBrowserSurface: 'include'
      });

      const audioTracks = this.mediaStream.getAudioTracks();
      const hasAudio = audioTracks.length > 0;

      this.activeSource = 'weburl';
      this.isListening = true;
      this.detectedOCRLanguage = null;
      this.hasActiveHardSubtitles = false;
      this.hasSeenHardSubtitles = false;
      this._hasNotifiedVietsubMode = false;
      this.isOCRModeActive = (mode === 'hard_sub');
      this._cropOcrToEmbeddedVideo = (mode === 'hard_sub');
      this.updateOcrFeedbackGuard();
      this.isHybridModeActive = false;

      this.mediaStream.getVideoTracks().forEach(track => {
        track.onended = () => {
          if (this.isListening && this.activeSource === 'weburl') {
            this.stopListening();
          }
        };
      });

      this.updateYouTubeCaptureButtonUI();
      this.updateMasterDubUI();

      if (mode === 'hard_sub') {
        if (this.webSyncNotice) {
          this.webSyncNotice.innerHTML = '📷 <strong>Đang quét phụ đề OCR</strong> trực tiếp trên khung hình video YouTube.';
          this.webSyncNotice.style.display = 'block';
        }
        this.showToast('📷 Đang quét phụ đề OCR cho video YouTube!');
        await this.startHardSubtitleOCR(this.mediaStream);
      } else {
        if (!hasAudio) {
          if (this.webSyncNotice) {
            this.webSyncNotice.innerHTML = '⚠️ <strong>Chưa nhận được âm thanh!</strong> Khi chọn chia sẻ cửa sổ/tab, hãy chọn tab/màn hình đang phát YouTube và nhớ tích ô <em>"Chia sẻ âm thanh" (Share audio)</em>.';
            this.webSyncNotice.style.display = 'block';
          }
          this.showToast('⚠️ Hãy chọn lại và tích "Chia sẻ âm thanh" để Whisper nghe được tiếng!');
        } else {
          if (this.webSyncNotice) {
            this.webSyncNotice.innerHTML = '🎙️ <strong>Whisper GPU CUDA đang nghe tiếng nói</strong> từ video YouTube và lồng tiếng realtime.';
            this.webSyncNotice.style.display = 'block';
          }
          this.showToast('🎙️ Whisper GPU đang nghe âm thanh YouTube!');
          await this.setupVADAndRecording(this.mediaStream);
        }
      }
      if (resumeEmbeddedVideo && this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
        try { this.ytPlayer.playVideo(); } catch (_) {}
      }
    } catch (err) {
      if (resumeEmbeddedVideo && this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
        try { this.ytPlayer.playVideo(); } catch (_) {}
      }
      if (err && err.name !== 'NotAllowedError') {
        this.showToast('❌ Lỗi bật ' + (mode === 'hard_sub' ? 'OCR' : 'Whisper') + ': ' + err.message);
      }
    }
  },
}
