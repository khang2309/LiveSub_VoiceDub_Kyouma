import test from 'node:test';
import assert from 'node:assert/strict';

import ttsPlayer from '../src/engines/tts-player.js';
import { isVieNeuPcmResponse, isVieNeuVoice } from '../src/engines/tts-providers/vieneu-provider.js';

function responseWithHeaders(headers) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { headers: { get: (name) => normalized.get(name.toLowerCase()) || null } };
}

test('a normal subtitle is kept as one uninterrupted TTS utterance', () => {
  const parts = ttsPlayer.splitSentenceIntoClauses('Vâng, Tiêu viện trưởng');
  assert.deepEqual(parts, ['Vâng, Tiêu viện trưởng']);
});

test('two visual subtitle rows remain one spoken sentence', () => {
  const parts = ttsPlayer.splitSentenceIntoClauses('first half of one sentence\ncontinues on the second visual row.');
  assert.deepEqual(parts, ['first half of one sentence continues on the second visual row.']);
});

test('a very long two-row subtitle remains one prosodic utterance', () => {
  const text = 'This deliberately long subtitle is visually wrapped across two rows but semantically remains one sentence with every word intact\nand it only splits when the VieNeu latency boundary truly requires another safe spoken clause.';
  const parts = ttsPlayer.splitSentenceIntoClauses(text);
  assert.deepEqual(parts, [text.replace(/\s+/g, ' ').trim()]);
});

test('VieNeu keeps a pathological long subtitle intact while native PCM streams', async () => {
  const queued = [];
  const studio = Object.assign({}, ttsPlayer, {
    isDubbingEnabled: true,
    sanitizeDubbingText: (text) => String(text || '').trim(),
    getEffectiveVoice: () => 'vieneu:Trúc Ly',
    enqueueSingleLiveDubbing: (...args) => queued.push(args),
    drainLiveDubbingQueue: async () => {}
  });
  const text = 'Đây là một câu phụ đề rất dài cần được chia hợp lý để âm thanh bắt đầu sớm hơn, nhưng các phần sau vẫn phải nối tiếp nhau mà không tự ý dừng hoặc hủy phần còn lại của câu thoại.';

  await studio.enqueueLiveDubbing(text, 12, text, 10, 10, null, 0, 'ocr');

  assert.equal(queued.length, 1);
  assert.equal(queued[0][0], text);
  assert.equal(queued[0][10], false);
});

test('a deliberate one-word hesitation is spoken immediately and never merged away', async () => {
  const queued = [];
  const studio = Object.assign({}, ttsPlayer, {
    isDubbingEnabled: true,
    sanitizeDubbingText: (text) => String(text || '').trim(),
    getEffectiveVoice: () => 'vieneu:Trúc Ly',
    enqueueSingleLiveDubbing: (...args) => queued.push(args),
    drainLiveDubbingQueue: async () => {}
  });

  await studio.enqueueLiveDubbing('Nhưng...', 14, 'Nhưng...', 10, 10, null, 0, 'ocr');

  assert.equal(queued.length, 1);
  assert.equal(queued[0][0], 'Nhưng...');
  assert.equal(queued[0][10], false);
});

test('VieNeu owns the realtime PCM format', () => {
  const vieneuResponse = responseWithHeaders({ 'x-audio-format': 'pcm_s16le' });
  assert.equal(isVieNeuVoice('vieneu:Trúc Ly'), true);
  assert.equal(isVieNeuPcmResponse(vieneuResponse), true);
});

test('VieNeu streams the head cue directly and prefetches one lookahead cue', () => {
  const prefetched = [];
  const studio = Object.assign({}, ttsPlayer, {
    isDubbingEnabled: true,
    isProcessingLiveDubbing: false,
    liveDubbingQueue: [],
    lastEnqueueTime: 0,
    dubbingGeneration: 1,
    sanitizeDubbingText: text => String(text || '').trim(),
    liveTtsPrefetch: new Map(),
    getEffectiveVoice: () => 'vieneu:Trúc Ly',
    prefetchLiveTts: (text, voice) => prefetched.push({ text, voice })
  });

  studio.enqueueSingleLiveDubbing('Câu đang cần phát ngay.', 1, 'source one');
  assert.deepEqual(prefetched, [], 'head cue must keep the VieNeu streaming fast path');

  studio.isProcessingLiveDubbing = true;
  studio.enqueueSingleLiveDubbing('Câu kế tiếp.', 2, 'source two');
  assert.deepEqual(prefetched, [{ text: 'Câu kế tiếp.', voice: 'vieneu:Trúc Ly' }]);
});
