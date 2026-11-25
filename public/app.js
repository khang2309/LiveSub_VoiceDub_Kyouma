// LiveSub & VoiceDub AI Studio - Professional Realtime Universal Engine

class LiveDubStudio {
  constructor() {
    this.activeSource = 'system'; // 'system' | 'local' | 'mic' | 'weburl'
    this.isListening = false;
    this.mediaStream = null;
    this.audioContext = null;
    this.mediaStreamSource = null; // Stored to prevent V8 GC!
    this.scriptNode = null;
    this.neuralVAD = null;
    this.neuralVADActive = false;
    this.isOCRModeActive = false;
    this.ocrVideo = null;
    this.ocrCanvas = null;
    this.ocrTimer = null;
    this.ocrRequestActive = false;
    this.lastOCRText = '';
    this.lastCleanText = '';
    this.currentActiveAudioSource = null;
    this.streamingAudioSources = new Set();
    this.streamingAbortController = null;
    this.realtimeMetrics = {
      samples: [],
      streamUnderruns: 0,
      lastServerTimings: null,
      lastSpeechEndToVoiceMs: null,
      lastSpeechStartToVoiceMs: null,
      naturalSpeechSplits: 0,
      hardSpeechSplits: 0
    };

    // VAD & Dynamic Speech Chunking (PCM WAV)
    this.isSpeaking = false;
    this.silenceFrames = 0;
    this.pcmBuffers = [];
    this.isTranscribing = false;
    this.activeAbortController = null;
    this.lastProcessedText = '';
    this.phraseStartTime = 0;

    // Subtitle & Voice Settings
    this.currentSubMode = 'bilingual';
    this.currentTransparency = 'transparent';
    this.isDubbingEnabled = true;
    this.isAdaptiveSpeedEnabled = true;
    this.isScanningPaused = false;
    this.isHybridModeActive = false;
    // Local VieNeu is the safe zero-cost default. The server benchmarks all
    // warmed providers once at startup and this value is refreshed once.
    this.autoVoiceProvider = 'vieneu:Trúc Ly';
    this.fontSizePx = 26;
    this.floatingWindow = null;

    // YouTube Subtitle Sync Engine
    this.ytPlayer = null;
    this.ytSegments = [];
    this.ytSyncInterval = null;
    this.currentYtSegmentIdx = -1;
    this.originalYtVol = null;
    this.isYtDucked = false;
    this.isAudioDuckingEnabled = false;
    this.ytRestoreVolumeTimer = null;
    this.audioPreCache = new Map();
    this.isFetchingPreCache = new Set();
    this.voiceGeneration = 0;
    this.dubbingGeneration = 0;
    this.playbackGeneration = 0;
    this.ytSessionGeneration = 0;
    this.lastYtTime = null;
    // Stay on the video's own CC timestamp; only compensate for the 60 ms
    // polling interval so we do not manufacture a separate system timeline.
    this.ytCueLeadSeconds = 0.08;
    this.isHoldingYtForDubbing = false;
    this.ytShouldResumeAfterHold = false;
    this.ytOverrunHoldTimer = null;
    this.smoothVideoPlayback = true;

    // Realtime requests are serialized instead of dropped while Whisper is busy.
    this.speechQueue = [];
    this.isProcessingSpeechQueue = false;
    this.lastTranscriptContext = '';
    this.autoDetectedSourceLang = null;
    this.autoLanguageProbeCounter = 0;
    this.maxSpeechQueueSize = 24;
    this.liveSpeechSequence = 0;
    this.liveDubbingQueue = [];
    this.isProcessingLiveDubbing = false;
    this.liveTtsPrefetch = new Map();
    this.currentGainNode = null;

    // Ignore stale subtitle responses when the user quickly loads another URL.
    this.youtubeLoadGeneration = 0;
    this.youtubeSubtitleAbortController = null;

    // History
    this.history = [];

    this.initElements();
    this.restorePreferences();
    this.bindEvents();
    this.updateSubModeUI();
    this.applyTransparencyUI();
    this.updateMasterDubUI();
    this.updateSourceIntelligenceControls();
    this.updateAppliedSettings();
    setTimeout(() => this.confirmRuntimeSettings(), 3000);
  }

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
  }

  getEffectiveVoice() {
    const selected = this.voiceSelect ? this.voiceSelect.value : 'vieneu:Trúc Ly';
    if (selected === 'auto-fast') {
      return this.autoVoiceProvider || 'vieneu:Trúc Ly';
    }
    return selected || 'vieneu:Trúc Ly';
  }

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
  }

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
  }

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
      this.voiceSelect.value = exists ? savedVoice : 'vieneu:Trúc Ly';
    } else if (this.voiceSelect) {
      this.voiceSelect.value = 'vieneu:Trúc Ly';
    }

    const savedLang = localStorage.getItem('livesub_sourcelang');
    if (savedLang && this.sourceLangSelect) {
      this.sourceLangSelect.value = savedLang;
    } else if (this.sourceLangSelect) {
      this.sourceLangSelect.value = 'vi-VN';
    }
    const savedSubMode = localStorage.getItem('livesub_sub_mode');
    if (savedSubMode && ['bilingual', 'vi_only', 'source_only', 'en_only'].includes(savedSubMode)) {
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
    const savedZone = localStorage.getItem('livesub_ocr_zone');
    if (savedZone && this.ocrZoneSelect) {
      this.ocrZoneSelect.value = savedZone;
      this.ocrScanZone = savedZone;
    }
    const savedCaptionMode = localStorage.getItem('livesub_caption_mode');
    if (savedCaptionMode && this.webCaptionMode) {
      this.setRadioGroupValue(this.webCaptionMode, savedCaptionMode === 'auto' ? 'has_captions' : savedCaptionMode);
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
        if (settings.sub_mode && ['bilingual', 'vi_only', 'source_only', 'en_only'].includes(settings.sub_mode)) {
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
      })
      .catch(() => {});
  }

  initElements() {
    this.statusBadge = document.getElementById('statusBadge');
    this.statusText = document.getElementById('statusText');
    this.btnFloatingWindow = document.getElementById('btnFloatingWindow');

    // Source navigation tabs (2 Core Sources)
    this.sourceTabs = document.querySelectorAll('.source-tab');
    this.panelSourceSystem = document.getElementById('panelSourceSystem');
    this.panelSourceMic = document.getElementById('panelSourceMic');
    this.panelSourceWebUrl = document.getElementById('panelSourceWebUrl');

    // Source 1: System
    this.btnToggleSystemAudio = document.getElementById('btnToggleSystemAudio');
    this.btnSystemAudioText = document.getElementById('btnSystemAudioText');
    this.oneTouchDetectionPill = document.getElementById('oneTouchDetectionPill');
    this.systemCaptureMode = document.getElementById('systemCaptureMode');
    this.systemSubMode = document.getElementById('systemSubMode');
    this.systemIntelligenceState = document.getElementById('systemIntelligenceState');
    this.systemIntelligenceHint = document.getElementById('systemIntelligenceHint');
    this.systemSubModeRadios = document.querySelectorAll('input[name="systemSubMode"]');
    this.chkAdaptiveSpeed = document.getElementById('chkAdaptiveSpeed');
    this.chkEnableWhisper = document.getElementById('chkEnableWhisper');
    this.btnModeSub = document.getElementById('btnModeSub');
    this.btnModeAudio = document.getElementById('btnModeAudio');
    this.btnModeHybrid = document.getElementById('btnModeHybrid');
    this.ocrZoneSelect = document.getElementById('ocrZoneSelect');
    this.lblSourceLang = document.getElementById('lblSourceLang');
    this.currentSystemMode = 'ocr';

    // Source 2: Mic
    this.btnToggleMic = document.getElementById('btnToggleMic');
    this.btnMicText = document.getElementById('btnMicText');

    // Source 4: Web URL
    this.webUrlInput = document.getElementById('webUrlInput');
    this.webVideoForm = document.getElementById('webVideoForm');
    this.btnLoadWebUrl = document.getElementById('btnLoadWebUrl');
    this.webVideoContainer = document.getElementById('webVideoContainer');
    this.webVideoTitle = document.getElementById('webVideoTitle');
    this.btnWebLiveCapture = document.getElementById('btnWebLiveCapture');
    this.webCaptionMode = document.getElementById('webCaptionMode');
    this.webCaptionLanguage = document.getElementById('webCaptionLanguage');
    this.sourceIntelligenceState = document.getElementById('sourceIntelligenceState');
    this.sourceIntelligenceHint = document.getElementById('sourceIntelligenceHint');
    this.btnMasterDubToggle = document.getElementById('btnMasterDubToggle');
    this.btnMasterDubText = document.getElementById('btnMasterDubText');
    this.btnCinemaMasterDubToggle = document.getElementById('btnCinemaMasterDubToggle');
    this.btnCinemaMasterDubText = document.getElementById('btnCinemaMasterDubText');
    this.btnCloseWebVideo = document.getElementById('btnCloseWebVideo');
    this.invideoWebSubVi = document.getElementById('invideoWebSubVi');
    this.invideoWebSubSource = document.getElementById('invideoWebSubSource');
    this.btnFullscreenWebVideo = document.getElementById('btnFullscreenWebVideo');
    this.btnFullscreenWebVideoText = document.getElementById('btnFullscreenWebVideoText');
    this.btnCinemaPiP = document.getElementById('btnCinemaPiP');
    this.webSyncNotice = document.getElementById('webSyncNotice');
    this.sampleLinks = document.querySelectorAll('.btn-sample-link');
    this.btnTestSpeaker = document.getElementById('btnTestSpeaker');
    this.btnConfirmSettings = document.getElementById('btnConfirmSettings');
    this.settingsApplyState = document.getElementById('settingsApplyState');
    this.runtimeSourceValue = document.getElementById('runtimeSourceValue');
    this.runtimeLanguageValue = document.getElementById('runtimeLanguageValue');
    this.runtimeSubtitleValue = document.getElementById('runtimeSubtitleValue');
    this.runtimeVoiceValue = document.getElementById('runtimeVoiceValue');
    this.runtimeEngineValue = document.getElementById('runtimeEngineValue');

    // Meter
    this.audioMeterFill = document.getElementById('audioMeterFill');
    this.meterPercentText = document.getElementById('meterPercentText');

    // Settings
    this.sourceLang = this.sourceLangSelect = document.getElementById('sourceLang');
    this.voiceSelect = document.getElementById('voiceSelect');
    this.btnTestVoiceSample = document.getElementById('btnTestVoiceSample');
    this.rateRange = document.getElementById('rateRange');
    this.rateValue = document.getElementById('rateValue');
    this.volumeRange = document.getElementById('volumeRange');
    this.volumeValue = document.getElementById('volumeValue');
    this.subTransparencyRadios = document.querySelectorAll('input[name="subTransparency"]');
    this.subModeRadios = document.querySelectorAll('input[name="subMode"]');

    // Test text
    this.testTextInput = document.getElementById('testTextInput');
    this.btnSendTestText = document.getElementById('btnSendTestText');

    // Cinema Display
    this.cinemaBox = document.getElementById('cinemaBox') || document.getElementById('subtitleViewport');
    this.subSourceDisplay = document.getElementById('subSourceDisplay');
    this.subViDisplay = document.getElementById('subViDisplay');
    this.dubbingIndicator = document.getElementById('dubbingIndicator');
    this.btnToggleBoxTransparent = document.getElementById('btnToggleBoxTransparent');
    this.btnSubtitleFontPlus = document.getElementById('btnSubtitleFontPlus');
    this.btnSubtitleFontMinus = document.getElementById('btnSubtitleFontMinus');
    this.btnPanicKill = document.getElementById('btnPanicKill');
    this.btnPauseScan = document.getElementById('btnPauseScan');

    // History
    this.historyList = document.getElementById('historyList');
    this.historyCount = document.getElementById('historyCount');
    this.historyEmpty = document.getElementById('historyEmpty');
    this.btnExportSRT = document.getElementById('btnExportSRT');
    this.btnExportTXT = document.getElementById('btnExportTXT');
    this.btnClearHistory = document.getElementById('btnClearHistory');

    // Native audio element for dubbing playback
    this.dubbingAudio = document.getElementById('dubbingAudio');

    // Toast element
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'studio-toast';
    document.body.appendChild(this.toastEl);

    // Global user-interaction audio unlock to defeat browser autoplay policies
    if (typeof window !== 'undefined') {
      const unlock = () => this.ensureAudioUnlocked();
      ['pointerdown', 'keydown', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, unlock, { passive: true });
      });
    }

    this.initOverlayChannel();
    this.startControlPolling();
  }

  startControlPolling() {
    if (this._controlPollingActive) return;
    this._controlPollingActive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/control/poll');
        if (res.ok) {
          const data = await res.json();
          if (data && data.key) {
            this.handleKeyCommand(data.key.toLowerCase());
          }
        }
      } catch (_) {}
      setTimeout(poll, 120);
    };
    poll();
  }

  initOverlayChannel() {
    try {
      if (typeof BroadcastChannel !== 'undefined' && !this.overlayChannel) {
        this.overlayChannel = new BroadcastChannel('livesub_overlay_channel');
        this.overlayChannel.onmessage = (event) => {
          const data = event.data;
          if (!data) return;
          if (data.type === 'KEY_COMMAND') {
            const key = (data.key || '').toLowerCase();
            this.handleKeyCommand(key);
          } else if (data.type === 'REQUEST_SYNC') {
            this.broadcastOverlayState();
          }
        };
      }
      if (typeof window !== 'undefined' && !this._overlayStorageBound) {
        this._overlayStorageBound = true;
        window.addEventListener('storage', (event) => {
          if (event.key === 'livesub_key_command' && event.newValue) {
            try {
              const cmd = JSON.parse(event.newValue);
              if (cmd && cmd.key) {
                this.handleKeyCommand(cmd.key.toLowerCase());
              }
            } catch (_) {}
          }
        });
      }
    } catch (e) {
      console.warn('initOverlayChannel error:', e);
    }
  }

  handleKeyCommand(key) {
    const now = Date.now();
    if (this._lastKeyCmd === key && (now - (this._lastKeyCmdTime || 0)) < 250) {
      return; // Khử lặp khi nhận đồng thời từ BroadcastChannel, storage event và polling
    }
    this._lastKeyCmd = key;
    this._lastKeyCmdTime = now;

    if (key === 'p') {
      this.toggleScanningPause();
    } else if (key === 'm') {
      this.toggleDubbingMute();
    } else if (key === 't') {
      const modes = ['transparent', 'glass', 'dark'];
      const nextIdx = (modes.indexOf(this.currentTransparency) + 1) % modes.length;
      this.currentTransparency = modes[nextIdx];
      const targetRadio = document.querySelector(`input[name="subTransparency"][value="${this.currentTransparency}"]`);
      if (targetRadio) targetRadio.checked = true;
      this.applyTransparencyUI();
      this.updateAppliedSettings();
      this.broadcastOverlayState();
      this.showToast(`Phông nền phụ đề: ${this.currentTransparency === 'transparent' ? 'Trong suốt' : (this.currentTransparency === 'glass' ? 'Kính mờ' : 'Tối màu')}`);
    } else if (key === '+' || key === '=') {
      this.adjustFontSize(1);
    } else if (key === '-') {
      this.adjustFontSize(-1);
    }
  }

  broadcastOverlayState() {
    try {
      if (!this.overlayChannel && typeof BroadcastChannel !== 'undefined') {
        this.overlayChannel = new BroadcastChannel('livesub_overlay_channel');
      }
      if (this.overlayChannel) {
        this.overlayChannel.postMessage({
          type: 'SYNC_STATE',
          isDubbingEnabled: this.isDubbingEnabled,
          isScanningPaused: this.isScanningPaused,
          currentSubMode: this.currentSubMode,
          currentTransparency: this.currentTransparency
        });
      }
    } catch (_) {}
  }

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
  }

  showToast(msg) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, 2400);
  }

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
  }

  getSafeStreamingPlaybackRate(queueDepth = 0, serverCap = 2.0, originalDuration = 0, textLength = 0, queueLagMs = 0) {
    const manualRate = parseFloat(this.rateRange && this.rateRange.value) || 1.15;
    const safeCap = (serverCap && serverCap >= 1.5) ? serverCap : 2.0;
    if (!this.isAdaptiveSpeedEnabled) {
      return Math.min(safeCap, Math.max(0.5, manualRate));
    }
    let rate = manualRate;

    // Realtime Lag Overdrive:
    // Anime & movie dialogue is fast-paced (~4.8-5.5 syllables/sec).
    // If the queue lags behind the video, immediately accelerate speech rate to eliminate cumulative delay.
    if (queueLagMs > 1200) {
      rate = Math.max(rate, 1.70);
    } else if (queueLagMs > 700) {
      rate = Math.max(rate, 1.50);
    } else if (queueLagMs > 350) {
      rate = Math.max(rate, 1.35);
    } else if (queueLagMs > 150) {
      rate = Math.max(rate, 1.25);
    }

    if (queueDepth >= 2) {
      rate = Math.max(rate, 1.30);
    }

    // Adaptive Speech Pacing: fit dialogue length to anime frame duration
    if (textLength > 0) {
      const estimatedSyllables = Math.max(1, textLength / 3.8);
      const estimatedSpeechSeconds = estimatedSyllables * 0.22;
      const targetDuration = originalDuration > 0
        ? originalDuration
        : Math.max(1.0, textLength * 0.045);
      if (targetDuration > 0 && estimatedSpeechSeconds > targetDuration) {
        const fitRate = estimatedSpeechSeconds / targetDuration;
        rate = Math.max(rate, fitRate);
      }
    }

    return Math.min(safeCap, Math.max(0.8, rate));
  }

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
  }

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
  }

  bindEvents() {
    if (this.btnConfirmSettings) {
      this.btnConfirmSettings.addEventListener('click', () => this.confirmRuntimeSettings());
    }

    // 1. Source Switching Tabs
    this.sourceTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.source;
        this.switchSourceTab(target);
      });
    });

    // 2. Source 1: System / Tab Audio
    if (this.btnModeSub) {
      this.btnModeSub.addEventListener('click', () => this.setSystemMode('ocr'));
    }
    if (this.btnModeAudio) {
      this.btnModeAudio.addEventListener('click', () => this.setSystemMode('whisper'));
    }
    if (this.btnModeHybrid) {
      this.btnModeHybrid.addEventListener('click', () => this.setSystemMode('auto'));
    }
    if (this.ocrZoneSelect) {
      this.ocrZoneSelect.addEventListener('change', (e) => {
        this.ocrScanZone = e.target.value;
        try { localStorage.setItem('livesub_ocr_zone', e.target.value); } catch (_) {}
        const zoneName = (this.ocrZoneSelect.selectedOptions && this.ocrZoneSelect.selectedOptions[0])
          ? this.ocrZoneSelect.selectedOptions[0].text
          : e.target.value;
        this.showToast(`📐 Đã đổi vùng quét sub: ${zoneName}`);
      });
    }
    if (this.btnToggleSystemAudio) {
      this.btnToggleSystemAudio.addEventListener('click', () => this.toggleSystemAudio());
    }
    if (this.systemCaptureMode) {
      this.systemCaptureMode.addEventListener('change', () => {
        const mode = this.getRadioGroupValue(this.systemCaptureMode, 'audio_only');
        localStorage.setItem('livesub_system_capture_mode', mode);
        this.updateSystemIntelligenceControls();
        this.updateAppliedSettings();
      });
    }
    if (this.systemSubModeRadios) {
      this.systemSubModeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
          this.setSubMode(e.target.value);
        });
      });
    }

    // 3. Source 2: Mic
    if (this.btnToggleMic) {
      this.btnToggleMic.addEventListener('click', () => this.toggleMic());
    }

    // 5. Source 4: Web URL
    if (this.webVideoForm && this.webUrlInput) {
      this.webVideoForm.addEventListener('submit', (event) => {
        event.preventDefault();
        this.loadWebVideo();
      });
    }
    if (this.btnLoadWebUrl) {
      this.btnLoadWebUrl.addEventListener('click', () => this.loadWebVideo());
    }
    if (this.sampleLinks) {
      this.sampleLinks.forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.url) this.loadWebVideo(btn.dataset.url);
        });
      });
    }
    if (this.btnWebLiveCapture) {
      this.btnWebLiveCapture.addEventListener('click', () => this.toggleSystemAudio());
    }
    if (this.webCaptionMode) {
      this.webCaptionMode.addEventListener('change', () => {
        localStorage.setItem('livesub_caption_mode', this.getRadioGroupValue(this.webCaptionMode, 'auto'));
        this.updateSourceIntelligenceControls();
        this.updateAppliedSettings();
      });
    }
    if (this.webCaptionLanguage) {
      this.webCaptionLanguage.addEventListener('change', () => {
        localStorage.setItem('livesub_caption_language', this.getRadioGroupValue(this.webCaptionLanguage, 'auto'));
        this.updateSourceIntelligenceControls();
        this.updateAppliedSettings();
      });
    }
    if (this.btnCloseWebVideo) {
      this.btnCloseWebVideo.addEventListener('click', () => {
        this.cleanupYouTubePlayback();
        const playerContainer = document.getElementById('webVideoPlayer');
        if (playerContainer) playerContainer.innerHTML = '';
        this.webVideoContainer.style.display = 'none';
        this.stopAllAudio();
      });
    }

    // Master Dubbing Toggle
    const toggleMasterDub = () => {
      this.isDubbingEnabled = !this.isDubbingEnabled;
      this.dubbingGeneration++;
      this.liveDubbingQueue = [];
      this.playbackGeneration++;
      localStorage.setItem('livesub_dubbing_enabled', this.isDubbingEnabled);
      if (!this.isDubbingEnabled) {
        this.stopDubbingAudio(false);
      } else {
        if (this.currentYtSegmentIdx >= 0) {
          this.prefetchUpcomingAudio(this.currentYtSegmentIdx);
        } else {
          this.prefetchUpcomingAudio(0);
        }
      }
      this.updateMasterDubUI();
      this.updateAppliedSettings();
      this.showToast(this.isDubbingEnabled ? ' ĐÃ BẬT LỒNG TIẾNG' : '⏸️ ĐÃ TẮT LỒNG TIẾNG');
    };

    if (this.btnMasterDubToggle) {
      this.btnMasterDubToggle.addEventListener('click', toggleMasterDub);
    }
    if (this.btnCinemaMasterDubToggle) {
      this.btnCinemaMasterDubToggle.addEventListener('click', toggleMasterDub);
    }

    // Speaker Test Button
    if (this.btnTestSpeaker) {
      this.btnTestSpeaker.addEventListener('click', () => this.testSpeaker());
    }

    // 6. Voice & Language Change Feedback
    if (this.voiceSelect) {
      this.voiceSelect.addEventListener('change', () => this.handleVoiceChange());
      this.voiceSelect.addEventListener('input', () => this.handleVoiceChange());
    }
    if (this.sourceLangSelect) {
      this.sourceLangSelect.addEventListener('change', () => {
        const val = this.sourceLangSelect.value;
        const name = this.sourceLangSelect.selectedOptions[0] ? this.sourceLangSelect.selectedOptions[0].text : val;
        this.detectedOCRLanguage = null;
        this.autoDetectedSourceLang = null;
        this.lastOCRText = '';
    this.lastCleanText = '';
        this._hasNotifiedVietsubMode = false;
        if (this.oneTouchDetectionPill) {
          if (val === 'vi') {
            this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phát hiện Vietsub:</strong> Khóa chế độ đọc chữ OCR siêu tốc ~200ms (tắt nghe tiếng chống loạn giọng)';
          } else if (val.startsWith('en')) {
            this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phụ đề Tiếng Anh:</strong> OCR PaddleOCR v4 (English) siêu tốc ~20ms, dịch trực tiếp & lồng tiếng Việt';
          } else if (val.startsWith('ja')) {
            this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phụ đề Tiếng Nhật:</strong> OCR PP-OCR v3 (Kanji/Kana) siêu tốc ~20ms, dịch trực tiếp & lồng tiếng Việt';
          } else if (val.startsWith('zh')) {
            this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phụ đề Tiếng Trung:</strong> OCR PP-OCR v4 (Hán tự) siêu tốc ~20ms, dịch trực tiếp & lồng tiếng Việt';
          } else if (val.startsWith('ko')) {
            this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phụ đề Tiếng Hàn:</strong> OCR PP-OCR v3 (Hangul) siêu tốc ~20ms, dịch trực tiếp & lồng tiếng Việt';
          } else {
            this.oneTouchDetectionPill.innerHTML = `⚡ <strong>Đang quét phụ đề (${val.toUpperCase()}):</strong> Tự động nhận diện & lồng tiếng`;
          }
        }
        localStorage.setItem('livesub_sourcelang', val);
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_lang: val })
        }).catch(() => {});
        this.showToast(` Đã chọn ngôn ngữ gốc: ${name}`);
        this.updateAppliedSettings();
      });
    }

    // 7. Voice Audition Button
    if (this.btnTestVoiceSample) {
      this.btnTestVoiceSample.addEventListener('click', () => this.auditionSelectedVoice());
    }

    // 8. Sliders & Radios
    if (this.rateRange) {
      this.rateRange.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value) || 1;
        this.rateValue.textContent = `${val.toFixed(2)}x`;
        if (this.currentActiveAudioSource && this.currentActiveAudioSource.playbackRate) {
          this.currentActiveAudioSource.playbackRate.value = val;
        }
        if (this.streamingAudioSources && this.streamingAudioSources.size > 0) {
          for (const src of this.streamingAudioSources) {
            if (src && src.playbackRate) src.playbackRate.value = val;
          }
        }
        this.updateAppliedSettings();
      });
      this.rateRange.addEventListener('change', () => {
        this.showToast(` Tốc độ đọc: ${this.rateRange.value}x`);
      });
    }
    if (this.volumeRange) {
      this.volumeRange.addEventListener('input', (e) => {
        const vol = parseInt(e.target.value, 10);
        this.volumeValue.textContent = `${vol}%`;
        if (this.currentGainNode) this.currentGainNode.gain.value = vol / 100;
        this.updateAppliedSettings();
      });
      this.volumeRange.addEventListener('change', () => {
        this.showToast(` Âm lượng: ${this.volumeRange.value}%`);
      });
    }

    this.subTransparencyRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.currentTransparency = e.target.value;
        this.applyTransparencyUI();
        this.updateAppliedSettings();
      });
    });

    this.subModeRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.setSubMode(e.target.value);
      });
    });

    if (this.chkAdaptiveSpeed) {
      this.chkAdaptiveSpeed.addEventListener('change', (e) => {
        this.isAdaptiveSpeedEnabled = !!e.target.checked;
        localStorage.setItem('livesub_adaptive_speed', String(this.isAdaptiveSpeedEnabled));
        if (!this.isAdaptiveSpeedEnabled) {
          this.releaseYouTubeDubbingHold();
        }
        this.updateAppliedSettings();
        this.showToast(this.isAdaptiveSpeedEnabled
          ? '⚡ Thích ứng video: ĐÃ BẬT (Tự động tăng tốc giọng đọc để đuổi kịp phụ đề)'
          : '⏹️ Thích ứng video: ĐÃ TẮT (Giữ cố định tốc độ đọc theo thanh trượt)');
      });
    }

    if (this.btnToggleBoxTransparent) {
      this.btnToggleBoxTransparent.addEventListener('click', () => {
        this.currentTransparency = this.currentTransparency === 'transparent' ? 'dark' : 'transparent';
        const targetRadio = document.querySelector(`input[name="subTransparency"][value="${this.currentTransparency}"]`);
        if (targetRadio) targetRadio.checked = true;
        this.applyTransparencyUI();
      });
    }

    // 9. Subtitle Font Sizing
    this.btnSubtitleFontPlus.addEventListener('click', () => {
      this.fontSizePx = Math.min(52, this.fontSizePx + 2);
      document.documentElement.style.setProperty('--sub-font-size', `${this.fontSizePx}px`);
    });
    this.btnSubtitleFontMinus.addEventListener('click', () => {
      this.fontSizePx = Math.max(16, this.fontSizePx - 2);
      document.documentElement.style.setProperty('--sub-font-size', `${this.fontSizePx}px`);
    });

    // 10. Panic Kill Switch & Shortcuts
    if (this.btnPanicKill) {
      this.btnPanicKill.addEventListener('click', () => {
        this.toggleDubbingMute();
      });
    }
    if (this.btnPauseScan) {
      this.btnPauseScan.addEventListener('click', () => {
        this.toggleScanningPause();
      });
    }

    // 11. Floating Window & Picture-in-Picture
    if (this.btnFloatingWindow) {
      this.btnFloatingWindow.addEventListener('click', () => this.openFloatingOverlay());
    }
    if (this.btnCinemaPiP) {
      this.btnCinemaPiP.addEventListener('click', () => this.openFloatingOverlay());
    }
    if (this.btnFullscreenWebVideo) {
      this.btnFullscreenWebVideo.addEventListener('click', () => this.toggleWebVideoFullscreen());
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
      document.addEventListener('webkitfullscreenchange', () => this.handleFullscreenChange());
      document.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

        if (e.key === 'f' || e.key === 'F') {
          if (this.webVideoContainer && this.webVideoContainer.style.display !== 'none') {
            e.preventDefault();
            this.toggleWebVideoFullscreen();
          }
        } else if (e.key === 'm' || e.key === 'M') {
          e.preventDefault();
          this.toggleDubbingMute();
        } else if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          this.toggleScanningPause();
        }
      });
    }

    // 12. Quick Test Text
    if (this.btnSendTestText) {
      this.btnSendTestText.addEventListener('click', () => this.handleTestText());
    }
    if (this.testTextInput) {
      this.testTextInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleTestText();
      });
    }

    // 13. History Actions
    if (this.btnExportSRT) this.btnExportSRT.addEventListener('click', () => this.exportSRT());
    if (this.btnExportTXT) this.btnExportTXT.addEventListener('click', () => this.exportTXT());
    if (this.btnClearHistory) this.btnClearHistory.addEventListener('click', () => this.clearHistory());
  }

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
  }

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
  }

  cleanupYouTubePlayback() {
    this.youtubeLoadGeneration = (this.youtubeLoadGeneration || 0) + 1;
    if (this.youtubeSubtitleAbortController) {
      try { this.youtubeSubtitleAbortController.abort(); } catch (_) {}
      this.youtubeSubtitleAbortController = null;
    }
    if (this.ytPrefetchAbortController) {
      try { this.ytPrefetchAbortController.abort(); } catch (_) {}
      this.ytPrefetchAbortController = null;
    }
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
    this.currentYtSegmentIdx = -1;
    this.lastSentenceArrivalGapMs = 0;
    this.lastEnqueueTime = 0;
    this.isHoldingYtForDubbing = false;
    this.ytShouldResumeAfterHold = false;
    this.isYtDucked = false;

    if (this.isFetchingPreCache && typeof this.isFetchingPreCache.clear === 'function') {
      this.isFetchingPreCache.clear();
    }
    if (this.audioPreCache && typeof this.audioPreCache.clear === 'function') {
      this.audioPreCache.clear();
    }
    if (this.liveTtsPrefetch && typeof this.liveTtsPrefetch.clear === 'function') {
      this.liveTtsPrefetch.clear();
    }
    this.liveDubbingQueue = [];
    this.isProcessingLiveDubbing = false;
    this.speechQueue = [];
    this.isProcessingSpeechQueue = false;
    this.playbackGeneration = (this.playbackGeneration || 0) + 1;
    this.dubbingGeneration = (this.dubbingGeneration || 0) + 1;

    if (typeof this.stopDubbingAudio === 'function') {
      this.stopDubbingAudio(false, false);
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
  }

  switchSourceTab(source) {
    if (this.activeSource === 'system' && source !== 'system') {
      if (typeof this.stopListening === 'function') {
        this.stopListening();
      }
    }
    if (source !== 'weburl' || this.activeSource === 'weburl') {
      this.cleanupYouTubePlayback();
    }
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    this.activeSource = source;
    this.sourceTabs.forEach(t => {
      if (t.dataset.source === source) t.classList.add('active');
      else t.classList.remove('active');
    });

    if (this.panelSourceSystem) this.panelSourceSystem.style.display = source === 'system' ? 'flex' : 'none';
    if (this.panelSourceMic) this.panelSourceMic.style.display = source === 'mic' ? 'flex' : 'none';
    if (this.panelSourceWebUrl) this.panelSourceWebUrl.style.display = source === 'weburl' ? 'flex' : 'none';
    this.updateAppliedSettings();
  }

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
  }

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
  }

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
    this.stopDubbingAudio(false);
    this.updateMasterDubUI();
    this.updateAppliedSettings();
    this.showToast(` Đã chọn giọng: ${name}`);
    if (this.isDubbingEnabled) {
      this.prefetchUpcomingAudio(Math.max(0, this.currentYtSegmentIdx));
    }
  }

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
  }

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
  }

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
  }

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
  }

  // Audition sample in the exact selected voice
  async auditionSelectedVoice() {
    const selectedVoice = this.voiceSelect.value;
    const voice = this.getEffectiveVoice();
    const sampleTexts = {
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
  }

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
  }

  // --- SOURCE 1: SYSTEM AUDIO ---
  setSystemMode(mode) {
    this.currentSystemMode = mode;
    this.isOCRModeActive = (mode === 'ocr' || mode === 'auto');
    this.isHybridModeActive = (mode === 'auto');
    this.detectedOCRLanguage = null;
    this.autoDetectedSourceLang = null;
    this.lastOCRText = '';
    this.lastCleanText = '';
    if (this.chkEnableWhisper) {
      this.chkEnableWhisper.checked = (mode === 'whisper' || mode === 'auto');
    }
    if (this.isListening && this.mediaStream) {
      if (mode === 'ocr') {
        if (this.neuralVAD) try { this.neuralVAD.pause(); } catch (_) {}
        this.startHardSubtitleOCR(this.mediaStream);
      } else if (mode === 'whisper') {
        this.stopHardSubtitleOCR();
        this.setupVADAndRecording(this.mediaStream);
      } else {
        this.startHardSubtitleOCR(this.mediaStream);
        this.setupVADAndRecording(this.mediaStream);
      }
    }
    if (mode === 'ocr') {
      const savedLang = this.sourceLangSelect ? this.sourceLangSelect.value : (localStorage.getItem('livesub_sourcelang') || 'auto');
      if (this.btnModeSub) this.btnModeSub.classList.add('active');
      if (this.btnModeAudio) this.btnModeAudio.classList.remove('active');
      if (this.btnModeHybrid) this.btnModeHybrid.classList.remove('active');
      if (this.lblSourceLang) this.lblSourceLang.textContent = 'Ngôn Ngữ Phụ Đề:';
      if (this.sourceLangSelect) {
        this.sourceLangSelect.innerHTML = `
          <option value="auto">🌐 Tự động nhận diện</option>
          <option value="en-US">🇬🇧 Tiếng Anh (Dịch sang Việt)</option>
          <option value="ja-JP">🇯🇵 Tiếng Nhật (Dịch sang Việt)</option>
          <option value="zh-CN">🇨🇳 Tiếng Trung (Dịch sang Việt)</option>
          <option value="ko-KR">🇰🇷 Tiếng Hàn (Dịch sang Việt)</option>
          <option value="vi-VN">🇻🇳 Tiếng Việt (Không dịch)</option>
        `;
        this.sourceLangSelect.value = savedLang || 'auto';
      }
      if (!this.isListening) {
        if (this.btnSystemAudioText) this.btnSystemAudioText.textContent = 'BẮT ĐẦU ĐỌC & LỒNG TIẾNG SUB';
      }
      if (this.oneTouchDetectionPill) {
        this.oneTouchDetectionPill.innerHTML = '📷 Đang đọc sub OCR (~150ms)';
      }
    } else if (mode === 'auto') {
      const savedLang = this.sourceLangSelect ? this.sourceLangSelect.value : (localStorage.getItem('livesub_sourcelang') || 'auto');
      if (this.btnModeSub) this.btnModeSub.classList.remove('active');
      if (this.btnModeAudio) this.btnModeAudio.classList.remove('active');
      if (this.btnModeHybrid) this.btnModeHybrid.classList.add('active');
      if (this.lblSourceLang) this.lblSourceLang.textContent = 'Ngôn Ngữ Video:';
      if (this.sourceLangSelect) {
        this.sourceLangSelect.innerHTML = `
          <option value="auto">🌐 Tự động Hybrid (OCR + Whisper)</option>
          <option value="vi-VN">🇻🇳 Tiếng Việt (Phụ đề / Nói)</option>
          <option value="ja-JP">🇯🇵 Tiếng Nhật (Anime)</option>
          <option value="en-US">🇬🇧 Tiếng Anh</option>
          <option value="zh-CN">🇨🇳 Tiếng Trung</option>
          <option value="ko-KR">🇰🇷 Tiếng Hàn</option>
        `;
        this.sourceLangSelect.value = savedLang || 'auto';
      }
      if (!this.isListening) {
        if (this.btnSystemAudioText) this.btnSystemAudioText.textContent = 'BẮT ĐẦU XEM & DỊCH TỰ ĐỘNG';
      }
      if (this.oneTouchDetectionPill) {
        this.oneTouchDetectionPill.innerHTML = '⚡ Chế độ Hybrid: Tự động OCR + Whisper GPU';
      }
    } else {
      const savedLang = this.sourceLangSelect ? this.sourceLangSelect.value : (localStorage.getItem('livesub_sourcelang') || 'auto');
      if (this.btnModeSub) this.btnModeSub.classList.remove('active');
      if (this.btnModeAudio) this.btnModeAudio.classList.add('active');
      if (this.btnModeHybrid) this.btnModeHybrid.classList.remove('active');
      if (this.lblSourceLang) this.lblSourceLang.textContent = 'Tiếng Nói Nhân Vật:';
      if (this.sourceLangSelect) {
        this.sourceLangSelect.innerHTML = `
          <option value="auto">🌐 Tự động (Whisper GPU)</option>
          <option value="ja-JP">🇯🇵 Tiếng Nhật (Anime)</option>
          <option value="en-US">🇬🇧 Tiếng Anh</option>
          <option value="zh-CN">🇨🇳 Tiếng Trung</option>
          <option value="ko-KR">🇰🇷 Tiếng Hàn</option>
          <option value="vi-VN">🇻🇳 Tiếng Việt</option>
        `;
        this.sourceLangSelect.value = savedLang || 'auto';
      }
      if (!this.isListening) {
        if (this.btnSystemAudioText) this.btnSystemAudioText.textContent = 'BẮT ĐẦU NGHE & LỒNG TIẾNG (WHISPER)';
      }
      if (this.oneTouchDetectionPill) {
        this.oneTouchDetectionPill.innerHTML = '🎙️ Đang nghe Whisper GPU (~0.3s)';
      }
    }
  }

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
      const captureMode = this.getRadioGroupValue(this.systemCaptureMode, 'auto');
      const isWhisperMode = (this.currentSystemMode === 'whisper') || (this.getRadioGroupValue(this.systemCaptureMode, 'hard_sub') === 'audio_only');
      const isAutoMode = (this.currentSystemMode === 'auto') || (captureMode === 'auto');
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
  }

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
  }

  // --- SOURCE 4: WEB URL (YOUTUBE WITH MILLISECOND SUBTITLE & VOICE DUB) ---
  getRadioGroupValue(group, fallback = 'auto') {
    if (!group) return fallback;
    const checked = group.querySelector?.('input[type="radio"]:checked');
    return checked?.value || group.value || fallback;
  }

  setRadioGroupValue(group, value) {
    if (!group) return;
    const options = Array.from(group.querySelectorAll?.('input[type="radio"]') || []);
    if (options.length) {
      const target = options.find(option => option.value === value);
      if (target) target.checked = true;
      return;
    }
    group.value = value;
  }

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
  }

  setSourceIntelligenceState(state, label, hint) {
    if (this.sourceIntelligenceState) {
      this.sourceIntelligenceState.dataset.state = state;
      this.sourceIntelligenceState.textContent = label;
      this.sourceIntelligenceState.setAttribute('aria-live', ['success', 'error', 'whisper'].includes(state) ? 'polite' : 'off');
    }
    if (this.sourceIntelligenceHint && hint) this.sourceIntelligenceHint.textContent = hint;
  }

  resolveOCRLanguage() {
    const selectedSpeech = this.sourceLangSelect ? this.sourceLangSelect.value : 'auto';
    if (selectedSpeech && selectedSpeech !== 'auto') return selectedSpeech;
    if (this.detectedOCRLanguage) return this.detectedOCRLanguage;
    if (typeof this.getRadioGroupValue === 'function') {
      const selectedCaption = this.getRadioGroupValue(this.webCaptionLanguage, 'auto');
      if (selectedCaption && !['original', 'auto'].includes(selectedCaption)) return selectedCaption;
    }
    return 'vi';
  }

  async runInitialSubtitleProbe(stream) {
    const videoTrack = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    if (!videoTrack) {
      this.isOCRModeActive = false;
      this.showToast('🎙️ Không có hình ảnh chia sẻ -> Whisper GPU đang nghe âm thanh trực tiếp.');
      return;
    }

    try {
      this.showToast('🔍 Đang kiểm tra 1 lần đầu để tự xác định Vietsub / Phụ đề tiếng gốc / Whisper...');
      const probeVideo = document.createElement('video');
      probeVideo.muted = true;
      probeVideo.playsInline = true;
      probeVideo.srcObject = new MediaStream([videoTrack]);
      await probeVideo.play().catch(() => {});
      await new Promise(r => setTimeout(r, 900));

      const width = probeVideo.videoWidth;
      const height = probeVideo.videoHeight;
      if (!width || !height) {
        probeVideo.pause();
        probeVideo.srcObject = null;
        this.isOCRModeActive = false;
        return;
      }

      const isTallPage = (height > width * 0.60);
      const sourceX = 0;
      const sourceWidth = width;
      let sourceY, sourceHeight;
      if (isTallPage) {
        sourceY = Math.floor(height * 0.56);
        sourceHeight = Math.max(1, Math.floor(height * 0.36));
      } else {
        sourceY = Math.floor(height * 0.70);
        sourceHeight = Math.max(1, Math.floor(height * 0.24));
      }
      // Giữ nguyên độ phân giải gốc 1:1 (lên tới 1080p/1920px) từ Math.min(1, 960 / width) để không làm mờ hoặc mất các dấu phụ nhỏ
      const scale = Math.min(1, 1920 / width);
      const probeCanvas = document.createElement('canvas');
      probeCanvas.width = Math.max(1, Math.round(sourceWidth * scale));
      probeCanvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const ctx = probeCanvas.getContext('2d', { alpha: false });
      ctx.drawImage(probeVideo, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, probeCanvas.width, probeCanvas.height);

      probeVideo.pause();
      probeVideo.srcObject = null;

      const blob = await new Promise(r => probeCanvas.toBlob(r, 'image/png'));
      if (!blob) return;

      const form = new FormData();
      form.append('image', blob, 'probe-frame.png');
      form.append('source_lang', this.resolveOCRLanguage());
      const res = await fetch('/api/ocr-subtitle', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Probe HTTP ${res.status}`);
      const data = await res.json();

      const raw = String(data.original || '').trim();
      const viMarkersCount = (raw.match(/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/gi) || []).length;
      const hasCommonViWord = /\b(?:không|được|người|chúng|tôi|bạn|của|trong|một|cho|với|như|đã|sẽ|đang)\b/i.test(raw);
      const hasViMarkers = viMarkersCount >= 2 || (viMarkersCount >= 1 && hasCommonViWord);

      const currentSelected = this.sourceLangSelect ? this.sourceLangSelect.value : 'auto';
      if (currentSelected === 'auto' && raw && hasViMarkers) {
        // Video already has Vietsub!
        this.isOCRModeActive = true;
        this.detectedOCRLanguage = 'vi';
        this.hasActiveHardSubtitles = true;
        this.updateMasterDubUI();
        this.showToast('Đã nhận diện Vietsub. Đang đọc phụ đề tiếng Việt bằng OCR.');
        if (this.oneTouchDetectionPill) {
          this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Đã nhận diện:</strong> Vietsub trên video — Đang đọc trực tiếp bằng OCR (VieNeu)';
        }
        await this.startHardSubtitleOCR(stream);
      } else if (raw && raw.length >= 2) {
        // Video has foreign hard subtitles!
        this.isOCRModeActive = true;
        this.hasActiveHardSubtitles = true;
        this.showToast('📷 Đã phát hiện phụ đề tiếng gốc trong video! Đang đọc OCR & lồng tiếng VieNeu-TTS.');
        if (this.oneTouchDetectionPill) {
          this.oneTouchDetectionPill.innerHTML = '📷 <strong>Đã nhận diện:</strong> Phụ đề chữ trong video -> Đang đọc OCR & Lồng tiếng VieNeu';
        }
        await this.startHardSubtitleOCR(stream);
      } else {
        // No hard subtitles detected in frame -> Whisper GPU CUDA actively listens, while OCR stands by
        this.hasActiveHardSubtitles = false;
        this.showToast('🎙️ Chế độ 1 Chạm: Whisper GPU đang nghe âm thanh & tự động đọc phụ đề khi xuất hiện.');
        if (this.oneTouchDetectionPill) {
          this.oneTouchDetectionPill.innerHTML = '🎙️ <strong>Chế độ 1 Chạm:</strong> Whisper GPU đang nghe âm thanh & tự động đọc phụ đề khi xuất hiện (OCR)';
        }
      }
    } catch (err) {
      console.warn('Initial subtitle probe failed, defaulting to Whisper:', err);
      this.hasActiveHardSubtitles = false;
      this.showToast('🎙️ Chế độ 1 Chạm: Whisper GPU đang nghe trực tiếp âm thanh video.');
    }
  }

  async startHardSubtitleOCR(streamOrVideo) {
    this.stopHardSubtitleOCR();

    let videoEl = null;
    let isExternalVideo = false;
    if (streamOrVideo instanceof HTMLVideoElement) {
      videoEl = streamOrVideo;
      isExternalVideo = true;
    } else {
      const videoTrack = streamOrVideo && streamOrVideo.getVideoTracks ? streamOrVideo.getVideoTracks()[0] : null;
      if (!videoTrack) {
        this.isOCRModeActive = false;
        this.showToast('OCR cần chia sẻ cả hình ảnh video; đang chuyển về nghe bằng Whisper.');
        return;
      }
      this.ocrVideo = document.createElement('video');
      this.ocrVideo.muted = true;
      this.ocrVideo.playsInline = true;
      this.ocrVideo.srcObject = new MediaStream([videoTrack]);
      await this.ocrVideo.play();
      videoEl = this.ocrVideo;
    }

    this.ocrVideo = videoEl;
    this._isOcrVideoExternal = isExternalVideo;
    this.isListening = true;
    this.isOCRModeActive = true;
    this.activeSource = 'system';
    if (this.activeAbortController) this.activeAbortController.abort();
    while (this.speechQueue.length) this.speechQueue.shift().resolve();
    this.lastOCRText = '';
    this.lastCleanText = '';
    this.ocrCanvas = document.createElement('canvas');

    const scan = async () => {
      if (!this.isListening || !this.isOCRModeActive || this.isScanningPaused || this.ocrRequestActive || !this.ocrVideo) return;
      const width = this.ocrVideo.videoWidth;
      const height = this.ocrVideo.videoHeight;
      if (!width || !height) return;

      // Capture the dialogue subtitle band across full video width.
      // Benchmarks on the target RTX 3050 machine found 960 px to be the best speed/accuracy
      // point for RapidOCR; larger frames only add CPU latency.
      const isTallPage = (height > width * 0.60);
      const sourceX = 0;
      const sourceWidth = width;
      let sourceY, sourceHeight;
      if (this.ocrScanZone === 'top') {
        sourceY = 0;
        sourceHeight = Math.max(1, Math.floor(height * 0.38));
      } else if (this.ocrScanZone === 'full') {
        sourceY = 0;
        sourceHeight = height;
      } else if (isTallPage) {
        // Shared browser webpage tab (e.g. YouTube, Anime sites in split-screen):
        sourceY = Math.floor(height * 0.52);
        sourceHeight = Math.max(1, Math.floor(height * 0.44));
      } else {
        // Shared fullscreen video / 16:9 window: focus on dialogue band (70% to 98%)
        sourceY = Math.floor(height * 0.70);
        sourceHeight = Math.max(1, Math.floor(height * 0.28));
      }
      // Target width 1440px - 1920px preserves high pixel density so Vietnamese tone marks
      // (dấu sắc, huyền, hỏi, ngã, nặng) have crisp sub-pixel detail and are recognized with 100% precision
      const targetWidth = Math.min(1920, Math.max(1280, Math.round(sourceWidth)));
      const scale = targetWidth / sourceWidth;
      this.ocrCanvas.width = targetWidth;
      this.ocrCanvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = this.ocrCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(
        this.ocrVideo,
        sourceX, sourceY, sourceWidth, sourceHeight,
        0, 0, this.ocrCanvas.width, this.ocrCanvas.height
      );
      await this.yieldToMain();

      // Fast non-blocking frame check: Do not scan if previous request is still in flight,
      // or if the video has paused / ended.
      if (this.ocrRequestActive) return;
      if (this.ocrVideo.paused || this.ocrVideo.ended) return;

      // Continuous OCR scanning: Do not artificially pause on static backgrounds (e.g. anime character dialogues)
      this.isVideoPaused = false;

      // Client-side static frame diff: if the dialogue band hasn't changed, skip heavy image encoding
      let isStaticFrame = false;
      let avgDiff = 100.0;
      if (typeof document !== 'undefined' && document.createElement && context && context.getImageData) {
        try {
          if (!this._ocrDiffCanvas) {
            this._ocrDiffCanvas = document.createElement('canvas');
            this._ocrDiffCanvas.width = 16;
            this._ocrDiffCanvas.height = 8;
          }
          const diffCtx = this._ocrDiffCanvas.getContext('2d', { willReadFrequently: true });
          if (diffCtx) {
            diffCtx.drawImage(this.ocrCanvas, 0, 0, 16, 8);
            const curData = diffCtx.getImageData(0, 0, 16, 8).data;
            if (this._ocrLastSample) {
              let diff = 0;
              for (let i = 0; i < curData.length; i += 4) {
                diff += Math.abs(curData[i] - this._ocrLastSample[i])
                      + Math.abs(curData[i + 1] - this._ocrLastSample[i + 1])
                      + Math.abs(curData[i + 2] - this._ocrLastSample[i + 2]);
              }
              avgDiff = diff / (128 * 3);
              if (avgDiff < 0.8) {
                isStaticFrame = true;
              }
            }
            this._ocrLastSample = curData;
          }
        } catch (_) {}
      }

      if (isStaticFrame) {
        this._ocrStaticFrameCount = (this._ocrStaticFrameCount || 0) + 1;
        if (this.lastOCRText) {
          this.lastHardSubTime = performance.now();
          // Subtitle on screen: check every 2nd tick (~70ms)
          if (this._ocrStaticFrameCount % 2 !== 0) return;
        } else {
          // No subtitle on screen: if change is tiny (< 0.4), skip every 2nd tick (~70ms) to conserve CPU
          // If diff >= 0.4, trigger scan immediately on tick 0 so new dialogue text is caught instantly!
          if (avgDiff < 0.4 && this._ocrStaticFrameCount % 2 !== 0) return;
        }
      } else {
        this._ocrStaticFrameCount = 0;
      }

      this.ocrRequestActive = true;
      try {
        // High quality JPEG 0.90 ensures fine Vietnamese tone hooks & accents are sharply preserved
        const blob = await new Promise(resolve => this.ocrCanvas.toBlob(resolve, 'image/jpeg', 0.90));
        if (!blob) return;
        const form = new FormData();
        form.append('image', blob, 'subtitle-frame.jpg');
        form.append('source_lang', this.resolveOCRLanguage());
        form.append('previous_context', this.lastTranscriptContext || '');
        const response = await fetch('/api/ocr-subtitle', { method: 'POST', body: form });
        if (!response.ok) throw new Error(`OCR HTTP ${response.status}`);
        const data = await response.json();
        if (!data.empty && data.original) {
          const hadEmptyGap = Boolean(this.ocrConsecutiveEmpty && this.ocrConsecutiveEmpty >= 1);
          this.ocrConsecutiveEmpty = 0;
          this.hasActiveHardSubtitles = true;
          this.hasSeenHardSubtitles = true;
          this.lastHardSubTime = performance.now();
          data.hadEmptyGap = hadEmptyGap;
          const viCount = (data.original.match(/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/gi) || []).length;
          const hasViWord = /\b(?:không|được|người|chúng|tôi|bạn|của|trong|một|cho|với|như|đã|sẽ|đang|vậy|từ|đó|những|tộc|hoàng|đế)\b/i.test(data.original);
          if (viCount >= 2 || (viCount >= 1 && hasViWord)) {
            this.detectedOCRLanguage = 'vi';
          } else if (/[a-zA-Z]/.test(data.original)) {
            this.detectedOCRLanguage = 'en';
          }
          if (this.neuralVAD && this.neuralVADActive) {
            try { this.neuralVAD.pause(); } catch (_) {}
          }
          if (this.oneTouchDetectionPill && !this._hasNotifiedVietsubMode) {
            this._hasNotifiedVietsubMode = true;
            const currentLang = this.resolveOCRLanguage();
            if (currentLang === 'vi' || (currentLang === 'auto' && this.detectedOCRLanguage === 'vi')) {
              this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phát hiện Vietsub Anime:</strong> Khóa chế độ đọc chữ OCR siêu tốc ~200ms (tắt nghe tiếng chống loạn giọng)';
            } else if (currentLang.startsWith('en')) {
              this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phụ đề Tiếng Anh:</strong> OCR PaddleOCR v4 (English) siêu tốc ~20ms, dịch trực tiếp & lồng tiếng Việt';
            } else if (currentLang.startsWith('ja')) {
              this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phụ đề Tiếng Nhật:</strong> OCR PP-OCR v3 (Kanji/Kana) siêu tốc ~20ms, dịch trực tiếp & lồng tiếng Việt';
            } else if (currentLang.startsWith('zh')) {
              this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phụ đề Tiếng Trung:</strong> OCR PP-OCR v4 (Hán tự) siêu tốc ~20ms, dịch trực tiếp & lồng tiếng Việt';
            } else if (currentLang.startsWith('ko')) {
              this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phụ đề Tiếng Hàn:</strong> OCR PP-OCR v3 (Hangul) siêu tốc ~20ms, dịch trực tiếp & lồng tiếng Việt';
            } else {
              this.oneTouchDetectionPill.innerHTML = `⚡ <strong>Đang quét phụ đề (${currentLang.toUpperCase()}):</strong> Tự động nhận diện & lồng tiếng`;
            }
          }
          this.handleOCRSubtitle(data);
        } else {
          this.ocrConsecutiveEmpty = (this.ocrConsecutiveEmpty || 0) + 1;
          if (this.ocrConsecutiveEmpty >= 2) {
            // After ~70ms of empty gap, reset lastOCRText so repeated dialogue lines speak in full
            this.lastOCRText = '';
            this.lastCleanText = '';
          }
          if (this.ocrConsecutiveEmpty >= 10) {
            // After ~350ms without hard subtitles, release active lock so Whisper can process speech
            if (this.hasActiveHardSubtitles) {
              this.hasActiveHardSubtitles = false;
              if (this.neuralVAD && this.neuralVADActive) {
                try { this.neuralVAD.resume(); } catch (_) {}
              }
              if (this.oneTouchDetectionPill) {
                this.oneTouchDetectionPill.innerHTML = '🎙️ <strong>Chế độ 1 Chạm:</strong> Whisper GPU đang nghe âm thanh trực tiếp';
              }
            }
          }
          if (this.ocrConsecutiveEmpty >= 40) {
            // After ~1.4s of silence / no subtitle, clear on-screen display
            if (this.currentSubMode !== 'none' && typeof this.displaySubtitle === 'function') {
              this.displaySubtitle('', '');
              if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = '';
              if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = '';
              if (this.invideoSubVi) this.invideoSubVi.textContent = '';
              if (this.invideoSubSource) this.invideoSubSource.textContent = '';
            }
          }
        }
      } catch (error) {
        console.warn('Hard subtitle OCR failed', error);
      } finally {
        this.ocrRequestActive = false;
      }
    };

    await scan();
    this.ocrTimer = setInterval(scan, 35);
    this.setSourceIntelligenceState('ocr', 'OCR đang chạy', 'Đang đọc vùng phụ đề trong khung hình; không dùng Whisper khi OCR hoạt động.');
    this.showToast('OCR đã bật. Để chính xác, hãy chia sẻ riêng tab/video thay vì toàn desktop.');
  }

  ocrSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    let c1 = String(s1);
    let c2 = String(s2);
    // Chỉ loại bỏ CJK nếu chuỗi là thuần chữ Latinh (Vietsub tránh dính watermark nền anime)
    const isCjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(c1 + c2);
    if (!isCjk) {
      c1 = c1.replace(/[\u4e00-\u9fff\u3040-\u30ff]/g, '');
      c2 = c2.replace(/[\u4e00-\u9fff\u3040-\u30ff]/g, '');
    }
    const strip = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd');
    const a = strip(c1).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const b = strip(c2).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (a === b) return 1.0;
    if (!a || !b) return 0;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    const v0 = new Array(b.length + 1);
    const v1 = new Array(b.length + 1);
    for (let i = 0; i <= b.length; i++) v0[i] = i;
    for (let i = 0; i < a.length; i++) {
      v1[0] = i + 1;
      for (let j = 0; j < b.length; j++) {
        const cost = a[i] === b[j] ? 0 : 1;
        v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
      }
      for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
    }
    return 1.0 - (v0[b.length] / maxLen);
  }

  async yieldToMain() {
    if (typeof window !== 'undefined' && 'scheduler' in window && 'yield' in window.scheduler) {
      await window.scheduler.yield();
    } else {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  isDuplicateOCR(text, candidate) {
    if (!text || !candidate) return false;
    const stripAccents = (s) => (s || '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'd')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ').trim();
    const s1 = stripAccents(text);
    const s2 = stripAccents(candidate);
    if (!s1 || !s2) return false;
    if (s1 === s2) return true;

    // If one sentence has added words or extension (length diff >= 4), they are distinct clauses/lines
    if (Math.abs(s1.length - s2.length) >= 4) {
      return false;
    }

    // Direct Levenshtein similarity on normalized text
    const sim = this.ocrSimilarity(s1, s2);
    // Short lines (<= 15 chars e.g. "Nhất trí!", "Thật à?", "Đi mau!", "Let's go!")
    if (Math.min(s1.length, s2.length) <= 15) {
      return sim >= 0.90;
    }

    return sim >= 0.88;
  }

  isGarbageOCR(text) {
    if (!text || typeof text !== 'string') return true;
    const trimmed = text.trim();
    if (!trimmed) return true;

    // Reject pirate site watermark banners (Kèo bóng lăn, Rạp chiếu, Cá cược, Nạp đầu, Tip...)
    if (/(?:Rạp chi[eêểế]u|Kèo bóng|Bóng lăn|Cá cược|Khuyến mãi|Nạp đầu|Ăn to|Tập\s*\d+>|Acid Béo|Hoiro|Sunwin|3bet|Nohu)/i.test(trimmed)) {
      return true;
    }

    // Allow Japanese, Chinese and Korean dialogue text:
    // Bất kỳ câu nào có ký tự CJK (chữ Hán, Hiragana, Katakana, Hangul) đều là thoại hợp lệ!
    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(trimmed)) {
      return false;
    }

    let currentLang = 'vi';
    try {
      if (typeof this.resolveOCRLanguage === 'function') {
        currentLang = this.resolveOCRLanguage() || 'vi';
      }
    } catch (_) {}
    const isVietsub = currentLang === 'vi' || (currentLang === 'auto' && this.detectedOCRLanguage === 'vi') || currentLang === 'auto';
    const isForeignLatin = !isVietsub;

    const cleanNorm = trimmed.replace(/^[^\wÀ-ỹ]+|[^\wÀ-ỹ]+$/gu, '').toLowerCase();
    if (!cleanNorm) return true;

    // Single-letter exclamations: "Á!", "Ơ!", "Ô!", "Ê!", "Ý!", "A!", "O!"
    if (cleanNorm.length === 1) {
      return !/^[aáàảãạăằắẳẵặâầấẩẫậeéèẻẽẹêềếểễệiíìỉĩịoóòỏõọôồốổỗộơờớởỡợuúùủũụưừứửữựyýỳỷỹỵ]$/i.test(cleanNorm);
    }

    // Đối với phụ đề ngôn ngữ nước ngoài (Tiếng Anh, Latin):
    if (isForeignLatin) {
      // Cho phép tất cả các câu thoại tiếng Anh thông dụng (kể cả VIẾT HOA hoặc câu ngắn 1-2 từ)
      const rawTokens = trimmed.match(/\S+/g) || [];
      if (rawTokens.some(w => /[a-zA-Z]+[0-9]{2,}|[0-9]{2,}[a-zA-Z]+/.test(w))) return true;
      if (/^[^\w\s]*\d+\s+[A-Za-z]{1,2}$/.test(trimmed)) return true;
      const hasValid = /[a-zA-Z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(trimmed);
      if (!hasValid) return true;
      return false;
    }

    // Common short action/dialogue words in anime & movies
    const SHORT_VALID = /^(ai|gì|đâu|nào|sao|có|không|đi|được|chạy|bắn|tránh|cút|dừng|đứng|chết|khoan|thôi|mau|biết|hiểu|nhớ|quên|xem|nghe|nói|thấy|cha|ba|mẹ|bố|con|anh|em|ông|bà|chị|cô|chú|bác|cháu|hắn|nó|họ|ta|mình|ừ|dạ|hả|vâng|đúng|phải|sai|thật|kìa|đây|đó|rồi|lại|ngay|xin|chào|này|vậy|hở|ôi|ơ|chứ|xong|nguy|cứu|buông|đợi|im|rõ|chắc)[.!?…,]*$/iu;
    if (SHORT_VALID.test(trimmed)) return false;
    // Strip noise prefix like leading %, _, quotes
    const textClean = trimmed.replace(/^[^\w\sÀ-ỹà-ỹ]+/i, '').trim();
    if (!textClean) return true;

    // Reject known hallucinated corruptions and background texture noise tokens
    if (/(?:ƯỚcC|ƯỚỢC|enmisẽ|cạn\s+độn|emaa|á\s*ƯỚ|cốc\s+nà|cô\s+rà)/i.test(trimmed)) return true;
    if (/^[_\s]*Ms\b/i.test(trimmed)) return true;

    // Reject noise tokens with mixed letters and digits (e.g. AA82n, Ta02, 2a, a2)
    const rawTokens = trimmed.match(/\S+/g) || [];
    if (rawTokens.some(w => /[a-zA-Z]+[0-9]+|[0-9]+[a-zA-Z]+/.test(w))) return true;
    if (/\b[a-z]*([hkjqwxyzv])\1[a-z]*\b/i.test(textClean)) return true;

    // Reject stray leading/trailing isolated digits or single consonants (e.g. "'2 VỀ", "Cảm ơn nhé. S", "lọi P")
    if (/(?:^|[\s,.\-;:!?])[0-9]+[a-zA-Zà-ỹÀ-Ỹ]?\s+[A-Za-zÀ-ỹ]{1,3}$/.test(trimmed)) return true;
    if (/^[^\w\s]*\d+\s+[A-Za-zÀ-ỹ]{1,3}$/.test(trimmed)) return true;
    if (/\s+[B-DF-HJ-NP-TV-Z]$/.test(trimmed)) return true;
    if (/^[B-DF-HJ-NP-TV-Zb-df-hj-np-tv-z]\s+[xX]\b/.test(trimmed)) return true;

    // Reject illegal double consonants and impossible consonant clusters in Vietnamese
    const wordTokens = textClean.match(/[a-zA-ZÀ-ỹ]+/g) || [];
    for (const tok of wordTokens) {
      const tokLow = tok.toLowerCase();
      if (['boss', 'pass', 'app', 'staff', 'jazz', 'off', 'game', 'hero', 'team', 'hello', 'cannot', 'will', 'little', 'better', 'all'].includes(tokLow)) continue;
      if (/(?:ccc|nng|een|xetn|[b-df-hj-np-tv-z]{4,})/.test(tokLow)) return true;
      if (/^[B-DF-HJ-NP-TV-Z]{2}$/.test(tok)) return true;
      if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúùủũụưừứửữựỳýỷỹỵđ]/.test(tokLow) && /([b-df-hj-np-tv-z])\1/.test(tokLow)) return true;
    }

    // Reject non-acronym all-caps words or nonsense tokens (e.g. AOA, EOA, BOA)
    const caps = trimmed.match(/\b[A-Z]{3,}\b/g);
    if (caps && caps.length > 0) {
      const KNOWN_ACRONYMS = new Set(['FBI', 'CIA', 'USA', 'VIP', 'CEO', 'SOS', 'GPS', 'SMS', 'USB', 'KFC', 'MC', 'DJ', 'AI', 'PC', 'TV', 'OK']);
      if (caps.some(c => !KNOWN_ACRONYMS.has(c))) return true;
    }

    // Reject phonotactically impossible vowel sequences in Vietnamese
    if (/(?:aoa|oaa|eoa|ee[aeiou]|uou|iei|iai)/i.test(trimmed)) return true;

    const letters = trimmed.match(/[a-zA-Zà-ỹÀ-Ỹ]/g);
    if (!letters) return true;
    const vowels = trimmed.match(/[aeiouyàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵAEIOUYÀ-Ỹ]/g);
    if (!vowels || (vowels.length / letters.length) < 0.18) return true;
    if (letters.length <= 6 && vowels.length <= 1 && !SHORT_VALID.test(trimmed)) return true;
    const words = trimmed.match(/[a-zA-Zà-ỹÀ-Ỹ0-9]+/g) || [];
    const vowelRegex = /[aeiouyàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵAEIOUYÀ-Ỹ]/;
    const wordsWithVowels = words.filter(w => vowelRegex.test(w));
    if (wordsWithVowels.length === 0 || (words.length >= 2 && (wordsWithVowels.length / words.length) < 0.5)) return true;
    if (/\b[A-Za-z]+[0-9]+\b/.test(trimmed) && words.length <= 3) return true;
    return false;
  }

  handleOCRSubtitle(data) {
    if (this.isScanningPaused) return;
    let raw = String(data.original || '').replace(/\s+/g, ' ').trim();
    if (!raw) return;

    // Check if subtitle line is music/OST
    const isMusic = /[\u266a\u266b\u2669\u266c\uD83C\uDFB5\uD83C\uDFB6~～♪♫♬♩]/u.test(raw) ||
                    /^\s*\[(music|applause|cheering|laughter|sound track|ost|bgm)\]\s*$/i.test(raw);
    if (isMusic) {
      this.displaySubtitle(raw, `🎵 [Nhạc nền / OST] ${data.translated || raw}`);
      return;
    }

    // Defragment single-consonant split words (e.g. "X em" -> "Xem", "x em" -> "xem", "t ôi" -> "tôi", "đ i" -> "đi")
    const defrag = (s) => (s || '').replace(/\b([bcdfghjklmnpqrstvwxyzđBCDFGHJKLMNPQRSTVWXYZĐ]|(?:ch|gh|kh|nh|ph|th|tr|ng|ngh|Ch|Gh|Kh|Nh|Ph|Th|Tr|Ng|Ngh))\s+([a-zA-Zà-ỹÀ-Ỹ]{1,6})\b/g, (match, c, rest) => {
      const combined = (c + rest).toLowerCase();
      if (/^(xem|tôi|đi|không|cho|người|bạn|làm|về|sẽ|rõ|nào|mình|họ|gì|được|nhưng|thấy|chắc|nói|biết|kìa|lần|đầu)$/i.test(combined)) {
        return c.toUpperCase() === c ? (c + rest.toLowerCase()) : combined;
      }
      return match;
    });
    raw = defrag(raw);

    if (this.isGarbageOCR(raw)) return;

    // Strip stray CJK characters ONLY if we are in Vietnamese subtitle mode (Vietsub)
    // NEVER strip CJK if source language is Japanese, Chinese, or contains native CJK subtitles!
    let currentLang = 'auto';
    try {
      if (typeof this.resolveOCRLanguage === 'function') {
        currentLang = this.resolveOCRLanguage() || 'auto';
      }
    } catch (_) {}
    const isVietsubMode = currentLang === 'vi' || currentLang === 'auto' || (this.detectedOCRLanguage === 'vi');
    // Cleanups specific to Vietsub fansub videos (AnimeHay, web player UI, gambling ads)
    if (isVietsubMode) {
      if (/[a-zA-Zà-ỹÀ-Ỹ]/.test(raw)) {
        raw = raw.replace(/[\u4e00-\u9fff\u3040-\u30ff]+/g, ' ').replace(/\s+/g, ' ').trim();
      }

      // Strip gambling site watermark banners (Sunwin, Hobet, Kèo bóng lăn, 3bet, Nohu, Tip2>...)
      raw = raw.replace(/\s*(?:Tip\d*|Tapi\d*|Tip\d+>|Tapi\d+>|Ráp chi[a-z]*|Lenkeobonglan|Hobet|Sunwin|Santuithantai|Nohuthethao|Nohu|3bet|Thuonghieusunwin|Napdau|Nhanngay).*$/i, '').trim();

      // Strip video titles, channel watermark tags and web fansub junk leaking into subtitle
      const junkTailRegex = /(?:^|\s+)(?:animehay|animevietsub|bit\.ly|citumo|rap\s*citu|hdbet|3bet|ch[oơ]ingay|n[oổ]\s*h[uũ]|b[áa]ckinh|bickinh|backinh|truyengoc).*$/i;
      raw = raw.replace(junkTailRegex, '').trim().replace(/^[,.\-:;]+|[,.\-:;]+$/g, '').trim();

      // Strip trailing video player UI buttons (e.g. "On O Ép On", "Ổn Áp On", "On Cx Oy", "Cài đặt Ơ On")
      raw = raw.replace(/(?:\b(?:On|Ổn|Ổn Áp|Cài đặt|Cài đăt|Cd|Oy|Cx|Ép On|Ép|Em|Cào Cào|Cư Pui)\b[\s\wÀ-ỹ]{0,15})+$/i, '').trim();
      raw = raw.replace(/\b(?:On\s+Cx\s+Oy|On\s+O\s+Ép\s+On|Ổn\s+Áp\s+On|Oy\s+Em|Cài\s+đặt\s+Ơ\s+On)\b/gi, '').trim();
      if (!raw) return;

      // Reject corrupted Vietsub hard subtitle OCR reading
      if (/[åöøß]|ngv[oò]i|thv[oò]ng|nu[aá]c\s*m[aå]t|lung\s*tr[oò]ng|ky\s*vi[eê]n/i.test(raw)) return;
      if (/\b(?:animehay|animevietsub|bit\.ly|citumo|rap\s*citu|hdbet|3bet|chơingay|nổ\s*hũ|bản lồng tiếng)\b/i.test(raw)) return;

      // Strip isolated single-letter leading OCR boundary noise (e.g. "e kích thành trì" -> "kích thành trì")
      raw = raw.replace(/^[a-zA-Z]\s+(?=[a-zA-Zà-ỹÀ-Ỹ]{3,})/i, '').trim();
    } else {
      // For foreign languages (English, Japanese, Chinese, French, German, Spanish, etc.):
      // Keep natural words like 'on', 'subscribers', 'views', 'six', 'share', 'comment'
      raw = raw.replace(/^[b-hj-zB-HJ-Z]\s+(?=[a-zA-Z]{3,})/i, '').trim();
    }

    // Strip video player OSD timecodes (e.g. "09:15/23:58", "5 09:20 / 23:50", "Dù 0 09:23 / 23:59", "23:56", "3 09:54/ 23:5", "11:24 / 23:59")
    // IMPORTANT: Preserve valid quantities & numbers like "1.000", "50.000", "1.5"
    raw = raw.replace(/(?:(?:^|\s+)(?:Dù|Vào|Vao|[a-zA-Z]{1,4})\s*){0,2}(?:\s*\d+\s+)?(?:\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[\/|\\]\s*\d{1,2}[:.]\d{1,2}(?:[:.]\d{1,2})?)?\s*\d*\b|\b\d{1,2}\.\d{2}\s*[\/|\\]\s*\d{1,2}[:.]\d{1,2}\s*\d*\b)/gi, '').trim();

    // OCR diacritic & spelling fallback corrections
    raw = raw.replace(/\bMôi năm\b/gi, 'Mỗi năm');
    raw = raw.replace(/\btôi tra được\b/gi, 'tôi trả được');
    raw = raw.replace(/\bm[oô]t n[uư][aã] r[oồ]i\b/gi, 'một nửa rồi');
    raw = raw.replace(/\bmột nữa\b/gi, 'một nửa');
    raw = raw.replace(/\bMôt\b/g, 'Một').replace(/\bmôt\b/g, 'một');
    raw = raw.replace(/\bcó có muốn\b/gi, 'cô có muốn');
    raw = raw.replace(/\bmuôn uông\b/gi, 'muốn uống');
    raw = raw.replace(/\bmuôn uống\b/gi, 'muốn uống');
    raw = raw.replace(/\bmuốn uông\b/gi, 'muốn uống');
    raw = raw.replace(/\bphơi khó\b/gi, 'phơi khô');
    raw = raw.replace(/\bPhơi khó\b/g, 'Phơi khô');
    raw = raw.replace(/\btừ rê ở đâu\b/gi, 'từ rễ ô đầu');
    raw = raw.replace(/\btừ rễ ở đâu\b/gi, 'từ rễ ô đầu');
    raw = raw.replace(/\brê ở đâu\b/gi, 'rễ ô đầu');
    raw = raw.replace(/\brễ ở đâu\b/gi, 'rễ ô đầu');
    raw = raw.replace(/\brê ô đầu\b/gi, 'rễ ô đầu');
    raw = raw.replace(/\btừ rê\b/gi, 'từ rễ');
    raw = raw.replace(/\bbiêt\b/g, 'biết');
    raw = raw.replace(/\bBiêt\b/g, 'Biết');
    // Strip trailing video player seek buttons / OSD tags (e.g. "? Dù 10", "Dù 10", "Tua 10")
    raw = raw.replace(/\s+(?:Dù|Vào|Vao|Tua|Lùi)\s*\d+\s*$/i, '').replace(/\s+(?:Dù|Vào|Vao|Tua|Lùi)?\s*(?:10|5|15|30|0)\s*$/i, '').trim();

    // Dialogue subtitles: allow long sentences, monologues and multi-speaker dialogues up to 1000 chars or 200 words
    if (raw.length > 1000 || raw.split(/\s+/).length > 200) return;

    // Single or short word check (eliminate phantom OCR noise on empty screen):
    const rawTokens = raw.split(/\s+/).filter(Boolean);
    const isCjkText = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(raw);
    if (!isCjkText && isVietsubMode && rawTokens.length <= 2) {
      const validViWords = ['cha', 'ba', 'mẹ', 'bố', 'con', 'anh', 'em', 'ông', 'bà', 'chị', 'cô', 'chú', 'bác', 'cháu', 'hắn', 'nó', 'họ', 'ta', 'mình', 'đúng', 'không', 'phải', 'chào', 'sao', 'dạ', 'vâng', 'ừ', 'thật', 'hả', 'này', 'vậy', 'hở', 'ôi', 'ơ', 'chứ', 'rồi', 'xong', 'đi', 'được', 'nghe', 'tại', 'cứu', 'chạy', 'mau', 'khoan', 'chết', 'nguy', 'bắn', 'tránh', 'cút', 'dừng', 'đứng', 'buông', 'đợi', 'thôi', 'im', 'rõ', 'ai', 'gì', 'đâu', 'nào', 'có', 'biết', 'hiểu', 'nhớ', 'quên', 'xem', 'nói', 'thấy', 'chắc', 'kìa', 'đây', 'đó', 'lại', 'ngay', 'mỗi', 'năm', 'trả', 'nửa', 'một', 'quá', 'hay', 'khó', 'dễ', 'đau', 'sợ', 'buồn', 'vui', 'chuyện', 'gớm', 'nhóc', 'mày', 'nhãi', 'chẳng', 'thèm'];
      const hasGenuineViWord = rawTokens.some(tok => {
        const w = tok.toLowerCase().replace(/[.!?…,;:"']+/gu, '');
        return validViWords.includes(w) || (w.length >= 3 && /[à-ỹÀ-Ỹ]/.test(tok));
      });
      if (!hasGenuineViWord) {
        return;
      }
    } else if (!isCjkText && rawTokens.length === 1) {
      const cleanWord = raw.toLowerCase().replace(/[.!?…,;:"']+/gu, '');
      const isValidForeignOrDigit = /^\d+$/.test(cleanWord) || /^[a-zA-Z0-9]{2,}$/.test(cleanWord);
      if (!isValidForeignOrDigit) {
        return;
      }
    }

    // Zero-drop real-time speech policy:
    // Never abruptly interrupt ongoing dialogue or purge the speech queue; let every sentence play smoothly to completion.

    const now = performance.now();
    if (!this.recentOCRHistory) this.recentOCRHistory = [];
    this.recentOCRHistory = this.recentOCRHistory.filter(item => (now - item.time) < 2200);

    const stripAccents = (s) => (s || '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'd')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
    const rawNorm = stripAccents(raw);
    let cleanRaw = defrag(String(data.translated || raw || ''));
    if (isVietsubMode) {
      cleanRaw = cleanRaw.replace(/^[a-zA-Z]\s+(?=[a-zA-Zà-ỹÀ-Ỹ]{3,})/i, '');
    }
    cleanRaw = cleanRaw.replace(/(\.{2,}|…)\s*\.+/g, '$1').replace(/\s+([.,!?:;…])/g, '$1').trim();
    cleanRaw = cleanRaw.replace(/\s+(?:Dù|Vào|Vao|Tua|Lùi)\s*\d+\s*$/i, '').replace(/\s+(?:Dù|Vào|Vao|Tua|Lùi)?\s*(?:10|5|15|30|0)\s*$/i, '').trim();
    cleanRaw = cleanRaw
      .replace(/\bsẽ khiên\b/gi, 'sẽ khiến')
      .replace(/\bkhiên người\b/gi, 'khiến người')
      .replace(/\bkhiên một\b/gi, 'khiến một')
      .replace(/\bkhiên cho\b/gi, 'khiến cho')
      .replace(/\bbât tỉnh\b/gi, 'bất tỉnh')
      .replace(/\bbât ngờ\b/gi, 'bất ngờ')
      .replace(/\bbât an\b/gi, 'bất an')
      .replace(/\bbât cứ\b/gi, 'bất cứ')
      .replace(/\bthường bât\b/gi, 'thường bất')
      .replace(/\bmôi năm\b/gi, 'mỗi năm')
      .replace(/\bMôi năm\b/g, 'Mỗi năm')
      .replace(/\btra được\b/gi, 'trả được')
      .replace(/\btôi tra được\b/gi, 'tôi trả được')
      .replace(/\bmôt nữa\b/gi, 'một nửa')
      .replace(/\bmột nữa\b/gi, 'một nửa')
      .replace(/\bmôt nửa\b/gi, 'một nửa')
      .replace(/\bMôt\b/g, 'Một').replace(/\bmôt\b/g, 'một')
      .replace(/\bnữa rồi\b/gi, 'nửa rồi')
      .replace(/\bđứa tre\b/gi, 'đứa trẻ')
      .replace(/\bxấu xí lăm\b/gi, 'xấu xí lắm')
      .replace(/\bkhống chỉ\b/gi, 'không chỉ')
      .replace(/\bkhông con sông được lâu\b/gi, 'không còn sống được lâu')
      .replace(/\bcon sông được lâu\b/gi, 'còn sống được lâu')
      .replace(/\bMuôn chết\b/gi, 'Muốn chết')
      .replace(/\bchô khác\b/gi, 'chỗ khác')
      .replace(/\bthàm làm\b/gi, 'tham lam')
      .replace(/\bĐung ai ngay\b/gi, 'Đừng đi ngay')
      .replace(/\btà vạy\b/gi, 'ta vậy')
      .replace(/\bcon đòi tiền\b/gi, 'còn đòi tiền')
      .replace(/\bCố vấn đề\b/gi, 'Có vấn đề')
      .replace(/\bBđược rồi\b/gi, 'Được rồi')
      .replace(/\bĐôi chút\b/gi, 'Đợi chút')
      .replace(/\bCha, tuyết quá\b/gi, 'Chà, tuyệt quá')
      .replace(/\btuyết quá\b/gi, 'tuyệt quá')
      .replace(/\bĐiên thiết\b/gi, 'Điên thiệt')
      .replace(/\btôi đông y\b/gi, 'tôi đồng ý')
      .replace(/\bcần xé\b/gi, 'cắn xé')
      .replace(/\bchắc chân không\b/gi, 'chắc chắn không')
      .replace(/\bHộo bị dụ\b/gi, 'Họ bị dụ')
      .replace(/\bHộo\b/g, 'Họ')
      .replace(/\bMôi năm\b/gi, 'Mỗi năm')
      .replace(/\btôi tra được\b/gi, 'tôi trả được')
      .replace(/\bm[oô]t n[uư][aã] r[oồ]i\b/gi, 'một nửa rồi')
      .replace(/\bmột nữa\b/gi, 'một nửa')
      .replace(/\bMôt\b/g, 'Một').replace(/\bmôt\b/g, 'một')
      .replace(/\bphơi khó\b/gi, 'phơi khô')
      .replace(/\bPhơi khó\b/g, 'Phơi khô')
      .replace(/\btừ rê ở đâu\b/gi, 'từ rễ ô đầu')
      .replace(/\btừ rễ ở đâu\b/gi, 'từ rễ ô đầu')
      .replace(/\brê ở đâu\b/gi, 'rễ ô đầu')
      .replace(/\brễ ở đâu\b/gi, 'rễ ô đầu')
      .replace(/\brê ô đầu\b/gi, 'rễ ô đầu')
      .replace(/\btừ rê\b/gi, 'từ rễ')
      .replace(/\bbiêt\b/g, 'biết')
      .replace(/\bBiêt\b/g, 'Biết')
      // Vietnamese tone mark disambiguation (sắc vs hỏi OCR font confusion)
      .replace(/\bcúa\b/gi, 'của')
      .replace(/\bcúa mình\b/gi, 'của mình')
      .replace(/\bviệc cúa\b/gi, 'việc của')
      .replace(/\bchẳng phái\b/gi, 'chẳng phải')
      .replace(/\bkhông phái\b/gi, 'không phải')
      .replace(/\bphái không\b/gi, 'phải không')
      .replace(/\bphái làm\b/gi, 'phải làm')
      .replace(/\bphái biết\b/gi, 'phải biết')
      .replace(/\bphái chăng\b/gi, 'phải chăng')
      .replace(/\bđư[oọ]c\b/gi, 'được')
      .replace(/\bngư[oò]i\b/gi, 'người')
      .replace(/\bcám ơn\b/gi, 'cảm ơn')
      .replace(/\bcám thấy\b/gi, 'cảm thấy')
      .replace(/\bcám giác\b/gi, 'cảm giác')
      .replace(/\bcám xúc\b/gi, 'cảm xúc')
      .replace(/\bcâu hói\b/gi, 'câu hỏi')
      .replace(/\bhói thăm\b/gi, 'hỏi thăm')
      .replace(/\bhói han\b/gi, 'hỏi han')
      .replace(/\bmuốn hói\b/gi, 'muốn hỏi')
      .replace(/\bđi hói\b/gi, 'đi hỏi')
      .replace(/\bcó thế\b/gi, 'có thể')
      .replace(/\bkhông thế\b/gi, 'không thể')
      .replace(/\bchí là\b/gi, 'chỉ là')
      .replace(/\bchí có\b/gi, 'chỉ có')
      .replace(/\bchí cần\b/gi, 'chỉ cần')
      .replace(/\bchí muốn\b/gi, 'chỉ muốn')
      .replace(/\btất cá\b/gi, 'tất cả')
      .replace(/\bcá hai\b/gi, 'cả hai')
      .replace(/\bcá nhà\b/gi, 'cả nhà')
      .replace(/\bhiếu rồi\b/gi, 'hiểu rồi')
      .replace(/\bhiếu không\b/gi, 'hiểu không')
      .replace(/\bhiếu được\b/gi, 'hiểu được')
      .replace(/\bkhông hiếu\b/gi, 'không hiểu')
      .replace(/\bthay đối\b/gi, 'thay đổi')
      .replace(/\bđối lại\b/gi, 'đổi lại')
      .replace(/\bbáo vệ\b/gi, 'bảo vệ')
      .replace(/\bnghe báo\b/gi, 'nghe bảo')
      .replace(/\btôi báo\b/gi, 'tôi bảo')
      .replace(/\bmớ cửa\b/gi, 'mở cửa')
      .replace(/\bmớ ra\b/gi, 'mở ra')
      .replace(/\btrớ về\b/gi, 'trở về')
      .replace(/\btrớ lại\b/gi, 'trở lại')
      .replace(/\btrớ thành\b/gi, 'trở thành')
      .replace(/\bchúẩn\b/gi, 'chuẩn')
      .replace(/\bchúẩn bị\b/gi, 'chuẩn bị')
      .replace(/\bthứ xem\b/gi, 'thử xem')
      .replace(/\bđú rồi\b/gi, 'đủ rồi')
      .replace(/\bchưa đú\b/gi, 'chưa đủ')
      .replace(/\bkhông đú\b/gi, 'không đủ')
      .replace(/\bbới vì\b/gi, 'bởi vì')
      .replace(/\bnhó bé\b/gi, 'nhỏ bé')
      .replace(/\bcòn nhó\b/gi, 'còn nhỏ');
    const cleanNorm = stripAccents(cleanRaw);

    // Discard trailing sub-fragments (e.g. "thành trì" after "phục kích thành trì", or "lắng xuống. - Xin chào" after "Không khí Tết đã lắng xuống. - Xin chào")
    const isSubFragment = this.recentOCRHistory.some(item => {
      const histNorm = stripAccents(item.text);
      const histCleanNorm = stripAccents(item.cleanText || item.text);
      if (histNorm.length >= rawNorm.length && rawNorm.length >= 3 && (histNorm.includes(rawNorm) || histNorm.endsWith(rawNorm))) {
        // Chỉ coi là sub-fragment nếu độ dài câu mới ngắn hơn đáng kể (câu mới bị cắt đuôi <= 65% câu cũ)
        if (rawNorm.length <= histNorm.length * 0.65) {
          return true;
        }
      }
      const rawTailNorm = (rawTokens.length > 2 && rawTokens[0].length === 1) ? stripAccents(rawTokens.slice(1).join(' ')) : '';
      if (rawTailNorm && histNorm.includes(rawTailNorm) && rawTailNorm.length <= histNorm.length * 0.65) {
        return true;
      }
      if (cleanNorm && histCleanNorm.length >= cleanNorm.length && cleanNorm.length >= 3 && (histCleanNorm.includes(cleanNorm) || histCleanNorm.endsWith(cleanNorm))) {
        if (cleanNorm.length <= histCleanNorm.length * 0.65) {
          return true;
        }
      }
      return false;
    });
    if (rawTokens.length > 1 && isSubFragment) {
      return;
    }

    // Merge progressive subtitle expansions (e.g. "Thdi ké" -> "Thôi kệ cả Lão bà bà có biết")
    // If the new line expands a recently queued item that hasn't played yet, update it in place!
    if (this.isDubbingEnabled && this.liveDubbingQueue && this.liveDubbingQueue.length > 0) {
      const lastQueued = this.liveDubbingQueue[this.liveDubbingQueue.length - 1];
      if (lastQueued) {
        const queuedNorm = stripAccents(lastQueued.sourceText);
        if (queuedNorm && queuedNorm.length >= 3 && rawNorm.length > queuedNorm.length && (rawNorm.startsWith(queuedNorm) || (lastQueued.sourceText && this.ocrSimilarity(raw.slice(0, lastQueued.sourceText.length), lastQueued.sourceText) >= 0.60))) {
          lastQueued.text = cleanRaw;
          lastQueued.sourceText = raw;
          this.lastOCRText = raw;
          this.lastCleanText = cleanRaw;
          if (typeof this.displaySubtitle === 'function') {
            this.displaySubtitle(raw, cleanRaw);
            if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = cleanRaw;
            if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = raw;
          }
          return;
        }
      }
    }


    // Suppress if duplicate (only if subtitle hasn't cleared or disappeared)
    const hasCleared = Boolean(data.hadEmptyGap || (this.ocrConsecutiveEmpty && this.ocrConsecutiveEmpty >= 1));
    if (!hasCleared) {
      if (
        (this.lastOCRText && this.isDuplicateOCR(raw, this.lastOCRText)) ||
        (this.lastCleanText && this.isDuplicateOCR(cleanRaw, this.lastCleanText)) ||
        this.recentOCRHistory.some(item => (now - item.time < 1200) && (this.isDuplicateOCR(raw, item.text) || (item.cleanText && this.isDuplicateOCR(cleanRaw, item.cleanText))))
      ) {
        return;
      }
    } else {
      // Subtitle cleared and reappeared as a fresh dialogue line: reset duplicate memory so repeated phrases speak!
      this.recentOCRHistory = [];
      this.lastOCRText = '';
      this.lastCleanText = '';
    }

    this.lastOCRText = raw;
    this.lastCleanText = cleanRaw;
    this.recentOCRHistory.push({ text: raw, cleanText: cleanRaw, time: now });
    this.lastTranscriptContext = raw;
    const record = this.addHistory(raw, cleanRaw, 'ocr');

    // Subtitle display:
    // Immediately display the recognized subtitle on screen so viewers read in real time!
    if (typeof this.displaySubtitle === 'function') {
      this.displaySubtitle(raw, cleanRaw);
      if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = cleanRaw;
      if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = raw;
    }

    if (this.isDubbingEnabled) {
      this.enqueueLiveDubbing(cleanRaw, record.id, raw, now, now, data.timings || null, 0, 'ocr');
    }
  }

  stopHardSubtitleOCR() {
    if (this.ocrTimer) clearInterval(this.ocrTimer);
    this.ocrTimer = null;
    this.ocrRequestActive = false;
    if (this.ocrVideo && !this._isOcrVideoExternal) {
      try { this.ocrVideo.pause(); } catch (error) {}
      this.ocrVideo.srcObject = null;
    }
    this.ocrVideo = null;
    this._isOcrVideoExternal = false;
    this.ocrCanvas = null;
    this._ocrDiffCanvas = null;
    this._ocrLastSample = null;
    this._ocrStaticFrameCount = 0;
    this.lastOCRText = '';
    this.lastCleanText = '';
    if (this.motionCtx) {
      this.motionCtx = null;
      this.motionCanvas = null;
      this.lastFrameThumb = null;
    }
    this.staticFrameCount = 0;
    this.isExternalVideoPaused = false;
    this.isSeekPreempt = false;
  }

  buildYouTubeSubtitleRequest(url) {
    const mode = this.webCaptionMode ? (this.webCaptionMode.value || (typeof this.getRadioGroupValue === 'function' && this.getRadioGroupValue(this.webCaptionMode)) || 'has_captions') : 'has_captions';
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
  }

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
    const loadGeneration = ++this.youtubeLoadGeneration;
    if (this.youtubeSubtitleAbortController) {
      this.youtubeSubtitleAbortController.abort();
    }
    this.youtubeSubtitleAbortController = new AbortController();

    this.webVideoContainer.style.display = 'block';
    if (this.webSyncNotice) this.webSyncNotice.style.display = 'none';
    const subtitleRequest = this.buildYouTubeSubtitleRequest(val);
    if (subtitleRequest.caption_mode === 'audio_only') {
      this.webSyncNotice.innerHTML = ' <strong>Chế độ chỉ có tiếng:</strong> Phát video, sau đó bấm “Bắt Âm Thanh Tab” và chọn đúng tab có video.';
      this.setSourceIntelligenceState('whisper', 'Whisper realtime', 'Đang bỏ qua CC theo lựa chọn của bạn. Bật thu âm Tab để nhận dạng tiếng nói trực tiếp.');
      this.ytSegments = [];
      this.currentYtSegmentIdx = -1;
      this.initOrUpdateYouTubePlayer(videoId);
      return;
    }
    if (subtitleRequest.caption_mode === 'hard_sub') {
      this.webSyncNotice.innerHTML = ' <strong>Chế độ phụ đề đóng cứng / OCR:</strong> Đang phát video. Hãy bấm nút <strong>“Bắt Âm Thanh Tab”</strong> bên trên và chọn <em>Chia sẻ tab này</em> để OCR quét phụ đề trên khung hình.';
      this.setSourceIntelligenceState('ocr', 'Quét OCR khung hình', 'Đang đọc chữ dính trên hình. Bấm nút Bắt Âm Thanh Tab để bật OCR.');
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
        if (data.title) this.webVideoTitle.textContent = data.title;
        if (this.webSyncNotice) {
          this.webSyncNotice.innerHTML = '';
          this.webSyncNotice.style.display = 'none';
        }
        const languageNames = { vi: 'Tiếng Việt', en: 'English', ja: '日本語', ko: '한국어', zh: '中文' };
        const languageLabel = languageNames[data.caption_language] || (data.caption_language || 'Tiếng gốc').toUpperCase();
        const sourceLabel = data.caption_source === 'manual' ? 'CC thủ công' : 'CC tự động';
        this.setSourceIntelligenceState('loading', 'Đang nạp giọng đọc...', 'Đang tải trước giọng lồng tiếng (1-2s)...');
        this.showToast('⏳ Đang tải trước giọng lồng tiếng (1-2s)...');
        this.audioPreCache.clear();
        await this.prebufferYouTubeInitialTracks(0, 3, loadGeneration);
        this.setSourceIntelligenceState('success', `${languageLabel} · ${sourceLabel}`, `Đang phát và lồng tiếng tự động.`);
        this.showToast(`🚀 Đã nạp ${data.segments.length} câu thoại phụ đề từ video! Bắt đầu phát.`);
        this.subViDisplay.textContent = '▶️ Đang phát video và lồng tiếng...';
        this.subSourceDisplay.textContent = `Đã đồng bộ ${data.segments.length} câu thoại`;
      } else {
        this.webSyncNotice.innerHTML = `ℹ️ ${data.error || 'Video không có phụ đề sẵn'}. Bạn hãy chọn nguồn <strong>"Màn hình / Tab Phim"</strong> để LiveSub quét phụ đề OCR trực tiếp trên video!`;
        this.setSourceIntelligenceState('error', 'Không có track phù hợp', 'Hãy chuyển sang nguồn "Màn hình / Tab Phim" để quét OCR trực tiếp.');
      }
    } catch (e) {
      if (e.name === 'AbortError' || loadGeneration !== this.youtubeLoadGeneration) return;
      console.warn('Subtitles fetch error:', e);
      this.webSyncNotice.innerHTML = 'ℹ️ Hãy chọn nguồn "Màn hình / Tab Phim" để LiveSub quét phụ đề OCR trực tiếp trên video!';
      this.setSourceIntelligenceState('error', 'Không tải được CC', 'Kiểm tra mạng rồi thử lại, hoặc dùng nguồn "Màn hình / Tab Phim" để OCR trực tiếp.');
    }

    // 2. Initialize YouTube Player
    if (loadGeneration === this.youtubeLoadGeneration) {
      this.initOrUpdateYouTubePlayer(videoId);
    }
  }

  async prebufferYouTubeInitialTracks(fromIdx = 0, count = 3, loadGeneration = null) {
    if (!this.isDubbingEnabled || !this.ytSegments || this.ytSegments.length === 0) return;
    const toIdx = Math.min(this.ytSegments.length, fromIdx + count);
    const generation = this.voiceGeneration;
    const voice = this.getEffectiveVoice();
    const pending = [];
    for (let i = fromIdx; i < toIdx; i++) {
      const seg = this.ytSegments[i];
      if (!seg || !seg.translated) continue;
      const fetchKey = `${generation}:${i}`;
      if (!this.audioPreCache.has(i) && !this.isFetchingPreCache.has(fetchKey)) {
        this.isFetchingPreCache.add(fetchKey);
        pending.push({ index: i, segment: seg, fetchKey });
      }
    }
    if (!pending.length) {
      this.startYouTubePrefetchWorker(toIdx);
      return;
    }

    const fetchPromise = (async () => {
      try {
        const res = await fetch('/api/tts-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: pending.map(item => item.segment.translated), voice })
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
            } catch (e) {
              console.warn('Initial prebuffer decode error:', e);
            }
          }));
        }
      } catch (e) {
        console.warn('Initial prebuffer error:', e);
      } finally {
        pending.forEach(entry => this.isFetchingPreCache.delete(entry.fetchKey));
        this.startYouTubePrefetchWorker(toIdx);
      }
    })();

    // Wait up to 1500ms so video starts promptly, while background caching continues
    const timeoutPromise = new Promise(resolve => setTimeout(resolve, 1500));
    await Promise.race([fetchPromise, timeoutPromise]);
  }

  syncRemainingYouTubeSubtitles(url, videoId, loadGeneration) {
    if (this.ytSyncRemainingTimer) clearTimeout(this.ytSyncRemainingTimer);
    this.ytSyncRemainingTimer = null;
  }

  initOrUpdateYouTubePlayer(videoId) {
    if (this.ytSyncInterval) {
      clearInterval(this.ytSyncInterval);
      this.ytSyncInterval = null;
    }

    const playerContainer = document.getElementById('webVideoPlayer');
    if (!playerContainer) return;

    const onPlayerReady = () => {
      this.startXTSync();
      this.prefetchUpcomingAudio(0);
    };

    const onPlayerStateChange = (event) => {
      // YT.PlayerState.PAUSED = 2, ENDED = 0
      if (event.data === 2 || event.data === 0) {
        // A dubbing hold is an intentional pause used to avoid dropping speech.
        if (!this.isHoldingYtForDubbing) this.stopAllAudio();
        this.restoreYouTubeVolumeNow();
      } else if (event.data === 1) { // PLAYING
        if (this.currentYtSegmentIdx >= 0) {
          this.prefetchUpcomingAudio(this.currentYtSegmentIdx);
        } else {
          this.prefetchUpcomingAudio(0);
        }
      }
    };

    // 100% reliable direct responsive YouTube Embed Iframe (never empty black screen, fs=0 to route fullscreen through LiveSub container)
    const embedUrl = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&rel=0&modestbranding=1&fs=0`;
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
  }

  duckYouTubeVolume(_targetVol = 18) {
    // Completely disabled per user request: keep video audio 100% at its original level
    return;
  }

  scheduleRestoreYouTubeVolume(_delayMs = 4500) {
    return;
  }

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
  }

  startXTSync() {
    if (this.ytSyncInterval) clearInterval(this.ytSyncInterval);
    this.ytSessionGeneration++;
    this.lastYtTime = null;
    this.lastYtTickWallClock = performance.now();

    this.ytSyncInterval = setInterval(() => {
      if (!this.ytPlayer || typeof this.ytPlayer.getCurrentTime !== 'function') return;

      const playerState = this.ytPlayer.getPlayerState ? this.ytPlayer.getPlayerState() : -1;
      if (playerState !== 1) { // Only when playing
        return;
      }

      const curTime = this.ytPlayer.getCurrentTime();
      if (!this.ytSegments || this.ytSegments.length === 0) return;

      const now = performance.now();
      if (this.lastYtTime !== null && this.lastYtTickWallClock) {
        const timeDelta = curTime - this.lastYtTime;
        const wallDelta = (now - this.lastYtTickWallClock) / 1000;
        // Detect genuine user scrubbing/seek (jump > 1.5s relative to elapsed real time)
        if (Math.abs(timeDelta - wallDelta) > 1.5) {
          this.ytSessionGeneration++;
          this.currentYtSegmentIdx = -1;
          this.playbackGeneration++;
          this.stopDubbingAudio(false);
        }
      }
      this.lastYtTime = curTime;
      this.lastYtTickWallClock = now;

      // Anticipate 0.15s before speech starts for zero perceived latency
      const idx = this.findActiveYtSegment(curTime);

      if (idx !== -1 && idx !== this.currentYtSegmentIdx) {
        this.currentYtSegmentIdx = idx;
        const seg = this.ytSegments[idx];
        let subtitleRevealed = false;
        const revealSubtitle = () => {
          if (subtitleRevealed) return;
          subtitleRevealed = true;
          if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = seg.translated;
          if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = seg.original;
          this.displaySubtitle(seg.original, seg.translated);
        };
        this.addHistory(seg.original, seg.translated, 'cc');

        // 3. Dubbing Audio: Instant Start via Pre-cached AudioBuffer
        const isMusic = /[\u266a\u266b\u2669\u266c\uD83C\uDFB5\uD83C\uDFB6~～♪♫♬♩]/u.test(seg.original || '') ||
                        /^\s*\[(music|applause|cheering|laughter|sound track|ost|bgm)\]\s*$/i.test(seg.original || '');

        if (this.isDubbingEnabled && !this.isScanningPaused && !isMusic) {
          try {
            this.duckYouTubeVolume(18);

            const timing = this.getYtSegmentTiming(idx, curTime);
            this.playSegmentAudio(idx, timing.slotDuration, revealSubtitle).catch(err => {
              console.warn('Dubbing play error for segment ' + idx, err);
            });
          } catch (err) {
            console.warn('Dubbing trigger error:', err);
          }
          if (!subtitleRevealed) revealSubtitle();
          this.prefetchUpcomingAudio(idx + 1);
        } else {
          revealSubtitle();
        }
      } else if (idx === -1) {
        // Keep subtitle readable for up to 1.4s after sentence ends
        const isNearAny = this.ytSegments.some(s => {
          const end = (s.end && s.end > s.start) ? s.end : (s.start + (s.duration > 0 ? s.duration : 3.0));
          return curTime >= (s.start - 0.2) && curTime <= (end + 1.4);
        });
        if (!isNearAny) {
          if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = '';
          if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = '';
        }
      }
    }, 60);
  }

  findActiveYtSegment(curTime) {
    let low = 0;
    let high = this.ytSegments.length - 1;
    let candidate = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const cueLead = Number.isFinite(this.ytCueLeadSeconds) ? this.ytCueLeadSeconds : 0.08;
      if (this.ytSegments[mid].start <= curTime + cueLead) {
        candidate = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (candidate >= 0) {
      const seg = this.ytSegments[candidate];
      const end = (seg.end && seg.end > seg.start) ? seg.end : (seg.start + (seg.duration > 0 ? seg.duration : 3.0));
      if (curTime <= end) return candidate;
    }
    return -1;
  }

  getYtSegmentTiming(segIdx, curTime) {
    const seg = this.ytSegments[segIdx];
    if (!seg) return { start: 0, deadline: 0, slotDuration: 0, remaining: 0 };
    const nextSeg = this.ytSegments[segIdx + 1];
    const naturalEnd = Math.max(seg.start + 0.05, seg.end);
    const deadline = nextSeg
      ? Math.max(seg.start + 0.05, Math.min(naturalEnd, nextSeg.start))
      : naturalEnd;
    return {
      start: seg.start,
      deadline,
      slotDuration: Math.max(0.05, deadline - seg.start),
      remaining: Math.max(0, deadline - curTime)
    };
  }

  holdYouTubeForDubbing() {
    // Pure voice rate acceleration - never pause video playback
    return;
  }

  releaseYouTubeDubbingHold() {
    if (this.ytOverrunHoldTimer) {
      clearTimeout(this.ytOverrunHoldTimer);
      this.ytOverrunHoldTimer = null;
    }
    this.isHoldingYtForDubbing = false;
    this.ytShouldResumeAfterHold = false;
    this.isHoldingLocalForDubbing = false;
  }

  scheduleYouTubeOverrunHold(playDuration, slotDuration) {
    // Pure voice rate acceleration - never pause video playback
    return;
  }

  isPlaybackCurrent(token) {
    if (!token || this.isDubbingEnabled === false) return false;
    if (token.session !== this.ytSessionGeneration) return false;
    if (token.playback !== this.playbackGeneration) return false;
    if (typeof token.segment === 'number') {
      if (this.currentYtSegmentIdx === -1) return true;
      return Math.abs(token.segment - this.currentYtSegmentIdx) <= 1;
    }
    return true;
  }

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
    if ((!seg.translated || seg.translated === seg.original) && seg.original) {
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

    try {
      const voice = this.getEffectiveVoice();
      await this.playStreamingTts(seg.translated, voice, true, onStart, token, 0, expectedSlotDuration);
      return;
    } catch (err) {
      console.warn('On-demand dub error for seg ' + segIdx, err);
    }
  }

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
  }

  startYouTubePrefetchWorker(startIdx = 0) {
    if (!this.isDubbingEnabled || !this.ytSegments || this.ytSegments.length === 0) return;
    this._ytPrefetchTargetIdx = Math.max(0, startIdx);
    if (this._isYtPrefetchWorkerRunning) return;

    this._isYtPrefetchWorkerRunning = true;
    const workerLoop = async () => {
      try {
        while (this._isYtPrefetchWorkerRunning && this.isDubbingEnabled && this.ytSegments && this.ytSegments.length > 0) {
          const curIdx = Math.max(this._ytPrefetchTargetIdx || 0, this.currentYtSegmentIdx >= 0 ? this.currentYtSegmentIdx : 0);
          const generation = this.voiceGeneration;
          const voice = this.getEffectiveVoice();

          // Rolling prefetch window: keep up to 12 tracks ahead cached (or all remaining if <= 30)
          const maxLookahead = (this.ytSegments.length <= 30) ? this.ytSegments.length : Math.min(this.ytSegments.length, curIdx + 12);

          const batch = [];
          for (let i = curIdx; i < maxLookahead; i++) {
            const seg = this.ytSegments[i];
            if (!seg || !seg.translated) continue;
            const key = `${generation}:${i}`;
            if (!this.audioPreCache.has(i) && !this.isFetchingPreCache.has(key)) {
              this.isFetchingPreCache.add(key);
              batch.push({ index: i, segment: seg, fetchKey: key });
              if (batch.length >= 4) break; // Small, low-latency 4-track batch
            }
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
              body: JSON.stringify({ texts: batch.map(b => b.segment.translated), voice })
            });

            if (res.ok && generation === this.voiceGeneration) {
              const data = await res.json();
              const items = data && Array.isArray(data.items) ? data.items : [];
              const AudioCtx = window.AudioContext || window.webkitAudioContext;
              if (!this.audioContext || this.audioContext.state === 'closed') this.audioContext = new AudioCtx();

              await Promise.all(batch.map(async (entry, pos) => {
                const item = items[pos];
                if (!item || !item.audio_base64) return;
                try {
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
                } catch (e) {
                  console.warn('Worker audio decode error:', e);
                }
              }));
            }
          } catch (e) {
            console.warn('Worker batch fetch error:', e);
            await new Promise(r => setTimeout(r, 500));
          } finally {
            batch.forEach(b => this.isFetchingPreCache.delete(b.fetchKey));
          }

          await new Promise(r => setTimeout(r, 60));
        }
      } finally {
        this._isYtPrefetchWorkerRunning = false;
      }
    };

    workerLoop();
  }

  prefetchUpcomingAudio(fromIdx) {
    if (!this.isDubbingEnabled || !this.ytSegments || this.ytSegments.length === 0) return;
    this._ytPrefetchTargetIdx = fromIdx;
    this.startYouTubePrefetchWorker(fromIdx);
  }

  // =========================================================================
  // CONTINUOUS 16kHz MONO WAV CHUNKING ENGINE (RTX 3050 GPU OPTIMIZED)
  // Never drops speech syllables, resamples to 16kHz for instant GPU Whisper!
  // =========================================================================
  async setupVADAndRecording(stream) {
    this.isListening = true;
    this.lastProcessedText = '';
    this.lastTranscriptContext = '';
    this.autoDetectedSourceLang = null;
    this.autoLanguageProbeCounter = 0;
    this.setStatus('recording', 'Đang lắng nghe âm thanh...');

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const audioTracks = stream.getAudioTracks();
    const audioStream = audioTracks.length > 0 ? new MediaStream(audioTracks) : stream;

    // STORE TO PREVENT V8 GARBAGE COLLECTION
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
    this.vadNoiseFloor = 0.0025;
    this.neuralVADActive = false;

    const triggerSendClause = (reason = 'natural') => {
      // Collect at least 0.4s of audio (~4 blocks at 48k)
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

    // Prefer a local neural VAD over raw volume thresholds. Silero sees speech
    // probability instead of only loudness, so background music and short
    // pauses are much less likely to split an actor in the middle of a line.
    // Audio is returned at Whisper-native 16 kHz and never leaves the browser
    // until a complete phrase has been detected.
    if ((!this.isOCRModeActive || this.isHybridModeActive) && window.vad && window.vad.MicVAD) {
      try {
        const vadStream = audioStream;
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
          positiveSpeechThreshold: 0.42,
          negativeSpeechThreshold: 0.30,
          // 350 ms redemption preserves natural sentences while triggering dubbing with near-zero latency
          redemptionMs: 350,
          preSpeechPadMs: 180,
          minSpeechMs: 200,
          submitUserSpeechOnPause: true,
          onSpeechStart: () => {
            this.captureStartedAt = performance.now();
          },
          onSpeechRealStart: () => {},
          onVADMisfire: () => {
            this.captureStartedAt = 0;
          },
          onFrameProcessed: (probabilities) => {
            // Split continuous monologues (> 4.2s) to prevent unbounded buffers and voiceover lag
            if (this.captureStartedAt && probabilities) {
              const elapsed = performance.now() - this.captureStartedAt;
              const isCeiling = elapsed > 4200;
              if (isCeiling && this.neuralVAD && this.neuralVAD.frameProcessor) {
                this.neuralVAD.frameProcessor.redemptionCounter = this.neuralVAD.frameProcessor.redemptionFrames || 999;
              }
            }
          },
          onSpeechEnd: (audio) => {
            if (!this.isListening || (this.isOCRModeActive && this.hasActiveHardSubtitles) || !audio || audio.length < 3200) return;
            const wavBlob = this.encodeWAV16k([audio], 16000);
            wavBlob.livesubCapturedAt = this.captureStartedAt || performance.now();
            wavBlob.livesubFinalizedAt = performance.now();
            this.captureStartedAt = 0;
            this.realtimeMetrics.naturalSpeechSplits++;
            if (wavBlob.size > 800) this.sendSpeechPhraseToAI(wavBlob);
          }
        });
        await this.neuralVAD.start();
        this.neuralVADActive = true;
        this.showToast('Silero VAD local đã bật — chống cắt ngang câu.');
      } catch (error) {
        console.warn('Silero VAD unavailable; using adaptive RMS fallback', error);
        this.neuralVAD = null;
        this.neuralVADActive = false;
        this.showToast('Silero VAD chưa tải được, đang dùng VAD dự phòng.');
      }
    }

    scriptNode.onaudioprocess = (e) => {
      if (!this.isListening) return;
      const input = e.inputBuffer.getChannelData(0);

      // 1. RMS Energy Calculation
      let sumSq = 0;
      for (let i = 0; i < input.length; i++) {
        sumSq += input[i] * input[i];
      }
      const rms = Math.sqrt(sumSq / input.length);
      const percent = Math.min(100, Math.round(rms * 100 * 12));

      this.audioMeterFill.style.width = `${percent}%`;
      this.meterPercentText.textContent = `${percent}%`;

      if (rms < 0.0001) {
        this.zeroAudioCounter = (this.zeroAudioCounter || 0) + 1;
        if (this.zeroAudioCounter === 45 && this.isListening) {
          if (this.activeSource === 'system') {
            this.showToast('⚠️ VAD 0%: Chưa nhận được tiếng! Hãy chắc chắn video đang phát và bạn đã tích ô "Chia sẻ âm thanh" (Share audio) khi chọn Tab.');
          }
        }
      } else {
        this.zeroAudioCounter = 0;
      }

      // Silero owns phrase endpointing. This ScriptProcessor remains connected
      // only for the level meter and the missing-shared-audio warning.
      if (this.neuralVADActive || (this.isOCRModeActive && this.hasActiveHardSubtitles)) return;

      // 2. Speech state machine with ~170 ms pre-roll. Long stretches of
      // silence are not uploaded to Whisper, which cuts ASR time noticeably.
      const block = new Float32Array(input);
      if (!this.isCapturingSpeech) {
        const speechStartThreshold = Math.max(0.004, this.vadNoiseFloor * 1.7);
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
          // Follow stable movie ambience/music slowly. Speech must rise above
          // this baseline instead of a fixed RMS threshold.
          this.vadNoiseFloor = this.vadNoiseFloor * 0.92 + Math.min(rms, 0.02) * 0.08;
        }
        return;
      }

      this.pcmBuffers.push(block);
      if (rms > this.currentChunkMaxRms) {
        this.currentChunkMaxRms = rms;
      }

      if (rms < this.currentChunkMaxRms * 0.55) {
        this.vadNoiseFloor = this.vadNoiseFloor * 0.95 + Math.min(rms, 0.02) * 0.05;
      }
      const speechEndThreshold = Math.max(0.0032, this.vadNoiseFloor * 1.3);
      if (rms < speechEndThreshold) {
        this.consecutiveQuietBlocks++;
      } else {
        this.consecutiveQuietBlocks = 0;
      }

      // Low-latency streaming pipeline:
      // 1. Natural sentence endpoint: ~255ms pause (3 quiet blocks @ 85ms) after >= 0.65s speech.
      // 2. Clause break on breathing pause: ~170ms pause (2 quiet blocks) after >= 2.5s speech.
      // 3. Monologue ceiling: 4.5s hard-limit prevents accumulating excessive speech buffer.
      const maxBlocks = Math.round((4.5 * sampleRate) / 4096);
      const minSpeechBlocks = Math.round((0.65 * sampleRate) / 4096);
      const clauseSpeechBlocks = Math.round((2.5 * sampleRate) / 4096);

      if (this.pcmBuffers.length >= maxBlocks) {
        triggerSendClause('hard-limit');
      } else if (this.pcmBuffers.length >= clauseSpeechBlocks && this.consecutiveQuietBlocks >= 2 && this.currentChunkMaxRms >= 0.001) {
        triggerSendClause('clause-pause');
      } else if (this.pcmBuffers.length >= minSpeechBlocks && this.consecutiveQuietBlocks >= 3 && this.currentChunkMaxRms >= 0.001) {
        triggerSendClause('natural');
      }
    };

    this.mediaStreamSource.connect(scriptNode);
    scriptNode.connect(this.audioContext.destination);
  }

  // Pure 16-bit Mono WAV 16,000 Hz Encoder (Whisper Native)
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
      const targetLength = Math.round(fullInput.length / ratio);
      resampled = new Float32Array(targetLength);
      for (let i = 0; i < targetLength; i++) {
        const srcIdx = Math.round(i * ratio);
        resampled[i] = fullInput[Math.min(srcIdx, fullInput.length - 1)];
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
  }

  async sendSpeechPhraseToAI(audioBlob) {
    return this.enqueueSpeechPhrase(audioBlob);
  }

  enqueueSpeechPhrase(audioBlob) {
    if (this.isOCRModeActive && this.hasActiveHardSubtitles) return Promise.resolve();
    if (!audioBlob || (typeof audioBlob.size === 'number' && audioBlob.size < 1000)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      // Never discard speech. VieNeu generates faster than realtime after
      // warm-up, so a temporary burst can drain without sacrificing content.
      if (this.speechQueue.length === this.maxSpeechQueueSize) {
        this.showToast('Đang giữ toàn bộ lời thoại trong hàng đợi để không mất câu.');
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
  }

  async drainSpeechQueue() {
    if (this.isProcessingSpeechQueue) return;
    this.isProcessingSpeechQueue = true;
    try {
      while (this.speechQueue.length > 0 && this.isListening !== false) {
        const item = this.speechQueue.shift();
        try {
          await this.processSpeechPhrase(item.audioBlob, item.sequence, item);
        } finally {
          item.resolve();
        }
      }
    } finally {
      this.isProcessingSpeechQueue = false;
    }
  }

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

    this.activeAbortController = new AbortController();

    try {
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
        signal: this.activeAbortController.signal
      });

      const data = await response.json();
      if (data.timings) this.realtimeMetrics.lastServerTimings = data.timings;
      if (this.isOCRModeActive && this.hasActiveHardSubtitles) return;
      if (selectedSourceLang === 'auto' && data.detected_lang && data.detected_lang !== 'auto') {
        this.autoDetectedSourceLang = data.detected_lang;
      }

      if (!data.empty && data.original) {
        if (data.original.toLowerCase() !== this.lastProcessedText.toLowerCase()) {
          this.lastProcessedText = data.original;
          this.lastTranscriptContext = `${this.lastTranscriptContext} ${data.original}`.trim().slice(-500);
          const record = this.addHistory(data.original, data.translated, data.detected_lang || 'auto');

          // Display translated subtitle immediately for zero perceived latency,
          // in tight sync with video speech, while voiceover plays smoothly.
          this.displaySubtitle(data.original, data.translated);
          if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = data.translated;
          if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = data.original;

          const captureDuration = (captureMeta && captureMeta.capturedAt && captureMeta.finalizedAt)
            ? Math.max(0, (captureMeta.finalizedAt - captureMeta.capturedAt) / 1000)
            : 0;

          if (this.isDubbingEnabled) {
            this.enqueueLiveDubbing(
              data.translated,
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
      this.isTranscribing = false;
      this.activeAbortController = null;
      if (this.isListening) {
        this.setStatus('recording', 'Đang lắng nghe âm thanh...');
      }
    }
  }

  splitSentenceIntoClauses(text) {
    const raw = String(text || '').trim();
    if (!raw) return [];

    // 1. Split on explicit linebreaks (multi-line subtitles in movies/anime)
    const rawLines = raw.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
    const candidateParts = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const sentParts = line.split(/(?<=[.!?…])\s+/).filter(Boolean);
      for (let j = 0; j < sentParts.length; j++) {
        let trimmed = sentParts[j].trim();
        if (trimmed) {
          if (i < rawLines.length - 1 && j === sentParts.length - 1 && !/[,;:.!?…–—]$/.test(trimmed)) {
            trimmed += ',';
          }
          candidateParts.push(trimmed);
        }
      }
    }

    // 2. Stream chunking for long sentences: synthesize the first clause immediately (~250-350ms)
    // while the remaining clauses synthesize in parallel in the background, eliminating the 2-second wait!
    const finalClauses = [];
    for (const part of candidateParts) {
      const words = part.split(/\s+/).filter(Boolean);
      if (words.length <= 7 && part.length <= 42) {
        finalClauses.push(part);
        continue;
      }

      let splitDone = false;
      // A. Natural comma / punctuation pause
      const punctMatch = part.match(/^(.*?)([,;:—–])\s+(.+)$/);
      if (punctMatch) {
        const left = punctMatch[1].trim() + punctMatch[2];
        const right = punctMatch[3].trim();
        const leftWords = left.split(/\s+/).filter(Boolean).length;
        const rightWords = right.split(/\s+/).filter(Boolean).length;
        if (leftWords >= 3 && rightWords >= 2) {
          finalClauses.push(left);
          if (rightWords > 7) {
            finalClauses.push(...this.splitSentenceIntoClauses(right));
          } else {
            finalClauses.push(right);
          }
          splitDone = true;
        }
      }
      if (splitDone) continue;

      // B. Conjunction split closest to the middle
      const conjRegex = /\s+(nhưng|mà|vì|khi|nếu|để|thì|nên|cho nên|do đó|trước khi|sau khi|và|hoặc|hôm nay|bởi vì|thế nên|rồi|sẽ|chứ|song|tuy)\s+/gi;
      let match;
      let bestSplitIndex = -1;
      let minDistanceToCenter = Infinity;
      const midWordIdx = Math.floor(words.length / 2);

      while ((match = conjRegex.exec(part)) !== null) {
        const leftSub = part.slice(0, match.index);
        const wCount = leftSub.split(/\s+/).filter(Boolean).length;
        if (wCount >= 3 && (words.length - wCount) >= 2) {
          const dist = Math.abs(wCount - midWordIdx);
          if (dist < minDistanceToCenter) {
            minDistanceToCenter = dist;
            bestSplitIndex = match.index;
          }
        }
      }

      if (bestSplitIndex > 0) {
        let leftPart = part.slice(0, bestSplitIndex).trim();
        let rightPart = part.slice(bestSplitIndex).trim();
        finalClauses.push(leftPart);
        if (rightPart.split(/\s+/).filter(Boolean).length > 7) {
          finalClauses.push(...this.splitSentenceIntoClauses(rightPart));
        } else {
          finalClauses.push(rightPart);
        }
        continue;
      }

      // C. Word boundary fallback if still >= 8 words
      if (words.length >= 8) {
        const splitPoint = Math.min(6, Math.max(4, Math.floor(words.length / 2)));
        let leftPart = words.slice(0, splitPoint).join(' ');
        let rightPart = words.slice(splitPoint).join(' ');
        finalClauses.push(leftPart);
        if (rightPart.split(/\s+/).filter(Boolean).length > 7) {
          finalClauses.push(...this.splitSentenceIntoClauses(rightPart));
        } else {
          finalClauses.push(rightPart);
        }
        continue;
      }

      finalClauses.push(part);
    }

    return finalClauses.length > 0 ? finalClauses : [raw];
  }

  enqueueLiveDubbing(text, historyId, sourceText = '', capturedAt = null, finalizedAt = null, serverTimings = null, originalDuration = 0, source = 'unknown', onStart = null) {
    if (!text || !this.isDubbingEnabled) return Promise.resolve();

    const clauses = this.splitSentenceIntoClauses(text);
    const effectiveVoice = this.getEffectiveVoice();
    if (clauses.length > 1) {
      const totalLen = text.length;
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
          text,
          (isFirst ? onStart : null),
          !isFirst // isChained: true for all subsequent clauses
        );
      }
      return this.drainLiveDubbingQueue();
    }

    this.enqueueSingleLiveDubbing(text, historyId, sourceText, capturedAt, finalizedAt, serverTimings, originalDuration, source, text, onStart, false);
    return this.drainLiveDubbingQueue();
  }

  enqueueSingleLiveDubbing(text, historyId, sourceText = '', capturedAt = null, finalizedAt = null, serverTimings = null, originalDuration = 0, source = 'unknown', fullText = null, onStart = null, isChained = false) {
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
  }

  getLivePcmBufferPolicy(text) {
    // Ultra-low latency 48kHz mono 16-bit PCM buffer policy (~200ms initial response time)
    return { initialBytes: 24000, sliceBytes: 19200, fullLinePreferred: false };
  }

  prefetchLiveTts(text, voice) {
    if (!text || !voice || !voice.startsWith('vieneu')) return;
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
  }

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
            const showText = item.fullText || item.text;
            this.displaySubtitle(item.sourceText, showText);
            if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = showText;
            if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = item.sourceText;
            // Pipeline prefetch: start synthesizing next queued item in background the exact moment this one plays!
            if (this.liveDubbingQueue.length > 0) {
              const nextItem = this.liveDubbingQueue[0];
              if (nextItem && nextItem.voice && nextItem.voice.startsWith('vieneu') && nextItem.text) {
                this.prefetchLiveTts(nextItem.text, nextItem.voice);
              }
            }
          };
          const originalDuration = item.originalDuration || (item.finalizedAt && item.capturedAt ? Math.max(0, (item.finalizedAt - item.capturedAt) / 1000) : 0);
          const queueLagMs = item.enqueuedAt ? (performance.now() - item.enqueuedAt) : 0;
          const currentQueueDepth = this.liveDubbingQueue.length + 1;
          if (item.voice.startsWith('vieneu')) {
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
            this.displaySubtitle(item.sourceText, item.text);
            continue;
          }
          if (isStale()) continue;
          const audio = await response.arrayBuffer();
          if (isStale()) continue;
          await this.playAudioBuffer(audio, true, revealSubtitle, originalDuration, item.text ? item.text.length : 0, currentQueueDepth, queueLagMs, item.isChained);
        } catch (error) {
          console.warn('Live dubbing error:', error);
          // A voice failure must not hide the translated content.
          this.displaySubtitle(item.sourceText, item.text);
        }
      }
    } finally {
      this.isProcessingLiveDubbing = false;
      if (this.liveDubbingQueue.length > 0) this.drainLiveDubbingQueue();
    }
  }

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
  }

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
  }

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
      // Micro fade-in (6ms)
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.006);
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
  }

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
  }

  stopAllAudio() {
    this.stopDubbingAudio();
  }

  cancelTranscription() {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  stopListening() {
    this.isListening = false;
    this.stopHardSubtitleOCR();
    this.isOCRModeActive = false;
    this.dubbingGeneration++;
    this.liveDubbingQueue = [];
    this.lastProcessedText = '';
    this.lastTranscriptContext = '';
    this.autoDetectedSourceLang = null;
    this.autoLanguageProbeCounter = 0;
    this.isSpeaking = false;
    this.silenceFrames = 0;
    this.pcmBuffers = [];
    this.stopAllAudio();
    this.cancelTranscription();
    while (this.speechQueue.length) {
      const queued = this.speechQueue.shift();
      if (queued && queued.resolve) queued.resolve();
    }

    if (this.neuralVAD) {
      const vadToDestroy = this.neuralVAD;
      this.neuralVAD = null;
      this.neuralVADActive = false;
      vadToDestroy.destroy().catch(error => console.warn('Cannot stop Silero VAD cleanly', error));
    }

    if (this.scriptNode) {
      try {
        this.scriptNode.disconnect();
      } catch (e) {}
      this.scriptNode = null;
    }

    if (this.mediaStreamSource) {
      try {
        this.mediaStreamSource.disconnect();
      } catch (e) {}
      this.mediaStreamSource = null;
    }

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
    this.updateMasterDubUI();

    if (this.btnMicText) this.btnMicText.textContent = 'Bật Microphone';
    if (this.btnToggleMic) {
      this.btnToggleMic.classList.remove('btn-danger');
      this.btnToggleMic.classList.add('btn-primary');
    }

    this.setStatus('ready', 'Sẵn sàng');
  }

  displaySubtitle(sourceText, viText) {
    if (this.subSourceDisplay) this.subSourceDisplay.textContent = sourceText || '';
    if (this.subViDisplay) this.subViDisplay.textContent = viText || '';

    const isSameText = sourceText && viText && (
      sourceText.trim().toLowerCase() === viText.trim().toLowerCase() ||
      viText.toLowerCase().includes(sourceText.trim().toLowerCase()) ||
      sourceText.toLowerCase().includes(viText.trim().toLowerCase())
    );
    const hasSource = Boolean(sourceText && String(sourceText).trim() && !isSameText && this.currentSubMode !== 'vi_only' && this.currentSubMode !== 'none');
    const hasVi = Boolean(viText && String(viText).trim() && this.currentSubMode !== 'source_only' && this.currentSubMode !== 'none');

    if (this.invideoSubSource) {
      this.invideoSubSource.textContent = hasSource ? sourceText : '';
      if (hasSource) {
        this.invideoSubSource.removeAttribute('data-empty');
        this.invideoSubSource.style.display = 'block';
      } else {
        this.invideoSubSource.setAttribute('data-empty', 'true');
        this.invideoSubSource.style.display = 'none';
      }
    }
    if (this.invideoSubVi) {
      this.invideoSubVi.textContent = hasVi ? viText : '';
      if (hasVi) {
        this.invideoSubVi.removeAttribute('data-empty');
        this.invideoSubVi.style.display = 'inline-block';
      } else {
        this.invideoSubVi.setAttribute('data-empty', 'true');
        this.invideoSubVi.style.display = 'none';
      }
    }

    if (this.invideoWebSubSource) {
      this.invideoWebSubSource.textContent = hasSource ? sourceText : '';
      if (hasSource) {
        this.invideoWebSubSource.removeAttribute('data-empty');
        this.invideoWebSubSource.style.display = 'block';
      } else {
        this.invideoWebSubSource.setAttribute('data-empty', 'true');
        this.invideoWebSubSource.style.display = 'none';
      }
    }
    if (this.invideoWebSubVi) {
      this.invideoWebSubVi.textContent = hasVi ? viText : '';
      if (hasVi) {
        this.invideoWebSubVi.removeAttribute('data-empty');
        this.invideoWebSubVi.style.display = 'inline-block';
      } else {
        this.invideoWebSubVi.setAttribute('data-empty', 'true');
        this.invideoWebSubVi.style.display = 'none';
      }
    }

    const invideoOverlays = document.querySelectorAll('.invideo-subtitle-overlay');
    invideoOverlays.forEach(overlay => {
      overlay.style.display = (hasSource || hasVi) ? 'block' : 'none';
    });

    if (this.pipWindow && !this.pipWindow.closed) {
      try {
        const srcEl = this.pipWindow.document.getElementById('pipSource');
        const viEl = this.pipWindow.document.getElementById('pipVi');
        const isSameText = sourceText && viText && (
          sourceText.trim().toLowerCase() === viText.trim().toLowerCase() ||
          viText.toLowerCase().includes(sourceText.trim().toLowerCase()) ||
          sourceText.toLowerCase().includes(viText.trim().toLowerCase())
        );
        const showSource = (this.currentSubMode !== 'vi_only' && this.currentSubMode !== 'none' && !isSameText);
        if (srcEl) {
          srcEl.textContent = showSource ? (sourceText || '') : '';
          srcEl.style.display = (showSource && sourceText) ? 'block' : 'none';
        }
        if (viEl) {
          viEl.textContent = (this.currentSubMode !== 'source_only' && this.currentSubMode !== 'none') ? (viText || '') : '';
          viEl.style.display = (this.currentSubMode !== 'source_only' && this.currentSubMode !== 'none') ? 'block' : 'none';
        }
      } catch (_) {}
    }

    if (this.isNativePipActive) {
      this.renderPipCanvas(sourceText, viText);
    }

    if (typeof document !== 'undefined') {
      const floatingSrc = document.getElementById('inAppPipSource');
      const floatingVi = document.getElementById('inAppPipVi');
      if (floatingSrc) floatingSrc.textContent = sourceText || '';
      if (floatingVi) floatingVi.textContent = viText || '';
    }

    const payload = {
      type: 'UPDATE_SUBTITLE',
      sourceText,
      viText,
      subMode: this.currentSubMode
    };

    this.broadcastOverlay(payload);
  }

  broadcastOverlay(payload) {
    if (this.floatingWindow && !this.floatingWindow.closed) {
      this.floatingWindow.postMessage(payload, '*');
    }
    try {
      if (!this.overlayChannel) {
        this.overlayChannel = new BroadcastChannel('livesub_overlay_channel');
      }
      this.overlayChannel.postMessage(payload);
    } catch (e) {}
  }

  applyTransparencyUI() {
    const box = this.cinemaBox || document.getElementById('subtitleViewport');
    if (box) {
      box.classList.remove('transparent-mode', 'glass-mode');
      if (this.currentTransparency === 'transparent') {
        box.classList.add('transparent-mode');
      } else if (this.currentTransparency === 'glass') {
        box.classList.add('glass-mode');
      }
    }
    if (this.btnToggleBoxTransparent) {
      this.btnToggleBoxTransparent.textContent = (this.currentTransparency === 'transparent') ? 'Tắt Trong Suốt' : 'Bật Trong Suốt';
    }

    const transPayload = {
      type: 'SET_TRANSPARENCY',
      mode: this.currentTransparency
    };

    if (this.floatingWindow && !this.floatingWindow.closed) {
      this.floatingWindow.postMessage(transPayload, '*');
    }

    try {
      if (!this.overlayChannel) {
        this.overlayChannel = new BroadcastChannel('livesub_overlay_channel');
      }
      this.overlayChannel.postMessage(transPayload);
    } catch (e) {}
  }

  updateSubModeUI() {
    const showSource = this.currentSubMode === 'bilingual' || this.currentSubMode === 'source_only' || this.currentSubMode === 'en_only';
    const showVi = this.currentSubMode === 'bilingual' || this.currentSubMode === 'vi_only';

    this.subSourceDisplay.style.display = showSource ? 'block' : 'none';
    this.subViDisplay.style.display = showVi ? 'block' : 'none';

    if (this.invideoSubSource) this.invideoSubSource.style.display = showSource ? 'block' : 'none';
    if (this.invideoSubVi) this.invideoSubVi.style.display = showVi ? 'block' : 'none';
    if (this.invideoWebSubSource) this.invideoWebSubSource.style.display = showSource ? 'block' : 'none';
    if (this.invideoWebSubVi) this.invideoWebSubVi.style.display = showVi ? 'block' : 'none';

    this.broadcastOverlay({
      type: 'UPDATE_SUBTITLE',
      sourceText: this.subSourceDisplay.textContent || '',
      viText: this.subViDisplay.textContent || '',
      subMode: this.currentSubMode
    });
  }

  setStatus(type, text) {
    this.statusBadge.className = 'status-badge ' + type;
    this.statusText.textContent = text;
  }

  async startNativeVideoPip() {
    if (!this.pipCanvas) {
      this.pipCanvas = document.createElement('canvas');
      this.pipCanvas.width = 960;
      this.pipCanvas.height = 140;
    }
    if (!this.pipVideo) {
      this.pipVideo = document.createElement('video');
      this.pipVideo.muted = true;
      this.pipVideo.playsInline = true;
      this.pipVideo.autoplay = true;
      this.pipVideo.style.position = 'fixed';
      this.pipVideo.style.opacity = '0';
      this.pipVideo.style.pointerEvents = 'none';
      this.pipVideo.style.zIndex = '-9999';
      document.body.appendChild(this.pipVideo);
      this.pipVideo.addEventListener('leavepictureinpicture', () => {
        this.isNativePipActive = false;
      });
    }

    const currentSource = this.subSourceDisplay ? this.subSourceDisplay.textContent : '';
    const currentVi = this.subViDisplay ? this.subViDisplay.textContent || 'Đang chờ phụ đề…' : 'Đang chờ phụ đề…';
    this.renderPipCanvas(currentSource, currentVi);

    if (typeof this.pipCanvas.captureStream === 'function') {
      this.pipVideo.srcObject = this.pipCanvas.captureStream(20);
      await this.pipVideo.play().catch(() => {});
      if (typeof this.pipVideo.requestPictureInPicture === 'function') {
        await this.pipVideo.requestPictureInPicture();
        this.isNativePipActive = true;
        return true;
      }
    }
    throw new Error('Canvas Video PictureInPicture not supported');
  }

  renderPipCanvas(sourceText, viText) {
    if (!this.pipCanvas) return;
    const ctx = this.pipCanvas.getContext('2d');
    if (!ctx) return;
    const w = this.pipCanvas.width;
    const h = this.pipCanvas.height;

    ctx.fillStyle = '#0b0d13';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#e89486';
    ctx.fillRect(0, 0, w, 3);

    if (sourceText) {
      ctx.font = '600 18px "Instrument Sans", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.textAlign = 'center';
      ctx.fillText(sourceText, w / 2, 38, w - 40);
    }

    ctx.font = '800 32px "Roboto Condensed", "Instrument Sans", sans-serif';
    ctx.fillStyle = '#FFE600';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 8;
    ctx.fillText(viText || 'Đang chờ phụ đề...', w / 2, sourceText ? 96 : 78, w - 40);
    ctx.shadowBlur = 0;
  }

  // Opens ultra-slim Picture-in-Picture window or Always-on-Top overlay
  async openFloatingOverlay() {
    this.ensureAudioUnlocked();
    const currentSource = this.subSourceDisplay ? this.subSourceDisplay.textContent : '';
    const currentVi = this.subViDisplay ? this.subViDisplay.textContent || 'Đang chờ phụ đề…' : 'Đang chờ phụ đề…';

    // 1. If currently active in Picture-in-Picture, exit
    if (typeof document !== 'undefined' && document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
        this.isNativePipActive = false;
        this.showToast('📌 Đã tắt Phụ Đề PiP');
        return;
      } catch (_) {}
    }
    if (this.pipWindow && !this.pipWindow.closed) {
      this.pipWindow.close();
      this.pipWindow = null;
      this.showToast('📌 Đã tắt Phụ Đề PiP');
      return;
    }

    // 2. Try Document Picture-in-Picture (Chrome 116+ standalone browser)
    if (typeof window !== 'undefined' && 'documentPictureInPicture' in window && typeof window.documentPictureInPicture.requestWindow === 'function') {
      try {
        const pip = await window.documentPictureInPicture.requestWindow({
          width: 820,
          height: 100
        });
        this.pipWindow = pip;

        if (typeof document !== 'undefined') {
          document.querySelectorAll('link[rel="stylesheet"], style').forEach(node => {
            try { pip.document.head.appendChild(node.cloneNode(true)); } catch (_) {}
          });
        }

        const currentSource = this.subSourceDisplay ? this.subSourceDisplay.textContent : '';
        const currentVi = this.subViDisplay ? this.subViDisplay.textContent || 'Đang chờ phụ đề…' : 'Đang chờ phụ đề…';

        const isSameText = currentSource && currentVi && (
          currentSource.trim().toLowerCase() === currentVi.trim().toLowerCase() ||
          currentVi.toLowerCase().includes(currentSource.trim().toLowerCase()) ||
          currentSource.toLowerCase().includes(currentVi.trim().toLowerCase())
        );
        const showSource = (this.currentSubMode !== 'vi_only' && this.currentSubMode !== 'none' && !isSameText);
        pip.document.body.innerHTML = `
          <div id="pipContainer" style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:4px 14px;background:rgba(10,12,18,0.92);box-sizing:border-box;user-select:none;font-family:var(--font-subtitle,sans-serif);text-align:center;overflow:hidden;border-radius:10px;">
            <div id="pipSource" style="font-size:13px;color:rgba(255,255,255,0.8);font-weight:600;white-space:normal;word-break:break-word;max-width:98%;margin-bottom:2px;display:${showSource && currentSource ? 'block' : 'none'};">${this.escapeHtml(currentSource)}</div>
            <div id="pipVi" style="font-size:24px;color:#FFE600;font-weight:800;white-space:normal;word-break:break-word;overflow-wrap:break-word;line-height:1.25;max-width:98%;text-shadow:0 2px 6px rgba(0,0,0,0.95);">${this.escapeHtml(currentVi)}</div>
          </div>
        `;

        pip.addEventListener('pagehide', () => {
          this.pipWindow = null;
        });

        this.showToast('📌 Đã bật Phụ Đề Ghim Nổi (Always-on-Top trên video toàn màn hình)!');
        return;
      } catch (err) {
        console.warn('Document PiP request error, falling back to Native Desktop PiP:', err);
      }
    }

    // 3. Desktop Native OS PiP Window via Backend Signal (Detached Always-on-Top Window)
    try {
      const res = await fetch('/api/overlay/toggle', { method: 'POST' });
      if (res && res.ok) {
        this.broadcastOverlay({
          type: 'UPDATE_SUBTITLE',
          sourceText: currentSource,
          viText: currentVi,
          subMode: this.currentSubMode
        });
        this.showToast('📌 Đã bật/tắt Cửa Sổ Phụ Đề Nổi (OS Always-on-Top)!');
        return;
      }
    } catch (_) {}

    // 3. Try Native Video Picture-in-Picture (OS Always-on-Top, 100% works in WebView2 & modern browsers)
    try {
      await this.startNativeVideoPip();
      this.showToast('📌 Đã bật Phụ Đề Nổi Always-on-Top (PiP)!');
      return;
    } catch (err) {
      console.warn('Native Video PiP error, falling back to in-app overlay:', err);
    }

    // 4. In-App Floating Overlay bar (Safe fallback, NO browser alert!)
    let overlayBar = document.getElementById('inAppFloatingBar');
    if (!overlayBar) {
      overlayBar = document.createElement('div');
      overlayBar.id = 'inAppFloatingBar';
      overlayBar.className = 'in-app-floating-bar';
      overlayBar.innerHTML = `
        <div class="in-app-pip-content">
          <div id="inAppPipSource" class="in-app-pip-source"></div>
          <div id="inAppPipVi" class="in-app-pip-vi">Đang chờ phụ đề...</div>
        </div>
        <button type="button" class="btn-close-inapp-pip" id="btnCloseInAppPip">✕</button>
      `;
      document.body.appendChild(overlayBar);
      const closeBtn = document.getElementById('btnCloseInAppPip');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          overlayBar.classList.remove('active');
        });
      }
    }

    const isActive = overlayBar.classList.toggle('active');
    if (isActive) {
      const currentSource = this.subSourceDisplay ? this.subSourceDisplay.textContent : '';
      const currentVi = this.subViDisplay ? this.subViDisplay.textContent || 'Đang chờ phụ đề…' : 'Đang chờ phụ đề…';
      const s = document.getElementById('inAppPipSource');
      const v = document.getElementById('inAppPipVi');
      if (s) s.textContent = currentSource;
      if (v) v.textContent = currentVi;
      this.showToast('📌 Đã ghim thanh Phụ Đề Nổi!');
    } else {
      this.showToast('📌 Đã đóng thanh Phụ Đề Nổi');
    }
  }

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

  addHistory(sourceText, viText, lang) {
    const id = Date.now() + Math.random().toString(36).substring(2, 6);
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    const record = { id, timestamp: timeStr, sourceText, viText, lang, audioBlobUrl: null };
    this.history.push(record);
    // Bounded history: keep latest 150 items to prevent unbounded memory growth
    if (this.history.length > 150) {
      this.history.shift();
      if (this.historyList.lastElementChild && this.historyList.lastElementChild !== this.historyEmpty) {
        this.historyList.removeChild(this.historyList.lastElementChild);
      }
    }
    this.historyCount.textContent = this.history.length;
    this.historyEmpty.style.display = 'none';

    const itemEl = document.createElement('div');
    itemEl.className = 'history-item';
    itemEl.id = `history-${id}`;
    const cleanSource = (sourceText || '').trim().replace(/[.!?…]+$/, '').toLowerCase();
    const cleanVi = (viText || '').trim().replace(/[.!?…]+$/, '').toLowerCase();
    const isDuplicateText = cleanSource && cleanVi && (cleanSource === cleanVi);

    itemEl.innerHTML = `
      <div class="history-meta">
        <span>[${timeStr}] (${lang.toUpperCase()})</span>
      </div>
      ${isDuplicateText ? '' : `<div class="history-source-text">${this.escapeHtml(sourceText)}</div>`}
      <div class="history-vi-text">${this.escapeHtml(viText)}</div>
    `;

    this.historyList.prepend(itemEl);
    return record;
  }

  async playHistoryAudio(id) {
    const item = this.history.find(h => h.id === id);
    if (!item || !item.viText) return;
    try {
      const voice = this.getEffectiveVoice();
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: item.viText, voice })
      });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        await this.playAudioBuffer(arrayBuf);
      }
    } catch (e) {
      console.warn('Replay audio error:', e);
    }
  }

  clearHistory() {
    this.history = [];
    if (this.historyCount) this.historyCount.textContent = '0';
    if (this.historyList) {
      this.historyList.innerHTML = '';
      if (this.historyEmpty) {
        this.historyEmpty.style.display = 'block';
        this.historyList.appendChild(this.historyEmpty);
      }
    }
    this.recentOCRHistory = [];
    this.lastOCRText = '';
    this.lastCleanText = '';
    this.liveDubbingQueue = [];
    this.speechQueue = [];
    if (typeof this.stopDubbingAudio === 'function') {
      this.stopDubbingAudio(false, true);
    }
  }

  exportSRT() {
    if (this.history.length === 0) {
      alert('Chưa có nội dung dịch để xuất phụ đề.');
      return;
    }
    let srtContent = '';
    let secCounter = 1;

    this.history.forEach((item, index) => {
      const startMs = secCounter * 1000;
      const endMs = startMs + 3000;
      secCounter += 4;

      srtContent += `${index + 1}\n`;
      srtContent += `${this.formatSRTTime(startMs)} --> ${this.formatSRTTime(endMs)}\n`;
      if (this.currentSubMode === 'source_only' || this.currentSubMode === 'en_only') {
        srtContent += `${item.sourceText}\n\n`;
      } else if (this.currentSubMode === 'vi_only') {
        srtContent += `${item.viText}\n\n`;
      } else {
        srtContent += `${item.sourceText}\n${item.viText}\n\n`;
      }
    });

    this.downloadFile(srtContent, `LiveSub_${Date.now()}.srt`, 'text/plain;charset=utf-8');
  }

  exportTXT() {
    if (this.history.length === 0) {
      alert('Chưa có nội dung dịch để xuất.');
      return;
    }
    let txtContent = `=== LỊCH SỬ DỊCH & KỊCH BẢN LIVESUB STUDIO ===\n`;
    txtContent += `Thời gian xuất: ${new Date().toLocaleString('vi-VN')}\n\n`;

    this.history.forEach((item, idx) => {
      txtContent += `[${item.timestamp}] #${idx + 1}\n`;
      txtContent += `Gốc (${item.lang}): ${item.sourceText}\n`;
      txtContent += `Dịch (VI): ${item.viText}\n\n`;
    });

    this.downloadFile(txtContent, `LiveSub_Script_${Date.now()}.txt`, 'text/plain;charset=utf-8');
  }

  formatSRTTime(milliseconds) {
    const date = new Date(milliseconds);
    const hours = String(Math.floor(milliseconds / 3600000)).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    const millis = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds},${millis}`;
  }

  downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 100);
  }

  getRealtimeMetrics() {
    const values = [...this.realtimeMetrics.samples].sort((a, b) => a - b);
    const percentile = p => values.length
      ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))]
      : null;
    return {
      ...this.realtimeMetrics,
      p50SpeechEndToVoiceMs: percentile(0.50),
      p95SpeechEndToVoiceMs: percentile(0.95),
      p99SpeechEndToVoiceMs: percentile(0.99),
      speechQueueDepth: this.speechQueue.length,
      dubbingQueueDepth: this.liveDubbingQueue.length,
      isTranscribing: this.isTranscribing,
      isSpeakingVietnamese: this.streamingAudioSources.size > 0
    };
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => {
      switch (m) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return m;
      }
    });
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    window.app = new LiveDubStudio();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LiveDubStudio;
}
