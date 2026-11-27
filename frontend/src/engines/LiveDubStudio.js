import settingsStore from './settings-store.js';
import ocrScanner from './ocr-scanner.js';
import whisperAudio from './whisper-audio.js';
import ttsPlayer from './tts-player.js';
import youtubeLifecycle from './youtube-lifecycle.js';
import youtubeSource from './youtube-source.js';
import youtubeTimelineSync from './youtube-sync.js';
import youtubeAudio from './youtube-audio.js';
import subtitleOverlay from './subtitle-overlay.js';
import historyExporter from './history-exporter.js';

export class LiveDubStudio {
  constructor({ onUIStateChange } = {}) {
    this.onUIStateChange = typeof onUIStateChange === 'function' ? onUIStateChange : null;

    this.activeSource = 'system'; // 'system' | 'local' | 'mic' | 'weburl'
    this.isListening = false;
    this.mediaStream = null;
    this.audioContext = null;
    this.mediaStreamSource = null;
    this.scriptNode = null;
    this.neuralVAD = null;
    this.neuralVADActive = false;
    this.isOCRModeActive = false;
    this.ocrVideo = null;
    this.ocrCanvas = null;
    this.ocrTimer = null;
    this.ocrRequestActive = false;
    this.ocrScanZone = 'bottom';
    this.lastOCRText = '';
    this.lastCleanText = '';
    this.currentActiveAudioSource = null;
    this.streamingAudioSources = new Set();
    this.streamingAbortController = null;
    this.ttsRequestGeneration = Date.now();
    this.currentEdgeStreamAudio = null;
    this.currentEdgeStreamUrl = null;
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
    this.transcriptionAbortControllers = new Set();
    this.activeTranscriptionCount = 0;
    this.maxConcurrentTranscriptions = 2;
    this.lastProcessedText = '';
    this.phraseStartTime = 0;

    // Subtitle & Voice Settings
    this.currentSubMode = 'vi_only';
    this.currentTransparency = 'transparent';
    this.isDubbingEnabled = true;
    this.isAdaptiveSpeedEnabled = true;
    this.isScanningPaused = false;
    this.isHybridModeActive = false;
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
    this.ytPrefetchedAudioIndices = new Set();
    this._ytSequentialPrefetchCursor = 0;
    this.voiceGeneration = 0;
    this.dubbingGeneration = 0;
    this.playbackGeneration = 0;
    this.ytSessionGeneration = 0;
    this.lastYtTime = null;
    this.ytCueLeadSeconds = 0.08;
    this.isHoldingYtForDubbing = false;
    this.ytShouldResumeAfterHold = false;
    this.ytOverrunHoldTimer = null;
    this.ytInitialStartGate = false;
    this.ytInitialPlayerReady = false;
    this.ytInitialVoiceReady = false;
    this.ytInitialGateTimer = null;
    this.smoothVideoPlayback = true;

    // Realtime requests serialized instead of dropped while Whisper is busy
    this.speechQueue = [];
    this.isProcessingSpeechQueue = false;
    this.lastTranscriptContext = '';
    this.autoDetectedSourceLang = null;
    this.autoLanguageProbeCounter = 0;
    this.maxSpeechQueueSize = 2;
    this.liveSpeechSequence = 0;
    this.lastCommittedSpeechSequence = 0;
    this.liveDubbingQueue = [];
    this.isProcessingLiveDubbing = false;
    this.liveTtsPrefetch = new Map();
    this.currentGainNode = null;
    this.maxLiveVoiceLagMs = 2200;

    this.youtubeLoadGeneration = 0;
    this.youtubeSubtitleAbortController = null;
    this.history = [];
    this._cleanupHandlers = [];

    this.initElements();
    this.restorePreferences();
    this.bindEvents();
    this.updateSubModeUI();
    this.applyTransparencyUI();
    this.updateMasterDubUI();
    this.updateSourceIntelligenceControls();
    this.updateAppliedSettings();
    this.notifyUIState();
    this._runtimeConfirmTimer = setTimeout(() => this.confirmRuntimeSettings(), 3000);
  }

