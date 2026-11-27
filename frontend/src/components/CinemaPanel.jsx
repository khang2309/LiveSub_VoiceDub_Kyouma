import React from 'react';

export default function CinemaPanel({
  onOpenPiP,
  onFontMinus,
  onFontPlus,
  onSendTestText,
  onTestVoiceSample
}) {
  return (
    <section className="cinema-panel">
      <div className="cinema-panel-header">
        <span className="panel-title-text">🎬 Phụ Đề Cinema View</span>
        <div className="header-btn-group">
          <button
            id="btnCinemaPiP"
            className="btn btn-primary btn-sm"
            title="Ghim phụ đề nổi Always-on-Top"
            onClick={onOpenPiP}
          >
            📌 Ghim PiP
          </button>
          <button id="btnSubtitleFontMinus" className="btn-icon" title="Giảm cỡ chữ" onClick={onFontMinus}>
            A-
          </button>
          <button id="btnSubtitleFontPlus" className="btn-icon" title="Tăng cỡ chữ" onClick={onFontPlus}>
            A+
          </button>
        </div>
      </div>

      <div className="cinema-screen cinema-box" id="subtitleViewport">
        <div className="subtitle-container" id="subtitleContainer">
          <div className="sub-line sub-source" id="subSourceDisplay" style={{ display: 'none' }}></div>
          <div className="sub-line sub-vi" id="subViDisplay" data-empty="true" style={{ display: 'none' }}></div>
        </div>

        <div className="dubbing-indicator" id="dubbingIndicator" style={{ marginTop: '10px' }}>
          <div className="waveform">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
          <span id="dubbingStatusText">VieNeu AI đang lồng tiếng…</span>
        </div>
      </div>

      <div
        className="test-text-bar"
        style={{
          display: 'flex',
          gap: '8px',
          marginTop: '8px',
          alignItems: 'center',
          background: 'var(--bg-card)',
          padding: '8px 12px',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}
      >
        <input
          type="text"
          id="testTextInput"
          className="form-control"
          placeholder="💬 Gõ câu thử nghiệm (Enter để dịch và phát âm thanh kiểm tra)..."
          style={{
            flex: 1,
            padding: '7px 10px',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-primary)',
            color: 'var(--text-main)',
            fontSize: '0.85rem'
          }}
          onKeyPress={(e) => {
            if (e.key === 'Enter') onSendTestText();
          }}
        />
        <button
          id="btnSendTestText"
          className="btn btn-primary btn-sm"
          type="button"
          style={{ whiteSpace: 'nowrap', padding: '7px 12px', fontSize: '0.82rem' }}
          onClick={onSendTestText}
        >
          🔊 Đọc Thử
        </button>
        <button
          id="btnTestVoiceSample"
          className="btn btn-secondary btn-sm"
          type="button"
          style={{ whiteSpace: 'nowrap', padding: '7px 12px', fontSize: '0.82rem' }}
          onClick={onTestVoiceSample}
        >
          🎧 Nghe Giọng
        </button>
      </div>
    </section>
  );
}
