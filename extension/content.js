// LiveSub AI Dubber - YouTube Content Script
// Perfect sync with YouTube video timeline, auto-ducking to prevent voice clashing, in-video transparent subtitle display.

(function () {
  'use strict';

  let isDubbingActive = true;
  let currentVoice = 'vi-VN-HoaiMyNeural';
  let duckVolumePercent = 10; // YouTube volume drops to 10% while dubbing
  let userOriginalVolume = 1.0;
  let currentAudio = null;
  let lastCaptionText = '';
  let captionDebounceTimer = null;
  let captionObserver = null;
  let subClearTimer = null;

  // In-memory cache for audio
  const dubCache = new Map();

  function getVideoElement() {
    return document.querySelector('video');
  }

  // Display In-Video Transparent Subtitle right on top of YouTube Player
  function showInVideoSubtitle(text) {
    let container = document.getElementById('livesub-invideo-sub');
    if (!container) {
      container = document.createElement('div');
      container.id = 'livesub-invideo-sub';
      container.style.cssText = `
        position: absolute;
        bottom: 60px;
        left: 0;
        width: 100%;
        text-align: center;
        z-index: 99999999;
        pointer-events: none;
        user-select: none;
      `;
      const player = document.querySelector('.html5-video-player') || document.body;
      player.appendChild(container);
    }

    container.innerHTML = `
      <span style="
        display: inline-block;
        background: rgba(0, 0, 0, 0.6);
        color: #facc15;
        font-size: 26px;
        font-weight: 800;
        padding: 5px 16px;
        border-radius: 8px;
        -webkit-text-stroke: 1.4px #000;
        text-shadow: 0 2px 8px #000;
        max-width: 85%;
        line-height: 1.35;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      ">${escapeHtml(text)}</span>
    `;

    clearTimeout(subClearTimer);
    subClearTimer = setTimeout(() => {
      if (container) container.innerHTML = '';
    }, 6000);
  }

  function clearInVideoSubtitle() {
    const container = document.getElementById('livesub-invideo-sub');
    if (container) container.innerHTML = '';
    clearTimeout(subClearTimer);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
  }

  // Create Sleek Draggable Control Badge on YouTube
  function createDubberWidget() {
    if (document.getElementById('livesub-yt-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'livesub-yt-widget';
    widget.innerHTML = `
      <div class="livesub-header">
        <span class="livesub-dot"></span>
        <span class="livesub-title">LiveSub AI Dubbing</span>
        <button id="livesub-toggle-btn" class="livesub-toggle ${isDubbingActive ? 'active' : ''}">
          ${isDubbingActive ? 'BẬT' : 'TẮT'}
        </button>
      </div>
      <div class="livesub-body" id="livesub-body">
        <div class="livesub-row">
          <label>Giọng đọc thật:</label>
          <select id="livesub-voice-select">
            <option value="vi-VN-HoaiMyNeural" selected>Hoài My (Nữ Microsoft)</option>
            <option value="google-vi">Google Voice Tiếng Việt</option>
            <option value="vi-VN-NamMinhNeural">Nam Minh (Nam Microsoft)</option>
            <option value="piper-vi">Piper Neural Offline</option>
          </select>
        </div>
        <div class="livesub-row">
          <label>Tiếng video gốc khi lồng:</label>
          <select id="livesub-duck-select">
            <option value="10" selected>Giảm xuống 10% (Chống lẫn giọng)</option>
            <option value="0">Tắt hẳn tiếng gốc (0%)</option>
            <option value="25">Giảm xuống 25%</option>
            <option value="100">Giữ nguyên (100%)</option>
          </select>
        </div>
        <div class="livesub-status" id="livesub-status">Đang chờ phụ đề YouTube (Bật nút CC)...</div>
      </div>
    `;

    document.body.appendChild(widget);

    // Bind UI actions
    const toggleBtn = widget.querySelector('#livesub-toggle-btn');
    const voiceSelect = widget.querySelector('#livesub-voice-select');
    const duckSelect = widget.querySelector('#livesub-duck-select');

    toggleBtn.addEventListener('click', () => {
      isDubbingActive = !isDubbingActive;
      toggleBtn.textContent = isDubbingActive ? 'BẬT' : 'TẮT';
      toggleBtn.classList.toggle('active', isDubbingActive);
      if (!isDubbingActive) {
        stopCurrentAudio();
        clearInVideoSubtitle();
        restoreVideoVolume();
        updateStatus('Đã tạm dừng thuyết minh');
      } else {
        updateStatus('Đang chờ phụ đề (Bật CC)...');
      }
    });

    voiceSelect.addEventListener('change', (e) => {
      currentVoice = e.target.value;
    });

    duckSelect.addEventListener('change', (e) => {
      duckVolumePercent = parseInt(e.target.value, 10);
    });

    // Toggle shortcut: Alt + D
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'd' || e.key === 'D')) {
        toggleBtn.click();
      }
    });
  }

  function updateStatus(text) {
    const el = document.getElementById('livesub-status');
    if (el) el.textContent = text;
  }

  function stopCurrentAudio() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
  }

  function duckVideoVolume() {
    const video = getVideoElement();
    if (!video) return;
    if (userOriginalVolume === null || userOriginalVolume === undefined) {
      userOriginalVolume = video.volume;
    }
    const targetVolume = (duckVolumePercent / 100) * (userOriginalVolume > 0 ? userOriginalVolume : 1.0);
    video.volume = Math.max(0, Math.min(1.0, targetVolume));
  }

  function restoreVideoVolume() {
    const video = getVideoElement();
    if (video && userOriginalVolume !== null) {
      video.volume = userOriginalVolume;
    }
  }

  function handleCaptionUpdate(text) {
    if (!isDubbingActive) return;
    const cleanText = text.replace(/\[.*?\]|\(.*?\)|♪+|♫+/g, '').trim();
    if (!cleanText || cleanText.length < 2 || cleanText === lastCaptionText) return;

    lastCaptionText = cleanText;
    updateStatus(`🎙️ Đang đọc: "${cleanText.substring(0, 30)}..."`);

    // Check cache
    const cacheKey = `${currentVoice}:${cleanText}`;
    if (dubCache.has(cacheKey)) {
      const cached = dubCache.get(cacheKey);
      showInVideoSubtitle(cached.translated || cleanText);
      playDubbedAudio(cached.audioUrl);
      return;
    }

    // Call local server
    fetch('http://localhost:3000/api/dub-subtitle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanText,
        voice: currentVoice
      })
    })
      .then(res => res.json())
      .then(data => {
        if (!isDubbingActive) return;
        const displayText = data.translated || cleanText;
        showInVideoSubtitle(displayText);

        if (data.audio_base64) {
          const mime = data.audio_mime || 'audio/mpeg';
          const audioUrl = `data:${mime};base64,` + data.audio_base64;
          dubCache.set(cacheKey, { audioUrl, translated: displayText });
          playDubbedAudio(audioUrl);
        }
      })
      .catch(err => {
        console.warn('LiveSub extension fetch error:', err);
        updateStatus('⚠️ Không kết nối được http://localhost:3000');
      });
  }

  function playDubbedAudio(audioUrl) {
    const video = getVideoElement();
    if (video && video.paused) return; // Do not play if user paused video!

    stopCurrentAudio();
    duckVideoVolume();

    currentAudio = new Audio(audioUrl);
    currentAudio.playbackRate = 1.15;

    currentAudio.onended = () => {
      restoreVideoVolume();
      currentAudio = null;
    };

    currentAudio.onerror = () => {
      restoreVideoVolume();
      currentAudio = null;
    };

    currentAudio.play().catch(e => {
      console.warn('Audio play error:', e);
      restoreVideoVolume();
    });
  }

  // Hook into video player timeline
  function setupVideoEventListeners() {
    const video = getVideoElement();
    if (!video) {
      setTimeout(setupVideoEventListeners, 1000);
      return;
    }

    // Save initial user volume
    if (video.volume > 0) {
      userOriginalVolume = video.volume;
    }

    // 1. Dừng video -> Dừng lồng tiếng lập tức!
    video.addEventListener('pause', () => {
      if (currentAudio) {
        currentAudio.pause();
      }
      restoreVideoVolume();
    });

    // 2. Tiếp tục phát -> Tiếp tục lồng tiếng
    video.addEventListener('play', () => {
      if (currentAudio && isDubbingActive) {
        duckVideoVolume();
        currentAudio.play().catch(() => {});
      }
    });

    // 3. Tua video (seek) -> Hủy bỏ âm thanh cũ lập tức!
    video.addEventListener('seeking', () => {
      stopCurrentAudio();
      clearInVideoSubtitle();
      restoreVideoVolume();
      lastCaptionText = '';
    });
  }

  // Observe YouTube Caption DOM (.ytp-caption-segment)
  function setupCaptionObserver() {
    if (captionObserver) captionObserver.disconnect();

    const targetContainer = document.querySelector('.ytp-caption-window-container') || document.body;

    captionObserver = new MutationObserver(() => {
      const segments = document.querySelectorAll('.ytp-caption-segment');
      if (segments.length > 0) {
        const fullText = Array.from(segments).map(s => s.textContent).join(' ').trim();
        if (fullText) {
          clearTimeout(captionDebounceTimer);
          captionDebounceTimer = setTimeout(() => {
            handleCaptionUpdate(fullText);
          }, 60);
        }
      }
    });

    captionObserver.observe(targetContainer, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  // Init when page is ready
  function init() {
    createDubberWidget();
    setupVideoEventListeners();
    setupCaptionObserver();

    // Re-check periodically for single-page YouTube navigations
    setInterval(() => {
      createDubberWidget();
      const video = getVideoElement();
      if (video && !video.dataset.livesubHooked) {
        video.dataset.livesubHooked = 'true';
        setupVideoEventListeners();
        setupCaptionObserver();
      }
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
