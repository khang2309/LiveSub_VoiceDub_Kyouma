import React from 'react';

export default function LegacyHiddenBridge() {
  return (
    <>
      <div id="legacyHiddenContainer" style={{ display: 'none' }} aria-hidden="true">
        <button id="btnFloatingWindow" style={{ display: 'none' }}></button>
        <input type="checkbox" id="chkEnableWhisper" defaultChecked={false} />
        <section className="runtime-config" aria-labelledby="runtimeConfigTitle">
          <strong id="runtimeConfigTitle">Nguồn → nhận dạng → dịch → giọng Việt</strong>
          <span id="settingsApplyState" className="apply-state" data-state="applied">
            <span className="apply-state-dot"></span>Đã áp dụng
          </span>
          <strong id="runtimeSourceValue">Hệ thống / Tab</strong>
          <strong id="runtimeLanguageValue">Tự động</strong>
          <strong id="runtimeSubtitleValue">Song ngữ</strong>
          <strong id="runtimeVoiceValue">VieNeu Local</strong>
          <strong id="runtimeEngineValue">Whisper CUDA</strong>
          <button id="btnConfirmSettings" type="button">Đồng bộ</button>
        </section>

        <strong id="systemIntelligenceTitle">Phương thức</strong>
        <span id="systemIntelligenceState">Sẵn sàng</span>
        <p id="systemIntelligenceHint"></p>
        <fieldset id="systemCaptureMode">
          <input type="radio" name="systemCaptureMode" value="auto" defaultChecked />
          <input type="radio" name="systemCaptureMode" value="audio_only" />
          <input type="radio" name="systemCaptureMode" value="hard_sub" />
        </fieldset>
        <fieldset id="systemSubMode">
          <input type="radio" name="systemSubMode" value="bilingual" defaultChecked />
          <input type="radio" name="systemSubMode" value="vi_only" />
          <input type="radio" name="systemSubMode" value="source_only" />
          <input type="radio" name="systemSubMode" value="en_only" />
          <input type="radio" name="systemSubMode" value="none" />
        </fieldset>
        <div id="audioMeterFill"></div>
        <span id="meterPercentText">0%</span>

        <select id="targetLang" disabled defaultValue="vi">
          <option value="vi">Tiếng Việt</option>
        </select>
        <input type="radio" name="subTransparency" value="transparent" defaultChecked />
        <input type="radio" name="subTransparency" value="glass" />
        <input type="radio" name="subTransparency" value="dark" />

        <strong id="sourceIntelligenceTitle"></strong>
        <span id="sourceIntelligenceState"></span>
        <fieldset id="webCaptionMode">
          <input type="radio" name="webCaptionMode" value="auto" />
          <input type="radio" name="webCaptionMode" value="has_captions" defaultChecked />
          <input type="radio" name="webCaptionMode" value="hard_sub" />
          <input type="radio" name="webCaptionMode" value="audio_only" />
        </fieldset>
        <fieldset id="webCaptionLanguage">
          <input type="radio" name="webCaptionLanguage" value="auto" />
          <input type="radio" name="webCaptionLanguage" value="original" defaultChecked />
          <input type="radio" name="webCaptionLanguage" value="en" />
          <input type="radio" name="webCaptionLanguage" value="vi" />
          <input type="radio" name="webCaptionLanguage" value="zh" />
          <input type="radio" name="webCaptionLanguage" value="ja" />
          <input type="radio" name="webCaptionLanguage" value="ko" />
          <input type="radio" name="webCaptionLanguage" value="th" />
        </fieldset>
        <p id="sourceIntelligenceHint"></p>

        <button id="btnMasterDubToggle" style={{ display: 'none' }}>
          <span id="btnMasterDubText"></span>
        </button>
        <button id="btnCinemaMasterDubToggle" style={{ display: 'none' }}>
          <span id="btnCinemaMasterDubText"></span>
        </button>
        <div id="cinemaBox" style={{ display: 'none' }}></div>
        <button id="btnToggleBoxTransparent"></button>
      </div>
      <audio id="dubbingAudio" preload="auto"></audio>
    </>
  );
}