  initElements() {
    this.statusBadge = document.getElementById('statusBadge');
    this.statusText = document.getElementById('statusText');
    this.btnFloatingWindow = document.getElementById('btnFloatingWindow');

    this.sourceTabs = document.querySelectorAll('.source-tab');
    this.panelSourceSystem = document.getElementById('panelSourceSystem');
    this.panelSourceMic = document.getElementById('panelSourceMic');
    this.panelSourceWebUrl = document.getElementById('panelSourceWebUrl');

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

    this.btnToggleMic = document.getElementById('btnToggleMic');
    this.btnMicText = document.getElementById('btnMicText');

    this.webUrlInput = document.getElementById('webUrlInput');
    this.webVideoForm = document.getElementById('webVideoForm');
    this.btnLoadWebUrl = document.getElementById('btnLoadWebUrl');
    this.webVideoContainer = document.getElementById('webVideoContainer');
    this.webVideoTitle = document.getElementById('webVideoTitle');
    this.btnWebLiveCapture = document.getElementById('btnWebLiveCapture');
    this.webCaptionMode = document.getElementById('webCaptionMode');
    this.webCaptionLanguage = document.getElementById('webCaptionLanguage');
    this.btnYtModeCC = document.getElementById('btnYtModeCC');
    this.btnYtModeOCR = document.getElementById('btnYtModeOCR');
    this.btnYtModeWhisper = document.getElementById('btnYtModeWhisper');
    this.ytLiveCaptureControls = document.getElementById('ytLiveCaptureControls');
    this.btnYtLiveCapture = document.getElementById('btnYtLiveCapture');
    this.btnYtLiveCaptureText = document.getElementById('btnYtLiveCaptureText');
    this.ytOcrZoneSelect = document.getElementById('ytOcrZoneSelect');
    this.currentYtMode = 'has_captions';
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

    this.audioMeterFill = document.getElementById('audioMeterFill');
    this.meterPercentText = document.getElementById('meterPercentText');

    this.sourceLang = this.sourceLangSelect = document.getElementById('sourceLang');
    this.voiceSelect = document.getElementById('voiceSelect');
    this.btnTestVoiceSample = document.getElementById('btnTestVoiceSample');
    this.rateRange = document.getElementById('rateRange');
    this.rateValue = document.getElementById('rateValue');
    this.volumeRange = document.getElementById('volumeRange');
    this.volumeValue = document.getElementById('volumeValue');
    this.subTransparencyRadios = document.querySelectorAll('input[name="subTransparency"]');
    this.subModeRadios = document.querySelectorAll('input[name="subMode"]');

    this.testTextInput = document.getElementById('testTextInput');
    this.btnSendTestText = document.getElementById('btnSendTestText');

    this.cinemaBox = document.getElementById('cinemaBox') || document.getElementById('subtitleViewport');
    this.subSourceDisplay = document.getElementById('subSourceDisplay');
    this.subViDisplay = document.getElementById('subViDisplay');
    this.dubbingIndicator = document.getElementById('dubbingIndicator');
    this.btnToggleBoxTransparent = document.getElementById('btnToggleBoxTransparent');
    this.btnSubtitleFontPlus = document.getElementById('btnSubtitleFontPlus');
    this.btnSubtitleFontMinus = document.getElementById('btnSubtitleFontMinus');
    this.btnPanicKill = document.getElementById('btnPanicKill');
    this.btnPauseScan = document.getElementById('btnPauseScan');

    this.historyList = document.getElementById('historyList');
    this.historyCount = document.getElementById('historyCount');
    this.historyEmpty = document.getElementById('historyEmpty');
    this.btnExportSRT = document.getElementById('btnExportSRT');
    this.btnExportTXT = document.getElementById('btnExportTXT');
    this.btnClearHistory = document.getElementById('btnClearHistory');

    this.dubbingAudio = document.getElementById('dubbingAudio');

    const existingToast = document.querySelector('body > .studio-toast');
    if (existingToast) {
      this.toastEl = existingToast;
    } else {
      this.toastEl = document.createElement('div');
      this.toastEl.className = 'studio-toast';
      document.body.appendChild(this.toastEl);
    }

    if (typeof window !== 'undefined') {
      const unlock = () => this.ensureAudioUnlocked();
      ['pointerdown', 'keydown', 'touchstart'].forEach((evt) => {
        window.addEventListener(evt, unlock, { passive: true });
        this._cleanupHandlers.push(() => window.removeEventListener(evt, unlock, { passive: true }));
      });
    }

    this.initOverlayChannel();
    this.startControlPolling();
  }

