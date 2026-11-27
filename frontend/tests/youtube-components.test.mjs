import test from 'node:test';
import assert from 'node:assert/strict';

import youtubeLifecycle from '../src/engines/youtube-lifecycle.js';
import youtubeSource from '../src/engines/youtube-source.js';
import youtubeTimelineSync from '../src/engines/youtube-sync.js';
import youtubeAudio from '../src/engines/youtube-audio.js';

const componentModules = {
  lifecycle: youtubeLifecycle,
  source: youtubeSource,
  timeline: youtubeTimelineSync,
  audio: youtubeAudio
};

test('YouTube engine components expose unique public methods', () => {
  const owners = new Map();
  for (const [component, methods] of Object.entries(componentModules)) {
    for (const name of Object.keys(methods)) {
      assert.equal(typeof methods[name], 'function', `${component}.${name} must be a function`);
      assert.equal(owners.has(name), false, `${name} is duplicated by ${component} and ${owners.get(name)}`);
      owners.set(name, component);
    }
  }

  assert.equal(owners.get('cleanupYouTubePlayback'), 'lifecycle');
  assert.equal(owners.get('loadWebVideo'), 'source');
  assert.equal(owners.get('prioritizeYouTubeSeek'), 'timeline');
  assert.equal(owners.get('startYouTubePrefetchWorker'), 'audio');
});

test('timeline component resolves active and next CC segments after a seek', () => {
  const studio = Object.assign({
    ytCueLeadSeconds: 0.08,
    ytSegments: [
      { start: 0, end: 1.5 },
      { start: 3, end: 4 },
      { start: 8, end: 10 }
    ]
  }, youtubeTimelineSync);

  assert.equal(studio.findActiveYtSegment(0.5), 0);
  assert.equal(studio.findActiveYtSegment(2), -1);
  assert.equal(studio.findYtSegmentAtOrAfter(2), 1);
  assert.equal(studio.findYtSegmentAtOrAfter(8.5), 2);
});

test('closing a YouTube session aborts and clears every prefetch queue', () => {
  let batchAborted = false;
  let liveAborted = false;
  let stoppedAudio = false;
  const studio = Object.assign({
    _isYtPrefetchWorkerRunning: true,
    _ytPrefetchGeneration: 2,
    ytPrefetchAbortController: { abort: () => { batchAborted = true; } },
    liveTtsPrefetch: new Map([['voice:text', { controller: { abort: () => { liveAborted = true; } } }]]),
    isFetchingPreCache: new Set(['0:1']),
    audioPreCache: new Map([[1, {}]]),
    ytPrefetchedAudioIndices: new Set([1]),
    liveDubbingQueue: [{}],
    voiceGeneration: 1,
    playbackGeneration: 1,
    dubbingGeneration: 1,
    stopDubbingAudio: () => { stoppedAudio = true; },
    ttsRequestGeneration: 10
  }, youtubeLifecycle);

  studio.stopYouTubePrefetch();
  assert.equal(batchAborted, true);
  assert.equal(liveAborted, true);
  assert.equal(stoppedAudio, true);
  assert.equal(studio._isYtPrefetchWorkerRunning, false);
  assert.equal(studio.audioPreCache.size, 0);
  assert.equal(studio.ytPrefetchedAudioIndices.size, 0);
  assert.equal(studio.liveDubbingQueue.length, 0);
  assert.ok(studio.ttsRequestGeneration > 10);
});

test('seek cancels old work and prebuffers from the new CC position', async () => {
  let paused = 0;
  let resumed = 0;
  let prebufferArgs = null;
  let nextPrefetch = null;
  const studio = Object.assign({
    currentYtMode: 'has_captions',
    isDubbingEnabled: true,
    ytSegments: Array.from({ length: 8 }, (_, index) => ({
      start: index * 5,
      end: index * 5 + 3,
      original: `gốc ${index}`,
      translated: `dịch ${index}`
    })),
    ytPlayer: {
      getPlayerState: () => 1,
      getCurrentTime: () => 16,
      pauseVideo: () => { paused++; },
      playVideo: () => { resumed++; }
    },
    audioPreCache: new Map(),
    isFetchingPreCache: new Set(),
    youtubeLoadGeneration: 4,
    ytPrefetchAbortController: new AbortController(),
    _ytPrefetchGeneration: 1,
    _ytSeekGeneration: 0,
    prebufferYouTubeInitialTracks: async (...args) => { prebufferArgs = args; },
    prefetchUpcomingAudio: (index) => { nextPrefetch = index; },
    setSourceIntelligenceState: () => {}
  }, youtubeTimelineSync);

  await studio.prioritizeYouTubeSeek(16);
  assert.equal(prebufferArgs[0], 3);
  assert.equal(prebufferArgs[1], 2);
  assert.equal(studio._ytSequentialPrefetchCursor, 3);
  assert.equal(nextPrefetch, 5);
  assert.equal(paused, 1);
  assert.equal(resumed, 1);
});

test('prefetch worker generates sequential batches through the end of CC', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const requested = [];

  class MockAudioContext {
    constructor() { this.state = 'running'; }
    async decodeAudioData() { return { duration: 1 }; }
  }
  globalThis.window = { AudioContext: MockAudioContext, webkitAudioContext: MockAudioContext };
  globalThis.fetch = async (_url, options) => {
    const texts = JSON.parse(options.body).texts;
    requested.push(...texts);
    return {
      ok: true,
      json: async () => ({ items: texts.map(() => ({ audio_base64: 'AA==' })) })
    };
  };

  const studio = Object.assign({
    currentYtMode: 'has_captions',
    isDubbingEnabled: true,
    ytSegments: Array.from({ length: 11 }, (_, index) => ({
      original: `câu ${index}`,
      translated: `câu ${index}`
    })),
    currentYtSegmentIdx: 0,
    _ytPrefetchTargetIdx: 0,
    _ytSequentialPrefetchCursor: 0,
    _isYtPrefetchWorkerRunning: false,
    _ytPrefetchGeneration: 0,
    ytPrefetchAbortController: new AbortController(),
    ytPrefetchedAudioIndices: new Set(),
    isFetchingPreCache: new Set(),
    audioPreCache: new Map(),
    voiceGeneration: 0,
    getEffectiveVoice: () => 'edge:Hoài My',
    sanitizeDubbingText: text => text,
    getVoiceProfile: () => ({ id: 'test' }),
    applyVoiceCharacteristics: buffer => buffer
  }, youtubeAudio);

  try {
    studio.startYouTubePrefetchWorker(0);
    const deadline = Date.now() + 1500;
    while (studio.ytPrefetchedAudioIndices.size < studio.ytSegments.length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    studio._isYtPrefetchWorkerRunning = false;
    studio._ytPrefetchGeneration++;

    assert.equal(studio.ytPrefetchedAudioIndices.size, 11);
    assert.deepEqual(requested, studio.ytSegments.map(segment => segment.translated));
    assert.equal(studio._ytSequentialPrefetchCursor, 11);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});
