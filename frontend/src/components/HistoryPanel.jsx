import React from 'react';

export default function HistoryPanel({ onExportSRT, onExportTXT, onClearHistory }) {
  return (
    <section className="history-panel">
      <div className="history-panel-header">
        <span className="panel-title-text">
          📜 Lịch Sử Thoại (<span id="historyCount">0</span>)
        </span>
        <div className="header-btn-group">
          <button
            id="btnExportSRT"
            className="btn btn-sm btn-secondary"
            title="Xuất file phụ đề chuẩn .SRT"
            onClick={onExportSRT}
          >
            .SRT
          </button>
          <button
            id="btnExportTXT"
            className="btn btn-sm btn-secondary"
            title="Xuất kịch bản text .TXT"
            onClick={onExportTXT}
          >
            .TXT
          </button>
          <button
            id="btnClearHistory"
            className="btn btn-sm btn-danger"
            title="Xóa toàn bộ lịch sử"
            onClick={onClearHistory}
          >
            Xóa
          </button>
        </div>
      </div>

      <div className="history-list" id="historyList">
        <div className="history-empty" id="historyEmpty">
          <p>
            👉 Chưa có câu thoại nào. Bấm <strong>BẮT ĐẦU</strong> để xem phim!
          </p>
        </div>
      </div>
    </section>
  );
}