  bindEvents() {
    // Only bind legacy hidden controls & global document shortcuts here;
    // primary visible React UI controls use JSX props in App.jsx.
    if (this.btnConfirmSettings) {
      const h = () => this.confirmRuntimeSettings();
      this.btnConfirmSettings.addEventListener('click', h);
      this._cleanupHandlers.push(() => this.btnConfirmSettings?.removeEventListener('click', h));
    }

    if (this.systemCaptureMode) {
      const h = () => {
        const mode = this.getRadioGroupValue(this.systemCaptureMode, 'audio_only');
        localStorage.setItem('livesub_system_capture_mode', mode);
        this.updateSystemIntelligenceControls();
        this.updateAppliedSettings();
      };
      this.systemCaptureMode.addEventListener('change', h);
      this._cleanupHandlers.push(() => this.systemCaptureMode?.removeEventListener('change', h));
    }

    if (this.webCaptionMode) {
      const h = () => {
        localStorage.setItem('livesub_caption_mode', this.getRadioGroupValue(this.webCaptionMode, 'auto'));
        this.updateSourceIntelligenceControls();
        this.updateAppliedSettings();
      };
      this.webCaptionMode.addEventListener('change', h);
      this._cleanupHandlers.push(() => this.webCaptionMode?.removeEventListener('change', h));
    }

    if (this.webCaptionLanguage) {
      const h = () => {
        localStorage.setItem('livesub_caption_language', this.getRadioGroupValue(this.webCaptionLanguage, 'auto'));
        this.updateSourceIntelligenceControls();
        this.updateAppliedSettings();
      };
      this.webCaptionLanguage.addEventListener('change', h);
      this._cleanupHandlers.push(() => this.webCaptionLanguage?.removeEventListener('change', h));
    }

    if (this.btnToggleBoxTransparent) {
      const h = () => {
        this.currentTransparency = this.currentTransparency === 'transparent' ? 'dark' : 'transparent';
        const targetRadio = document.querySelector(`input[name="subTransparency"][value="${this.currentTransparency}"]`);
        if (targetRadio) targetRadio.checked = true;
        this.applyTransparencyUI();
      };
      this.btnToggleBoxTransparent.addEventListener('click', h);
      this._cleanupHandlers.push(() => this.btnToggleBoxTransparent?.removeEventListener('click', h));
    }

    if (typeof document !== 'undefined') {
      const onFs = () => this.handleFullscreenChange();
      document.addEventListener('fullscreenchange', onFs);
      document.addEventListener('webkitfullscreenchange', onFs);
      this._cleanupHandlers.push(() => {
        document.removeEventListener('fullscreenchange', onFs);
        document.removeEventListener('webkitfullscreenchange', onFs);
      });

      const onKeyDown = (e) => {
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
      };
      document.addEventListener('keydown', onKeyDown);
      this._cleanupHandlers.push(() => document.removeEventListener('keydown', onKeyDown));
    }
  }

  getUIState() {
    return {
      activeSource: this.activeSource || 'system',
      sourceLang: this.sourceLangSelect?.value || 'auto',
      sourceLangLabel: this.lblSourceLang?.textContent || 'Ngôn Ngữ Gốc:',
      voice: this.voiceSelect?.value || 'edge:Hoài My',
      subMode: this.currentSubMode || 'vi_only',
      transparency: this.currentTransparency || 'transparent',
      rate: parseFloat(this.rateRange?.value) || 1,
      adaptiveSpeed: !!this.isAdaptiveSpeedEnabled,
      volume: parseInt(this.volumeRange?.value ?? 100, 10),
      systemMode: this.currentSystemMode || 'ocr',
      ocrZone: this.ocrScanZone || 'bottom',
      ytMode: this.currentYtMode || 'has_captions'
    };
  }

  notifyUIState() {
    if (this.onUIStateChange) {
      this.onUIStateChange(this.getUIState());
    }
  }

