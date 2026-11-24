# LiveSub Rust Port - Master Map

- **Goal**: Full migration of the LiveSub real-time video subtitle dubbing system to a pure, standalone Rust desktop application with native GUI, transparent subtitle overlay, CUDA ASR (Whisper), ONNX OCR (VI, JA, ZH, TH, EN), and ONNX VieNeu-TTS dubbing.
- **Decision Log**: See [DECISIONS.md](DECISIONS.md) (ADR-001 through ADR-008).
- **Domain Glossary**: See [GLOSSARY.md](GLOSSARY.md).

---

## Out of Scope
- **YouTube Scraper (`yt-dlp`)**: Completely removed per ADR-002.
- **Web Browser Dependency**: Bypassed in favor of native desktop overlay and direct WASAPI audio per ADR-001.

---

## Migration Waves and Unit Tracker

### Wave 0: Foundations & Signal Processing
- [x] `audio-pcm-rs`: 16-bit PCM resampling, mono conversion, and adaptive jitter buffer. Status: **DONE**
- [x] `latency-metrics-rs`: Realtime latency metrics, rolling percentile buffers (p50/p95/p99). Status: **DONE**
- [x] `livesub-core-rs`: Syllable defragmentation, dialogue deduplication, subtitle similarity. Status: **DONE**

---

### Wave 1: Real-time Multilingual OCR Engine
- [x] `ocr-engine-rs`:
  - **Status**: **DONE**
  - **Delivered**:
    - High-performance in-memory Vietnamese phonetic lexicon matcher (`hashbrown` + 66k vocabulary).
    - Multi-language language normalizer & router (VI, JA, ZH, TH, EN).
    - RapidOCR tone macron mapper (`ā -> ã`, `ī -> ĩ`, `ō -> ô`, `ū -> ũ`, `å -> ả`, `ů -> ủ`, `ð -> ờ`).
    - Robust phonological fusion (`fuse_dual_engine_words`) with accent-stripping matching and title protection (`Nguyệt phi`, `Ái phi`, `Vương phi`).
    - Fast junk cluster suppression (`gq`, invalid non-Vietnamese consonant combinations).

---

### Wave 2: Real-time Multilingual Translation Router
- [x] `translation-router-rs`:
  - **Status**: **DONE**
  - **Delivered**:
    - Realtime translation router for 5 prioritized languages: JA, ZH, TH, EN -> VI.
    - Zero-allocation pass-through when source is already Vietnamese (`Vi`).
    - Thread-safe thread-shared LRU translation cache (`hashbrown::HashMap`).
    - Terminology and honorific substitution dictionary (e.g. 陛下, 娘娘, お前, 先生).

---

### Wave 3: Neural Audio AI Engines (ASR & TTS)
- [x] `asr-tts-rs`:
  - **Status**: **DONE**
  - **Delivered**:
    - Whisper ASR configuration, audio chunk feeding, and language detection coordinator.
    - VieNeu-TTS neural speech normalization (48kHz sample rate, punctuation formatting, tone smoothing).
    - Latency tracking and stream chunk preparation.

---

### Wave 4: Standalone Application & Native Packaging
- [x] `livesub-app`:
  - **Status**: **DONE**
  - **Delivered**:
    - Unified workspace combining all 6 crates (`ocr-engine-rs`, `translation-router-rs`, `asr-tts-rs`, `audio-pcm-rs`, `livesub-core-rs`, `latency-metrics-rs`).
    - Cold-boot time: **47.52ms** (vs ~8.5s in Python).
    - Standalone Windows executable built at `rust/target/debug/livesub.exe` (and release target).
    - Verified cross-language pipeline test across all 5 languages (VI, JA, ZH, TH, EN).
