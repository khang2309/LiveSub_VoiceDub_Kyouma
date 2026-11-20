const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const LiveDubStudio = require('../public/app.js');

function el() {
  return { style: {}, textContent: '', classList: { add() {}, remove() {} } };
}

test('auto voice resolves to the single startup-selected provider', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.voiceSelect = { value: 'auto-fast' };
  app.autoVoiceProvider = 'vieneu:Thái Sơn';
  assert.equal(app.getEffectiveVoice(), 'vieneu:Thái Sơn');
  app.voiceSelect.value = 'google-vi';
  assert.equal(app.getEffectiveVoice(), 'google-vi');
});

test('OCR capture is capped at the benchmarked 960 pixel width', () => {
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  assert.match(source, /Math\.min\(1, 960 \/ width\)/);
});

test('confirm settings verifies the running backend and exposes applied state', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      asr: { status: 'ready' },
      tts: { status: 'ready', auto_provider: { selected: 'vieneu:Thái Sơn', vieneu_ttfa_ms: 94 } }
    })
  });
  try {
    const app = Object.create(LiveDubStudio.prototype);
    app.activeSource = 'system';
    app.currentSubMode = 'bilingual';
    app.autoVoiceProvider = 'vieneu:Thái Sơn';
    app.voiceSelect = { value: 'auto-fast', selectedOptions: [{ text: 'Tự động nhanh nhất' }] };
    app.sourceLangSelect = { selectedOptions: [{ text: 'Tự động nhận diện' }] };
    app.rateRange = { value: '1.15' };
    app.settingsApplyState = { dataset: {}, innerHTML: '' };
    app.runtimeSourceValue = el();
    app.runtimeLanguageValue = el();
    app.runtimeSubtitleValue = el();
    app.runtimeVoiceValue = el();
    app.runtimeEngineValue = el();
    app.showToast = () => {};

    await app.confirmRuntimeSettings();

    assert.equal(app.settingsApplyState.dataset.state, 'applied');
    assert.match(app.settingsApplyState.innerHTML, /Đã xác nhận đang chạy/);
    assert.match(app.runtimeEngineValue.textContent, /Whisper CUDA/);
    assert.match(app.runtimeEngineValue.textContent, /TTFA 94ms/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('changing voice is silent and invalidates stale cache generation', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.voiceSelect = { value: 'vieneu:Thái Sơn', selectedOptions: [{ text: 'Thái Sơn' }] };
  app.audioPreCache = new Map([[0, { voice: 'old' }]]);
  app.isFetchingPreCache = new Set([0]);
  app.voiceGeneration = 2;
  app.currentYtSegmentIdx = -1;
  app.updateMasterDubUI = () => {};
  app.stopDubbingAudio = () => {};
  app.prefetchUpcomingAudio = () => {};
  app.showToast = () => {};
  app.auditionSelectedVoice = () => { throw new Error('voice selection must not audition'); };

  app.handleVoiceChange();

  assert.equal(app.voiceGeneration, 3);
  assert.equal(app.audioPreCache.size, 0);
});

test('voice playback rate is capped to avoid choppy speech', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.rateRange = { value: '1.50' };
  assert.equal(app.getSafePlaybackRate(), 1.50);
  assert.equal(app.getSafePlaybackRate(0.2), 1.50);
});

test('live VieNeu PCM is capped below GPU generation throughput', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.rateRange = { value: '1.50' };
  assert.equal(app.getSafeStreamingPlaybackRate(0), 1.20);
  assert.equal(app.getSafeStreamingPlaybackRate(8), 1.20);
  assert.equal(app.getSafeStreamingPlaybackRate(8, 1.04), 1.04);
  app.rateRange.value = '1.00';
  assert.equal(app.getSafeStreamingPlaybackRate(0), 1.00);
});

test('subtitle mode updates cinema, local and web overlays immediately', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.currentSubMode = 'none';
  app.subSourceDisplay = el();
  app.subViDisplay = el();
  app.invideoSubSource = el();
  app.invideoSubVi = el();
  app.invideoWebSubSource = el();
  app.invideoWebSubVi = el();
  app.broadcastOverlay = () => {};

  app.updateSubModeUI();

  for (const node of [app.subSourceDisplay, app.subViDisplay, app.invideoSubSource,
    app.invideoSubVi, app.invideoWebSubSource, app.invideoWebSubVi]) {
    assert.equal(node.style.display, 'none');
  }
});

