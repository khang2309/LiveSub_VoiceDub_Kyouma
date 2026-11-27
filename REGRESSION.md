# LiveSub Module Regression Ledger

Dependency evidence command:

```powershell
rg -n "from './engines|Object.assign\(|youtube[A-Z]" frontend/src
```

## Module — YouTube Lifecycle

- Source: `frontend/src/engines/youtube-lifecycle.js`
- Downstream consumers: `LiveDubStudio`, source tabs, YouTube panel, OCR/Whisper capture.
- Regression acceptance command: `node --test frontend/tests/youtube-components.test.mjs`
- Propagation rule: lifecycle behavior change requires frontend production build and backend tests because it cancels shared TTS/capture work.

## Module — YouTube Source and Player

- Source: `frontend/src/engines/youtube-source.js`
- Downstream consumers: timeline sync, TTS prefetch, subtitle overlay, translation sync.
- Regression acceptance command: `node --test frontend/tests/youtube-components.test.mjs`
- Propagation rule: request/player contract change requires frontend build plus Rust YouTube route tests.

## Module — YouTube Timeline Sync

- Source: `frontend/src/engines/youtube-sync.js`
- Downstream consumers: audio playback, seek priority, history and subtitle display.
- Regression acceptance command: `node --test frontend/tests/youtube-components.test.mjs`
- Propagation rule: timing/seek change requires all YouTube component tests and frontend build.

## Module — YouTube Audio and Prefetch

- Source: `frontend/src/engines/youtube-audio.js`
- Downstream consumers: TTS routes, decoded audio cache, adaptive playback and source switching.
- Regression acceptance command: `node --test frontend/tests/youtube-components.test.mjs`
- Propagation rule: queue/cache change requires component tests, all Rust library tests and frontend build.

## Aggregate Downstream Gates

```powershell
npm --prefix frontend test
npm --prefix frontend run build
cargo test --manifest-path rust/livesub-app/Cargo.toml --lib
git diff --check
cmd /c scripts\Dong-Goi-Installer.bat
```

No module is considered green unless its command and every required downstream gate exit with code 0.

## OCR Realtime Handoff

- Source: `frontend/src/engines/ocr-scanner.js`
- Downstream consumers: subtitle overlay, history, and `tts-player.js` live dubbing queue.
- Invariant: a recognized dialogue cue is displayed before it is enqueued for TTS; non-speech cues may display but must never be spoken.
- Regression evidence: `frontend/tests/ocr-realtime.test.mjs`.
- Feedback-loop guard: YouTube OCR moves LiveSub output opposite the scan band; full-frame OCR hides only the in-video copy while keeping the side subtitle panel active.
- Screen/tab guard: recently rendered Vietnamese output is removed from OCR input; echo-only frames are discarded, mixed source+echo frames are retranslated from the remaining source text, and a genuine repeat after an empty gap is preserved.

## TTS Realtime Continuity

- Source: `frontend/src/engines/tts-player.js`
- Downstream consumers: OCR, Whisper, YouTube CC, audio queue, and Web Audio playback.
- Invariant: ordinary subtitle cues stay in one utterance; only unusually long cues split, and every continuation remains chained.
- Regression evidence: `frontend/tests/tts-realtime.test.mjs`.
- Provider contract: Edge uses chunked MP3; VieNeu uses lossless PCM S16LE. A provider must not silently buffer or transcode the other provider's hot path.
- Provider sentence policy: VieNeu bounds unusually long clauses for lower TTFA; Edge keeps the complete sentence for context/prosody because it can stream before completion.
- Two-row policy: visual line breaks merge before sentence analysis; normal two-row captions remain one utterance, while genuinely long VieNeu text splits only at safe boundaries and each completed PCM result plays as one buffer.
- Source-switch policy: every YouTube cleanup advances a monotonic backend generation so stale batch prefetch stops before the new system/OCR source requests GPU work.
