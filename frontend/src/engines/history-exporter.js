// LiveSub Component: history-exporter
export default {
  addHistory(sourceText, viText, lang) {
    const id = Date.now() + Math.random().toString(36).substring(2, 6);
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    const record = { id, timestamp: timeStr, sourceText, viText, lang, audioBlobUrl: null };
    this.history.push(record);
    // Bounded history: keep latest 150 items to prevent unbounded memory growth
    if (this.history.length > 150) {
      this.history.shift();
      if (this.historyList.lastElementChild && this.historyList.lastElementChild !== this.historyEmpty) {
        this.historyList.removeChild(this.historyList.lastElementChild);
      }
    }
    this.historyCount.textContent = this.history.length;
    this.historyEmpty.style.display = 'none';

    const itemEl = document.createElement('div');
    itemEl.className = 'history-item';
    itemEl.id = `history-${id}`;
    const cleanSource = (sourceText || '').trim().replace(/[.!?…]+$/, '').toLowerCase();
    const cleanVi = (viText || '').trim().replace(/[.!?…]+$/, '').toLowerCase();
    const isDuplicateText = cleanSource && cleanVi && (cleanSource === cleanVi);

    itemEl.innerHTML = `
      <div class="history-meta">
        <span>[${timeStr}] (${lang.toUpperCase()})</span>
      </div>
      ${isDuplicateText ? '' : `<div class="history-source-text">${this.escapeHtml(sourceText)}</div>`}
      <div class="history-vi-text">${this.escapeHtml(viText)}</div>
    `;

    this.historyList.prepend(itemEl);
    return record;
  },

  async playHistoryAudio(id) {
    const item = this.history.find(h => h.id === id);
    if (!item || !item.viText) return;
    try {
      const voice = this.getEffectiveVoice();
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: item.viText, voice })
      });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        await this.playAudioBuffer(arrayBuf);
      }
    } catch (e) {
      console.warn('Replay audio error:', e);
    }
  },

  clearHistory() {
    this.history = [];
    if (this.historyCount) this.historyCount.textContent = '0';
    if (this.historyList) {
      this.historyList.innerHTML = '';
      if (this.historyEmpty) {
        this.historyEmpty.style.display = 'block';
        this.historyList.appendChild(this.historyEmpty);
      }
    }
    this.recentOCRHistory = [];
    this.lastOCRText = '';
    this.lastCleanText = '';
    this.liveDubbingQueue = [];
    this.speechQueue = [];
    if (typeof this.stopDubbingAudio === 'function') {
      this.stopDubbingAudio(false, true);
    }
  },

  async exportSRT() {
    if (!this.history || this.history.length === 0) {
      alert('⚠️ Chưa có nội dung phụ đề trong lịch sử để xuất. Hãy quét hoặc dịch video trước khi xuất .SRT.');
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
      if (this.currentSubMode === 'source_only' || this.currentSubMode === 'en_only') {
        srtContent += `${item.sourceText || ''}\n\n`;
      } else if (this.currentSubMode === 'vi_only') {
        srtContent += `${item.viText || ''}\n\n`;
      } else {
        srtContent += `${item.sourceText || ''}\n${item.viText || ''}\n\n`;
      }
    });

    await this.downloadFile(srtContent, `LiveSub_${Date.now()}.srt`, 'text/plain;charset=utf-8');
  },

  async exportTXT() {
    if (!this.history || this.history.length === 0) {
      alert('⚠️ Chưa có nội dung kịch bản trong lịch sử để xuất. Hãy quét hoặc dịch video trước khi xuất .TXT.');
      return;
    }
    let txtContent = `=== LỊCH SỬ DỊCH & KỊCH BẢN LIVESUB STUDIO ===\n`;
    txtContent += `Thời gian xuất: ${new Date().toLocaleString('vi-VN')}\n\n`;

    this.history.forEach((item, idx) => {
      txtContent += `[${item.timestamp || ''}] #${idx + 1}\n`;
      txtContent += `Gốc (${item.lang || 'auto'}): ${item.sourceText || ''}\n`;
      txtContent += `Dịch (VI): ${item.viText || ''}\n\n`;
    });

    await this.downloadFile(txtContent, `LiveSub_Script_${Date.now()}.txt`, 'text/plain;charset=utf-8');
  },

  formatSRTTime(milliseconds) {
    const hours = String(Math.floor(milliseconds / 3600000)).padStart(2, '0');
    const remaining = milliseconds % 3600000;
    const minutes = String(Math.floor(remaining / 60000)).padStart(2, '0');
    const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
    const millis = String(remaining % 1000).padStart(3, '0');
    return `${hours}:${minutes}:${seconds},${millis}`;
  },

  async downloadFile(content, fileName, mimeType) {
    // 1. Try Native Backend Export API (Saves directly to user's Downloads folder)
    try {
      const res = await fetch('/api/export-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fileName, content })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && data.path) {
          alert(`✅ Đã xuất file thành công vào thư mục Downloads:\n${data.path}`);
          return;
        }
      }
    } catch (_) {}

    // 2. Fallback for browser download
    try {
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
      }, 500);
      alert(`✅ Đã xuất file: ${fileName}`);
    } catch (err) {
      alert(`❌ Lỗi khi xuất file: ${err.message}`);
    }
  },

  getRealtimeMetrics() {
    const values = [...this.realtimeMetrics.samples].sort((a, b) => a - b);
    const percentile = p => values.length
      ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))]
      : null;
    return {
      ...this.realtimeMetrics,
      p50SpeechEndToVoiceMs: percentile(0.50),
      p95SpeechEndToVoiceMs: percentile(0.95),
      p99SpeechEndToVoiceMs: percentile(0.99),
      speechQueueDepth: this.speechQueue.length,
      dubbingQueueDepth: this.liveDubbingQueue.length,
      isTranscribing: this.isTranscribing,
      isSpeakingVietnamese: this.streamingAudioSources.size > 0
    };
  },

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
};