test('turning dubbing off does not abort an active transcription', () => {
  const app = Object.create(LiveDubStudio.prototype);
  let aborted = false;
  app.activeAbortController = { abort() { aborted = true; } };
  app.currentActiveAudioSource = null;
  app.dubbingAudio = { pause() {}, currentTime: 0 };
  app.dubbingIndicator = { classList: { remove() {} } };
  app.stopDubbingAudio();
  assert.equal(aborted, false);
});

test('speech chunks queued while transcription is busy are not dropped', async () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.speechQueue = [];
  app.isProcessingSpeechQueue = false;
  const seen = [];
  app.processSpeechPhrase = async value => {
    seen.push(value);
    await new Promise(resolve => setTimeout(resolve, 5));
  };

  const first = app.enqueueSpeechPhrase('one');
  const second = app.enqueueSpeechPhrase('two');
  await Promise.all([first, second]);
  assert.deepEqual(seen, ['one', 'two']);
});

test('speech queue never discards an old phrase when temporarily overloaded', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.speechQueue = [];
  app.maxSpeechQueueSize = 2;
  app.liveSpeechSequence = 0;
  app.isProcessingSpeechQueue = true;
  app.showToast = () => {};
  app.enqueueSpeechPhrase({ size: 1200 });
  app.enqueueSpeechPhrase({ size: 1200 });
  app.enqueueSpeechPhrase({ size: 1200 });
  assert.equal(app.speechQueue.length, 3);
});

test('stale playback token is rejected after segment/session advances', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.playbackGeneration = 7;
  app.ytSessionGeneration = 3;
  app.currentYtSegmentIdx = 5;
  assert.equal(app.isPlaybackCurrent({ playback: 6, session: 3, segment: 5 }), false);
  assert.equal(app.isPlaybackCurrent({ playback: 7, session: 3, segment: 5 }), true);
});

test('YouTube timing uses the next speech start as a hard synchronization boundary', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.ytSegments = [
    { start: 10, end: 14 },
    { start: 12.5, end: 15 }
  ];

  const timing = app.getYtSegmentTiming(0, 10.25);

  assert.equal(timing.deadline, 12.5);
  assert.equal(timing.slotDuration, 2.5);
  assert.equal(timing.remaining, 2.25);
});

test('YouTube scheduler follows the video CC timestamp with polling tolerance only', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.ytCueLeadSeconds = 0.08;
  app.ytSegments = [{ start: 10, end: 12 }];

  assert.equal(app.findActiveYtSegment(9.93), 0);
  assert.equal(app.findActiveYtSegment(9.90), -1);
});

test('cached YouTube subtitle is revealed by the matching audio start callback', async () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.isDubbingEnabled = true;
  app.audioPreCache = new Map([[0, { buffer: {}, voiceGeneration: 1 }]]);
  app.voiceGeneration = 1;
  app.playbackGeneration = 0;
  app.ytSessionGeneration = 1;
  app.currentYtSegmentIdx = 0;
  let revealed = false;
  app.playDecodedAudioBuffer = async (_buffer, _duration, _token, onStart) => {
    assert.equal(revealed, false);
    onStart();
  };

  await app.playSegmentAudio(0, 2, () => { revealed = true; });

  assert.equal(revealed, true);
});

