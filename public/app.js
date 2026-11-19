// LiveSub & VoiceDub AI Studio - Professional Realtime Universal Engine

class LiveDubStudio {
  constructor() {
    this.activeSource = 'system'; // 'system' | 'local' | 'mic' | 'weburl'
    this.isListening = false;
    this.mediaStream = null;
    this.audioContext = null;
    this.mediaStreamSource = null; // Stored to prevent V8 GC!
    this.scriptNode = null;
    this.currentActiveAudioSource = null;

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
    this.fontSizePx = 26;
    this.floatingWindow = null;

    // YouTube Subtitle Sync Engine
    this.ytPlayer = null;
    this.ytSegments = [];
    this.ytSyncInterval = null;
    this.currentYtSegmentIdx = -1;
    this.originalYtVol = null;

    // History
    this.history = [];

    this.initElements();
    this.restorePreferences();
    this.bindEvents();
    this.updateSubModeUI();
    this.applyTransparencyUI();
  }

  restorePreferences() {
    const savedVoice = localStorage.getItem('livesub_voice');
    if (savedVoice && this.voiceSelect) {
      this.voiceSelect.value = savedVoice;
    }
    const savedLang = localStorage.getItem('livesub_sourcelang');
    if (savedLang && this.sourceLangSelect) {
      this.sourceLangSelect.value = savedLang;
    }
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
    this.webVideoTitle = document.getElementById('webVideoTitle');
    this.btnWebLiveCapture = document.getElementById('btnWebLiveCapture');
    this.btnCloseWebVideo = document.getElementById('btnCloseWebVideo');
    this.invideoWebSubVi = document.getElementById('invideoWebSubVi');
    this.invideoWebSubSource = document.getElementById('invideoWebSubSource');
    this.webSyncNotice = document.getElementById('webSyncNotice');
    this.sampleLinks = document.querySelectorAll('.btn-sample-link');
    this.btnTestSpeaker = document.getElementById('btnTestSpeaker');

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

    // Toast element
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'studio-toast';
    document.body.appendChild(this.toastEl);
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

    // Local Video Events
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
    if (this.btnCloseWebVideo) {
      this.btnCloseWebVideo.addEventListener('click', () => {
        if (this.ytSyncInterval) {
          clearInterval(this.ytSyncInterval);
          this.ytSyncInterval = null;
        }
        if (this.ytPlayer && typeof this.ytPlayer.stopVideo === 'function') {
          this.ytPlayer.stopVideo();
        }
        if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = '';
        if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = '';
        this.webVideoContainer.style.display = 'none';
        this.stopAllAudio();
      });
    }

    // Speaker Test Button
    if (this.btnTestSpeaker) {
      this.btnTestSpeaker.addEventListener('click', () => this.testSpeaker());
    }

    // 6. Voice & Language Change Feedback
    if (this.voiceSelect) {
      this.voiceSelect.addEventListener('change', () => {
        const name = this.voiceSelect.selectedOptions[0].text;
        localStorage.setItem('livesub_voice', this.voiceSelect.value);
        this.showToast(`🎙️ Đã chọn giọng: ${name}`);
        this.auditionSelectedVoice();
      });
    }
    if (this.sourceLangSelect) {
      this.sourceLangSelect.addEventListener('change', () => {
        const name = this.sourceLangSelect.selectedOptions[0].text;
        localStorage.setItem('livesub_sourcelang', this.sourceLangSelect.value);
        this.showToast(`🌐 Đã chọn ngôn ngữ gốc: ${name}`);
      });
    }
        const name = this.sourceLangSelect.selectedOptions[0].text;
        this.showToast(`🌐 Đã chọn ngôn ngữ gốc: ${name}`);
      });
    }

    // 7. Voice Audition Button
    if (this.btnTestVoiceSample) {
      this.btnTestVoiceSample.addEventListener('click', () => this.auditionSelectedVoice());
    }

    // 8. Sliders & Radios
    if (this.rateRange) {
      this.rateRange.addEventListener('input', (e) => {
        this.rateValue.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
      });
      this.rateRange.addEventListener('change', () => {
        this.showToast(`⚡ Tốc độ đọc: ${this.rateRange.value}x`);
      });
    }
    if (this.volumeRange) {
      this.volumeRange.addEventListener('input', (e) => {
        const vol = parseInt(e.target.value, 10);
        this.volumeValue.textContent = `${vol}%`;
      });
      this.volumeRange.addEventListener('change', () => {
        this.showToast(`🔊 Âm lượng: ${this.volumeRange.value}%`);
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

    // 9. Subtitle Font Sizing
    this.btnSubtitleFontPlus.addEventListener('click', () => {
      this.fontSizePx = Math.min(52, this.fontSizePx + 2);
      document.documentElement.style.setProperty('--sub-font-size', `${this.fontSizePx}px`);
    });
    this.btnSubtitleFontMinus.addEventListener('click', () => {
      this.fontSizePx = Math.max(16, this.fontSizePx - 2);
      document.documentElement.style.setProperty('--sub-font-size', `${this.fontSizePx}px`);
    });

    // 10. Panic Kill Switch
    this.btnPanicKill.addEventListener('click', () => {
      this.stopAllAudio();
      this.subSourceDisplay.textContent = '';
      this.subViDisplay.textContent = 'Đã dừng và làm sạch âm thanh.';
      this.showToast('🛑 Đã dừng âm thanh khẩn cấp');
    });

    // 11. Floating Window
    this.btnFloatingWindow.addEventListener('click', () => this.openFloatingOverlay());

    // 12. Quick Test Text
    this.btnSendTestText.addEventListener('click', () => this.handleTestText());
    this.testTextInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleTestText();
    });

    // 13. History Actions
    this.btnExportSRT.addEventListener('click', () => this.exportSRT());
    this.btnExportTXT.addEventListener('click', () => this.exportTXT());
    this.btnClearHistory.addEventListener('click', () => this.clearHistory());
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
    this.showToast(`🔊 Đang phát giọng: ${this.voiceSelect.selectedOptions[0].text}`);

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
    this.showToast('🔊 Đang kiểm tra âm thanh loa máy tính...');
    const voice = this.voiceSelect ? this.voiceSelect.value : 'vi-VN-HoaiMyNeural';
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
        this.showToast('✅ Loa hoạt động hoàn hảo!');
      } else {
        this.showToast('⚠️ Lỗi kiểm tra loa từ máy chủ');
      }
    } catch (e) {
      this.showToast('⚠️ Không thể phát âm thanh: ' + e.message);
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

      this.showToast('🟢 Đã kết nối âm thanh hệ thống! Hãy phát video để nghe lồng tiếng.');
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
    this.showToast(`📁 Đã nạp file: ${file.name}`);
  }

  async startLocalVideoDubbing() {
    this.stopListening();
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const sourceNode = this.audioContext.createMediaElementSource(this.localVideoPlayer);
      const destination = this.audioContext.createMediaStreamDestination();
      
      sourceNode.connect(this.audioContext.destination);
      sourceNode.connect(destination);

      await this.setupVADAndRecording(destination.stream);
      this.localVideoPlayer.play();
      this.btnStartLocalDubbing.textContent = 'Đang Thuyết Minh...';
      this.showToast('🎬 Đang phát video và thuyết minh realtime!');
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

      this.showToast('🎤 Đang lắng nghe qua Microphone!');
      await this.setupVADAndRecording(this.mediaStream);
    } catch (err) {
      alert('Không thể mở Microphone: ' + err.message);
    }
  }

  // --- SOURCE 4: WEB URL (YOUTUBE WITH MILLISECOND SUBTITLE & VOICE DUB) ---
  async loadWebVideo(customUrl = null) {
    const val = (customUrl || this.webUrlInput.value).trim();
    if (!val) return;
    this.webUrlInput.value = val;

    const match = val.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (!match || !match[1]) {
      alert('Vui lòng nhập link video YouTube hợp lệ (VD: https://www.youtube.com/watch?v=q6fgVVmdpgY).');
      return;
    }
    const videoId = match[1];

    this.webVideoContainer.style.display = 'block';
    this.webVideoContainer.scrollIntoView({ behavior: 'smooth' });
    this.webSyncNotice.className = 'web-sync-notice show';
    this.webSyncNotice.innerHTML = '⏳ Đang kết nối video và tải phụ đề gốc & kịch bản dịch chuẩn...';

    // 1. Fetch YouTube Subtitles from Backend
    this.ytSegments = [];
    this.currentYtSegmentIdx = -1;

    try {
      const res = await fetch('/api/youtube-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: val, target_lang: 'vi' })
      });
      const data = await res.json();
      if (data.success && data.segments && data.segments.length > 0) {
        this.ytSegments = data.segments;
        if (data.title) this.webVideoTitle.textContent = data.title;
        this.webSyncNotice.innerHTML = `✅ <strong>Đã đồng bộ ${data.segments.length} câu thoại chuẩn xác 100%!</strong> Hãy bấm ▶️ Play trên video để thưởng thức thuyết minh chuẩn mili-giây.`;
        this.showToast(`🎬 Đã nạp ${data.segments.length} câu thoại phụ đề từ video!`);
      } else {
        this.webSyncNotice.innerHTML = `ℹ️ ${data.error || 'Video không có phụ đề sẵn'}. Hãy bấm nút <strong>"🎙️ Bắt Âm Thanh Tab"</strong> để Whisper GPU nghe và dịch trực tiếp!`;
      }
    } catch (e) {
      console.warn('Subtitles fetch error:', e);
      this.webSyncNotice.innerHTML = 'ℹ️ Bấm nút "🎙️ Bắt Âm Thanh Tab" để Whisper GPU nghe và dịch trực tiếp!';
    }

    // 2. Initialize YouTube Player
    this.initOrUpdateYouTubePlayer(videoId);
  }

  initOrUpdateYouTubePlayer(videoId) {
    if (this.ytSyncInterval) {
      clearInterval(this.ytSyncInterval);
      this.ytSyncInterval = null;
    }

    const onPlayerReady = () => {
      this.startXTSync();
    };

    const onPlayerStateChange = (event) => {
      // YT.PlayerState.PAUSED = 2, ENDED = 0
      if (event.data === 2 || event.data === 0) {
        this.stopAllAudio();
      }
    };

    if (window.YT && window.YT.Player) {
      if (this.ytPlayer && typeof this.ytPlayer.loadVideoById === 'function') {
        this.ytPlayer.loadVideoById(videoId);
      } else {
        document.getElementById('webVideoPlayer').innerHTML = '';
        this.ytPlayer = new window.YT.Player('webVideoPlayer', {
          height: '420',
          width: '100%',
          videoId: videoId,
          playerVars: {
            autoplay: 1,
            enablejsapi: 1,
            modestbranding: 1,
            rel: 0
          },
          events: {
            onReady: onPlayerReady,
            onStateChange: onPlayerStateChange
          }
        });
      }
    } else {
      setTimeout(() => this.initOrUpdateYouTubePlayer(videoId), 400);
    }
  }

  startXTSync() {
    if (this.ytSyncInterval) clearInterval(this.ytSyncInterval);

    this.ytSyncInterval = setInterval(async () => {
      if (!this.ytPlayer || typeof this.ytPlayer.getCurrentTime !== 'function') return;

      const playerState = this.ytPlayer.getPlayerState ? this.ytPlayer.getPlayerState() : -1;
      if (playerState !== 1) { // Only when playing
        return;
      }

      const curTime = this.ytPlayer.getCurrentTime();
      if (!this.ytSegments || this.ytSegments.length === 0) return;

      const idx = this.ytSegments.findIndex(s => curTime >= s.start && curTime <= s.end);

      if (idx !== -1 && idx !== this.currentYtSegmentIdx) {
        this.currentYtSegmentIdx = idx;
        const seg = this.ytSegments[idx];

        // 1. In-video Subtitle (100% Transparent, No black borders, Cinema yellow font)
        if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = seg.translated;
        if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = seg.original;

        // 2. Cinema View
        this.displaySubtitle(seg.original, seg.translated);
        const record = this.addHistory(seg.original, seg.translated, 'cc');

        // 3. Dubbing Audio
        if (this.isDubbingEnabled) {
          try {
            if (this.ytPlayer.getVolume && this.originalYtVol === null) {
              this.originalYtVol = this.ytPlayer.getVolume();
            }
            if (this.ytPlayer.setVolume) this.ytPlayer.setVolume(12);

            const res = await fetch('/api/dub-subtitle', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                text: seg.translated, 
                voice: this.voiceSelect ? this.voiceSelect.value : 'vi-VN-HoaiMyNeural' 
              })
            });
            const data = await res.json();
            if (data.audio_base64) {
              await this.playBase64Audio(data.audio_base64, record.id, data.audio_mime || 'audio/mpeg');
            }
          } catch (err) {
            console.warn('Dubbing error:', err);
          } finally {
            if (this.ytPlayer && this.ytPlayer.setVolume && this.originalYtVol !== null) {
              setTimeout(() => {
                if (this.ytPlayer && this.ytPlayer.setVolume && !this.currentActiveAudioSource) {
                  this.ytPlayer.setVolume(this.originalYtVol || 100);
                }
              }, 1200);
            }
          }
        }
      } else if (idx === -1) {
        const isNearAny = this.ytSegments.some(s => curTime >= (s.start - 0.2) && curTime <= (s.end + 0.4));
        if (!isNearAny) {
          if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = '';
          if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = '';
        }
      }
    }, 70);
  }

  // =========================================================================
  // CONTINUOUS 16kHz MONO WAV CHUNKING ENGINE (RTX 3050 GPU OPTIMIZED)
  // Never drops speech syllables, resamples to 16kHz for instant GPU Whisper!
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

    const triggerSendClause = () => {
      // Collect at least 0.4s of audio (~4 blocks at 48k)
      const minBlocks = Math.max(3, Math.round((0.4 * sampleRate) / 4096));
      if (this.pcmBuffers.length < minBlocks || this.currentChunkMaxRms < 0.0002) {
        this.pcmBuffers = [];
        this.currentChunkMaxRms = 0;
        this.consecutiveQuietBlocks = 0;
        return;
      }

      const wavBlob = this.encodeWAV16k(this.pcmBuffers, sampleRate);
      this.pcmBuffers = [];
      this.currentChunkMaxRms = 0;
      this.consecutiveQuietBlocks = 0;

      if (wavBlob && wavBlob.size > 800) {
        this.sendSpeechPhraseToAI(wavBlob);
      }
    };

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

      // 2. Buffer Continuous Audio
      this.pcmBuffers.push(new Float32Array(input));
      if (rms > this.currentChunkMaxRms) {
        this.currentChunkMaxRms = rms;
      }

      if (rms < 0.003) {
        this.consecutiveQuietBlocks++;
      } else {
        this.consecutiveQuietBlocks = 0;
      }

      // Max duration: 1.6s -> trigger immediately to Whisper GPU!
      const maxBlocks = Math.round((1.6 * sampleRate) / 4096);
      if (this.pcmBuffers.length >= maxBlocks) {
        triggerSendClause();
      } 
      // Early natural pause trigger: after at least 0.7s of audio and 2 quiet blocks
      else if (this.pcmBuffers.length >= Math.round((0.7 * sampleRate) / 4096) && this.consecutiveQuietBlocks >= 2 && this.currentChunkMaxRms >= 0.001) {
        triggerSendClause();
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
    if (!audioBlob || audioBlob.size < 1000 || this.isTranscribing) return;

    this.isTranscribing = true;
    this.setStatus('active', 'AI nhận diện GPU & dịch...');

    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.wav');
    formData.append('source_lang', this.sourceLangSelect ? this.sourceLangSelect.value : 'auto');
    formData.append('dubbing', this.isDubbingEnabled ? 'true' : 'false');
    formData.append('voice', this.voiceSelect ? this.voiceSelect.value : 'vi-VN-HoaiMyNeural');

    this.activeAbortController = new AbortController();

    try {
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
        signal: this.activeAbortController.signal
      });

      const data = await response.json();

      if (!data.empty && data.original) {
        if (data.original.toLowerCase() !== this.lastProcessedText.toLowerCase()) {
          this.lastProcessedText = data.original;
          this.displaySubtitle(data.original, data.translated);
          if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = data.translated;
          if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = data.original;
          const record = this.addHistory(data.original, data.translated, data.detected_lang || 'auto');

          if (this.isDubbingEnabled && data.audio_base64) {
            await this.playBase64Audio(data.audio_base64, record.id, data.audio_mime || 'audio/mpeg');
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

  // Unblockable Web Audio API buffer playback
  async playBase64Audio(base64Audio, historyId, mime = 'audio/mpeg') {
    this.stopAllAudio();
    this.dubbingIndicator.classList.add('active');

    try {
      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer.slice(0));
      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.playbackRate.value = parseFloat(this.rateRange.value) || 1.15;

      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = (parseInt(this.volumeRange.value, 10) || 100) / 100;

      sourceNode.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      this.currentActiveAudioSource = sourceNode;
      sourceNode.onended = () => {
        this.dubbingIndicator.classList.remove('active');
        this.currentActiveAudioSource = null;
      };
      sourceNode.start(0);

      const item = this.history.find(h => h.id === historyId);
      if (item) item.audioBlobUrl = `data:${mime};base64,` + base64Audio;
    } catch (err) {
      console.warn('Web Audio API playback fallback to HTML5 Audio:', err);
      const audioUrl = `data:${mime};base64,` + base64Audio;
      this.dubbingAudio.src = audioUrl;
      this.dubbingAudio.volume = parseInt(this.volumeRange.value, 10) / 100;
      this.dubbingAudio.playbackRate = parseFloat(this.rateRange.value) || 1.15;
      this.dubbingAudio.play().catch(e => console.warn('HTML5 audio play error:', e));
    }
  }

  async playAudioBuffer(arrayBuffer) {
    this.stopAllAudio();
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.playbackRate.value = parseFloat(this.rateRange.value) || 1.15;

      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = (parseInt(this.volumeRange.value, 10) || 100) / 100;

      sourceNode.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      this.currentActiveAudioSource = sourceNode;
      sourceNode.onended = () => {
        this.currentActiveAudioSource = null;
      };
      sourceNode.start(0);
    } catch (e) {
      console.warn('playAudioBuffer error:', e);
    }
  }

  stopAllAudio() {
    if (this.currentActiveAudioSource) {
      try {
        this.currentActiveAudioSource.stop();
      } catch (e) {}
      this.currentActiveAudioSource = null;
    }
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
    this.silenceFrames = 0;
    this.pcmBuffers = [];
    this.stopAllAudio();

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

    this.btnSystemAudioText.textContent = 'Bắt Đầu Thu Âm Hệ Thống / Tab';
    this.btnToggleSystemAudio.classList.remove('btn-danger');
    this.btnToggleSystemAudio.classList.add('btn-primary');

    this.btnMicText.textContent = 'Bật Microphone';
    this.btnToggleMic.classList.remove('btn-danger');
    this.btnToggleMic.classList.add('btn-primary');

    this.setStatus('ready', 'Sẵn sàng');
  }

  displaySubtitle(sourceText, viText) {
    this.subSourceDisplay.textContent = sourceText;
    this.subViDisplay.textContent = viText;

    if (this.invideoSubSource && this.invideoSubVi) {
      this.invideoSubSource.textContent = sourceText;
      this.invideoSubVi.textContent = viText;
    }

    const payload = {
      type: 'UPDATE_SUBTITLE',
      sourceText,
      viText,
      subMode: this.currentSubMode
    };

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

  // Opens ultra-slim, borderless bottom overlay window
  openFloatingOverlay() {
    const width = 760;
    const height = 55;
    const left = Math.round((screen.availWidth - width) / 2);
    const top = screen.availHeight - height - 35;

    const win = window.open(
      '/overlay',
      'LiveSubFloatingWindow',
      `width=${width},height=${height},top=${top},left=${left},resizable=yes,alwaysRaised=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`
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
        default: return m;
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new LiveDubStudio();
});
