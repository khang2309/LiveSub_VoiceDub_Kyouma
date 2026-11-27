import React from 'react';

export const SOURCE_LANGUAGES = [
  ['auto', '🌐 Tự động nhận diện (6 ngôn ngữ)'],
  ['vi-VN', '🇻🇳 Tiếng Việt (Không dịch)'],
  ['ja-JP', '🇯🇵 Tiếng Nhật'],
  ['en-US', '🇬🇧 Tiếng Anh'],
  ['zh-CN', '🇨🇳 Tiếng Trung'],
  ['ko-KR', '🇰🇷 Tiếng Hàn'],
  ['th-TH', '🇹🇭 Tiếng Thái']
];

export const SUB_MODES = [
  { value: 'bilingual', label: '🔤 Song ngữ', title: 'Hiện cả phụ đề gốc và tiếng Việt' },
  { value: 'vi_only', label: '🇻🇳 Chỉ Tiếng Việt', title: 'Chỉ hiện phụ đề tiếng Việt' },
  { value: 'source_only', label: '🌐 Chỉ Tiếng Gốc', title: 'Chỉ hiện phụ đề tiếng gốc' },
  { value: 'en_only', label: '🇬🇧 Chỉ Tiếng Anh', title: 'Chỉ hiện phụ đề tiếng Anh' },
  { value: 'none', label: '🔇 Không Sub', title: 'Không hiện chữ, chỉ phát giọng lồng tiếng' }
];