test('a missing YouTube dub buffer requests a playback hold instead of dropping speech', async () => {
  const originalFetch = global.fetch;
  const app = Object.create(LiveDubStudio.prototype);
  app.isDubbingEnabled = true;
  app.audioPreCache = new Map();
  app.voiceGeneration = 0;
  app.playbackGeneration = 0;
  app.ytSessionGeneration = 1;
  app.currentYtSegmentIdx = 0;
  app.ytSegments = [{ start: 4, end: 6, translated: 'xin chao' }];
  app.voiceSelect = { value: 'voice-a' };
  let held = false;
  app.holdYouTubeForDubbing = () => { held = true; };
  global.fetch = async () => ({ json: async () => ({}) });

  try {
    await app.playSegmentAudio(0, 2);
    assert.equal(held, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('live transcription sends context and does not wait for server-side TTS', async () => {
  const originalFormData = global.FormData;
  const originalFetch = global.fetch;
  const originalAbortController = global.AbortController;
  let submitted;
  class FakeFormData {
    constructor() { this.values = new Map(); }
    append(key, value) { this.values.set(key, value); }
  }
  global.FormData = FakeFormData;
  global.AbortController = class { constructor() { this.signal = {}; } abort() {} };
  global.fetch = async (_url, options) => {
    submitted = options.body.values;
    return { json: async () => ({ empty: false, original: 'hello', translated: 'xin chào' }) };
  };

  try {
    const app = Object.create(LiveDubStudio.prototype);
    app.isTranscribing = false;
    app.isListening = true;
    app.isDubbingEnabled = true;
    app.lastTranscriptContext = 'previous sentence';
    app.lastProcessedText = '';
    app.realtimeSessionId = 'session-test';
    app.sourceLangSelect = { value: 'en' };
    app.voiceSelect = { value: 'voice-a' };
    app.setStatus = () => {};
    app.displaySubtitle = () => {};
    app.addHistory = () => ({ id: 'history-1' });
    app.enqueueLiveDubbing = (text, id) => { app.queuedDub = [text, id]; };
    app.invideoWebSubVi = null;
    app.invideoWebSubSource = null;

    await app.processSpeechPhrase({ size: 1200 }, 1);

    assert.equal(submitted.get('dubbing'), 'false');
    assert.equal(submitted.get('previous_context'), 'previous sentence');
    assert.equal(submitted.get('session_id'), 'session-test');
    assert.equal(submitted.get('sequence'), '1');
    assert.deepEqual(app.queuedDub, ['xin chào', 'history-1']);
    assert.match(app.lastTranscriptContext, /hello$/);
  } finally {
    global.FormData = originalFormData;
    global.fetch = originalFetch;
    global.AbortController = originalAbortController;
  }
});

test('normal VieNeu lines use a bounded realtime PCM prebuffer', () => {
  const app = Object.create(LiveDubStudio.prototype);
  const policy = app.getLivePcmBufferPolicy('A normal subtitle line');

  assert.ok(policy.initialBytes >= 19200);
  assert.ok(policy.initialBytes <= 28800);
  assert.ok(policy.sliceBytes <= 48000);
});

test('cross-source equivalents enter the live dub queue only once', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.isDubbingEnabled = true;
  app.dubbingGeneration = 1;
  app.liveDubbingQueue = [];
  app.isProcessingLiveDubbing = true;
  app.voiceSelect = { value: 'voice-a' };

  app.enqueueLiveDubbing('Với đấu trường nhỏ hơn.', 'ocr-1', 'With the arena now smaller.', 1, 2, null, 1, 'ocr');
  app.enqueueLiveDubbing('Với đấu trường giờ nhỏ hơn.', 'asr-1', 'With the arena now smaller', 1, 2, null, 1, 'asr');

  assert.equal(app.liveDubbingQueue.length, 1);
});

test('stale live TTS response never plays after the session is invalidated', async () => {
  const originalFetch = global.fetch;
  let releaseFetch;
  global.fetch = () => new Promise(resolve => {
    releaseFetch = () => resolve({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8)
    });
  });

  try {
    const app = Object.create(LiveDubStudio.prototype);
    app.isDubbingEnabled = true;
    app.dubbingGeneration = 4;
    app.liveDubbingQueue = [];
    app.isProcessingLiveDubbing = false;
    app.maxLiveDubbingQueueSize = 3;
    app.liveDubbingMaxAgeMs = 4500;
    app.voiceSelect = { value: 'voice-a' };
    let played = false;
    app.playAudioBuffer = async () => { played = true; };

    const draining = app.enqueueLiveDubbing('hello', 'h1');
    app.dubbingGeneration++;
    app.liveDubbingQueue = [];
    releaseFetch();
    await draining;

    assert.equal(played, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('live dubbing queue preserves every translated line in order', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.isDubbingEnabled = true;
  app.dubbingGeneration = 1;
  app.liveDubbingQueue = [];
  app.isProcessingLiveDubbing = true;
  app.maxLiveDubbingQueueSize = 2;
  app.liveDubbingMaxAgeMs = 4500;
  app.voiceSelect = { value: 'voice-a' };

  app.enqueueLiveDubbing('one', 'h1');
  app.enqueueLiveDubbing('two', 'h2');
  app.enqueueLiveDubbing('three', 'h3');

  assert.deepEqual(app.liveDubbingQueue.map(item => item.text), ['one', 'two', 'three']);
});

test('live translated subtitle is shown when its matching dub starts', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8)
  });
  try {
    const app = Object.create(LiveDubStudio.prototype);
    app.isDubbingEnabled = true;
    app.dubbingGeneration = 2;
    app.liveDubbingQueue = [];
    app.isProcessingLiveDubbing = false;
    app.voiceSelect = { value: 'voice-a' };
    let displayed = null;
    app.displaySubtitle = (source, translated) => { displayed = [source, translated]; };
    app.playAudioBuffer = async (_audio, _wait, onStart) => onStart();

    await app.enqueueLiveDubbing('xin chao', 'h1', 'hello');

    assert.deepEqual(displayed, ['hello', 'xin chao']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('VieNeu live dubbing uses the low-latency PCM stream', async () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.isDubbingEnabled = true;
  app.dubbingGeneration = 3;
  app.liveDubbingQueue = [];
  app.isProcessingLiveDubbing = false;
  app.voiceSelect = { value: 'vieneu:Thái Sơn' };
  app.invideoWebSubVi = null;
  app.invideoWebSubSource = null;
  let streamed = null;
  let displayed = null;
  app.displaySubtitle = (source, translated) => { displayed = [source, translated]; };
  app.playStreamingTts = async (text, voice, wait, onStart) => {
    streamed = [text, voice, wait];
    onStart();
  };

  await app.enqueueLiveDubbing('Xin chào', 'h1', 'Hello');

  assert.deepEqual(streamed, ['Xin chào', 'vieneu:Thái Sơn', true]);
  assert.deepEqual(displayed, ['Hello', 'Xin chào']);
});

test('YouTube subtitle request preserves caption mode and language choice', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.webCaptionMode = { value: 'has_captions' };
  app.webCaptionLanguage = { value: 'original' };
  assert.deepEqual(app.buildYouTubeSubtitleRequest('https://youtu.be/example'), {
    url: 'https://youtu.be/example',
    target_lang: 'vi',
    caption_mode: 'has_captions',
    caption_language: 'original'
  });
});

test('radio caption choices are read directly from the checked option', () => {
  const app = Object.create(LiveDubStudio.prototype);
  const group = {
    querySelector(selector) {
      assert.equal(selector, 'input[type="radio"]:checked');
      return { value: 'audio_only' };
    }
  };
  assert.equal(app.getRadioGroupValue(group), 'audio_only');
});

test('audio-only caption mode disables every caption-language option', () => {
  const app = Object.create(LiveDubStudio.prototype);
  const languageOptions = [{ disabled: false }, { disabled: false }, { disabled: false }];
  app.webCaptionMode = {
    querySelector: () => ({ value: 'audio_only' })
  };
  app.webCaptionLanguage = {
    querySelectorAll: () => languageOptions,
    toggleAttribute(name, value) {
      assert.equal(name, 'data-disabled');
      assert.equal(value, true);
    }
  };
  app.sourceIntelligenceState = null;
  app.sourceIntelligenceHint = null;

  app.updateSourceIntelligenceControls();

  assert.equal(languageOptions.every(option => option.disabled), true);
});

test('explicit language selection is reused by OCR on every frame', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.sourceLangSelect = { value: 'ko-KR' };
  app.webCaptionLanguage = { value: 'auto' };
  assert.equal(app.resolveOCRLanguage(), 'ko-KR');

  app.sourceLangSelect.value = 'auto';
  app.webCaptionLanguage.value = 'ja';
  assert.equal(app.resolveOCRLanguage(), 'ja');
});

test('OCR subtitle is deduplicated before entering the dubbing queue', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.lastOCRText = '';
  app.lastTranscriptContext = '';
  app.isDubbingEnabled = true;
  app.addHistory = () => ({ id: 'ocr-1' });
  let queued = 0;
  app.enqueueLiveDubbing = () => { queued++; };
  app.handleOCRSubtitle({ original: 'Hello world', translated: 'Xin chào' });
  app.handleOCRSubtitle({ original: '  hello   world ', translated: 'Xin chào' });
  assert.equal(queued, 1);
  assert.equal(app.lastTranscriptContext, 'Hello world');
});

test('system capture mode selects OCR vs Whisper for system audio capture', async () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.systemCaptureMode = {
    querySelector: (sel) => ({ value: 'hard_sub' })
  };
  app.isListening = false;
  app.btnSystemAudioText = { textContent: '' };
  app.btnToggleSystemAudio = { classList: { remove() {}, add() {} } };
  app.stopListening = () => {};
  app.setupVADAndRecording = async () => {};
  let ocrStarted = false;
  app.startHardSubtitleOCR = async () => { ocrStarted = true; };
  app.showToast = () => {};

  const originalMediaDevices = global.navigator.mediaDevices;
  global.navigator.mediaDevices = {
    getDisplayMedia: async () => ({
      getAudioTracks: () => [{}],
      getVideoTracks: () => [{ onended: null }]
    })
  };

  try {
    await app.toggleSystemAudio();
    assert.equal(app.activeSource, 'system');
    assert.equal(app.isOCRModeActive, true);
    assert.equal(ocrStarted, true);
  } finally {
    global.navigator.mediaDevices = originalMediaDevices;
  }
});

