// LiveSub & VoiceDub AI Studio - Professional Realtime Universal Engine

class LiveDubStudio {
  constructor() {
    this.activeSource = 'system'; // 'system' | 'local' | 'mic' | 'weburl'
    this.isListening = false;
    this.mediaStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.meterAnimationId = null;

    // VAD & Dynamic Speech Chunking
    this.isSpeaking = false;
    this.silenceCounter = 0;
    this.speechDurationMs = 0;
    this.recorder = null;
    this.recordedBlobs = [];
    this.isTranscribing = false;
    this.activeAbortController = null;
    this.lastProcessedText = '';

    // Subtitle & Voice Settings
    this.currentSubMode = 'bilingual';
    this.currentTransparency = 'transparent';
    this.isDubbingEnabled = true;
    this.fontSizePx = 26;
    this.floatingWindow = null;

    // History
    this.history = [];

    this.initElements();
    this.bindEvents();
    this.updateSubModeUI();
    this.applyTransparencyUI();
  }

  initElements() {
    this.statusBadge = document.getElementById('statusBadge');
    this.statusText = document.getElementById('statusText');
    this.btnFloatingWindow = document.getElementById('btnFloatingWindow');

    // Source navigation tabs
    this.sourceTabs = document.querySelectorAll('.source-tab');
    this.panelSourceSystem = document.getElementById('panelSourceSystem');
    this.panelSourceLocalFile = document.getElementById('panelSourceLocalFile');
    this.panelSourceMic = document.getElementById('panelSourceMic');
    this.panelSourceWebUrl = document.getElementById('panelSourceWebUrl');

    // Source 1: System
    this.btnToggleSystemAudio = document.getElementById('btnToggleSystemAudio');
    this.btnSystemAudioText = document.getElementById('btnSystemAudioText');

    // Source 2: Local Video File
    this.localVideoDropZone = document.getElementById('localVideoDropZone');
    this.localVideoFileInput = document.getElementById('localVideoFileInput');
    this.localVideoFileInfo = document.getElementById('localVideoFileInfo');
    this.loadedFileName = document.getElementById('loadedFileName');
    this.btnStartLocalDubbing = document.getElementById('btnStartLocalDubbing');
    this.localVideoContainer = document.getElementById('localVideoContainer');
    this.localVideoPlayer = document.getElementById('localVideoPlayer');
    this.btnCloseLocalVideo = document.getElementById('btnCloseLocalVideo');
    this.invideoSubSource = document.getElementById('invideoSubSource');
    this.invideoSubVi = document.getElementById('invideoSubVi');

    // Source 3: Mic
    this.btnToggleMic = document.getElementById('btnToggleMic');
    this.btnMicText = document.getElementById('btnMicText');

    // Source 4: Web URL
    this.webUrlInput = document.getElementById('webUrlInput');
    this.btnLoadWebUrl = document.getElementById('btnLoadWebUrl');
    this.webVideoContainer = document.getElementById('webVideoContainer');
    this.webVideoIframe = document.getElementById('webVideoIframe');
    this.btnCloseWebVideo = document.getElementById('btnCloseWebVideo');

    // Meter
    this.audioMeterFill = document.getElementById('audioMeterFill');
    this.meterPercentText = document.getElementById('meterPercentText');

    // Settings
    this.sourceLangSelect = document.getElementById('sourceLang');
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
    this.cinemaBox = document.getElementById('cinemaBox');
    this.subSourceDisplay = document.getElementById('subSourceDisplay');
    this.subViDisplay = document.getElementById('subViDisplay');
    this.dubbingIndicator = document.getElementById('dubbingIndicator');
    this.btnToggleBoxTransparent = document.getElementById('btnToggleBoxTransparent');
    this.btnSubtitleFontPlus = document.getElementById('btnSubtitleFontPlus');
    this.btnSubtitleFontMinus = document.getElementById('btnSubtitleFontMinus');
    this.btnPanicKill = document.getElementById('btnPanicKill');

    // History
    this.historyList = document.getElementById('historyList');
    this.historyCount = document.getElementById('historyCount');
    this.historyEmpty = document.getElementById('historyEmpty');
    this.btnExportSRT = document.getElementById('btnExportSRT');
    this.btnExportTXT = document.getElementById('btnExportTXT');
    this.btnClearHistory = document.getElementById('btnClearHistory');

    // Native audio element for dubbing playback
    this.dubbingAudio = document.getElementById('dubbingAudio');
  }

