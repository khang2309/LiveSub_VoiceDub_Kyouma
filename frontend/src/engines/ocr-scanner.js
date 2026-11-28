// LiveSub Component: ocr-scanner
export default {
  getOcrCaptureBounds(width, height) {
    let x = 0;
    let y = 0;
    let captureWidth = width;
    let captureHeight = height;
    if (this._cropOcrToEmbeddedVideo && this.webVideoContainer && typeof window !== 'undefined') {
      const frame = this.webVideoContainer.querySelector('.video-element-container');
      const rect = frame?.getBoundingClientRect?.();
      if (rect && rect.width > 120 && rect.height > 80 && window.innerWidth > 0 && window.innerHeight > 0) {
        const scaleX = width / window.innerWidth;
        const scaleY = height / window.innerHeight;
        x = Math.max(0, Math.floor(rect.left * scaleX));
        y = Math.max(0, Math.floor(rect.top * scaleY));
        captureWidth = Math.max(1, Math.min(width - x, Math.ceil(rect.width * scaleX)));
        captureHeight = Math.max(1, Math.min(height - y, Math.ceil(rect.height * scaleY)));
      }
    }
    return { x, y, width: captureWidth, height: captureHeight };
  },

  async captureOcrRegionPreview() {
    const video = this.ocrVideo;
    const width = video?.videoWidth || 0;
    const height = video?.videoHeight || 0;
    if (!video || !width || !height) return '';
    const bounds = this.getOcrCaptureBounds(width, height);
    const canvas = document.createElement('canvas');
    const targetWidth = Math.min(1280, bounds.width);
    const scale = targetWidth / bounds.width;
    canvas.width = Math.max(1, Math.round(bounds.width * scale));
    canvas.height = Math.max(1, Math.round(bounds.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.drawImage(video, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  },

  updateOcrFeedbackGuard() {
    const overlay = this.webVideoContainer?.querySelector?.('.invideo-subtitle-overlay');
    if (!overlay?.classList) return;
    overlay.classList.remove('ocr-safe-top', 'ocr-safe-bottom', 'ocr-feedback-hidden');
    const guardActive = this.activeSource === 'weburl'
      && this.isOCRModeActive
      && this._cropOcrToEmbeddedVideo;
    if (!guardActive) return;
    if (this.ocrScanZone === 'full' || this.ocrScanZone === 'custom') {
      overlay.classList.add('ocr-feedback-hidden');
    } else if (this.ocrScanZone === 'top') {
      overlay.classList.add('ocr-safe-bottom');
    } else {
      overlay.classList.add('ocr-safe-top');
    }
  },

  removeRenderedSubtitleEcho(text, hadEmptyGap = false) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw || hadEmptyGap || !this.isOCRModeActive) return { text: raw, changed: false, echoOnly: false };
    const now = performance.now();
    const recent = (this.recentRenderedOcrTranslations || [])
      .filter((item) => now - item.time < 1800 && item.text && item.text.length >= 4);
    this.recentRenderedOcrTranslations = recent;
    let cleaned = raw;
    let changed = false;
    for (const item of recent) {
      const escaped = item.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const exact = new RegExp(escaped, 'giu');
      if (exact.test(cleaned)) {
        cleaned = cleaned.replace(exact, ' ').replace(/\s+/g, ' ').trim();
        changed = true;
        continue;
      }
      if (this.ocrSimilarity(cleaned, item.text) >= 0.90) {
        return { text: '', changed: true, echoOnly: true };
      }
    }
    cleaned = cleaned.replace(/^[|\-–—:;,.…\s]+|[|\-–—:;,.…\s]+$/gu, '').trim();
    return { text: cleaned, changed, echoOnly: changed && !cleaned };
  },

  resolveOCRLanguage() {
    const selectedSpeech = this.sourceLangSelect ? this.sourceLangSelect.value : 'auto';
    if (selectedSpeech && selectedSpeech !== 'auto') return selectedSpeech;
    if (this.detectedOCRLanguage) return this.detectedOCRLanguage;
    if (typeof this.getRadioGroupValue === 'function') {
      const selectedCaption = this.getRadioGroupValue(this.webCaptionLanguage, 'auto');
      if (selectedCaption && !['original', 'auto'].includes(selectedCaption)) return selectedCaption;
    }
    return 'vi';
  },

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
      // 1280px preserves crisp Vietnamese diacritic marks while keeping PNG encoding fast
      const scale = Math.min(1, 1280 / width);
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
  },

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
    if (this.activeSource !== 'weburl') {
      this.activeSource = 'system';
    }
    this.updateOcrFeedbackGuard();
    if (this.activeAbortController) this.activeAbortController.abort();
    while (this.speechQueue.length) this.speechQueue.shift().resolve();
    this.lastOCRText = '';
    this.lastCleanText = '';
    this._ocrScanPending = false;
    this.ocrCanvas = document.createElement('canvas');

    const scan = async () => {
      if (!this.isListening || !this.isOCRModeActive || this.isScanningPaused || !this.ocrVideo) return;
      if (this.ocrRequestActive) {
        this._ocrScanPending = true;
        return;
      }
      const width = this.ocrVideo.videoWidth;
      const height = this.ocrVideo.videoHeight;
      if (!width || !height) return;

      // Capture the dialogue subtitle band across full video width.
      // Benchmarks on the target RTX 3050 machine found 960 px to be the best speed/accuracy
      // point for RapidOCR; larger frames only add CPU latency.
      const isTallPage = (height > width * 0.60);
      const captureBounds = this.getOcrCaptureBounds(width, height);
      let sourceX = captureBounds.x;
      let sourceWidth = captureBounds.width;
      let embeddedVideoTop = captureBounds.y;
      let embeddedVideoHeight = captureBounds.height;
      let sourceY, sourceHeight;
      if (this.ocrScanZone === 'custom' && this.customOcrRegion) {
        const region = this.customOcrRegion;
        sourceX = captureBounds.x + Math.floor(captureBounds.width * region.x);
        sourceWidth = Math.max(1, Math.floor(captureBounds.width * region.width));
        sourceY = captureBounds.y + Math.floor(captureBounds.height * region.y);
        sourceHeight = Math.max(1, Math.floor(captureBounds.height * region.height));
      } else if (this.ocrScanZone === 'top') {
        sourceY = embeddedVideoTop;
        sourceHeight = Math.max(1, Math.floor(embeddedVideoHeight * 0.38));
      } else if (this.ocrScanZone === 'full') {
        sourceY = embeddedVideoTop;
        sourceHeight = embeddedVideoHeight;
      } else if (this.ocrScanZone === 'split') {
        sourceY = embeddedVideoTop + Math.floor(embeddedVideoHeight * 0.50);
        sourceHeight = Math.max(1, Math.floor(embeddedVideoHeight * 0.50));
      } else if (this._cropOcrToEmbeddedVideo) {
        sourceY = embeddedVideoTop + Math.floor(embeddedVideoHeight * 0.62);
        sourceHeight = Math.max(1, Math.floor(embeddedVideoHeight * 0.36));
      } else if (isTallPage) {
        // Shared browser webpage tab (e.g. YouTube, Anime sites in split-screen):
        sourceY = Math.floor(height * 0.52);
        sourceHeight = Math.max(1, Math.floor(height * 0.44));
      } else {
        // Shared fullscreen video / 16:9 window: focus on dialogue band (70% to 98%)
        sourceY = Math.floor(height * 0.70);
        sourceHeight = Math.max(1, Math.floor(height * 0.28));
      }
      // Target width: 1280px for Vietnamese (thin tone marks), 960px for foreign scripts (optimal RapidOCR speed/accuracy)
      const activeOcrLang = String(this.resolveOCRLanguage() || 'vi').split(/[-_]/)[0].toLowerCase();
      const maxStripWidth = (activeOcrLang === 'vi' || activeOcrLang === 'auto') ? 1280 : 960;
      const targetWidth = Math.min(maxStripWidth, Math.max(960, Math.round(sourceWidth)));
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
        // Vietnamese tone marks are only a few pixels high. PNG keeps those pixels
        // lossless; JPEG ringing can turn hỏi/ngã/sắc into a different glyph.
        const blob = await new Promise(resolve => this.ocrCanvas.toBlob(resolve, 'image/png'));
        if (!blob) return;
        const form = new FormData();
        form.append('image', blob, 'subtitle-frame.png');
        form.append('source_lang', this.resolveOCRLanguage());
        form.append('previous_context', this.lastTranscriptContext || '');
        const response = await fetch('/api/ocr-subtitle', { method: 'POST', body: form });
        if (!response.ok) throw new Error(`OCR HTTP ${response.status}`);
        const data = await response.json();
        if (!data.empty && data.original) {
          const hadEmptyGap = Boolean(this.ocrConsecutiveEmpty && this.ocrConsecutiveEmpty >= 7);
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
            } else if (currentLang.startsWith('th')) {
              this.oneTouchDetectionPill.innerHTML = '🇹🇭 <strong>Tiếng Thái:</strong> Đang quét chữ & dịch trực tiếp sang Tiếng Việt';
            } else {
              this.oneTouchDetectionPill.innerHTML = `⚡ <strong>Đang quét phụ đề (${currentLang.toUpperCase()}):</strong> Tự động nhận diện & lồng tiếng`;
            }
          }
          await this.handleOCRSubtitle(data);
        } else {
          this.ocrConsecutiveEmpty = (this.ocrConsecutiveEmpty || 0) + 1;
          if (this.ocrConsecutiveEmpty >= 7) {
            // Only after ~245ms+ of genuine empty frames (real gap between dialogue cues),
            // reset active line tracker so legitimate repeated lines like "Miu meo, miu meo" speak again.
            this.lastOCRText = '';
            this.lastCleanText = '';
            this._lastOcrFrameLines = [];
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
        if (this._ocrScanPending && this.isListening && this.isOCRModeActive) {
          this._ocrScanPending = false;
          queueMicrotask(scan);
        }
      }
    };

    await scan();
    this.ocrTimer = setInterval(scan, 35);
    this.setSourceIntelligenceState('ocr', 'OCR đang chạy', 'Đang đọc vùng phụ đề trong khung hình; không dùng Whisper khi OCR hoạt động.');
    this.showToast('OCR đã bật. Để chính xác, hãy chia sẻ riêng tab/video thay vì toàn desktop.');
  },

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
  },

  async yieldToMain() {
    if (typeof window !== 'undefined' && 'scheduler' in window && 'yield' in window.scheduler) {
      await window.scheduler.yield();
    } else {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  },

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

    const w1 = s1.split(/\s+/).filter(Boolean);
    const w2 = s2.split(/\s+/).filter(Boolean);

    // If the new sentence extends the previous one with genuine new words
    // (e.g. "không phải lỗi của mình" -> "không phải lỗi của mình nhưng..."), it is a NEW cue!
    if (w1.length > w2.length && s1.length >= s2.length + 3) {
      return false;
    }

    // Direct Levenshtein similarity when length difference is within minor OCR jitter
    const sim = this.ocrSimilarity(s1, s2);
    const lenDiff = Math.abs(s1.length - s2.length);
    const minLen = Math.min(s1.length, s2.length);
    if (minLen <= 15) {
      if (lenDiff <= 3 && sim >= 0.88) return true;
    } else if (lenDiff <= 4 && sim >= 0.82) {
      return true;
    }

    // Catch shorter partial flicker while the fuller line is still on screen
    const minWords = Math.min(w1.length, w2.length);
    if (w1.length <= w2.length && minWords >= 3) {
      if (s2.includes(s1)) return true;
      const set2 = new Set(w2);
      let shared = 0;
      for (const w of w1) {
        if (set2.has(w)) shared++;
      }
      if ((shared / w1.length) >= 0.80 && w2.length - w1.length <= 2) {
        return true;
      }
    }

    return false;
  },

  isGarbageOCR(text) {
    if (!text || typeof text !== 'string') return true;
    const trimmed = text.trim();
    if (!trimmed || trimmed.includes('[UNK]')) return true;

    // Reject on-video channel CTAs/watermarks before they enter subtitle history
    // or TTS. Require promotional intent/context so ordinary movie dialogue that
    // happens to mention a video or a channel is preserved.
    const promoNorm = trimmed.toLowerCase().replace(/[.,!?;:()[\]{}"'“”‘’_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const hasChannelContext = /(kênh|channel|video|chuông|bell)/iu.test(promoNorm);
    const isPromotionalCta =
      /\bsubscribe\b/i.test(promoNorm)
      || (/(đăng ký|theo dõi|nhấn chuông|bấm chuông|ủng hộ)/iu.test(promoNorm) && hasChannelContext)
      || /không bỏ lỡ.*video/iu.test(promoNorm)
      || /\b(like and subscribe|like share subscribe|thanks for watching|thank you for watching)\b/i.test(promoNorm);
    if (isPromotionalCta) return true;

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
    const baseLang = String(currentLang).split(/[-_]/)[0].toLowerCase();
    const isVietsub = baseLang === 'vi' || baseLang === 'auto';
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
  },

  async handleOCRSubtitle(data) {
    if (this.isScanningPaused) return;
    if (!data._groupedLine) {
      const frameLines = (Array.isArray(data.lines) ? data.lines : String(data.original || '').split(/[\r\n]+/))
        .map(line => String(line || '').trim())
        .filter(Boolean);
      if (frameLines.length > 1) {
        const previous = this._lastOcrFrameLines || [];
        const hasSpeakerMarkers = frameLines.filter(line => /^[\-–—]\s*/u.test(line)).length >= 2;
        const boxes = Array.isArray(data.line_boxes) ? data.line_boxes : [];
        const geometricallyAligned = boxes.length < 2
          || Math.abs(Number(boxes[0]?.center_x || 0) - Number(boxes[1]?.center_x || 0)) < 0.18;
        const appendedWhileVisible = previous.length > 0
          && previous.some(old => this.ocrSimilarity(old, frameLines[0]) >= 0.9)
          && !previous.some(old => this.ocrSimilarity(old, frameLines[frameLines.length - 1]) >= 0.9);
        const firstContinues = !/[.!?…:]["'”’)]?$/u.test(frameLines[0]);
        const groups = (!hasSpeakerMarkers && !appendedWhileVisible && firstContinues && geometricallyAligned)
          ? [frameLines.join(' ')]
          : frameLines.map(line => line.replace(/^[\-–—]\s*/u, '').trim()).filter(Boolean);
        this._lastOcrFrameLines = frameLines;
        const translatedLines = Array.isArray(data.translated_lines) ? data.translated_lines : [];
        for (let index = 0; index < groups.length; index++) {
          const translated = groups.length === 1
            ? String(data.translated || groups[0]).replace(/[\r\n]+/g, ' ').trim()
            : String(translatedLines[index] || groups[index]).trim();
          await this.handleOCRSubtitle({ ...data, _groupedLine: true, lines: null, original: groups[index], translated });
        }
        if (groups.length > 1 && typeof this.displaySubtitle === 'function') {
          const shownOriginal = groups.join('\n');
          const shownTranslated = groups.map((line, index) => translatedLines[index] || line).join('\n');
          this.displaySubtitle(shownOriginal, shownTranslated);
          if (this.invideoWebSubVi) this.invideoWebSubVi.textContent = shownTranslated;
          if (this.invideoWebSubSource) this.invideoWebSubSource.textContent = shownOriginal;
        }
        return;
      }
      this._lastOcrFrameLines = frameLines;
    }
    let raw = String(data.original || '').replace(/\s+/g, ' ').trim();
    if (!raw) return;

    const echoFiltered = this.removeRenderedSubtitleEcho(raw, Boolean(data.hadEmptyGap));
    if (echoFiltered.echoOnly || !echoFiltered.text) return;
    if (echoFiltered.changed) {
      raw = echoFiltered.text;
      try {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: raw,
            source_lang: this.resolveOCRLanguage(),
            previous_context: this.lastTranscriptContext || ''
          })
        });
        if (response.ok) {
          const translated = await response.json();
          data.translated = translated.translated || raw;
        }
      } catch (_) {
        data.translated = raw;
      }
      data.original = raw;
    }

    // Show non-speech captions, but never send cue-only lines to TTS.
    const isMusic = !this.sanitizeDubbingText(raw);
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
    const baseLang = String(currentLang).split(/[-_]/)[0].toLowerCase();
    const isVietsubMode = baseLang === 'vi' || baseLang === 'auto' || (this.detectedOCRLanguage === 'vi');
    // Structural cleanup only (no hardcoded words/phrases)
    if (isVietsubMode) {
      if (/[a-zA-Zà-ỹÀ-Ỹ]/.test(raw)) {
        raw = raw.replace(/[\u4e00-\u9fff\u3040-\u30ff]+/g, ' ').replace(/\s+/g, ' ').trim();
      }
      raw = raw.trim().replace(/^[,\.\-:;]+|[,\.\-:;]+$/g, '').trim();
      if (!raw) return;

      // Strip isolated single consonant leading OCR boundary noise before a real word
      raw = raw.replace(/^[bcdfghjklmnpqrstvwxz]\s+(?=[a-zA-Zà-ỹÀ-Ỹ]{3,})/i, '').trim();
    } else {
      raw = raw.replace(/^[b-hj-zB-HJ-Z]\s+(?=[a-zA-Z]{3,})/i, '').trim();
    }

    // Strip standalone player OSD timecodes while preserving real dialogue numbers
    raw = raw.replace(/\b\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s*[\/|\\]\s*\d{1,2}[:.]\d{1,2}(?:[:.]\d{1,2})?)?\b/g, '').trim();
    if (!raw) return;

    // Dialogue subtitles: allow long sentences, monologues and multi-speaker dialogues up to 1000 chars or 200 words
    if (raw.length > 1000 || raw.split(/\s+/).length > 200) return;

    // Single or short token structural check (allow any real dialogue word, reject pure single-char punctuation)
    const rawTokens = raw.split(/\s+/).filter(Boolean);
    const isCjkText = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(raw);
    if (!isCjkText && rawTokens.length === 1) {
      const cleanWord = raw.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const isValidToken = /^\d+$/.test(cleanWord) || cleanWord.length >= 2 || /[à-ỹÀ-Ỹ]/.test(cleanWord);
      if (!isValidToken) {
        return;
      }
    }

    // Zero-drop real-time speech policy:
    // Never abruptly interrupt ongoing dialogue or purge the speech queue; let every sentence play smoothly to completion.

    const now = performance.now();
    const hasCleared = Boolean(data.hadEmptyGap);
    if (hasCleared) {
      // Genuine empty-screen pause cleared previous subtitle: allow identical repeats in a new cue
      this.recentOCRHistory = [];
      this.lastOCRText = '';
      this.lastCleanText = '';
    } else {
      if (!this.recentOCRHistory) this.recentOCRHistory = [];
      this.recentOCRHistory = this.recentOCRHistory.filter(item => (now - item.time) < 6500);
    }

    const stripAccents = (s) => (s || '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'd')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
    const rawNorm = stripAccents(raw);
    let cleanRaw = defrag(String(data.translated || raw || ''));
    if (isVietsubMode) {
      cleanRaw = cleanRaw.replace(/^[bcdfghjklmnpqrstvwxz]\s+(?=[a-zA-Zà-ỹÀ-Ỹ]{3,})/i, '');
    }
    // If raw OCR has a more complete sentence than cleanRaw (e.g. cleanRaw was cut off with trailing letter + dots)
    if (raw && raw.length > cleanRaw.length) {
      const cleanPrefix = cleanRaw.replace(/[\s\wÀ-ỹà-ỹ]*\.{2,}.*$/, '').trim();
      if (cleanPrefix.length >= 10 && raw.startsWith(cleanPrefix)) {
        cleanRaw = raw;
      }
    }
    cleanRaw = cleanRaw.replace(/\s+[a-zA-Zà-ỹÀ-Ỹ]\.{2,}\s*$/g, '').trim();
    cleanRaw = cleanRaw.replace(/(\.{2,}|…)\s*\.+/g, '$1').replace(/\s+([.,!?:;…])/g, '$1').trim();
    if (!cleanRaw) return;
    const cleanNorm = stripAccents(cleanRaw);

    // While subtitle stays continuously on screen (!hasCleared), suppress shorter partial flickers
    // while allowing progressive extensions (rawNorm > histNorm) to pass or update queued items.
    if (!hasCleared) {
      const isSubFragment = this.recentOCRHistory.some(item => {
        const histNorm = stripAccents(item.text);
        const histCleanNorm = stripAccents(item.cleanText || item.text);
        if (histNorm.length >= rawNorm.length && rawNorm.length >= 8 && (histNorm.includes(rawNorm) || histNorm.endsWith(rawNorm))) {
          return true;
        }
        const rawTailNorm = (rawTokens.length > 2 && rawTokens[0].length === 1) ? stripAccents(rawTokens.slice(1).join(' ')) : '';
        if (rawTailNorm && rawTailNorm.length >= 8 && histNorm.includes(rawTailNorm)) {
          return true;
        }
        if (cleanNorm && histCleanNorm.length >= cleanNorm.length && cleanNorm.length >= 8 && (histCleanNorm.includes(cleanNorm) || histCleanNorm.endsWith(cleanNorm))) {
          return true;
        }
        return false;
      });
      if (rawTokens.length > 1 && isSubFragment) {
        return;
      }
    }

    // Merge progressive subtitle expansions in place if the unplayed item is still sitting in liveDubbingQueue
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

    // Suppress duplicates only while the same subtitle remains continuously on screen (!hasCleared)
    if (
      !hasCleared && (
        this.recentOCRHistory.some(item => (
          this.isDuplicateOCR(raw, item.text) ||
          (item.cleanText && this.isDuplicateOCR(cleanRaw, item.cleanText))
        )) ||
        (this.lastOCRText && this.isDuplicateOCR(raw, this.lastOCRText)) ||
        (this.lastCleanText && this.isDuplicateOCR(cleanRaw, this.lastCleanText))
      )
    ) {
      return;
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
  },

  stopHardSubtitleOCR() {
    if (this.ocrTimer) clearInterval(this.ocrTimer);
    this.ocrTimer = null;
    this.ocrRequestActive = false;
    this._ocrScanPending = false;
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
    const overlay = this.webVideoContainer?.querySelector?.('.invideo-subtitle-overlay');
    overlay?.classList?.remove('ocr-safe-top', 'ocr-safe-bottom', 'ocr-feedback-hidden');
    this.lastOCRText = '';
    this.lastCleanText = '';
    this._lastOcrFrameLines = [];
    if (this.motionCtx) {
      this.motionCtx = null;
      this.motionCanvas = null;
      this.lastFrameThumb = null;
    }
    this.staticFrameCount = 0;
    this.isExternalVideoPaused = false;
    this.isSeekPreempt = false;
  }

  }