test('system subMode syncs across controls and supports en_only mode', () => {
  const app = Object.create(LiveDubStudio.prototype);
  const mainRadios = [{ value: 'bilingual', checked: true }, { value: 'en_only', checked: false }];
  const sysRadios = [{ value: 'bilingual', checked: true }, { value: 'en_only', checked: false }];
  app.subModeRadios = mainRadios;
  app.systemSubModeRadios = sysRadios;
  app.subSourceDisplay = el();
  app.subViDisplay = el();
  app.invideoSubSource = el();
  app.invideoSubVi = el();
  app.invideoWebSubSource = el();
  app.invideoWebSubVi = el();
  app.broadcastOverlay = () => {};
  app.updateAppliedSettings = () => {};

  app.setSubMode('en_only');

  assert.equal(app.currentSubMode, 'en_only');
  assert.equal(mainRadios[1].checked, true);
  assert.equal(sysRadios[1].checked, true);
  assert.equal(app.subSourceDisplay.style.display, 'block');
  assert.equal(app.subViDisplay.style.display, 'none');
});

test('adaptive speed scales playback rate to match video speech duration', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.rateRange = { value: '1.00' };
  app.isAdaptiveSpeedEnabled = true;

  // Dialogue with 15 Vietnamese syllables (~3.3s speech) crowded into a 2.0s video slot
  // Expected fitRate = ~1.65, capped safely to server RTF cap (1.25)
  const rate = app.getSafeStreamingPlaybackRate(0, 1.25, 2.0, 57);
  assert.equal(rate, 1.25);

  // When speaker speaks slowly (4.0s slot for 10 characters = ~0.58s speech), rate relaxes
  const relaxedRate = app.getSafeStreamingPlaybackRate(0, 1.20, 4.0, 10);
  assert.ok(relaxedRate <= 1.00);

  // When adaptive speed is disabled, rate stays at user setting
  app.isAdaptiveSpeedEnabled = false;
  const fixedRate = app.getSafeStreamingPlaybackRate(0, 1.25, 2.0, 57);
  assert.equal(fixedRate, 1.00);
});