  bindEvents() {
    // 1. Source Switching Tabs
    this.sourceTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.source;
        this.switchSourceTab(target);
      });
    });

    // 2. Source 1: System / Tab Audio
    if (this.btnToggleSystemAudio) {
      this.btnToggleSystemAudio.addEventListener('click', () => this.toggleSystemAudio());
    }

    // 3. Source 2: Local Video File
    if (this.localVideoDropZone && this.localVideoFileInput) {
      this.localVideoDropZone.addEventListener('click', () => this.localVideoFileInput.click());
      this.localVideoDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        this.localVideoDropZone.style.borderColor = 'var(--accent-cyan)';
      });
      this.localVideoDropZone.addEventListener('dragleave', () => {
        this.localVideoDropZone.style.borderColor = 'rgba(56, 189, 248, 0.3)';
      });
      this.localVideoDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        this.localVideoDropZone.style.borderColor = 'rgba(56, 189, 248, 0.3)';
        if (e.dataTransfer.files.length > 0) {
          this.handleFileSelected(e.dataTransfer.files[0]);
        }
      });
      this.localVideoFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this.handleFileSelected(e.target.files[0]);
        }
      });
    }

    if (this.btnStartLocalDubbing) {
      this.btnStartLocalDubbing.addEventListener('click', () => this.startLocalVideoDubbing());
    }

    if (this.btnCloseLocalVideo) {
      this.btnCloseLocalVideo.addEventListener('click', () => {
        this.stopListening();
        this.localVideoPlayer.pause();
        this.localVideoPlayer.src = '';
        this.localVideoContainer.style.display = 'none';
        this.localVideoFileInfo.style.display = 'none';
        this.localVideoDropZone.style.display = 'flex';
      });
    }

    // Local Video Events: instant sync on pause and seek
    if (this.localVideoPlayer) {
      this.localVideoPlayer.addEventListener('pause', () => {
        this.stopAllAudio();
      });
      this.localVideoPlayer.addEventListener('seeking', () => {
        this.stopAllAudio();
        this.invideoSubSource.textContent = '';
        this.invideoSubVi.textContent = '';
      });
    }

    // 4. Source 3: Mic
    if (this.btnToggleMic) {
      this.btnToggleMic.addEventListener('click', () => this.toggleMic());
    }

    // 5. Source 4: Web URL
    if (this.btnLoadWebUrl && this.webUrlInput) {
      this.btnLoadWebUrl.addEventListener('click', () => this.loadWebVideo());
      this.webUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.loadWebVideo();
      });
    }
    if (this.btnCloseWebVideo) {
      this.btnCloseWebVideo.addEventListener('click', () => {
        this.webVideoIframe.src = '';
        this.webVideoContainer.style.display = 'none';
      });
    }

    // 6. Voice Audition Button
    if (this.btnTestVoiceSample) {
      this.btnTestVoiceSample.addEventListener('click', () => this.auditionSelectedVoice());
    }

    // 7. Sliders & Radios
    if (this.rateRange) {
      this.rateRange.addEventListener('input', (e) => {
        this.rateValue.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
      });
    }
    if (this.volumeRange) {
      this.volumeRange.addEventListener('input', (e) => {
        const vol = parseInt(e.target.value, 10);
        this.volumeValue.textContent = `${vol}%`;
        this.dubbingAudio.volume = vol / 100;
      });
    }

    this.subTransparencyRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.currentTransparency = e.target.value;
        this.applyTransparencyUI();
      });
    });

    this.subModeRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.currentSubMode = e.target.value;
        this.updateSubModeUI();
      });
    });

    if (this.btnToggleBoxTransparent) {
      this.btnToggleBoxTransparent.addEventListener('click', () => {
        this.currentTransparency = this.currentTransparency === 'transparent' ? 'dark' : 'transparent';
        const targetRadio = document.querySelector(`input[name="subTransparency"][value="${this.currentTransparency}"]`);
        if (targetRadio) targetRadio.checked = true;
        this.applyTransparencyUI();
      });
    }

    // 8. Subtitle Font Sizing
    this.btnSubtitleFontPlus.addEventListener('click', () => {
      this.fontSizePx = Math.min(52, this.fontSizePx + 2);
      document.documentElement.style.setProperty('--sub-font-size', `${this.fontSizePx}px`);
    });
    this.btnSubtitleFontMinus.addEventListener('click', () => {
      this.fontSizePx = Math.max(16, this.fontSizePx - 2);
      document.documentElement.style.setProperty('--sub-font-size', `${this.fontSizePx}px`);
    });

    // 9. Panic Kill Switch
    this.btnPanicKill.addEventListener('click', () => {
      this.stopAllAudio();
      this.subSourceDisplay.textContent = '';
      this.subViDisplay.textContent = 'Đã dừng và làm sạch âm thanh.';
    });

    // 10. Floating Window
    this.btnFloatingWindow.addEventListener('click', () => this.openFloatingOverlay());

    // 11. Quick Test Text
    this.btnSendTestText.addEventListener('click', () => this.handleTestText());
    this.testTextInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleTestText();
    });

    // 12. History Actions
    this.btnExportSRT.addEventListener('click', () => this.exportSRT());
    this.btnExportTXT.addEventListener('click', () => this.exportTXT());
    this.btnClearHistory.addEventListener('click', () => this.clearHistory());

    // Audio Playback Events
    this.dubbingAudio.addEventListener('ended', () => {
      this.dubbingIndicator.classList.remove('active');
    });
    this.dubbingAudio.addEventListener('error', () => {
      this.dubbingIndicator.classList.remove('active');
    });
  }

  switchSourceTab(source) {
    this.activeSource = source;
    this.sourceTabs.forEach(t => {
      if (t.dataset.source === source) t.classList.add('active');
      else t.classList.remove('active');
    });

    this.panelSourceSystem.style.display = source === 'system' ? 'flex' : 'none';
    this.panelSourceLocalFile.style.display = source === 'local' ? 'flex' : 'none';
    this.panelSourceMic.style.display = source === 'mic' ? 'flex' : 'none';
    this.panelSourceWebUrl.style.display = source === 'weburl' ? 'flex' : 'none';
  }

  // Audition sample in the exact selected voice
  async auditionSelectedVoice() {
    const voice = this.voiceSelect.value;
    const sampleTexts = {
      'google-vi': 'Xin chào bạn, đây là giọng đọc tiếng Việt siêu tốc của Google, phản hồi không phẩy một giây.',
      'vi-VN-HoaiMyNeural': 'Xin chào, tôi là Hoài My, giọng đọc nữ nhẹ nhàng và truyền cảm của Microsoft.',
      'vi-VN-NamMinhNeural': 'Xin chào quý vị và các bạn, tôi là Nam Minh, giọng đọc nam trầm ấm và truyền cảm.',
      'piper-vi': 'Xin chào, đây là giọng đọc ngoại tuyến cục bộ Piper chạy trên máy tính của bạn.'
    };
    const text = sampleTexts[voice] || 'Xin chào, đây là giọng đọc tiếng Việt chất lượng cao.';

    this.setStatus('active', 'Đang tải âm thanh giọng mẫu...');
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice })
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        this.stopAllAudio();
        this.dubbingAudio.src = url;
        this.dubbingAudio.playbackRate = parseFloat(this.rateRange.value) || 1.15;
        this.dubbingAudio.volume = parseInt(this.volumeRange.value, 10) / 100;
        this.dubbingAudio.play();
        this.setStatus('ready', `Đang phát giọng: ${this.voiceSelect.selectedOptions[0].text}`);
      }
    } catch (e) {
      console.warn('Audition error:', e);
      this.setStatus('ready', 'Sẵn sàng');
    }
  }

  // --- SOURCE 1: SYSTEM AUDIO ---
  async toggleSystemAudio() {
    if (this.isListening && this.activeSource === 'system') {
      this.stopListening();
      return;
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
      if (audioTracks.length === 0) {
        alert('⚠️ BẠN CHƯA TÍCH CHỌN "Chia sẻ âm thanh / Share audio".\n\nVui lòng bấm lại và tích vào ô chia sẻ âm thanh ở góc dưới cửa sổ chọn tab/màn hình.');
        this.mediaStream.getTracks().forEach(t => t.stop());
        return;
      }

      this.activeSource = 'system';
      this.btnSystemAudioText.textContent = 'Dừng Thu Âm Hệ Thống';
      this.btnToggleSystemAudio.classList.remove('btn-primary');
      this.btnToggleSystemAudio.classList.add('btn-danger');

      this.mediaStream.getVideoTracks().forEach(track => {
        track.onended = () => this.stopListening();
      });

      await this.setupVADAndRecording(this.mediaStream);
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        alert('Lỗi thu âm hệ thống: ' + err.message);
      }
    }
  }

  // --- SOURCE 2: LOCAL VIDEO FILE ---
  handleFileSelected(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    this.localVideoPlayer.src = url;
    this.loadedFileName.textContent = file.name;
    this.localVideoDropZone.style.display = 'none';
    this.localVideoFileInfo.style.display = 'flex';
    this.localVideoContainer.style.display = 'block';
    this.localVideoContainer.scrollIntoView({ behavior: 'smooth' });
  }

  async startLocalVideoDubbing() {
    this.stopListening();
    try {
      // Route video audio to Web Audio Context
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const sourceNode = this.audioContext.createMediaElementSource(this.localVideoPlayer);
      const destination = this.audioContext.createMediaStreamDestination();
      
      // Connect to speakers so user can hear video (or lower it for dubbing)
      sourceNode.connect(this.audioContext.destination);
      sourceNode.connect(destination);

      await this.setupVADAndRecording(destination.stream);
      this.localVideoPlayer.play();
      this.btnStartLocalDubbing.textContent = 'Đang Thuyết Minh...';
    } catch (err) {
      console.error('Local dubbing error:', err);
    }
  }

  // --- SOURCE 3: MICROPHONE ---
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

      await this.setupVADAndRecording(this.mediaStream);
    } catch (err) {
      alert('Không thể mở Microphone: ' + err.message);
    }
  }

  // --- SOURCE 4: WEB URL ---
  loadWebVideo() {
    const val = this.webUrlInput.value.trim();
    if (!val) return;
    const match = val.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (!match || !match[1]) {
      alert('Vui lòng nhập link video YouTube hoặc web video hợp lệ.');
      return;
    }
    const videoId = match[1];
    this.webVideoIframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&autoplay=1`;
    this.webVideoContainer.style.display = 'block';
    this.webVideoContainer.scrollIntoView({ behavior: 'smooth' });
  }

  // =========================================================================
  // INTELLIGENT SPEECH SEGMENTATION (VAD: Voice Activity Detection)
  // Accumulates coherent clauses and triggers on natural pause (250ms)
  // Eliminates cut-off syllables and repeated "có thể có thể..." hallucinations!
  // =========================================================================
  async setupVADAndRecording(stream) {
    this.isListening = true;
    this.setStatus('recording', 'Đang lắng nghe âm thanh...');

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Recording engine
    let mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/ogg';

    let currentRecorder = null;
    let audioChunks = [];
    let clauseStartTime = 0;

    const startPhraseRecording = () => {
      audioChunks = [];
      try {
        currentRecorder = new MediaRecorder(stream, { mimeType });
        currentRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunks.push(e.data);
          }
        };
        currentRecorder.onstop = () => {
          if (audioChunks.length > 0 && !this.isTranscribing) {
            const blob = new Blob(audioChunks, { type: mimeType });
            if (blob.size > 800) {
              this.sendSpeechPhraseToAI(blob);
            }
          }
          currentRecorder = null;
          audioChunks = [];
        };
        currentRecorder.start(250);
        clauseStartTime = Date.now();
      } catch (e) {
        console.warn('Recorder init error:', e);
      }
    };

    const stopPhraseAndSend = () => {
      if (currentRecorder && currentRecorder.state === 'recording') {
        currentRecorder.stop();
      }
    };

    const SPEECH_THRESHOLD = 7; // RMS energy threshold
    const SILENCE_TRIGGER_FRAMES = 8; // ~200ms of silence
    const MAX_CLAUSE_DURATION_MS = 2600; // max 2.6s per phrase

    const checkAudioFrame = () => {
      if (!this.isListening) return;

      this.analyser.getByteFrequencyData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < bufferLength; i++) {
        sumSquares += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sumSquares / bufferLength);
      const percent = Math.min(100, Math.round((rms / 128) * 100));

      this.audioMeterFill.style.width = `${percent}%`;
      this.meterPercentText.textContent = `${percent}%`;

      if (percent >= SPEECH_THRESHOLD) {
        this.silenceCounter = 0;
        if (!this.isSpeaking) {
          this.isSpeaking = true;
          startPhraseRecording();
        } else {
          // If phrase has been speaking continuously for MAX_CLAUSE_DURATION_MS, cut phrase cleanly!
          if (Date.now() - clauseStartTime >= MAX_CLAUSE_DURATION_MS) {
            stopPhraseAndSend();
            startPhraseRecording();
          }
        }
      } else {
        // Silence detected
        if (this.isSpeaking) {
          this.silenceCounter++;
          if (this.silenceCounter >= SILENCE_TRIGGER_FRAMES) {
            // Natural silence pause reached! Sentence/clause is finished!
            this.isSpeaking = false;
            this.silenceCounter = 0;
            stopPhraseAndSend();
          }
        }
      }

      this.meterAnimationId = requestAnimationFrame(checkAudioFrame);
    };

    checkAudioFrame();
  }

  async sendSpeechPhraseToAI(audioBlob) {
    if (!audioBlob || audioBlob.size < 700 || this.isTranscribing) return;

    this.isTranscribing = true;
    this.setStatus('active', 'AI dịch & lồng tiếng...');

    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm');
    formData.append('source_lang', this.sourceLangSelect.value);
    formData.append('dubbing', this.isDubbingEnabled ? 'true' : 'false');
    formData.append('voice', this.voiceSelect.value);

    this.activeAbortController = new AbortController();

    try {
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
        signal: this.activeAbortController.signal
      });

      const data = await response.json();

      if (!data.empty && data.original) {
        // Prevent duplicate consecutive clauses
        if (data.original.toLowerCase() !== this.lastProcessedText.toLowerCase()) {
          this.lastProcessedText = data.original;
          this.displaySubtitle(data.original, data.translated);
          const record = this.addHistory(data.original, data.translated, data.detected_lang || 'auto');

          if (this.isDubbingEnabled && data.audio_base64) {
            const mime = data.audio_mime || 'audio/mpeg';
            this.playDubbedVoice(data.audio_base64, record.id, mime);
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

  playDubbedVoice(base64Audio, historyId, mime = 'audio/mpeg') {
    this.stopAllAudio();
    this.dubbingIndicator.classList.add('active');

    const audioUrl = `data:${mime};base64,` + base64Audio;
    const item = this.history.find(h => h.id === historyId);
    if (item) item.audioBlobUrl = audioUrl;

    this.dubbingAudio.src = audioUrl;
    this.dubbingAudio.volume = parseInt(this.volumeRange.value, 10) / 100;
    this.dubbingAudio.playbackRate = parseFloat(this.rateRange.value) || 1.15;
    this.dubbingAudio.play().catch(e => console.warn('Audio play error:', e));
  }

  stopAllAudio() {
    if (this.dubbingAudio) {
      this.dubbingAudio.pause();
      this.dubbingAudio.currentTime = 0;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    this.dubbingIndicator.classList.remove('active');
  }

  stopListening() {
    this.isListening = false;
    this.isSpeaking = false;
    this.silenceCounter = 0;
    this.stopAllAudio();

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }

    if (this.meterAnimationId) {
      cancelAnimationFrame(this.meterAnimationId);
      this.meterAnimationId = null;
    }
    this.audioMeterFill.style.width = '0%';
    this.meterPercentText.textContent = '0%';

    // Reset button labels
    this.btnSystemAudioText.textContent = 'Bắt Đầu Thu Âm Hệ Thống / Tab';
    this.btnToggleSystemAudio.classList.remove('btn-danger');
    this.btnToggleSystemAudio.classList.add('btn-primary');

    this.btnMicText.textContent = 'Bật Microphone';
    this.btnToggleMic.classList.remove('btn-danger');
    this.btnToggleMic.classList.add('btn-primary');

    this.setStatus('ready', 'Sẵn sàng');
  }

  displaySubtitle(sourceText, viText) {
    // 1. Cinema View
    this.subSourceDisplay.textContent = sourceText;
    this.subViDisplay.textContent = viText;

    // 2. In-Video View
    if (this.invideoSubSource && this.invideoSubVi) {
      this.invideoSubSource.textContent = sourceText;
      this.invideoSubVi.textContent = viText;
    }

    // 3. Floating Overlay
    if (this.floatingWindow && !this.floatingWindow.closed) {
      this.floatingWindow.postMessage({
        type: 'UPDATE_SUBTITLE',
        sourceText,
        viText,
        subMode: this.currentSubMode
      }, '*');
    }
  }

  applyTransparencyUI() {
    this.cinemaBox.classList.remove('transparent-mode', 'glass-mode');
    if (this.currentTransparency === 'transparent') {
      this.cinemaBox.classList.add('transparent-mode');
      if (this.btnToggleBoxTransparent) this.btnToggleBoxTransparent.textContent = 'Tắt Trong Suốt';
    } else if (this.currentTransparency === 'glass') {
      this.cinemaBox.classList.add('glass-mode');
      if (this.btnToggleBoxTransparent) this.btnToggleBoxTransparent.textContent = 'Bật Trong Suốt';
    } else {
      if (this.btnToggleBoxTransparent) this.btnToggleBoxTransparent.textContent = 'Bật Trong Suốt';
    }

    if (this.floatingWindow && !this.floatingWindow.closed) {
      this.floatingWindow.postMessage({
        type: 'SET_TRANSPARENCY',
        mode: this.currentTransparency
      }, '*');
    }
  }

  updateSubModeUI() {
    const showSource = this.currentSubMode === 'bilingual' || this.currentSubMode === 'source_only';
    const showVi = this.currentSubMode === 'bilingual' || this.currentSubMode === 'vi_only';

    this.subSourceDisplay.style.display = showSource ? 'block' : 'none';
    this.subViDisplay.style.display = showVi ? 'block' : 'none';

    if (this.invideoSubSource) this.invideoSubSource.style.display = showSource ? 'block' : 'none';
    if (this.invideoSubVi) this.invideoSubVi.style.display = showVi ? 'block' : 'none';
  }

  setStatus(type, text) {
    this.statusBadge.className = 'status-badge ' + type;
    this.statusText.textContent = text;
  }

  // Opens a dedicated bottom ticker overlay window that NEVER paints a solid white box
  openFloatingOverlay() {
    const width = 850;
    const height = 68;
    const left = Math.round((screen.availWidth - width) / 2);
    const top = screen.availHeight - height - 30;

    const win = window.open(
      '/overlay',
      'LiveSubFloatingWindow',
      `width=${width},height=${height},top=${top},left=${left},resizable=yes,alwaysRaised=yes,scrollbars=no,toolbar=no,menubar=no,status=no`
    );

    if (!win) {
      alert('Trình duyệt đã chặn cửa sổ pop-up. Vui lòng cho phép Pop-up để mở Phụ Đề Nổi.');
      return;
    }

    this.floatingWindow = win;
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

        const voice = this.voiceSelect.value;
        const ttsRes = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: data.translated, voice })
        });
        if (ttsRes.ok) {
          const blob = await ttsRes.blob();
          const audioUrl = URL.createObjectURL(blob);
          record.audioBlobUrl = audioUrl;
          this.stopAllAudio();
          this.dubbingAudio.src = audioUrl;
          this.dubbingAudio.playbackRate = parseFloat(this.rateRange.value) || 1.15;
          this.dubbingAudio.volume = parseInt(this.volumeRange.value, 10) / 100;
          this.dubbingAudio.play();
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
    this.historyCount.textContent = this.history.length;
    this.historyEmpty.style.display = 'none';

    const itemEl = document.createElement('div');
    itemEl.className = 'history-item';
    itemEl.id = `history-${id}`;
    itemEl.innerHTML = `
      <div class="history-meta">
        <span>[${timeStr}] (${lang.toUpperCase()})</span>
        <button class="btn-play-again" data-id="${id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Nghe Lại
        </button>
      </div>
      <div class="history-source-text">${this.escapeHtml(sourceText)}</div>
      <div class="history-vi-text">${this.escapeHtml(viText)}</div>
    `;

    itemEl.querySelector('.btn-play-again').addEventListener('click', () => {
      this.playHistoryAudio(id);
    });

    this.historyList.prepend(itemEl);
    return record;
  }

  playHistoryAudio(id) {
    const item = this.history.find(h => h.id === id);
    if (item && item.audioBlobUrl) {
      const a = new Audio(item.audioBlobUrl);
      a.play();
    }
  }

  clearHistory() {
    this.history = [];
    this.historyCount.textContent = '0';
    this.historyList.innerHTML = '';
    this.historyEmpty.style.display = 'block';
    this.historyList.appendChild(this.historyEmpty);
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
      if (this.currentSubMode === 'source_only') {
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

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => {
      switch (m) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#039;';
        default: return m;
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new LiveDubStudio();
});
