import React from 'react';

export default function HeaderBar({ onTestSpeaker }) {
  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-icon">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <path d="m5 8 3 3" />
            <path d="m19 8-3 3" />
          </svg>
        </div>
        <h1>
          LiveSub Studio{' '}
          <span
            style={{
              fontSize: '11px',
              background: 'rgba(56, 189, 248, 0.2)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontWeight: 700,
              verticalAlign: 'middle',
              marginLeft: '6px'
            }}
          >
            v1.0.5
          </span>
        </h1>
      </div>

      <div className="header-actions">
        <div className="status-badge" id="statusBadge">
          <span className="status-dot"></span>
          <span id="statusText">Sẵn sàng</span>
        </div>
        <button
          id="btnTestSpeaker"
          className="btn btn-secondary btn-sm"
          title="Kiểm tra âm thanh loa"
          onClick={onTestSpeaker}
        >
          Thử loa
        </button>
      </div>
    </header>
  );
}