test('ocrSimilarity detects fuzzy noise and prevents repetitive spam like BácKinh/BicKinh', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.lastOCRText = '';
  app.recentOCRHistory = [];
  app.isDubbingEnabled = true;
  app.addHistory = () => ({ id: 'ocr-spam' });
  let queued = 0;
  app.enqueueLiveDubbing = () => { queued++; };

  // Junk keyword filter immediately discards YouTube thumbnail tags like BácKinh/BicKinh
  app.handleOCRSubtitle({ original: 'BácKinh', translated: 'Bắc Kinh' });
  assert.equal(queued, 0);

  app.handleOCRSubtitle({ original: 'BicKinh', translated: 'Bí Kinh' });
  assert.equal(queued, 0);

  // Legitimate dialogue line
  app.handleOCRSubtitle({ original: 'You cannot hide forever in the woods', translated: 'Anh không thể trốn trong rừng mãi được' });
  assert.equal(queued, 1);

  // Noisy OCR fluctuation on next frame (1 letter typo/noise from motion: 'can not' vs 'cannot')
  app.handleOCRSubtitle({ original: 'You can not hide forever in the woods', translated: 'Anh không thể trốn trong rừng mãi được' });
  assert.equal(queued, 1);

  // New sentence
  app.handleOCRSubtitle({ original: "He is by himself in there", translated: "Hắn ở một mình trong đó" });
  assert.equal(queued, 2);
});

