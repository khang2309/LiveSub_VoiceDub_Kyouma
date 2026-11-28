import React, { useEffect, useRef, useState } from 'react';
import HeaderBar from './components/HeaderBar.jsx';
import SourceTabs from './components/SourceTabs.jsx';
import QuickControlBar from './components/QuickControlBar.jsx';
import SystemCapturePanel from './components/SystemCapturePanel.jsx';
import YouTubePanel from './components/YouTubePanel.jsx';
import CinemaPanel from './components/CinemaPanel.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import LegacyHiddenBridge from './components/LegacyHiddenBridge.jsx';
import OcrRegionSelector from './components/OcrRegionSelector.jsx';
import LiveDubStudio from './engines/LiveDubStudio.js';

export default function App() {
  const studioRef = useRef(null);
  const [ui, setUi] = useState({
    activeSource: 'system',
    sourceLang: 'auto',
    sourceLangLabel: 'Ngôn Ngữ Gốc:',
    voice: 'vieneu:Trúc Ly',
    subMode: 'vi_only',
    transparency: 'transparent',
    rate: 1.0,
    adaptiveSpeed: true,
    volume: 100,
    systemMode: 'ocr',
    ocrZone: 'bottom',
    ytMode: 'has_captions'
  });
  const [ocrEditor, setOcrEditor] = useState({ open: false, preview: '', region: null });

  useEffect(() => {
    const studio = new LiveDubStudio({
      onUIStateChange: (nextState) => {
        setUi((prev) => ({ ...prev, ...nextState }));
      }
    });
    studioRef.current = studio;
    window.app = studio;
    return () => {
      studio.destroy();
      if (studioRef.current === studio) {
        studioRef.current = null;
      }
      if (window.app === studio) {
        window.app = null;
      }
    };
  }, []);

  const studio = () => studioRef.current;
  const openOcrEditor = async () => {
    const app = studio();
    if (!app) return;
    const preview = await app.captureOcrRegionPreview();
    if (!preview) {
      app.showToast('Hãy bắt đầu chia sẻ màn hình/video trước khi chỉnh vùng OCR.');
      return;
    }
    setOcrEditor({ open: true, preview, region: app.customOcrRegion });
  };

  return (
    <div className="app-container">
      <HeaderBar onTestSpeaker={() => studio()?.testSpeaker()} />

      <main className="main-content">
        <div className="unified-source-workspace">
          <SourceTabs
            activeSource={ui.activeSource}
            onSwitchSource={(src) => studio()?.switchSourceTab(src)}
          />

          <QuickControlBar
            sourceLangLabel={ui.sourceLangLabel}
            sourceLang={ui.sourceLang}
            onSourceLangChange={(val) => {
              setUi((prev) => ({ ...prev, sourceLang: val }));
              studio()?.handleSourceLangChange(val);
            }}
            voice={ui.voice}
            onVoiceChange={(val) => {
              setUi((prev) => ({ ...prev, voice: val }));
              setTimeout(() => studio()?.handleVoiceChange(), 0);
            }}
            subMode={ui.subMode}
            onSubModeChange={(mode) => {
              setUi((prev) => ({ ...prev, subMode: mode }));
              studio()?.setSubMode(mode);
            }}
            transparency={ui.transparency}
            onTransparencyChange={(mode) => {
              setUi((prev) => ({ ...prev, transparency: mode }));
              studio()?.setSubtitleTransparency(mode);
            }}
            rate={ui.rate}
            onRateChange={(val) => {
              setUi((prev) => ({ ...prev, rate: val }));
              studio()?.handleRateChange(val);
            }}
            adaptiveSpeed={ui.adaptiveSpeed}
            onAdaptiveSpeedChange={(checked) => {
              setUi((prev) => ({ ...prev, adaptiveSpeed: checked }));
              studio()?.handleAdaptiveSpeedChange(checked);
            }}
            volume={ui.volume}
            onVolumeChange={(val) => {
              setUi((prev) => ({ ...prev, volume: val }));
              studio()?.handleVolumeChange(val);
            }}
            onPanicKill={() => studio()?.toggleDubbingMute()}
            onPauseScan={() => studio()?.toggleScanningPause()}
          />
        </div>

        <div className="main-content-streamlined">
          <div className="video-workspace-column">
            <SystemCapturePanel
              visible={ui.activeSource === 'system'}
              systemMode={ui.systemMode}
              ocrZone={ui.ocrZone}
              onToggleSystemAudio={() => studio()?.toggleSystemAudio()}
              onSetSystemMode={(mode) => studio()?.setSystemMode(mode)}
              onOcrZoneChange={(val) => {
                setUi((prev) => ({ ...prev, ocrZone: val }));
                studio()?.handleOcrZoneChange(val, false);
              }}
              onEditOcrRegion={openOcrEditor}
            />

            <YouTubePanel
              visible={ui.activeSource === 'weburl'}
              ytMode={ui.ytMode}
              ocrZone={ui.ocrZone}
              onLoadWebVideo={() => studio()?.loadWebVideo()}
              onSetYtMode={(mode) => studio()?.setYouTubeMode(mode)}
              onYtOcrZoneChange={(val) => {
                setUi((prev) => ({ ...prev, ocrZone: val }));
                studio()?.handleOcrZoneChange(val, true);
              }}
              onEditOcrRegion={openOcrEditor}
              onStartYtLiveCapture={() => studio()?.startYouTubeLiveCapture()}
              onToggleFullscreen={() => studio()?.toggleWebVideoFullscreen()}
              onCloseVideo={() => studio()?.closeWebVideo()}
            />
          </div>

          <div className="subtitles-workspace-column">
            <CinemaPanel
              onOpenPiP={() => studio()?.openFloatingOverlay()}
              onFontMinus={() => studio()?.adjustFontSize(-2)}
              onFontPlus={() => studio()?.adjustFontSize(2)}
              onSendTestText={() => studio()?.handleTestText()}
              onTestVoiceSample={() => studio()?.auditionSelectedVoice()}
            />

            <HistoryPanel
              onExportSRT={() => studio()?.exportSRT()}
              onExportTXT={() => studio()?.exportTXT()}
              onClearHistory={() => studio()?.clearHistory()}
            />
          </div>
        </div>
      </main>

      <LegacyHiddenBridge />
      <OcrRegionSelector
        open={ocrEditor.open}
        preview={ocrEditor.preview}
        initialRegion={ocrEditor.region}
        onClose={() => setOcrEditor((prev) => ({ ...prev, open: false }))}
        onApply={(region) => {
          studio()?.setCustomOcrRegion(region);
          setUi((prev) => ({ ...prev, ocrZone: 'custom' }));
          setOcrEditor((prev) => ({ ...prev, open: false, region }));
        }}
      />
    </div>
  );
}
