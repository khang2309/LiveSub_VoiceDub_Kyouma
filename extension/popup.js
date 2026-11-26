// LiveSub Studio Extension - Popup Controller
// Version 1.2.0 - Standalone UI & Desktop Bridge

(function () {
  'use strict';

  const chkMasterDub = document.getElementById('chkMasterDub');
  const selVoice = document.getElementById('selVoice');
  const selSubMode = document.getElementById('selSubMode');
  const selDucking = document.getElementById('selDucking');
  const chkSyncSpeed = document.getElementById('chkSyncSpeed');
  const chkShowWidget = document.getElementById('chkShowWidget');
  const rngFontSize = document.getElementById('rngFontSize');
  const lblFontSize = document.getElementById('lblFontSize');
  const statusDot = document.getElementById('statusDot');
  const statusLabel = document.getElementById('statusLabel');
  const statusBanner = document.getElementById('statusBanner');
  const bannerTitle = document.getElementById('bannerTitle');
  const bannerDesc = document.getElementById('bannerDesc');
  const btnTestVoice = document.getElementById('btnTestVoice');
  const btnOpenStudio = document.getElementById('btnOpenStudio');
  const appModal = document.getElementById('appModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnModalUnderstood = document.getElementById('btnModalUnderstood');
  const btnModalForceOpen = document.getElementById('btnModalForceOpen');

  let isLocalEngineOnline = false;

  // Default configuration
  const DEFAULT_CONFIG = {
    isDubbingActive: true,
    voice: 'vi-VN-Standard',
    subMode: 'vi_only',
    duckPercent: 10,
    syncSpeed: true,
    ocrScan: false,
    showFloatingWidget: false, // Default FALSE: keeps video clean
    fontSize: 26
  };

  // 1. Load settings from chrome.storage.local
  function loadSettings() {
    chrome.storage.local.get(DEFAULT_CONFIG, (items) => {
      chkMasterDub.checked = items.isDubbingActive;
      selVoice.value = items.voice || 'vi-VN-Standard';
      selSubMode.value = items.subMode || 'vi_only';
      selDucking.value = String(items.duckPercent !== undefined ? items.duckPercent : 10);
      chkSyncSpeed.checked = Boolean(items.syncSpeed);
      if (chkShowWidget) chkShowWidget.checked = Boolean(items.showFloatingWidget);
      rngFontSize.value = items.fontSize || 26;
      lblFontSize.textContent = `${rngFontSize.value}px`;
    });
  }

  // 2. Save settings and notify active tab
  function saveSettings() {
    const config = {
      isDubbingActive: chkMasterDub.checked,
      voice: selVoice.value,
      subMode: selSubMode.value,
      duckPercent: parseInt(selDucking.value, 10),
      syncSpeed: chkSyncSpeed.checked,
      showFloatingWidget: chkShowWidget ? chkShowWidget.checked : false,
      fontSize: parseInt(rngFontSize.value, 10)
    };

    chrome.storage.local.set(config, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'LIVESUB_CONFIG_UPDATED',
            config
          }).catch(() => {});
        }
      });
    });
  }

  // 3. Ping local LiveSub Engine (Port 3000)
  async function checkLocalEngine() {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 600);
      const res = await fetch('http://localhost:3000/api/health', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(tid);
      if (res && res.ok) {
        isLocalEngineOnline = true;
        statusDot.className = 'status-dot online';
        statusLabel.textContent = 'LiveSub Desktop (3000)';
        statusLabel.style.color = '#86efac';
        bannerTitle.textContent = 'Đã kết nối LiveSub Desktop';
        bannerDesc.textContent = 'Đang sử dụng trọn bộ động cơ VieNeu-TTS Offline và Quét chữ Video OCR hiệu năng cao.';
        statusBanner.classList.add('desktop-connected');
        return;
      }
    } catch (_) {}

    // Standalone mode is fully functional and ready
    isLocalEngineOnline = false;
    statusDot.className = 'status-dot standalone';
    statusLabel.textContent = 'Chế Độ Độc Lập';
    statusLabel.style.color = '#38bdf8';
    bannerTitle.textContent = 'Tiện ích hoạt động Độc Lập';
    bannerDesc.textContent = 'Tự động nhận diện phụ đề trên YouTube, Netflix, Web phim và lồng tiếng trực tiếp bằng AI.';
    statusBanner.classList.remove('desktop-connected');
  }

  // 4. Test Voice
  function testVoice() {
    const testSample = 'Chào bạn! LiveSub Studio đã sẵn sàng lồng tiếng cho mọi video!';
    btnTestVoice.disabled = true;
    btnTestVoice.textContent = '⏳ Đang phát...';

    // First try browser SpeechSynthesis (instant 0ms)
    try {
      if (typeof window.speechSynthesis !== 'undefined') {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(testSample);
        u.lang = 'vi-VN';
        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
          const vi = voices.find(v => v.lang === 'vi-VN' || v.lang.startsWith('vi'));
          if (vi) u.voice = vi;
        }
        u.onend = () => {
          btnTestVoice.disabled = false;
          btnTestVoice.textContent = '🔊 Thử Giọng';
        };
        u.onerror = () => {
          btnTestVoice.disabled = false;
          btnTestVoice.textContent = '🔊 Thử Giọng';
        };
        window.speechSynthesis.speak(u);
        return;
      }
    } catch (_) {}

    btnTestVoice.disabled = false;
    btnTestVoice.textContent = '🔊 Thử Giọng';
  }

  // Bind Events
  chkMasterDub.addEventListener('change', saveSettings);
  selVoice.addEventListener('change', saveSettings);
  selSubMode.addEventListener('change', saveSettings);
  selDucking.addEventListener('change', saveSettings);
  chkSyncSpeed.addEventListener('change', saveSettings);
  if (chkShowWidget) chkShowWidget.addEventListener('change', saveSettings);

  rngFontSize.addEventListener('input', () => {
    lblFontSize.textContent = `${rngFontSize.value}px`;
    saveSettings();
  });

  btnTestVoice.addEventListener('click', testVoice);

  // Desktop App Button Handler: Show friendly modal if app is not running
  btnOpenStudio.addEventListener('click', () => {
    if (isLocalEngineOnline) {
      chrome.tabs.create({ url: 'http://localhost:3000' });
    } else {
      appModal.style.display = 'flex';
    }
  });

  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => {
      appModal.style.display = 'none';
    });
  }

  if (btnModalUnderstood) {
    btnModalUnderstood.addEventListener('click', () => {
      appModal.style.display = 'none';
    });
  }

  if (btnModalForceOpen) {
    btnModalForceOpen.addEventListener('click', () => {
      appModal.style.display = 'none';
      chrome.tabs.create({ url: 'http://localhost:3000' });
    });
  }

  // Initialize
  loadSettings();
  checkLocalEngine();

  // Periodic status poll
  setInterval(checkLocalEngine, 4000);
})();
