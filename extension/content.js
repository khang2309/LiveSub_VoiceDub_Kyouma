// LiveSub Studio - Universal Video AI Dubbing Content Script
// Synchronous timeline playback, auto audio ducking, DOM caption extraction, and optional video canvas OCR.

(function () {
  'use strict';

  let config = {
    isDubbingActive: true,
    voice: 'Trúc Ly',
    subMode: 'vi_only',
    duckPercent: 10,
    syncSpeed: true,
    ocrScan: true,
    fontSize: 26
  };

  let userOriginalVolume = null;
  let currentAudio = null;
  let lastProcessedText = '';
  let captionDebounceTimer = null;
  let ocrScanInterval = null;
  let subClearTimer = null;
  let activeVideoEl = null;

  // In-memory audio URL cache
  const audioCache = new Map();

  // Load config from extension storage
  function loadConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(config, (saved) => {
        config = Object.assign(config, saved);
        applyConfigToUI();
      });
    }
  }

  // Listen for storage changes across all frames and popup in real-time
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        let hasChange = false;
        for (let key in changes) {
          if (key in config) {
            config[key] = changes[key].newValue;
            hasChange = true;
          }
        }
        if (hasChange) {
          applyConfigToUI();
        }
      }
    });
  }

  // Listen for direct messages from popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'LIVESUB_CONFIG_UPDATED' && msg.config) {
        config = Object.assign(config, msg.config);
        applyConfigToUI();
      }
    });
  }

  function applyConfigToUI() {
    const toggleBtn = document.getElementById('livesub-floating-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = config.isDubbingActive ? 'BẬT' : 'TẮT';
      toggleBtn.classList.toggle('active', config.isDubbingActive);
    }
    const invideoSpan = document.querySelector('#livesub-invideo-sub span');
    if (invideoSpan) {
      invideoSpan.style.fontSize = `${config.fontSize || 26}px`;
    }
    if (!config.isDubbingActive) {
      stopCurrentAudio();
      restoreVideoVolume();
      clearInVideoSubtitle();
      updateWidgetStatus('Đã tạm dừng');
    } else {
      updateWidgetStatus('Sẵn sàng lồng tiếng');
    }
  }

  // Find the primary active video element on the current frame
  function findActiveVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;
    // Prefer video that is currently playing
    const playing = videos.find(v => !v.paused && v.currentTime > 0);
    if (playing) return playing;
    // Prefer video with real dimensions
    const visible = videos.find(v => v.offsetWidth > 160 && v.offsetHeight > 90);
    return visible || videos[0];
  }

  // Validate and clean candidate subtitle string from cues or DOM
  function cleanAndValidateSubtitle(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;

    // 1. Strip HTML/WebVTT tags (e.g. <font color="...">, <v Speaker>, <b>, </i>, <c.yellow>)
    let text = rawText
      .replace(/<[^>]+>/g, '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text || text.length < 2) return null;

    // 2. Reject JSON metadata strings (common in HLS / DASH / Video.js in-band metadata)
    // E.g.: {"metadataType":"discontinuity"}, [{"type":"cuePoint"}], {"timestamp":123}
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) return null;
    if (/["']?metadataType["']?\s*:/i.test(text)) return null;
    if (/["']?discontinuity["']?/i.test(text)) return null;
    if (/["']?(id|type|stream|segment|timestamp|duration|bandwidth)["']?\s*:/i.test(text) && text.includes('{')) return null;

    // 3. Reject WebVTT protocol headers or cues
    if (/^WEBVTT/i.test(text) || /^X-TIMESTAMP/i.test(text) || /-->/.test(text)) return null;

    // 4. Reject pure numbers, timestamps, duration, or seek buttons (:59, 10, 14:12 / 23:59)
    if (/^[:0-9\s.,\-/]+$/.test(text)) return null;
    if (/^\d{1,2}:\d{2}(:\d{2})?(\s*[\/\-]\s*\d{1,2}:\d{2}(:\d{2})?)?$/.test(text)) return null;

    // 5. Reject player UI control buttons & watermarks
    if (/^(Dù\s*\d+|Tập\s*\d+|Next|Prev|Play|Pause|Mute|Volume|Fullscreen|Rạp chiếu|Mở rộng|Bình luận|Cài đặt|Chất lượng|Server|AHS|HY|VIP)\s*$/i.test(text)) return null;

    // 6. Must contain at least one Vietnamese or Latin letter
    if (!/[a-zA-ZÀ-ỹ]/.test(text)) return null;

    return text;
  }

  // Display In-Video Transparent Subtitle right on top of video container
  function showInVideoSubtitle(text, sourceText = '') {
    if (config.subMode === 'none') {
      clearInVideoSubtitle();
      return;
    }

    const video = findActiveVideo();
    const parentContainer = (video ? video.parentElement : null) || document.querySelector('.html5-video-player') || document.body;

    let container = document.getElementById('livesub-invideo-sub');
    if (!container) {
      container = document.createElement('div');
      container.id = 'livesub-invideo-sub';
      container.className = 'livesub-invideo-container';
      parentContainer.appendChild(container);
    }

    // Handle Subtitle Modes
    const isVietsubMode = config.subMode === 'vi_only';
    const isSourceOnly = config.subMode === 'source_only';
    let displayText = text;

    if (isSourceOnly && sourceText) {
      displayText = sourceText;
    } else if (config.subMode === 'bilingual' && sourceText && sourceText.trim() !== text.trim()) {
      displayText = `<div class="sub-source-line">${escapeHtml(sourceText)}</div><div class="sub-vi-line">${escapeHtml(text)}</div>`;
    } else {
      displayText = `<div class="sub-vi-line">${escapeHtml(text)}</div>`;
    }

    container.innerHTML = `
      <div class="livesub-sub-pill" style="font-size: ${config.fontSize || 26}px;">
        ${displayText}
      </div>
    `;

    clearTimeout(subClearTimer);
    subClearTimer = setTimeout(() => {
      clearInVideoSubtitle();
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

  // Audio Ducking
  function duckVideoVolume() {
    const video = findActiveVideo();
    if (!video) return;
    if (userOriginalVolume === null || userOriginalVolume === undefined) {
      userOriginalVolume = video.volume;
    }
    const factor = (config.duckPercent !== undefined ? config.duckPercent : 10) / 100;
    const targetVol = (userOriginalVolume > 0 ? userOriginalVolume : 1.0) * factor;
    video.volume = Math.max(0, Math.min(1.0, targetVol));
  }

  function restoreVideoVolume() {
    const video = findActiveVideo();
    if (video && userOriginalVolume !== null && userOriginalVolume !== undefined) {
      video.volume = userOriginalVolume;
    }
  }

  function stopCurrentAudio() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
  }

  // Handle Dialogue Text Event
  function handleDialogueSubtitle(rawText, sourceText = '') {
    if (!config.isDubbingActive) return;
    const text = cleanAndValidateSubtitle(rawText);
    if (!text) return;

    // Suppress music lines / OST
    if (/[\u266a\u266b\u2669\u266c\uD83C\uDFB5\uD83C\uDFB6~～♪♫♬♩]|^\s*\[(music|applause|cheering|laughter|ost|bgm)\]/iu.test(text)) {
      showInVideoSubtitle(`🎵 [Nhạc nền / OST] ${text}`);
      return;
    }

    if (text === lastProcessedText) return;
    lastProcessedText = text;

    updateWidgetStatus(`🎙️ "${text.substring(0, 22)}${text.length > 22 ? '...' : ''}"`);

    // Check cache
    const cacheKey = `${config.voice}:::${text}`;
    if (audioCache.has(cacheKey)) {
      const cached = audioCache.get(cacheKey);
      showInVideoSubtitle(cached.displayText, sourceText);
      playDubbedAudio(cached.audioUrl);
      return;
    }

    // Send to background service worker for TTS synthesis
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'SYNTHESIZE_TTS',
        text,
        voice: config.voice
      }, (resp) => {
        if (!config.isDubbingActive) return;
        if (resp && (resp.audioUrl || resp.audio_base64)) {
          const url = resp.audioUrl || (`data:${resp.audio_mime || 'audio/wav'};base64,` + resp.audio_base64);
          const display = resp.prompt || text;
          audioCache.set(cacheKey, { audioUrl: url, displayText: display });
          showInVideoSubtitle(display, sourceText);
          playDubbedAudio(url);
        } else {
          // Fallback to Web Speech API
          fallbackWebSpeech(text, sourceText);
        }
      });
    } else {
      fallbackWebSpeech(text, sourceText);
    }
  }

  function fallbackWebSpeech(text, sourceText) {
    showInVideoSubtitle(text, sourceText);
    if (typeof window.speechSynthesis === 'undefined') return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'vi-VN';

      // Pick natural Vietnamese voice if available
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const viVoice = voices.find(v => v.lang === 'vi-VN' || v.lang.startsWith('vi'));
        if (viVoice) u.voice = viVoice;
      }

      const video = findActiveVideo();
      if (video && config.syncSpeed) {
        u.rate = Math.max(0.8, Math.min(2.0, video.playbackRate));
      }
      duckVideoVolume();
      u.onend = () => restoreVideoVolume();
      u.onerror = () => restoreVideoVolume();
      window.speechSynthesis.speak(u);
    } catch (_) {
      restoreVideoVolume();
    }
  }

  function playDubbedAudio(audioUrl) {
    const video = findActiveVideo();
    if (video && video.paused) return; // Do not speak if video is paused

    stopCurrentAudio();
    duckVideoVolume();

    currentAudio = new Audio(audioUrl);
    if (video && config.syncSpeed && video.playbackRate) {
      currentAudio.playbackRate = Math.max(0.75, Math.min(2.0, video.playbackRate));
    }

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

  // Bind to HTML5 Video Events
  function attachVideoEvents(video) {
    if (!video || video.dataset.livesubAttached) return;
    video.dataset.livesubAttached = 'true';
    activeVideoEl = video;

    if (video.volume > 0) {
      userOriginalVolume = video.volume;
    }

    // 1. Video pause -> Pause speech
    video.addEventListener('pause', () => {
      if (currentAudio) currentAudio.pause();
      if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.pause();
      restoreVideoVolume();
    });

    // 2. Video resume -> Resume speech
    video.addEventListener('play', () => {
      if (currentAudio && config.isDubbingActive) {
        duckVideoVolume();
        currentAudio.play().catch(() => {});
      }
      if (typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.paused) {
        duckVideoVolume();
        window.speechSynthesis.resume();
      }
    });

    // 3. Video seek (tua) -> Abort stale speech immediately
    video.addEventListener('seeking', () => {
      stopCurrentAudio();
      if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel();
      clearInVideoSubtitle();
      restoreVideoVolume();
      lastProcessedText = '';
    });

    // 4. Video speed change -> Sync speech rate
    video.addEventListener('ratechange', () => {
      if (currentAudio && config.syncSpeed) {
        currentAudio.playbackRate = Math.max(0.75, Math.min(2.0, video.playbackRate));
      }
    });
  }

  // 1. Observer for Soft Subtitles (YouTube, Netflix, HTML5 textTracks, JWPlayer, Video.js)
  function setupSoftSubtitleObservers() {
    // A. Native HTML5 TextTracks (AnimeVietsub, AnimeHay, generic HTML5 players)
    const video = findActiveVideo();
    if (video && video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        // CRITICAL: Filter out metadata and non-dialogue tracks!
        if (track.kind !== 'subtitles' && track.kind !== 'captions') {
          continue;
        }

        if (track._livesubAttached) continue;
        track._livesubAttached = true;

        track.oncuechange = () => {
          if (track.activeCues && track.activeCues.length > 0) {
            for (let c = 0; c < track.activeCues.length; c++) {
              const cue = track.activeCues[c];
              if (cue && cue.text) {
                const cleaned = cleanAndValidateSubtitle(cue.text);
                if (cleaned) {
                  handleDialogueSubtitle(cleaned);
                  break;
                }
              }
            }
          }
        };
      }
    }

    // B. DOM MutationObserver for YouTube, Netflix, JWPlayer
    const observer = new MutationObserver(() => {
      // YouTube
      const ytSegs = document.querySelectorAll('.ytp-caption-segment');
      if (ytSegs.length > 0) {
        const full = Array.from(ytSegs).map(s => s.textContent).join(' ').trim();
        const cleaned = cleanAndValidateSubtitle(full);
        if (cleaned) {
          clearTimeout(captionDebounceTimer);
          captionDebounceTimer = setTimeout(() => handleDialogueSubtitle(cleaned), 50);
          return;
        }
      }

      // Netflix
      const nflx = document.querySelector('.player-timedtext');
      if (nflx && nflx.textContent.trim()) {
        const cleaned = cleanAndValidateSubtitle(nflx.textContent.trim());
        if (cleaned) {
          clearTimeout(captionDebounceTimer);
          captionDebounceTimer = setTimeout(() => handleDialogueSubtitle(cleaned), 50);
          return;
        }
      }

      // Generic Video.js / JWPlayer cue container
      const genericCue = document.querySelector('.vjs-text-track-cue, .jw-text-track-cue, .shaka-text-container');
      if (genericCue && genericCue.textContent.trim()) {
        const cleaned = cleanAndValidateSubtitle(genericCue.textContent.trim());
        if (cleaned) {
          clearTimeout(captionDebounceTimer);
          captionDebounceTimer = setTimeout(() => handleDialogueSubtitle(cleaned), 50);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // 2. Off-screen Canvas Frame Crop for Hard Subtitles (OCR scan)
  function setupVideoOcrScanner() {
    if (ocrScanInterval) clearInterval(ocrScanInterval);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let lastOcrSample = null;

    ocrScanInterval = setInterval(() => {
      if (!config.isDubbingActive || !config.ocrScan) return;
      const video = findActiveVideo();
      if (!video || video.paused || video.ended || video.readyState < 2) return;

      // Only skip OCR if there is a real, non-empty soft subtitle currently displayed on screen
      const softSubEl = document.querySelector('.ytp-caption-segment, .player-timedtext, .vjs-text-track-cue, .jw-text-track-cue');
      if (softSubEl && cleanAndValidateSubtitle(softSubEl.textContent)) {
        return;
      }

      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 360;
      // Crop bottom 22% of video frame (subtitle zone)
      const cropH = Math.round(vh * 0.22);
      const cropY = vh - cropH;

      canvas.width = 480;
      canvas.height = 100;

      let base64Jpeg = null;
      try {
        ctx.drawImage(video, 0, cropY, vw, cropH, 0, 0, canvas.width, canvas.height);
        base64Jpeg = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      } catch (err) {
        // Tainted canvas by cross-origin video without CORS headers
        return;
      }

      if (!base64Jpeg) return;

      // Compare with previous sample
      if (base64Jpeg === lastOcrSample) return;
      lastOcrSample = base64Jpeg;

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'OCR_FRAME',
          imageData: base64Jpeg,
          sourceLang: 'vi'
        }, (res) => {
          if (res && !res.empty && res.original) {
            const cleanOriginal = cleanAndValidateSubtitle(res.original);
            const cleanTranslated = cleanAndValidateSubtitle(res.translated || res.original);
            if (cleanTranslated) {
              handleDialogueSubtitle(cleanTranslated, cleanOriginal || cleanTranslated);
            }
          }
        });
      }
    }, 280);
  }

  // Create Draggable Quick Widget strictly only in the frame that contains the video
  function updateFloatingWidget() {
    const video = findActiveVideo();
    const existing = document.getElementById('livesub-floating-widget');

    if (!video) {
      // If there is no video in this frame/window, remove any existing widget (eliminates duplicate widgets)
      if (existing) {
        existing.remove();
      }
      return;
    }

    if (!existing) {
      createFloatingWidget();
    }
  }

  function createFloatingWidget() {
    if (document.getElementById('livesub-floating-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'livesub-floating-widget';
    widget.className = 'livesub-floating-widget';
    widget.innerHTML = `
      <div class="livesub-widget-header">
        <span class="livesub-widget-dot"></span>
        <span class="livesub-widget-title">LiveSub AI</span>
        <button type="button" id="livesub-floating-toggle" class="livesub-toggle-btn ${config.isDubbingActive ? 'active' : ''}">
          ${config.isDubbingActive ? 'BẬT' : 'TẮT'}
        </button>
      </div>
      <div class="livesub-widget-status" id="livesub-widget-status">
        ${config.isDubbingActive ? 'Sẵn sàng lồng tiếng' : 'Đã tạm dừng'}
      </div>
    `;

    document.body.appendChild(widget);

    const toggleBtn = widget.querySelector('#livesub-floating-toggle');
    toggleBtn.addEventListener('click', () => {
      config.isDubbingActive = !config.isDubbingActive;
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ isDubbingActive: config.isDubbingActive });
      }
      applyConfigToUI();
    });

    // Shortcut: Alt + D
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'd' || e.key === 'D')) {
        toggleBtn.click();
      }
    });
  }

  function updateWidgetStatus(text) {
    const el = document.getElementById('livesub-widget-status');
    if (el) el.textContent = text;
  }

  // Initialize
  function init() {
    loadConfig();
    updateFloatingWidget();
    setupSoftSubtitleObservers();
    setupVideoOcrScanner();

    // Check periodically for dynamically loaded video players and manage single widget
    setInterval(() => {
      const v = findActiveVideo();
      if (v) {
        if (!v.dataset.livesubAttached) {
          attachVideoEvents(v);
          setupSoftSubtitleObservers();
        }
        updateFloatingWidget();
      } else {
        updateFloatingWidget();
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
