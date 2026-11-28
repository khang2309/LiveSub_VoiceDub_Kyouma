import React from 'react';

export default function YouTubePanel({
  visible,
  ytMode,
  ocrZone,
  onLoadWebVideo,
  onSetYtMode,
  onYtOcrZoneChange,
  onEditOcrRegion,
  onStartYtLiveCapture,
  onToggleFullscreen,
  onCloseVideo
}) {
  return (
    <div
      id="panelSourceWebUrl"
      className="source-panel-block"
      style={{
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: '14px',
        padding: '14px',
        width: '100%'
      }}
    >
      <div style={{ marginBottom: '8px' }}>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '2px' }}>🌐 Xem Video YouTube &amp; Lồng Tiếng Realtime</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          Dán link YouTube (VD: MrBeast, Tin tức...) để tự động dịch và đọc lồng tiếng
        </p>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <input
          type="url"
          id="webUrlInput"
          className="form-control"
          placeholder="https://www.youtube.com/watch?v=..."
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-primary)',
            color: 'var(--text-main)',
            fontSize: '0.88rem'
          }}
        />
        <button
          id="btnLoadWebUrl"
          className="btn btn-primary"
          type="button"
          style={{ whiteSpace: 'nowrap', padding: '8px 16px', fontWeight: 600 }}
          onClick={onLoadWebVideo}
        >
          ▶️ Nạp Video
        </button>
      </div>

      <div
        className="yt-mode-bar"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}
      >
        <div className="mode-toggle-group" style={{ flex: 1, minWidth: '260px' }}>
          <button
            type="button"
            id="btnYtModeCC"
            className={`btn-mode${ytMode === 'has_captions' ? ' active' : ''}`}
            title="Lấy phụ đề sẵn (Closed Captions) từ YouTube"
            onClick={() => onSetYtMode('has_captions')}
          >
            📝 CC YouTube
          </button>
          <button
            type="button"
            id="btnYtModeOCR"
            className={`btn-mode${ytMode === 'hard_sub' ? ' active' : ''}`}
            title="Quét phụ đề chữ in trên khung hình video bằng GPU OCR (khi không có CC)"
            onClick={() => onSetYtMode('hard_sub')}
          >
            📷 Quét OCR
          </button>
          <button
            type="button"
            id="btnYtModeWhisper"
            className={`btn-mode${ytMode === 'audio_only' ? ' active' : ''}`}
            title="Nghe giọng nói trực tiếp bằng Whisper GPU CUDA (khi không có phụ đề)"
            onClick={() => onSetYtMode('audio_only')}
          >
            🎙️ Nghe Whisper
          </button>
        </div>

        <div
          id="ytLiveCaptureControls"
          style={{
            display: ytMode === 'hard_sub' || ytMode === 'audio_only' ? 'flex' : 'none',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap'
          }}
        >
          <select
            id="ytOcrZoneSelect"
            className="form-control form-control-compact select-zone"
            title="Vùng quét phụ đề OCR"
            style={{ display: ytMode === 'hard_sub' ? 'inline-block' : 'none' }}
            value={ocrZone}
            onChange={(e) => onYtOcrZoneChange(e.target.value)}
          >
            <option value="bottom">📐 1/3 Đáy</option>
            <option value="split">📺 Nửa Dưới</option>
            <option value="full">🖥️ Toàn Hình</option>
            <option value="custom">✂ Vùng tùy chỉnh</option>
          </select>
          <button type="button" className="btn btn-secondary btn-compact" style={{ display: ytMode === 'hard_sub' ? 'inline-flex' : 'none' }} onClick={onEditOcrRegion}>✏ Chỉnh vùng</button>
          <button
            id="btnYtLiveCapture"
            className="btn-hero-action"
            type="button"
            style={{ height: '34px', padding: '0 12px', fontSize: '0.82rem' }}
            onClick={onStartYtLiveCapture}
          >
            <span id="btnYtLiveCaptureText">🎙️ Bắt Đầu Nghe Whisper</span>
          </button>
        </div>
      </div>

      <div id="webVideoContainer" className="web-video-wrapper" style={{ display: 'none', position: 'relative' }}>
        <div
          className="video-top-bar"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 10px',
            marginBottom: '6px',
            background: 'rgba(0, 0, 0, 0.4)',
            borderRadius: '6px'
          }}
        >
          <span
            id="webVideoTitle"
            style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}
          >
            YouTube Video
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              id="btnFullscreenWebVideo"
              className="btn btn-sm btn-secondary"
              type="button"
              title="Toàn màn hình (Phím tắt: F)"
              style={{ padding: '3px 10px', fontSize: '0.78rem' }}
              onClick={onToggleFullscreen}
            >
              <span id="btnFullscreenWebVideoText">⛶ Toàn Màn Hình</span>
            </button>
            <button
              id="btnCloseWebVideo"
              className="btn btn-sm"
              type="button"
              title="Đóng phát video"
              style={{
                background: 'rgba(239, 68, 68, 0.25)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                fontWeight: 600,
                padding: '3px 10px',
                fontSize: '0.78rem',
                cursor: 'pointer',
                borderRadius: '4px'
              }}
              onClick={onCloseVideo}
            >
              ✕ Đóng Video
            </button>
          </div>
        </div>
        <div className="video-element-container">
          <div id="webVideoPlayer" className="iframe-element-container"></div>
          <div className="invideo-subtitle-overlay">
            <div id="invideoWebSubSource" className="invideo-sub-source" style={{ display: 'none' }} data-empty="true"></div>
            <div id="invideoWebSubVi" className="invideo-sub-vi" style={{ display: 'none' }} data-empty="true"></div>
          </div>
        </div>
        <div id="webSyncNotice" className="web-sync-notice" style={{ display: 'none' }}></div>
      </div>

      <form
        id="webVideoForm"
        style={{ display: 'none' }}
        onSubmit={(e) => {
          e.preventDefault();
          onLoadWebVideo();
        }}
      >
        <button id="btnWebLiveCapture" type="button" onClick={onStartYtLiveCapture}>
          Bắt âm thanh
        </button>
      </form>
    </div>
  );
}
