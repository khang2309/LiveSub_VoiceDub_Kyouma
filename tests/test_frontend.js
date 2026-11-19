const test = require('node:test');
const assert = require('node:assert/strict');

const LiveDubStudio = require('../public/app.js');

function el() {
  return { style: {}, textContent: '', classList: { add() {}, remove() {} } };
}

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
    assert.deepEqual(app.queuedDub, ['xin chào', 'history-1']);
    assert.match(app.lastTranscriptContext, /hello$/);
  } finally {
    global.FormData = originalFormData;
    global.fetch = originalFetch;
    global.AbortController = originalAbortController;
  }
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
