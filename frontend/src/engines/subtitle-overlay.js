// LiveSub Component: subtitle-overlay
export default {
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
  },

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
  },

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
      this.setSubtitleTransparency(modes[nextIdx]);
    } else if (key === '+' || key === '=') {
      this.adjustFontSize(1);
    } else if (key === '-') {
      this.adjustFontSize(-1);
    }
  },

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
  },

  displaySubtitle(sourceText, viText) {
    if (this.isOCRModeActive && viText && String(viText).trim()) {
      const now = performance.now();
      if (!this.recentRenderedOcrTranslations) this.recentRenderedOcrTranslations = [];
      this.recentRenderedOcrTranslations = this.recentRenderedOcrTranslations
        .filter((item) => now - item.time < 1800);
      const text = String(viText).replace(/\s+/g, ' ').trim();
      if (!this.recentRenderedOcrTranslations.some((item) => item.text === text)) {
        this.recentRenderedOcrTranslations.push({ text, time: now });
      }
    }
    const isSameText = sourceText && viText && (
      sourceText.trim().toLowerCase() === viText.trim().toLowerCase() ||
      viText.toLowerCase().includes(sourceText.trim().toLowerCase()) ||
      sourceText.toLowerCase().includes(viText.trim().toLowerCase())
    );
    const hasSource = Boolean(sourceText && String(sourceText).trim() && !isSameText && this.currentSubMode !== 'vi_only' && this.currentSubMode !== 'none');
    const hasVi = Boolean(viText && String(viText).trim() && this.currentSubMode !== 'source_only' && this.currentSubMode !== 'none');

    if (this.subSourceDisplay) {
      this.subSourceDisplay.textContent = hasSource ? sourceText : '';
      this.subSourceDisplay.style.display = hasSource ? 'block' : 'none';
      this.subSourceDisplay.toggleAttribute('data-empty', !hasSource);
    }
    if (this.subViDisplay) {
      this.subViDisplay.textContent = hasVi ? viText : '';
      this.subViDisplay.style.display = hasVi ? 'block' : 'none';
      this.subViDisplay.toggleAttribute('data-empty', !hasVi);
    }

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
  },

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
  },

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

    document.querySelectorAll('.invideo-subtitle-overlay').forEach((overlay) => {
      overlay.classList.remove('subtitle-bg-transparent', 'subtitle-bg-glass', 'subtitle-bg-dark');
      overlay.classList.add(`subtitle-bg-${this.currentTransparency}`);
    });

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
  },

  setSubtitleTransparency(mode) {
    if (!['transparent', 'glass', 'dark'].includes(mode)) return;
    this.currentTransparency = mode;
    try { localStorage.setItem('livesub_sub_transparency', mode); } catch (_) {}
    const targetRadio = document.querySelector(`input[name="subTransparency"][value="${mode}"]`);
    if (targetRadio) targetRadio.checked = true;
    this.applyTransparencyUI();
    this.updateAppliedSettings();
    this.broadcastOverlayState();
    this.notifyUIState?.();
    this.showToast(`Phông nền phụ đề: ${mode === 'transparent' ? 'Trong suốt' : (mode === 'glass' ? 'Kính mờ' : 'Tối màu')}`);
  },

  updateSubModeUI() {
    const showSource = this.currentSubMode === 'bilingual' || this.currentSubMode === 'source_only' || this.currentSubMode === 'en_only';
    const showVi = this.currentSubMode === 'bilingual' || this.currentSubMode === 'vi_only';

    const sourceHasText = Boolean(this.subSourceDisplay?.textContent?.trim());
    const viHasText = Boolean(this.subViDisplay?.textContent?.trim());
    this.subSourceDisplay.style.display = (showSource && sourceHasText) ? 'block' : 'none';
    this.subViDisplay.style.display = (showVi && viHasText) ? 'block' : 'none';

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
  },

  setStatus(type, text) {
    this.statusBadge.className = 'status-badge ' + type;
    this.statusText.textContent = text;
  },

  showToast(msg) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, 2400);
  },

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
    const currentVi = this.subViDisplay ? this.subViDisplay.textContent || '' : '';
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
  },

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
    if (viText) ctx.fillText(viText, w / 2, sourceText ? 96 : 78, w - 40);
    ctx.shadowBlur = 0;
  },

  // Opens ultra-slim Picture-in-Picture window or Always-on-Top overlay

  async openFloatingOverlay() {
    this.ensureAudioUnlocked();
    const currentSource = this.subSourceDisplay ? this.subSourceDisplay.textContent : '';
    const currentVi = this.subViDisplay ? this.subViDisplay.textContent || '' : '';

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
        const currentVi = this.subViDisplay ? this.subViDisplay.textContent || '' : '';

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
          <div id="inAppPipVi" class="in-app-pip-vi"></div>
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
      const currentVi = this.subViDisplay ? this.subViDisplay.textContent || '' : '';
      const s = document.getElementById('inAppPipSource');
      const v = document.getElementById('inAppPipVi');
      if (s) s.textContent = currentSource;
      if (v) v.textContent = currentVi;
      this.showToast('📌 Đã ghim thanh Phụ Đề Nổi!');
    } else {
      this.showToast('📌 Đã đóng thanh Phụ Đề Nổi');
    }
  }

  }
