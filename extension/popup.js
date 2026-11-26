// LiveSub Studio Extension - Popup Controller

(function () {
  'use strict';

  const chkMasterDub = document.getElementById('chkMasterDub');
  const selVoice = document.getElementById('selVoice');
  const selSubMode = document.getElementById('selSubMode');
  const selDucking = document.getElementById('selDucking');
  const chkSyncSpeed = document.getElementById('chkSyncSpeed');
  const chkOcrScan = document.getElementById('chkOcrScan');
  const rngFontSize = document.getElementById('rngFontSize');
  const lblFontSize = document.getElementById('lblFontSize');
  const engineStatus = document.getElementById('engineStatus');
  const statusDot = document.getElementById('statusDot');
  const statusLabel = document.getElementById('statusLabel');
  const btnTestVoice = document.getElementById('btnTestVoice');
  const btnOpenStudio = document.getElementById('btnOpenStudio');

  // Default configuration
  const DEFAULT_CONFIG = {
    isDubbingActive: true,
    voice: 'Trúc Ly',
    subMode: 'vi_only',
    duckPercent: 10,
    syncSpeed: true,
    ocrScan: true,
    fontSize: 26
  };

  // 1. Load settings from chrome.storage.local
  function loadSettings() {
    chrome.storage.local.get(DEFAULT_CONFIG, (items) => {
      chkMasterDub.checked = items.isDubbingActive;
      selVoice.value = items.voice || 'Trúc Ly';
      selSubMode.value = items.subMode || 'vi_only';
      selDucking.value = String(items.duckPercent !== undefined ? items.duckPercent : 10);
      chkSyncSpeed.checked = Boolean(items.syncSpeed);
      chkOcrScan.checked = Boolean(items.ocrScan);
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
      ocrScan: chkOcrScan.checked,
      fontSize: parseInt(rngFontSize.value, 10)
    };

    chrome.storage.local.set(config, () => {
      // Broadcast to current active tab
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
      const res = await fetch('http://localhost:3000/api/pipeline-status', {
        method: 'GET',
        cache: 'no-store'
      });
      if (res && res.ok) {
        statusDot.className = 'status-dot online';
        statusLabel.textContent = 'Native Pure Rust (3000)';
        statusLabel.style.color = '#86efac';
        return;
      }
    } catch (_) {}

    // Fallback: check /api/health
    try {
      const res = await fetch('http://localhost:3000/api/health', {
        method: 'GET',
        cache: 'no-store'
      });
      if (res && res.ok) {
        statusDot.className = 'status-dot online';
        statusLabel.textContent = 'LiveSub Đang Chạy';
        statusLabel.style.color = '#86efac';
        return;
      }
    } catch (_) {}

    // Not reachable -> Cloud Edge-TTS / Web Speech
    statusDot.className = 'status-dot offline';
    statusLabel.textContent = 'Đám Mây / Edge-TTS';
    statusLabel.style.color = '#fde047';
  }

  // 4. Test Voice
  function testVoice() {
    const voice = selVoice.value;
    const testSample = 'Chào bạn! LiveSub Studio đã sẵn sàng lồng tiếng cho mọi video!';
    btnTestVoice.disabled = true;
    btnTestVoice.textContent = '⏳ Đang phát...';

    chrome.runtime.sendMessage({
      type: 'SYNTHESIZE_TTS',
      text: testSample,
      voice
    }, (resp) => {
      btnTestVoice.disabled = false;
      btnTestVoice.textContent = '🔊 Thử Giọng';
      if (resp && resp.audioUrl) {
        const audio = new Audio(resp.audioUrl);
        audio.play().catch(console.warn);
      } else if (resp && resp.audio_base64) {
        const audio = new Audio(`data:${resp.audio_mime || 'audio/wav'};base64,` + resp.audio_base64);
        audio.play().catch(console.warn);
      } else {
        // Fallback to browser SpeechSynthesis
        try {
          const u = new SpeechSynthesisUtterance(testSample);
          u.lang = 'vi-VN';
          window.speechSynthesis.speak(u);
        } catch (_) {}
      }
    });
  }

  // Bind Events
  chkMasterDub.addEventListener('change', saveSettings);
  selVoice.addEventListener('change', saveSettings);
  selSubMode.addEventListener('change', saveSettings);
  selDucking.addEventListener('change', saveSettings);
  chkSyncSpeed.addEventListener('change', saveSettings);
  chkOcrScan.addEventListener('change', saveSettings);

  rngFontSize.addEventListener('input', () => {
    lblFontSize.textContent = `${rngFontSize.value}px`;
    saveSettings();
  });

  btnTestVoice.addEventListener('click', testVoice);
  btnOpenStudio.addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://localhost:3000' });
  });

  // Initialize
  loadSettings();
  checkLocalEngine();
})();
