// LiveSub engine component: youtube-timeline-sync
export default {
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
        if (!this._ytSeekInProgress && Math.abs(timeDelta - wallDelta) > 1.5) {
          this.ytSessionGeneration++;
          this.currentYtSegmentIdx = -1;
          this.playbackGeneration++;
          this.stopDubbingAudio(false);
          this.lastYtTime = curTime;
          this.lastYtTickWallClock = now;
          this.prioritizeYouTubeSeek(curTime).catch((error) => {
            console.warn('YouTube seek prebuffer error:', error);
          });
          return;
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
        const isMusic = !this.sanitizeDubbingText(seg.translated || seg.original);

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
  },

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
  },

  findYtSegmentAtOrAfter(curTime) {
    const active = this.findActiveYtSegment(curTime);
    if (active >= 0) return active;
    let low = 0;
    let high = this.ytSegments.length - 1;
    let candidate = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.ytSegments[mid].start >= curTime) {
        candidate = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return candidate;
  },

  async prioritizeYouTubeSeek(curTime) {
    if (!this.ytPlayer || this.currentYtMode !== 'has_captions' || !this.isDubbingEnabled) return;
    const targetIdx = this.findYtSegmentAtOrAfter(curTime);
    if (targetIdx < 0) return;

    const seekGeneration = (this._ytSeekGeneration || 0) + 1;
    this._ytSeekGeneration = seekGeneration;
    this._ytSeekInProgress = true;

    // Cancel low-priority work around the old playback position. Already decoded
    // audio remains useful, but new GPU work starts from the seek destination.
    this._isYtPrefetchWorkerRunning = false;
    this._ytPrefetchGeneration = (this._ytPrefetchGeneration || 0) + 1;
    if (this.ytPrefetchAbortController) {
      try { this.ytPrefetchAbortController.abort(); } catch (_) {}
    }
    this.ytPrefetchAbortController = new AbortController();
    if (this.isFetchingPreCache?.clear) this.isFetchingPreCache.clear();
    this._ytPrefetchTargetIdx = targetIdx;
    this._ytSequentialPrefetchCursor = targetIdx;

    // Seeking changes prefetch priority but never pauses an already-playing
    // movie. Only the initial start gate may hold playback while the first
    // voice buffer is prepared.
    this.setSourceIntelligenceState(
      'loading',
      'Đang ưu tiên điểm vừa tua...',
      'Video tiếp tục phát; giọng tại vị trí mới đang được tạo ưu tiên.'
    );

    try {
      const translateTargets = this.ytSegments.slice(targetIdx, targetIdx + 2).filter(seg => seg && !seg.translated);
      await Promise.all(translateTargets.map(async (seg) => {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: seg.original, from_lang: this.ytCaptionLanguage || 'auto', to_lang: 'vi' }),
          signal: this.ytPrefetchAbortController?.signal
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data?.translated) seg.translated = data.translated;
      }));
      await this.prebufferYouTubeInitialTracks(targetIdx, 2, this.youtubeLoadGeneration, 12000);
    } finally {
      if (seekGeneration !== this._ytSeekGeneration || !this.ytPlayer) return;
      const latestTime = this.ytPlayer.getCurrentTime?.() ?? curTime;
      if (Math.abs(latestTime - curTime) > 1.5) {
        this._ytSeekInProgress = false;
        await this.prioritizeYouTubeSeek(latestTime);
        return;
      }
      this._ytSeekInProgress = false;
      this.currentYtSegmentIdx = -1;
      this.lastYtTime = latestTime;
      this.lastYtTickWallClock = performance.now();
      this.prefetchUpcomingAudio(targetIdx + 2);
      this.setSourceIntelligenceState('success', 'CC đã đồng bộ', 'Đã ưu tiên giọng tại vị trí vừa tua.');
    }
  },

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
  },

  holdYouTubeForDubbing() {
    // Pure voice rate acceleration - never pause video playback
    return;
  },

  releaseYouTubeDubbingHold() {
    if (this.ytOverrunHoldTimer) {
      clearTimeout(this.ytOverrunHoldTimer);
      this.ytOverrunHoldTimer = null;
    }
    this.isHoldingYtForDubbing = false;
    this.ytShouldResumeAfterHold = false;
    this.isHoldingLocalForDubbing = false;
  },

  scheduleYouTubeOverrunHold(playDuration, slotDuration) {
    // Pure voice rate acceleration - never pause video playback
    return;
  },

  isPlaybackCurrent(token) {
    if (!token || this.isDubbingEnabled === false) return false;
    if (token.session !== this.ytSessionGeneration) return false;
    if (token.playback !== this.playbackGeneration) return false;
    if (typeof token.segment === 'number') {
      if (this.currentYtSegmentIdx === -1) return true;
      return Math.abs(token.segment - this.currentYtSegmentIdx) <= 1;
    }
    return true;
  },
}
