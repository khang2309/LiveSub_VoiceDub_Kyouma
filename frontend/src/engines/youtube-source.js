// LiveSub engine component: youtube-source
export default {
  buildYouTubeSubtitleRequest(url) {
    const mode = this.currentYtMode || (this.webCaptionMode ? (this.webCaptionMode.value || (typeof this.getRadioGroupValue === 'function' && this.getRadioGroupValue(this.webCaptionMode)) || 'has_captions') : 'has_captions');
    let lang = this.webCaptionLanguage ? (this.webCaptionLanguage.value || (typeof this.getRadioGroupValue === 'function' && this.getRadioGroupValue(this.webCaptionLanguage)) || null) : null;
    if (!lang) {
      const el = this.sourceLangSelect || this.sourceLang || (typeof document !== 'undefined' && document.getElementById ? document.getElementById('sourceLang') : null);
      const rawLang = el ? el.value : 'auto';
      lang = (rawLang === 'auto') ? null : rawLang.split(/[-_]/)[0];
    }
    return {
      url,
      target_lang: 'vi',
      caption_mode: mode,
      caption_language: lang
    };
  },

  async loadWebVideo(customUrl = null) {
    const val = (customUrl || this.webUrlInput.value).trim();
    if (!val) return;
    this.webUrlInput.value = val;

    const match = val.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (!match || !match[1]) {
      alert('Mục này chỉ hỗ trợ nhúng link video YouTube (VD: https://www.youtube.com/watch?v=...).\n\nĐối với các trang web phim khác (như AnimeHay, Bilibili, Netflix, v.v.), bạn hãy mở phim trên một tab riêng của trình duyệt, sau đó quay lại LiveSub chọn tab đầu tiên "Âm Thanh Hệ Thống / Mọi Ứng Dụng" rồi bấm "Bắt Đầu Xem & Lồng Tiếng"!');
      return;
    }
    const videoId = match[1];
    this.stopYouTubePrefetch();
    const loadGeneration = ++this.youtubeLoadGeneration;
    let playerInitialized = false;
    if (this.youtubeSubtitleAbortController) {
      this.youtubeSubtitleAbortController.abort();
    }
    this.youtubeSubtitleAbortController = new AbortController();

    this.webVideoContainer.style.display = 'block';
    if (this.webSyncNotice) this.webSyncNotice.style.display = 'none';
    const subtitleRequest = this.buildYouTubeSubtitleRequest(val);
    if (subtitleRequest.caption_mode === 'audio_only') {
      if (this.webSyncNotice) {
        this.webSyncNotice.innerHTML = '🎙️ <strong>Chế độ Nghe Whisper:</strong> Phát video rồi bấm <strong>“🎙️ Bắt Đầu Nghe Whisper”</strong> ở trên và chọn tab/màn hình (tích Chia sẻ âm thanh).';
        this.webSyncNotice.style.display = 'block';
      }
      this.setSourceIntelligenceState('whisper', 'Whisper realtime', 'Đang bỏ qua CC theo lựa chọn của bạn. Bấm Bắt Đầu Nghe Whisper để nhận dạng tiếng nói trực tiếp.');
      this.ytSegments = [];
      this.currentYtSegmentIdx = -1;
      this.initOrUpdateYouTubePlayer(videoId);
      return;
    }
    if (subtitleRequest.caption_mode === 'hard_sub') {
      if (this.webSyncNotice) {
        this.webSyncNotice.innerHTML = '📷 <strong>Chế độ Quét Sub OCR:</strong> Phát video rồi bấm <strong>“📷 Bắt Đầu Quét Sub OCR”</strong> ở trên để đọc phụ đề chữ in trên video.';
        this.webSyncNotice.style.display = 'block';
      }
      this.setSourceIntelligenceState('ocr', 'Quét OCR khung hình', 'Đang đọc chữ dính trên hình. Bấm Bắt Đầu Quét Sub OCR để quét trực tiếp.');
      this.ytSegments = [];
      this.currentYtSegmentIdx = -1;
      this.initOrUpdateYouTubePlayer(videoId);
      return;
    }
    if (this.webSyncNotice) this.webSyncNotice.style.display = 'none';
    this.setSourceIntelligenceState('loading', 'Đang dò CC', 'Đang đọc danh sách track phụ đề của video...');

    // 1. Fetch YouTube Subtitles from Backend
    this.ytSegments = [];
    this.currentYtSegmentIdx = -1;

    try {
      const res = await fetch('/api/youtube-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subtitleRequest),
        signal: this.youtubeSubtitleAbortController.signal
      });
      const data = await res.json();
      if (loadGeneration !== this.youtubeLoadGeneration) return;
      if (data.success && data.segments && data.segments.length > 0) {
        this.ytSegments = data.segments;
        this.ytCaptionLanguage = data.caption_language || 'auto';
        if (data.title) this.webVideoTitle.textContent = data.title;
        if (this.webSyncNotice) {
          this.webSyncNotice.innerHTML = '';
          this.webSyncNotice.style.display = 'none';
        }
        const languageNames = { vi: 'Tiếng Việt', en: 'English', ja: '日本語', ko: '한국어', zh: '中文', th: 'ภาษาไทย' };
        const languageLabel = languageNames[data.caption_language] || (data.caption_language || 'Tiếng gốc').toUpperCase();
        const sourceLabel = data.caption_source === 'manual' ? 'CC thủ công' : 'CC tự động';
        this.setSourceIntelligenceState('loading', 'Đang giữ video tại đầu...', 'Đợi giọng câu đầu tiên sẵn sàng rồi mới phát video.');
        this.showToast('⏸️ Video đang dừng ở đầu để tạo giọng câu đầu tiên...');
        this.audioPreCache.clear();
        this.ytPrefetchedAudioIndices?.clear();
        this._ytSequentialPrefetchCursor = 0;
        this.ytPrefetchAbortController = new AbortController();
        this.ytInitialStartGate = Boolean(this.isDubbingEnabled);
        this.ytInitialPlayerReady = false;
        this.ytInitialVoiceReady = !this.isDubbingEnabled;
        this.initOrUpdateYouTubePlayer(videoId, { holdForInitialVoice: this.ytInitialStartGate });
        playerInitialized = true;
        if (data.has_more_translations) {
          this.syncRemainingYouTubeSubtitles(val, videoId, loadGeneration, 12);
        }
        const firstVoiceReady = await this.prebufferYouTubeInitialTracks(0, 2, loadGeneration, 12000);
        this.ytInitialVoiceReady = firstVoiceReady || !this.isDubbingEnabled;
        if (!this.ytInitialVoiceReady) {
          this.showToast('⚠️ Giọng đầu chưa tạo kịp sau 12 giây; video sẽ phát và tiếp tục tạo giọng nền.');
        }
        // The gate is resolved either by a ready first voice or by the explicit
        // 12-second safety timeout. This also covers a player that becomes ready later.
        this.ytInitialVoiceReady = true;
        this.releaseInitialYouTubeStartGate(true);
        this.setSourceIntelligenceState('success', `${languageLabel} · ${sourceLabel}`, `Đang phát và lồng tiếng tự động.`);
        this.showToast(`🚀 Đã nạp ${data.segments.length} câu thoại phụ đề từ video! Bắt đầu phát.`);
        this.subViDisplay.textContent = '▶️ Đang phát video và lồng tiếng...';
        this.subSourceDisplay.textContent = `Đã đồng bộ ${data.segments.length} câu thoại`;
      } else {
        this.renderYouTubeNoCaptionsFallback(data.error || 'Video không có phụ đề sẵn (Closed Captions)');
        this.setSourceIntelligenceState('error', 'Không có phụ đề CC', 'Chọn Nghe Whisper hoặc Quét Sub OCR ngay bên dưới video.');
      }
    } catch (e) {
      if (e.name === 'AbortError' || loadGeneration !== this.youtubeLoadGeneration) return;
      console.warn('Subtitles fetch error:', e);
      this.renderYouTubeNoCaptionsFallback('Không tải được phụ đề CC từ YouTube');
      this.setSourceIntelligenceState('error', 'Không tải được CC', 'Thử lại hoặc bật Nghe Whisper / Quét Sub OCR ngay bên dưới.');
    }

    // 2. Initialize YouTube Player
    if (loadGeneration === this.youtubeLoadGeneration && !playerInitialized) {
      this.initOrUpdateYouTubePlayer(videoId);
    }
  },

  async prebufferYouTubeInitialTracks(fromIdx = 0, count = 3, loadGeneration = null, maxWaitMs = 1500) {
    if (!this.isDubbingEnabled || !this.ytSegments || this.ytSegments.length === 0) return true;
    const toIdx = Math.min(this.ytSegments.length, fromIdx + count);
    const generation = this.voiceGeneration;
    const voice = this.getEffectiveVoice();
    const prefetchController = this.ytPrefetchAbortController;
    const pending = [];
    let firstSpeakableIndex = -1;
    for (let i = fromIdx; i < toIdx; i++) {
      const seg = this.ytSegments[i];
      if (!seg || !seg.translated) continue;
      const speakText = this.sanitizeDubbingText(seg.translated);
      if (!speakText) continue;
      if (firstSpeakableIndex < 0) firstSpeakableIndex = i;
      const fetchKey = `${generation}:${i}`;
      if (!this.audioPreCache.has(i) && !this.isFetchingPreCache.has(fetchKey)) {
        this.isFetchingPreCache.add(fetchKey);
        pending.push({ index: i, segment: seg, fetchKey, speakText });
      }
    }
    if (!pending.length) {
      this.startYouTubePrefetchWorker(toIdx);
      return firstSpeakableIndex < 0 || this.audioPreCache.has(firstSpeakableIndex);
    }

    const fetchPromise = (async () => {
      try {
        const res = await fetch('/api/tts-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            texts: pending.map(item => item.speakText),
            voice,
            generation: this.ttsRequestGeneration
          }),
          signal: prefetchController?.signal
        });
        if (res && res.ok) {
          const data = await res.json();
          if (loadGeneration !== null && loadGeneration !== this.youtubeLoadGeneration) return;
          const items = data && Array.isArray(data.items) ? data.items : [];
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!this.audioContext || this.audioContext.state === 'closed') this.audioContext = new AudioCtx();

          await Promise.all(pending.map(async (entry, pos) => {
            const audio = items[pos];
            if (!audio || !audio.audio_base64) return;
            try {
              const binary = atob(audio.audio_base64);
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
              this.ytPrefetchedAudioIndices?.add(entry.index);
            } catch (e) {
              console.warn('Initial prebuffer decode error:', e);
            }
          }));
        }
      } catch (e) {
        if (e?.name !== 'AbortError') console.warn('Initial prebuffer error:', e);
      } finally {
        pending.forEach(entry => this.isFetchingPreCache.delete(entry.fetchKey));
        if (this.currentYtMode === 'has_captions'
          && !prefetchController?.signal.aborted
          && (loadGeneration === null || loadGeneration === this.youtubeLoadGeneration)) {
          this.startYouTubePrefetchWorker(toIdx);
        }
      }
    })();

    // The first CC voice gates playback. Later prefetches remain background work.
    const timeoutPromise = new Promise(resolve => setTimeout(resolve, maxWaitMs));
    await Promise.race([fetchPromise, timeoutPromise]);
    return firstSpeakableIndex < 0 || this.audioPreCache.has(firstSpeakableIndex);
  },

  syncRemainingYouTubeSubtitles(url, videoId, loadGeneration, fromIdx = 12) {
    if (this.ytSyncRemainingTimer) clearTimeout(this.ytSyncRemainingTimer);
    this.ytSyncRemainingTimer = null;

    const syncBatch = async (nextIdx) => {
      if (loadGeneration !== this.youtubeLoadGeneration) return;
      try {
        const res = await fetch(`/api/youtube-subtitles-sync?url=${encodeURIComponent(url)}&from_idx=${nextIdx}`, {
          signal: this.youtubeSubtitleAbortController ? this.youtubeSubtitleAbortController.signal : undefined
        });
        if (!res.ok || loadGeneration !== this.youtubeLoadGeneration) return;
        const data = await res.json();
        if (data && Array.isArray(data.segments) && this.ytSegments) {
          for (const seg of data.segments) {
            if (typeof seg.index === 'number' && this.ytSegments[seg.index] && seg.translated) {
              this.ytSegments[seg.index].translated = seg.translated;
            }
          }
        }
        if (data && !data.done && loadGeneration === this.youtubeLoadGeneration) {
          const step = (data.segments && data.segments.length > 0) ? data.segments.length : 24;
          this.ytSyncRemainingTimer = setTimeout(() => syncBatch(nextIdx + step), 50);
        }
      } catch (_) {}
    };

    this.ytSyncRemainingTimer = setTimeout(() => syncBatch(fromIdx), 30);
  },

  initOrUpdateYouTubePlayer(videoId, { holdForInitialVoice = false } = {}) {
    if (this.ytSyncInterval) {
      clearInterval(this.ytSyncInterval);
      this.ytSyncInterval = null;
    }

    const playerContainer = document.getElementById('webVideoPlayer');
    if (!playerContainer) return;

    const onPlayerReady = () => {
      try {
        if (typeof this.ytPlayer.unloadModule === 'function') this.ytPlayer.unloadModule('captions');
        if (typeof this.ytPlayer.setOption === 'function') this.ytPlayer.setOption('captions', 'track', {});
      } catch (_) {}
      this.startXTSync();
      this.prefetchUpcomingAudio(0);
      this.ytInitialPlayerReady = true;
      if (holdForInitialVoice && this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
        try {
          this.ytPlayer.pauseVideo();
          if (typeof this.ytPlayer.seekTo === 'function') this.ytPlayer.seekTo(0, true);
        } catch (_) {}
      }
      this.releaseInitialYouTubeStartGate(false);
    };

    const onPlayerStateChange = (event) => {
      // YT.PlayerState.PAUSED = 2, ENDED = 0
      if (event.data === 2 || event.data === 0) {
        // A dubbing hold is an intentional pause used to avoid dropping speech.
        if (!this.isHoldingYtForDubbing) this.stopAllAudio();
        this.restoreYouTubeVolumeNow();
      } else if (event.data === 1) { // PLAYING
        if (this.ytInitialStartGate && !this.ytInitialVoiceReady) {
          try { this.ytPlayer.pauseVideo(); } catch (_) {}
          return;
        }
        if (this.currentYtSegmentIdx >= 0) {
          this.prefetchUpcomingAudio(this.currentYtSegmentIdx);
        } else {
          this.prefetchUpcomingAudio(0);
        }
      }
    };

    // 100% reliable direct responsive YouTube Embed Iframe (never empty black screen, fs=0 to route fullscreen through LiveSub container)
    const autoplay = holdForInitialVoice ? 0 : 1;
    const embedUrl = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=${autoplay}&rel=0&modestbranding=1&fs=0&cc_load_policy=0&iv_load_policy=3`;
    playerContainer.innerHTML = `<iframe id="ytIframeEl" src="${embedUrl}" width="100%" height="100%" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="width:100%; height:100%; border:none; border-radius:8px;"></iframe>`;

    const attachYT = () => {
      if (window.YT && window.YT.Player) {
        try {
          this.ytPlayer = new window.YT.Player('ytIframeEl', {
            events: {
              onReady: onPlayerReady,
              onStateChange: onPlayerStateChange
            }
          });
        } catch (e) {
          console.warn('YT.Player attach warning:', e);
        }
      }
    };

    if (window.YT && window.YT.Player) {
      setTimeout(attachYT, 120);
    } else {
      window.onYouTubeIframeAPIReady = attachYT;
    }
  },

  releaseInitialYouTubeStartGate(forceRelease = false) {
    if (!this.ytInitialStartGate) return;
    if (!this.ytInitialPlayerReady) return;
    if (!this.ytInitialVoiceReady && !forceRelease) return;
    this.ytInitialStartGate = false;
    if (this.ytInitialGateTimer) clearTimeout(this.ytInitialGateTimer);
    this.ytInitialGateTimer = setTimeout(() => {
      this.ytInitialGateTimer = null;
      if (!this.ytPlayer) return;
      try {
        if (typeof this.ytPlayer.seekTo === 'function') this.ytPlayer.seekTo(0, true);
        if (typeof this.ytPlayer.playVideo === 'function') this.ytPlayer.playVideo();
      } catch (_) {}
    }, 180);
  },

  duckYouTubeVolume(_targetVol = 18) {
    // Completely disabled per user request: keep video audio 100% at its original level
    return;
  },

  scheduleRestoreYouTubeVolume(_delayMs = 4500) {
    return;
  },

  restoreYouTubeVolumeNow() {
    if (this.ytRestoreVolumeTimer) {
      clearTimeout(this.ytRestoreVolumeTimer);
      this.ytRestoreVolumeTimer = null;
    }
    if (this.isYtDucked && this.ytPlayer && typeof this.ytPlayer.setVolume === 'function') {
      try {
        const target = (this.originalYtVol !== null && this.originalYtVol > 0) ? this.originalYtVol : 100;
        this.ytPlayer.setVolume(target);
      } catch (_) {}
      this.isYtDucked = false;
    }
  },
}
