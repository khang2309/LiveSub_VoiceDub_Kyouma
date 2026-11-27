import React from 'react';

export default function SourceTabs({ activeSource, onSwitchSource }) {
  return (
    <nav className="source-nav-bar" style={{ marginBottom: '12px' }}>
      <button
        className={`source-tab${activeSource === 'system' ? ' active' : ''}`}
        id="tabSourceSystem"
        data-source="system"
        type="button"
        onClick={() => onSwitchSource('system')}
      >
        <span className="tab-icon">🖥️</span>
        <div className="tab-info">
          <strong>Màn hình / Tab Phim</strong>
          <span>Xem phim, Anime, Livestream</span>
        </div>
      </button>
      <button
        className={`source-tab${activeSource === 'weburl' ? ' active' : ''}`}
        id="tabSourceWebUrl"
        data-source="weburl"
        type="button"
        onClick={() => onSwitchSource('weburl')}
      >
        <span className="tab-icon">🌐</span>
        <div className="tab-info">
          <strong>Link YouTube</strong>
          <span>Xem video &amp; dịch phụ đề</span>
        </div>
      </button>
    </nav>
  );
}