  switchSourceTab(source) {
    if (this.isListening && this.activeSource !== source) {
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
    this.updateAppliedSettings();
    this.notifyUIState();
  }

  handleSourceLangChange(val) {
    const select = this.sourceLangSelect;
    const option = select && Array.from(select.options || []).find((o) => o.value === val);
    const name = option ? option.text : val;
    this.detectedOCRLanguage = null;
    this.autoDetectedSourceLang = null;
    this.lastOCRText = '';
    this.lastCleanText = '';
    this._hasNotifiedVietsubMode = false;
    if (this.oneTouchDetectionPill) {
      if (val.startsWith('vi')) {
        this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phát hiện Vietsub:</strong> Khóa chế độ đọc chữ OCR siêu tốc ~200ms (tắt nghe tiếng chống loạn giọng)';
      } else if (val.startsWith('en')) {
        this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phụ đề Tiếng Anh:</strong> OCR siêu tốc ~20ms, dịch trực tiếp & lồng tiếng Việt';
      } else if (val.startsWith('ja')) {
        this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phụ đề Tiếng Nhật:</strong> OCR (Kanji/Kana) siêu tốc ~20ms, dịch trực tiếp & lồng tiếng Việt';
      } else if (val.startsWith('zh')) {
        this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Phụ đề Tiếng Trung:</strong> OCR (Hán tự) siêu tốc ~20ms, dịch trực tiếp & lồng tiếng Việt';
      } else if (val.startsWith('ko')) {
        this.oneTouchDetectionPill.innerHTML = '⚡ <strong>Tiếng Hàn:</strong> Nhận diện & dịch sang Tiếng Việt';
      } else if (val.startsWith('th')) {
        this.oneTouchDetectionPill.innerHTML = '🇹🇭 <strong>Tiếng Thái:</strong> OCR & Whisper GPU Thái Lan -> Tiếng Việt';
      } else {
        this.oneTouchDetectionPill.innerHTML = '🌐 <strong>Tự động nhận diện:</strong> Tự phát hiện ngôn ngữ nói/chữ & dịch sang Tiếng Việt';
      }
    }
    try { localStorage.setItem('livesub_sourcelang', val); } catch (_) {}
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_lang: val })
    }).catch(() => {});
    this.showToast(` Đã chọn ngôn ngữ gốc: ${name}`);
    this.updateAppliedSettings();
    this.notifyUIState();
  }

  handleOcrZoneChange(val, fromYouTube = false) {
    this.ocrScanZone = val;
    if (typeof this.updateOcrFeedbackGuard === 'function') this.updateOcrFeedbackGuard();
    try { localStorage.setItem('livesub_ocr_zone', val); } catch (_) {}
    if (!fromYouTube && this.ocrZoneSelect) {
      const zoneName = (this.ocrZoneSelect.selectedOptions && this.ocrZoneSelect.selectedOptions[0])
        ? this.ocrZoneSelect.selectedOptions[0].text
        : val;
      this.showToast(`📐 Đã đổi vùng quét sub: ${zoneName}`);
    }
    this.notifyUIState();
  }

  handleRateChange(val) {
    const num = parseFloat(val) || 1;
    if (this.currentActiveAudioSource?.playbackRate) {
      this.currentActiveAudioSource.playbackRate.value = num;
    }
    if (this.streamingAudioSources && this.streamingAudioSources.size > 0) {
      for (const src of this.streamingAudioSources) {
        if (src && src.playbackRate) src.playbackRate.value = num;
      }
    }
    this.updateAppliedSettings();
  }

  handleVolumeChange(vol) {
    const num = parseInt(vol, 10);
    if (this.currentGainNode) this.currentGainNode.gain.value = num / 100;
    this.updateAppliedSettings();
  }

  handleAdaptiveSpeedChange(enabled) {
    this.isAdaptiveSpeedEnabled = !!enabled;
    try { localStorage.setItem('livesub_adaptive_speed', String(this.isAdaptiveSpeedEnabled)); } catch (_) {}
    if (!this.isAdaptiveSpeedEnabled) {
      this.releaseYouTubeDubbingHold();
    }
    this.updateAppliedSettings();
    this.showToast(this.isAdaptiveSpeedEnabled
      ? '⚡ Thích ứng video: ĐÃ BẬT (Tự động tăng tốc giọng đọc để đuổi kịp phụ đề)'
      : '⏹️ Thích ứng video: ĐÃ TẮT (Giữ cố định tốc độ đọc theo thanh trượt)');
  }

  closeWebVideo() {
    this.cleanupYouTubePlayback();
    const playerContainer = document.getElementById('webVideoPlayer');
    if (playerContainer) playerContainer.innerHTML = '';
    if (this.webVideoContainer) this.webVideoContainer.style.display = 'none';
    this.stopAllAudio();
  }

  adjustFontSize(delta) {
    this.fontSizePx = Math.max(16, Math.min(52, this.fontSizePx + delta));
    document.documentElement.style.setProperty('--sub-font-size', `${this.fontSizePx}px`);
  }

  destroy() {
    if (this._runtimeConfirmTimer) clearTimeout(this._runtimeConfirmTimer);
    if (this._controlPollTimer) clearInterval(this._controlPollTimer);
    this._cleanupHandlers.forEach((fn) => { try { fn(); } catch (_) {} });
    this._cleanupHandlers = [];
    this.stopListening?.();
    this.cleanupYouTubePlayback?.();
    this.stopAllAudio?.();
  }
}

Object.assign(
  LiveDubStudio.prototype,
  settingsStore,
  ocrScanner,
  whisperAudio,
  ttsPlayer,
  youtubeLifecycle,
  youtubeSource,
  youtubeTimelineSync,
  youtubeAudio,
  subtitleOverlay,
  historyExporter
);

// Sync UI state helper wrap around existing component mutators
const origSetSystemMode = LiveDubStudio.prototype.setSystemMode;
LiveDubStudio.prototype.setSystemMode = function (mode) {
  origSetSystemMode.call(this, mode);
  this.notifyUIState();
};

const origSetYouTubeMode = LiveDubStudio.prototype.setYouTubeMode;
LiveDubStudio.prototype.setYouTubeMode = function (mode) {
  origSetYouTubeMode.call(this, mode);
  this.notifyUIState();
};

const origSetSubMode = LiveDubStudio.prototype.setSubMode;
LiveDubStudio.prototype.setSubMode = function (mode) {
  origSetSubMode.call(this, mode);
  this.notifyUIState();
};

export default LiveDubStudio;