test('drainLiveDubbingQueue skips ancient audio older than 12s when user scrubs ahead', async () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.isDubbingEnabled = true;
  app.dubbingGeneration = 1;
  app.isProcessingLiveDubbing = false;
  app.displaySubtitle = () => {};
  let playedAudios = 0;
  app.playAudioBuffer = async () => { playedAudios++; };

  // Item 1 is ancient (> 12s ago, e.g. user scrubbed or jumped 30s ahead)
  const now = performance.now();
  app.liveDubbingQueue = [
    { text: 'Old line', sourceText: 'Old', enqueuedAt: now - 15000, generation: 1, voice: 'google-vi' },
    { text: 'Fresh line', sourceText: 'Fresh', enqueuedAt: now - 50, generation: 1, voice: 'google-vi' },
  ];

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(10)
  });

  try {
    await app.drainLiveDubbingQueue();
    // Only the fresh line should have played audio, ancient line audio was skipped
    assert.equal(playedAudios, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('smoothVideoPlayback prevents video pause during dubbing hold to eliminate stuttering', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.smoothVideoPlayback = true;
  app.isHoldingYtForDubbing = false;
  let pauseCalled = false;
  app.ytPlayer = {
    getPlayerState: () => 1,
    pauseVideo: () => { pauseCalled = true; }
  };

  app.holdYouTubeForDubbing();
  assert.equal(app.isHoldingYtForDubbing, true);
  assert.equal(pauseCalled, false, 'YouTube pauseVideo must not be called in smooth playback mode');
});

test('webCaptionMode hard_sub prompts for Tab capture and does not block on CC fetching', async () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.webUrlInput = el();
  app.buildYouTubeSubtitleRequest = () => ({ caption_mode: 'hard_sub', caption_language: 'auto' });
  app.webVideoContainer = el();
  app.webVideoContainer.scrollIntoView = () => {};
  app.webSyncNotice = el();
  app.setSourceIntelligenceState = () => {};
  let playerInited = false;
  app.initOrUpdateYouTubePlayer = () => { playerInited = true; };

  await app.loadWebVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(playerInited, true);
  assert.match(app.webSyncNotice.innerHTML, /Bắt Âm Thanh Tab/);
});

test('displaySubtitle updates invideoWebSubVi, invideoWebSubSource and PiP element', () => {
  const app = Object.create(LiveDubStudio.prototype);
  app.subSourceDisplay = el();
  app.subViDisplay = el();
  app.invideoWebSubSource = el();
  app.invideoWebSubVi = el();
  app.broadcastOverlay = () => {};
  const pipSrc = el();
  const pipVi = el();
  app.pipWindow = {
    closed: false,
    document: {
      getElementById: (id) => (id === 'pipSource' ? pipSrc : id === 'pipVi' ? pipVi : null)
    }
  };

  app.displaySubtitle('Hello world', 'Xin chào thế giới');
  assert.equal(app.subSourceDisplay.textContent, 'Hello world');
  assert.equal(app.subViDisplay.textContent, 'Xin chào thế giới');
  assert.equal(app.invideoWebSubSource.textContent, 'Hello world');
  assert.equal(app.invideoWebSubVi.textContent, 'Xin chào thế giới');
  assert.equal(pipSrc.textContent, 'Hello world');
  assert.equal(pipVi.textContent, 'Xin chào thế giới');
});

test('toggleWebVideoFullscreen requests fullscreen on webVideoContainer', () => {
  const app = Object.create(LiveDubStudio.prototype);
  let requestCalled = false;
  app.webVideoContainer = {
    requestFullscreen: async () => { requestCalled = true; }
  };

  app.toggleWebVideoFullscreen();
  assert.equal(requestCalled, true);
});

test('openFloatingOverlay prioritizes documentPictureInPicture when available', async () => {
  const originalWindow = global.window;
  try {
    const app = Object.create(LiveDubStudio.prototype);
    app.ensureAudioUnlocked = () => {};
    app.subSourceDisplay = el();
    app.subViDisplay = el();
    app.showToast = () => {};
    app.escapeHtml = (s) => s;

    let pipRequested = false;
    const mockPipDoc = {
      head: { appendChild() {} },
      body: { innerHTML: '' }
    };
    global.window = {
      documentPictureInPicture: {
        requestWindow: async () => {
          pipRequested = true;
          return {
            document: mockPipDoc,
            addEventListener() {},
            closed: false
          };
        }
      }
    };

    await app.openFloatingOverlay();
    assert.equal(pipRequested, true);
    assert.ok(app.pipWindow);
  } finally {
    global.window = originalWindow;
  }
});



