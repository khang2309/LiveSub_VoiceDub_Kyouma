// LiveSub Component: settings-store
export default {
  async resolveAutoVoiceProvider() {
    try {
      const response = await fetch('/api/tts-status', { cache: 'no-store' });
      if (!response.ok) return;
      const state = await response.json();
      const selected = state && state.auto_provider && state.auto_provider.selected;
      if (selected) this.autoVoiceProvider = selected;
      this.updateAppliedSettings();
    } catch (error) {
      console.warn('Auto voice startup benchmark status unavailable', error);
    }
  },

  getEffectiveVoice() {
    const selected = this.voiceSelect ? this.voiceSelect.value : 'edge:Hoài My';
    if (selected === 'auto-fast') {
      return this.autoVoiceProvider || 'edge:Hoài My';
    }
    return selected || 'edge:Hoài My';
  },

  updateAppliedSettings() {
    if (!this.settingsApplyState) return;
    const sourceNames = {
      system: 'Hệ thống / Tab',
      local: 'File trên máy',
      mic: 'Microphone',
      weburl: 'Link video web'
    };
    const modeNames = {
      bilingual: 'Song ngữ',
      vi_only: 'Sub Tiếng Việt',
      source_only: 'Sub Tiếng Gốc',
      en_only: 'Sub Tiếng Anh',
      none: 'Đã tắt phụ đề'
    };
    const languageText = this.sourceLangSelect && this.sourceLangSelect.selectedOptions[0]
      ? this.sourceLangSelect.selectedOptions[0].text.trim()
      : 'Tự động một lần';
    const selectedVoice = this.voiceSelect && this.voiceSelect.selectedOptions[0]
      ? this.voiceSelect.selectedOptions[0].text.trim()
      : 'Tự động nhanh nhất';
    const effectiveVoice = this.getEffectiveVoice();
    const baseVoiceText = this.voiceSelect && this.voiceSelect.value === 'auto-fast'
      ? `${selectedVoice.split('(')[0].trim()} → ${effectiveVoice.replace('vieneu:', 'VieNeu ')}`
      : selectedVoice.split('(')[0].trim();
    const adaptiveSuffix = this.isAdaptiveSpeedEnabled ? ' (Thích ứng)' : '';
    const voiceText = `${baseVoiceText} · ${this.getSafePlaybackRate().toFixed(2)}×${adaptiveSuffix}`;

    if (this.runtimeSourceValue) this.runtimeSourceValue.textContent = sourceNames[this.activeSource] || this.activeSource;
    if (this.runtimeLanguageValue) this.runtimeLanguageValue.textContent = languageText;
    if (this.runtimeSubtitleValue) this.runtimeSubtitleValue.textContent = modeNames[this.currentSubMode] || this.currentSubMode;
    if (this.runtimeVoiceValue) this.runtimeVoiceValue.textContent = voiceText;
    this.settingsApplyState.dataset.state = 'applied';
    this.settingsApplyState.innerHTML = '<span class="apply-state-dot"></span>Đã áp dụng realtime';
  },

  async confirmRuntimeSettings() {
    if (!this.settingsApplyState) return;
    this.settingsApplyState.dataset.state = 'checking';
    this.settingsApplyState.innerHTML = '<span class="apply-state-dot"></span>Đang xác nhận backend…';
    try {
      const response = await fetch('/api/pipeline-status', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const status = await response.json();
      const ttsReady = status.tts && (status.tts.status === 'ready' || status.tts.backend === 'vieneu' || status.tts.backend === 'VieNeu-TTS' || status.tts.device === 'cuda');
      const asrReady = status.asr && (status.asr.status === 'ready' || status.asr.status === 'idle');
      const auto = status.tts && status.tts.auto_provider ? status.tts.auto_provider : {};
      const ttfa = auto.vieneu_ttfa_ms ? ` · TTFA ${Math.round(auto.vieneu_ttfa_ms)}ms` : '';
      if (this.runtimeEngineValue) {
        this.runtimeEngineValue.textContent = `${asrReady ? 'Whisper CUDA' : 'ASR đang nạp'} · ${ttsReady ? 'VieNeu CUDA' : 'TTS đang nạp'}${ttfa}`;
      }
      if (!ttsReady && status.tts && status.tts.status === 'warming') {
        if (!this._ttsPollCount) this._ttsPollCount = 0;
        if (this._ttsPollCount++ < 12) {
          setTimeout(() => this.confirmRuntimeSettings(), 2500);
        }
      }
      this.autoVoiceProvider = auto.selected || this.autoVoiceProvider;
      this.updateAppliedSettings();
      this.settingsApplyState.innerHTML = '<span class="apply-state-dot"></span>Đã xác nhận đang chạy';
      this.showToast('Đã xác nhận: cấu hình giao diện và backend đang đồng bộ.');
    } catch (error) {
      this.settingsApplyState.dataset.state = 'error';
      this.settingsApplyState.innerHTML = '<span class="apply-state-dot"></span>Backend chưa xác nhận';
      if (this.runtimeEngineValue) this.runtimeEngineValue.textContent = 'Không kết nối được backend';
      this.showToast(`Không thể xác nhận cấu hình: ${error.message}`);
    }
  },

  restorePreferences() {
    const savedDub = localStorage.getItem('livesub_dubbing_enabled');
    if (savedDub !== null) this.isDubbingEnabled = (savedDub !== 'false');

    const savedAdaptive = localStorage.getItem('livesub_adaptive_speed');
    if (savedAdaptive !== null) {
      this.isAdaptiveSpeedEnabled = (savedAdaptive !== 'false');
      if (this.chkAdaptiveSpeed) this.chkAdaptiveSpeed.checked = this.isAdaptiveSpeedEnabled;
    }
    const savedSystemCapture = localStorage.getItem('livesub_system_capture_mode');
    if (savedSystemCapture && this.systemCaptureMode) {
      this.setRadioGroupValue(this.systemCaptureMode, savedSystemCapture);
    }

    const savedVoice = localStorage.getItem('livesub_voice');
    if (savedVoice && this.voiceSelect) {
      const exists = Array.from(this.voiceSelect.options || []).some(o => o.value === savedVoice);
      this.voiceSelect.value = exists ? savedVoice : 'edge:Hoài My';
    } else if (this.voiceSelect) {
      this.voiceSelect.value = 'edge:Hoài My';
    }

    const savedLang = localStorage.getItem('livesub_sourcelang');
    if (savedLang && this.sourceLangSelect) {
      this.sourceLangSelect.value = savedLang;
    } else if (this.sourceLangSelect) {
      this.sourceLangSelect.value = 'auto';
    }
    const savedSubMode = localStorage.getItem('livesub_sub_mode');
    if (savedSubMode && ['bilingual', 'vi_only', 'source_only', 'en_only', 'none'].includes(savedSubMode)) {
      this.currentSubMode = savedSubMode;
      const radio = Array.from(this.subModeRadios || []).find(item => item.value === savedSubMode);
      if (radio) radio.checked = true;
      const sysRadio = Array.from(this.systemSubModeRadios || []).find(item => item.value === savedSubMode);
      if (sysRadio) sysRadio.checked = true;
    } else {
      this.currentSubMode = 'vi_only';
      const radio = Array.from(this.subModeRadios || []).find(item => item.value === 'vi_only');
      if (radio) radio.checked = true;
      const sysRadio = Array.from(this.systemSubModeRadios || []).find(item => item.value === 'vi_only');
      if (sysRadio) sysRadio.checked = true;
    }
    const savedTransparency = localStorage.getItem('livesub_sub_transparency');
    if (savedTransparency && ['transparent', 'glass', 'dark'].includes(savedTransparency)) {
      this.currentTransparency = savedTransparency;
      const radio = Array.from(this.subTransparencyRadios || []).find(item => item.value === savedTransparency);
      if (radio) radio.checked = true;
      this.applyTransparencyUI();
    }
    const savedZone = localStorage.getItem('livesub_ocr_zone');
    if (savedZone && this.ocrZoneSelect) {
      this.ocrZoneSelect.value = savedZone;
      this.ocrScanZone = savedZone;
    }
    const savedCaptionMode = localStorage.getItem('livesub_caption_mode');
    if (savedCaptionMode) {
      const normalizedYt = savedCaptionMode === 'auto' ? 'has_captions' : savedCaptionMode;
      this.setYouTubeMode(normalizedYt);
    } else {
      this.setYouTubeMode('has_captions');
    }
    const savedCaptionLanguage = localStorage.getItem('livesub_caption_language');
    if (savedCaptionLanguage && this.webCaptionLanguage) {
      this.setRadioGroupValue(this.webCaptionLanguage, savedCaptionLanguage === 'auto' ? 'original' : savedCaptionLanguage);
    }

    // Load guaranteed persistent on-disk settings from backend
    fetch('/api/settings', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(settings => {
        if (!settings) return;
        if (settings.voice && this.voiceSelect) {
          const exists = Array.from(this.voiceSelect.options || []).some(o => o.value === settings.voice);
          if (exists) {
            this.voiceSelect.value = settings.voice;
            if (typeof localStorage !== 'undefined') localStorage.setItem('livesub_voice', settings.voice);
          }
        }
        if (settings.source_lang && this.sourceLangSelect) {
          this.sourceLangSelect.value = settings.source_lang;
          if (typeof localStorage !== 'undefined') localStorage.setItem('livesub_sourcelang', settings.source_lang);
        }
        if (settings.sub_mode && ['bilingual', 'vi_only', 'source_only', 'en_only', 'none'].includes(settings.sub_mode)) {
          this.currentSubMode = settings.sub_mode;
          const radio = Array.from(this.subModeRadios || []).find(item => item.value === settings.sub_mode);
          if (radio) radio.checked = true;
          const sysRadio = Array.from(this.systemSubModeRadios || []).find(item => item.value === settings.sub_mode);
          if (sysRadio) sysRadio.checked = true;
        }
        if (typeof settings.adaptive_speed === 'boolean') {
          this.isAdaptiveSpeedEnabled = settings.adaptive_speed;
          if (this.chkAdaptiveSpeed) this.chkAdaptiveSpeed.checked = settings.adaptive_speed;
        }
        if (typeof settings.dubbing_enabled === 'boolean') {
          this.isDubbingEnabled = settings.dubbing_enabled;
        }
        if (settings.ocr_zone && this.ocrZoneSelect) {
          this.ocrZoneSelect.value = settings.ocr_zone;
          this.ocrScanZone = settings.ocr_zone;
        }
        this.updateAppliedSettings();
        this.notifyUIState?.();
      })
      .catch(() => {});
    this.notifyUIState?.();
  },

  setSubMode(mode) {
    if (!['bilingual', 'vi_only', 'source_only', 'en_only', 'none'].includes(mode)) return;
    this.currentSubMode = mode;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('livesub_sub_mode', mode);
    } catch (_) {}
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_mode: mode })
    }).catch(() => {});

    (this.subModeRadios || []).forEach(r => { r.checked = (r.value === mode); });
    (this.systemSubModeRadios || []).forEach(r => { r.checked = (r.value === mode); });

    this.updateSubModeUI();
    this.updateAppliedSettings();
  },

  populateSourceLangOptions(mode = 'whisper') {
    if (!this.sourceLangSelect) return;
    const prevVal = this.sourceLangSelect.value || (typeof localStorage !== 'undefined' ? localStorage.getItem('livesub_sourcelang') : null) || 'auto';
    const isOcr = mode === 'ocr';
    const autoLabel = isOcr
      ? '🌐 Tự động nhận diện (6 ngôn ngữ)'
      : (mode === 'auto' ? '🌐 Tự động Hybrid (6 ngôn ngữ)' : '🌐 Tự động nhận diện (6 ngôn ngữ)');
    const options = [
      ['auto', autoLabel],
      ['vi-VN', '🇻🇳 Tiếng Việt (Không dịch)'],
      ['ja-JP', '🇯🇵 Tiếng Nhật'],
      ['en-US', '🇬🇧 Tiếng Anh'],
      ['zh-CN', '🇨🇳 Tiếng Trung'],
      ['ko-KR', '🇰🇷 Tiếng Hàn'],
      ['th-TH', '🇹🇭 Tiếng Thái']
    ];
    this.sourceLangSelect.options[0] && (this.sourceLangSelect.options[0].text = autoLabel);
    const validVals = ['auto', 'vi-VN', 'ja-JP', 'en-US', 'zh-CN', 'ko-KR', 'th-TH'];
    this.sourceLangSelect.value = validVals.includes(prevVal) ? prevVal : 'auto';
    this.notifyUIState?.();
  },

  getRadioGroupValue(group, fallback = 'auto') {
    if (!group) return fallback;
    const checked = group.querySelector?.('input[type="radio"]:checked');
    return checked?.value || group.value || fallback;
  },

  setRadioGroupValue(group, value) {
    if (!group) return;
    const options = Array.from(group.querySelectorAll?.('input[type="radio"]') || []);
    if (options.length) {
      const target = options.find(option => option.value === value);
      if (target) target.checked = true;
      return;
    }
    group.value = value;
  },

  updateSystemIntelligenceControls() {
    if (!this.systemCaptureMode) return;
    const mode = this.getRadioGroupValue(this.systemCaptureMode, 'audio_only');
    if (this.systemIntelligenceState) {
      if (mode === 'audio_only') {
        this.systemIntelligenceState.dataset.state = 'ready';
        this.systemIntelligenceState.textContent = 'Whisper GPU';
      } else if (mode === 'hard_sub') {
        this.systemIntelligenceState.dataset.state = 'ocr';
        this.systemIntelligenceState.textContent = 'RapidOCR GPU';
      } else {
        this.systemIntelligenceState.dataset.state = 'ready';
        this.systemIntelligenceState.textContent = 'Hybrid Tự Động';
      }
    }
    if (this.systemIntelligenceHint) {
      if (mode === 'audio_only') {
        this.systemIntelligenceHint.textContent = 'Faster-Whisper CUDA float16 cùng Silero VAD đang nhận diện âm thanh trực tiếp từ loa / mọi ứng dụng.';
      } else if (mode === 'hard_sub') {
        this.systemIntelligenceHint.textContent = 'RapidOCR GPU sẽ quét phụ đề đóng cứng trực tiếp từ khung hình/tab video bạn chia sẻ, không phụ thuộc âm thanh.';
      } else {
        this.systemIntelligenceHint.textContent = 'Chế độ thông minh: Tự động phát hiện phụ đề hình ảnh (OCR) kết hợp nhận diện giọng nói Whisper khi không có chữ.';
      }
    }
  },

  updateSourceIntelligenceControls() {
    if (!this.webCaptionMode || !this.webCaptionLanguage) return;
    const captionMode = this.getRadioGroupValue(this.webCaptionMode);
    const audioOnly = captionMode === 'audio_only';
    const languageOptions = this.webCaptionLanguage.querySelectorAll?.('input[type="radio"]') || [];
    languageOptions.forEach(option => { option.disabled = audioOnly; });
    this.webCaptionLanguage.toggleAttribute?.('data-disabled', audioOnly);
    if (audioOnly) {
      this.setSourceIntelligenceState('whisper', 'Whisper realtime', 'Phát video rồi bấm “Bắt Âm Thanh Tab”. Hệ thống sẽ nhận dạng trực tiếp từ tiếng nói.');
    } else if (captionMode === 'hard_sub') {
      this.setSourceIntelligenceState('ocr', 'OCR phụ đề đóng cứng', 'Chọn đúng ngôn ngữ, sau đó bấm Bắt Âm Thanh Tab và chia sẻ khung hình video. OCR sẽ thay Whisper để giảm trễ.');
    } else if (captionMode === 'has_captions') {
      this.setSourceIntelligenceState('ready', 'Chờ kiểm tra CC', 'Hệ thống chỉ dùng track CC đúng ngôn ngữ bạn chọn; nếu không có sẽ báo rõ, không tự đổi sang track khác.');
    } else {
      this.setSourceIntelligenceState('ready', 'Tự động', 'Ưu tiên CC tiếng gốc để đồng bộ; nếu video không có CC, hệ thống sẽ hướng dẫn chuyển sang Whisper.');
    }
  },

  setSourceIntelligenceState(state, label, hint) {
    if (this.sourceIntelligenceState) {
      this.sourceIntelligenceState.dataset.state = state;
      this.sourceIntelligenceState.textContent = label;
      this.sourceIntelligenceState.setAttribute('aria-live', ['success', 'error', 'whisper'].includes(state) ? 'polite' : 'off');
    }
    if (this.sourceIntelligenceHint && hint) this.sourceIntelligenceHint.textContent = hint;
  },

  handleVoiceChange() {
    const name = this.voiceSelect && this.voiceSelect.selectedOptions[0]
      ? this.voiceSelect.selectedOptions[0].text
      : '';
    const voiceVal = this.voiceSelect ? this.voiceSelect.value : 'vieneu:Trúc Ly';
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('livesub_voice', voiceVal);
    }
    // Persist to backend on-disk configuration
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: voiceVal })
    }).catch(() => {});

    this.voiceGeneration++;
    this.dubbingGeneration++;
    this.liveDubbingQueue = [];
    this.playbackGeneration++;
    this.audioPreCache.clear();
    this.isFetchingPreCache.clear();
    this.ytPrefetchedAudioIndices?.clear();
    this._ytSequentialPrefetchCursor = Math.max(0, this.currentYtSegmentIdx || 0);
    this.stopDubbingAudio(false);
    this.updateMasterDubUI();
    this.updateAppliedSettings();
    this.showToast(` Đã chọn giọng: ${name}`);
    if (this.isDubbingEnabled) {
      this.prefetchUpcomingAudio(Math.max(0, this.currentYtSegmentIdx));
    }
  },

  updateMasterDubUI() {
    let voiceName = 'VieNeu Trúc Ly';
    if (this.voiceSelect && this.voiceSelect.selectedOptions && this.voiceSelect.selectedOptions[0]) {
      const fullText = this.voiceSelect.selectedOptions[0].text;
      if (fullText.includes('VieNeu-TTS:')) {
        const parts = fullText.split('VieNeu-TTS:')[1].split('(')[0].trim();
        voiceName = 'VieNeu ' + parts;
      } else {
        voiceName = fullText.split('(')[0].replace(/[^\w\sÀ-ỹ]/gi, '').trim() || 'Trúc Ly';
      }
    }

    const activeRunningHtml = `<span class="toggle-indicator-dot"></span><span>🟢 ĐANG LỒNG TIẾNG (${voiceName})</span>`;
    const readyWaitingHtml = `<span class="toggle-indicator-dot"></span><span>🟢 ĐÃ BẬT LỒNG TIẾNG (${voiceName})</span>`;
    const pausedHtml = `<span class="toggle-indicator-dot"></span><span>⏸️ ĐÃ TẮT LỒNG TIẾNG (Bấm để bật)</span>`;

    const statusHtml = this.isDubbingEnabled ? (this.isListening ? activeRunningHtml : readyWaitingHtml) : pausedHtml;

    if (this.btnMasterDubToggle) {
      this.btnMasterDubToggle.className = `btn-master-dub-toggle ${this.isDubbingEnabled ? 'active' : 'paused'}`;
      this.btnMasterDubToggle.innerHTML = statusHtml;
    }
    if (this.btnCinemaMasterDubToggle) {
      this.btnCinemaMasterDubToggle.className = `btn-master-dub-toggle ${this.isDubbingEnabled ? 'active' : 'paused'}`;
      this.btnCinemaMasterDubToggle.innerHTML = statusHtml;
    }
  },

  toggleDubbingMute() {
    this.isDubbingEnabled = !this.isDubbingEnabled;
    if (!this.isDubbingEnabled) {
      this.stopDubbingAudio(true, false);
      this.showToast('🔇 Đã TẮT ÂM lồng tiếng (Bấm M để bật lại)');
      if (this.btnPanicKill) {
        this.btnPanicKill.innerHTML = '🔊 Bật Tiếng (M)';
        this.btnPanicKill.className = 'btn btn-warning btn-compact';
      }
    } else {
      this.showToast('🔊 Đã BẬT LẠI âm lồng tiếng (Phím M)');
      if (this.btnPanicKill) {
        this.btnPanicKill.innerHTML = '🔇 Tắt Tiếng (M)';
        this.btnPanicKill.className = 'btn btn-secondary btn-compact';
      }
      if (this.ytSegments && this.ytSegments.length > 0 && this.currentYtSegmentIdx >= 0) {
        this.prefetchUpcomingAudio(this.currentYtSegmentIdx);
      }
    }
    this.updateMasterDubUI();
    this.broadcastOverlayState();
  },

  toggleScanningPause() {
    this.isScanningPaused = !this.isScanningPaused;
    if (this.isScanningPaused) {
      this.stopDubbingAudio(false, false);
      this.showToast('⏸️ Đã TẠM DỪNG quét & lồng tiếng (Tránh dịch nhầm nhạc OST/Credit. Bấm P để tiếp tục)');
      if (this.btnPauseScan) {
        this.btnPauseScan.innerHTML = '▶️ Tiếp Tục Quét (P)';
        this.btnPauseScan.className = 'btn btn-warning btn-compact';
      }
    } else {
      this.showToast('▶️ Đã TIẾP TỤC quét & lồng tiếng (Phím P)');
      if (this.btnPauseScan) {
        this.btnPauseScan.innerHTML = '⏸️ Tạm Dừng (P)';
        this.btnPauseScan.className = 'btn btn-secondary btn-compact';
      }
    }
    if (this.runtimeSubtitleValue) {
      this.runtimeSubtitleValue.textContent = this.isScanningPaused
        ? '⏸️ Tạm dừng quét (P)'
        : (this.currentSubMode || 'Song ngữ');
    }
    this.broadcastOverlayState();
  }

  }