export default function QuickControlBar({
  sourceLangLabel = 'Ngôn Ngữ Gốc:',
  sourceLang,
  onSourceLangChange,
  voice,
  onVoiceChange,
  subMode,
  onSubModeChange,
  transparency,
  onTransparencyChange,
  rate,
  onRateChange,
  adaptiveSpeed,
  onAdaptiveSpeedChange,
  volume,
  onVolumeChange,
  onPanicKill,
  onPauseScan
}) {
  return (
    <div className="quick-control-bar" style={{ marginBottom: '8px' }}>
      <div
        className="control-row-top"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}
      >
        <div className="control-cell" style={{ flex: '1 1 170px', minWidth: 0 }}>
          <label htmlFor="sourceLang" id="lblSourceLang" className="control-label">
            {sourceLangLabel}
          </label>
          <select
            id="sourceLang"
            className="form-control form-control-compact"
            value={sourceLang}
            onChange={(e) => onSourceLangChange(e.target.value)}
          >
            {SOURCE_LANGUAGES.map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="control-cell" style={{ flex: '1.6 1 220px', minWidth: 0 }}>
          <label htmlFor="voiceSelect" className="control-label">
            Giọng Lồng Tiếng:
          </label>
          <select
            id="voiceSelect"
            className="form-control form-control-compact select-highlight"
            value={voice}
            onChange={(e) => onVoiceChange(e.target.value)}
          >
            <optgroup label="⚡ Microsoft Edge-TTS Neural (~200ms - Siêu Tốc Khuyên Dùng)">
              <option value="edge:Hoài My">⚡ Hoài My (Nữ Truyền Cảm - Siêu Tốc)</option>
              <option value="edge:Nam Minh">⚡ Nam Minh (Nam Trầm Ấm - Siêu Tốc)</option>
            </optgroup>
            <optgroup label="🎙️ VieNeu-TTS Neural (100% Offline GPU CUDA)">
              <option value="vieneu:Trúc Ly">🎙️ Trúc Ly (Nữ Dịu Dàng - GPU)</option>
              <option value="vieneu:Hải Đăng">🎙️ Hải Đăng (Nam Trầm Ấm - GPU)</option>
              <option value="vieneu:Thiện Minh">🎙️ Thiện Minh (Nam Kể Chuyện - GPU)</option>
              <option value="vieneu:Mai Anh">🎙️ Mai Anh (Nữ Trẻ Trung - GPU)</option>
              <option value="vieneu:Thùy Dung">🎙️ Thùy Dung (Nữ Truyền Cảm - GPU)</option>
              <option value="vieneu:Thái Sơn">🎙️ Thái Sơn (Nam Hùng Hồn - GPU)</option>
              <option value="vieneu:Ngọc Huyền">🎙️ Ngọc Huyền (Nữ Miền Nam Ngọt Ngào - GPU)</option>
              <option value="vieneu:Quỳnh Anh">🎙️ Quỳnh Anh (Nữ Trong Trẻo - GPU)</option>
              <option value="vieneu:Đức Trí">🎙️ Đức Trí (Nam Tri Thức - GPU)</option>
              <option value="vieneu:Minh Đức">🎙️ Minh Đức (Nam Tự Nhiên - GPU)</option>
              <option value="vieneu:Kim Thanh">🎙️ Kim Thanh (Nữ Chuẩn Mực - GPU)</option>
            </optgroup>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
          <button
            id="btnPanicKill"
            className="btn btn-secondary btn-compact"
            type="button"
            title="Bật / Tắt âm lồng tiếng tức thì (Phím tắt: M)"
            style={{ height: '34px', padding: '0 12px', whiteSpace: 'nowrap' }}
            onClick={onPanicKill}
          >
            ⏹ Dừng Âm (M)
          </button>
          <button
            id="btnPauseScan"
            className="btn btn-secondary btn-compact"
            type="button"
            title="Tạm dừng quét & lồng tiếng tránh dịch nhầm nhạc OST / Credits (Phím tắt: P)"
            style={{ height: '34px', padding: '0 12px', whiteSpace: 'nowrap' }}
            onClick={onPauseScan}
          >
            ⏸️ Tạm Dừng (P)
          </button>
        </div>
      </div>

      <div
        className="control-row-middle"
        style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap' }}
      >
        <div className="control-cell" style={{ flex: '2 1 360px', minWidth: 0 }}>
          <span className="control-label">Phụ đề hệ thống / video:</span>
          <div className="sub-mode-btn-group" id="subModeBtnGroup" style={{ flexWrap: 'wrap', height: 'auto', minHeight: '34px' }}>
            {SUB_MODES.map((m) => (
              <label key={m.value} className="btn-submode" title={m.title}>
                <input
                  type="radio"
                  name="subMode"
                  value={m.value}
                  checked={subMode === m.value}
                  onChange={() => onSubModeChange(m.value)}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
          <div className="subtitle-appearance-controls" role="group" aria-label="Độ đậm nền phụ đề">
            {[
              ['transparent', 'Trong', 'Không nền, chỉ giữ viền chữ'],
              ['glass', 'Mờ', 'Nền kính mờ dễ nhìn'],
              ['dark', 'Đậm', 'Nền tối rõ nhất']
            ].map(([value, label, title]) => (
              <button
                key={value}
                type="button"
                className={`btn-subtitle-appearance${transparency === value ? ' active' : ''}`}
                title={title}
                aria-pressed={transparency === value}
                onClick={() => onTransparencyChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="control-cell control-cell-pacing" style={{ flex: '1 1 190px', minWidth: 0 }}>
          <div className="pacing-header">
            <span className="control-label">
              Tốc độ: <strong id="rateValue">{Number(rate).toFixed(2)}x</strong>
            </span>
            <label
              className="adaptive-speed-label"
              title="Tự động tăng tốc giọng đọc để đuổi kịp phụ đề video mà không dừng video"
            >
              <input
                type="checkbox"
                id="chkAdaptiveSpeed"
                checked={adaptiveSpeed}
                onChange={(e) => onAdaptiveSpeedChange(e.target.checked)}
              />
              <span>⚡ Thích ứng video</span>
            </label>
          </div>
          <input
            type="range"
            id="rateRange"
            className="form-range"
            min="0.8"
            max="1.75"
            step="0.05"
            value={rate}
            onChange={(e) => onRateChange(parseFloat(e.target.value))}
            title="Kéo để chỉnh tốc độ đọc (0.8x - 1.75x)"
          />
        </div>

        <div className="control-cell control-cell-vol" style={{ flex: '0.8 1 130px', minWidth: 0 }}>
          <span className="control-label">
            Âm lượng: <strong id="volumeValue">{volume}%</strong>
          </span>
          <input
            type="range"
            id="volumeRange"
            className="form-range"
            min="0"
            max="100"
            step="5"
            value={volume}
            onChange={(e) => onVolumeChange(parseInt(e.target.value, 10))}
            title="Kéo để chỉnh âm lượng"
          />
        </div>
      </div>
    </div>
  );
}
