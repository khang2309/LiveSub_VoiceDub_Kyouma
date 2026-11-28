import React from 'react';

export default function SystemCapturePanel({
  visible,
  systemMode,
  ocrZone,
  onToggleSystemAudio,
  onSetSystemMode,
  onOcrZoneChange,
  onEditOcrRegion
}) {
  return (
    <div
      id="panelSourceSystem"
      style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', width: '100%', gap: '10px' }}
    >
      <div
        className="control-row-bottom"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '12px 16px',
          flexWrap: 'wrap'
        }}
      >
        <button
          id="btnToggleSystemAudio"
          className="btn-hero-action"
          type="button"
          style={{ flex: '1 1 240px', minWidth: 0 }}
          onClick={onToggleSystemAudio}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span id="btnSystemAudioText">BẮT ĐẦU ĐỌC &amp; LỒNG TIẾNG SUB</span>
        </button>

        <div className="control-cell">
          <span className="control-label visually-hidden">Chế độ video:</span>
          <div className="mode-toggle-group">
            <button
              type="button"
              id="btnModeSub"
              className={`btn-mode${systemMode === 'ocr' ? ' active' : ''}`}
              title="Dành cho Anime, Phim có phụ đề chữ in trên video"
              onClick={() => onSetSystemMode('ocr')}
            >
              📷 Đọc Sub OCR
            </button>
            <button
              type="button"
              id="btnModeAudio"
              className={`btn-mode${systemMode === 'whisper' ? ' active' : ''}`}
              title="Dành cho video không có sub: YouTube, Livestream"
              onClick={() => onSetSystemMode('whisper')}
            >
              🎙️ Nghe Whisper
            </button>
            <button
              type="button"
              id="btnModeHybrid"
              className={`btn-mode${systemMode === 'auto' ? ' active' : ''}`}
              title="Tự động nhận diện: Ưu tiên đọc phụ đề trên màn hình, kết hợp nghe Whisper"
              onClick={() => onSetSystemMode('auto')}
            >
              ⚡ Tự Động Hybrid
            </button>
          </div>
        </div>

        <div className="control-cell-zone" id="cellOcrZone" title="Chọn vùng quét phụ đề trên khung hình chia sẻ">
          <label htmlFor="ocrZoneSelect" className="control-label visually-hidden">
            Vùng Quét Sub:
          </label>
          <select
            id="ocrZoneSelect"
            className="form-control form-control-compact select-zone"
            value={ocrZone}
            onChange={(e) => onOcrZoneChange(e.target.value)}
          >
            <option value="bottom">📐 1/3 Đáy (Phim)</option>
            <option value="split">📺 Nửa Dưới (50%)</option>
            <option value="full">🖥️ Toàn Màn Hình</option>
            <option value="custom">✂ Vùng tùy chỉnh</option>
          </select>
          <button type="button" className="btn btn-secondary btn-compact" onClick={onEditOcrRegion}>✏ Chỉnh vùng</button>
        </div>

        <div id="oneTouchDetectionPill" className="one-touch-status-pill">
          📷 Đang đọc sub OCR (~150ms)
        </div>
      </div>
    </div>
  );
}
