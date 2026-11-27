import test from 'node:test';
import assert from 'node:assert/strict';

import ocrScanner from '../src/engines/ocr-scanner.js';

function createScanner(overrides = {}) {
  const events = [];
  const studio = Object.assign({
    isScanningPaused: false,
    isDubbingEnabled: true,
    liveDubbingQueue: [],
    recentOCRHistory: [],
    lastOCRText: '',
    lastCleanText: '',
    detectedOCRLanguage: 'vi',
    sanitizeDubbingText: (text) => text.replace(/^\s*\[[^\]]+\]\s*$/u, '').trim(),
    resolveOCRLanguage: () => 'vi',
    isGarbageOCR: () => false,
    isDuplicateOCR: () => false,
    ocrSimilarity: () => 0,
    addHistory: () => ({ id: 17 }),
    displaySubtitle: (original, translated) => events.push(['display', original, translated]),
    enqueueLiveDubbing: (...args) => events.push(['enqueue', ...args])
  }, ocrScanner, overrides);
  return { studio, events };
}

test('OCR publishes the subtitle before handing the same cue to TTS', () => {
  const { studio, events } = createScanner();

  studio.handleOCRSubtitle({
    original: 'Vâng, Tiêu viện trưởng',
    translated: 'Vâng, Tiêu viện trưởng',
    hadEmptyGap: true,
    timings: { ocr_ms: 72 }
  });

  assert.deepEqual(events.map(([name]) => name), ['display', 'enqueue']);
  assert.equal(events[0][2], 'Vâng, Tiêu viện trưởng');
  assert.equal(events[1][1], 'Vâng, Tiêu viện trưởng');
  assert.equal(events[1][8], 'ocr');
});

test('OCR displays non-speech cues but never sends them to TTS', () => {
  const { studio, events } = createScanner({ sanitizeDubbingText: () => '' });

  studio.handleOCRSubtitle({ original: '[Âm nhạc]', translated: '[Âm nhạc]' });

  assert.deepEqual(events.map(([name]) => name), ['display']);
});

test('YouTube OCR keeps LiveSub output outside the selected scan band', () => {
  const classes = new Set();
  const classList = {
    add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name))
  };
  const { studio } = createScanner({
    activeSource: 'weburl',
    isOCRModeActive: true,
    _cropOcrToEmbeddedVideo: true,
    webVideoContainer: { querySelector: () => ({ classList }) }
  });

  studio.ocrScanZone = 'bottom';
  studio.updateOcrFeedbackGuard();
  assert.equal(classes.has('ocr-safe-top'), true);

  studio.ocrScanZone = 'top';
  studio.updateOcrFeedbackGuard();
  assert.equal(classes.has('ocr-safe-bottom'), true);
  assert.equal(classes.has('ocr-safe-top'), false);

  studio.ocrScanZone = 'full';
  studio.updateOcrFeedbackGuard();
  assert.equal(classes.has('ocr-feedback-hidden'), true);
});

test('screen OCR removes LiveSub translated text from a captured frame', () => {
  const { studio } = createScanner({
    isOCRModeActive: true,
    recentRenderedOcrTranslations: [{ text: 'Tôi đã hiểu rồi', time: performance.now() }]
  });

  const combined = studio.removeRenderedSubtitleEcho('I understand now Tôi đã hiểu rồi');
  assert.equal(combined.text, 'I understand now');
  assert.equal(combined.changed, true);

  const echoOnly = studio.removeRenderedSubtitleEcho('Tôi đã hiểu rồi');
  assert.equal(echoOnly.echoOnly, true);
  assert.equal(echoOnly.text, '');
});

test('a genuine repeated subtitle after an empty gap is not suppressed as feedback', () => {
  const { studio } = createScanner({
    isOCRModeActive: true,
    recentRenderedOcrTranslations: [{ text: 'Đừng đi', time: performance.now() }]
  });

  const result = studio.removeRenderedSubtitleEcho('Đừng đi', true);
  assert.equal(result.text, 'Đừng đi');
  assert.equal(result.changed, false);
});
