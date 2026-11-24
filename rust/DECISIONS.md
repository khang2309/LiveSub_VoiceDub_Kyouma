# Architecture Decision Records (ADRs) - LiveSub Rust Port

This document records all architectural decisions agreed upon for the complete migration of the LiveSub real-time video subtitle dubbing system to a pure, standalone Rust application.

---

## ADR-001: Standalone Desktop Application with Native GUI
- **Status**: Accepted (2026-11-22)
- **Context**: The user specified Option B: building a native desktop application in Rust rather than relying on an external web browser tab.
- **Decision**: Build the application as a pure native Windows desktop executable using Rust GUI (e.g. Slint / Egui / transparent overlay window) and native Windows Graphics Capture / Desktop Duplication APIs. The app will feature a floating, click-through transparent subtitle overlay that can sit directly on top of any video player, streaming site, or game.
- **Consequences**: No web browser or Node.js runtime required. The final product is a single portable `.exe` binary.

---

## ADR-002: Scope Simplification - YouTube Deprecation
- **Status**: Accepted (2026-11-22)
- **Context**: YouTube integration (`yt-dlp`, URL fetching, cloud CC sync) required thousands of lines of volatile web-scraping logic subject to constant YouTube cipher changes.
- **Decision**: Completely deprecate and remove all YouTube scraping code. The application will focus exclusively on:
  1. Real-time Screen Subtitle OCR (hardcoded subs from any player).
  2. Real-time Desktop / Microphone Audio Recognition (ASR).
  3. Real-time Translation to Vietnamese.
  4. Real-time Vietnamese Dubbing (AI Speech Synthesis).
- **Consequences**: Massive reduction in codebase complexity and elimination of brittle external scrapers.

---

## ADR-003: Language Priority Hierarchy
- **Status**: Accepted (2026-11-22)
- **Context**: Multi-language support needs a clear priority order for accuracy and latency tuning.
- **Decision**: The system prioritizes languages in the following exact order:
  1. **Tiếng Việt (VI)**: Target dubbing language & direct Vietnamese subtitle reading.
  2. **Tiếng Nhật (JA)**: Japanese anime, TV shows, and games.
  3. **Tiếng Trung (ZH)**: Chinese historical dramas, donghua, and livestreams.
  4. **Tiếng Thái (TH)**: Thai series and movies.
  5. **Tiếng Anh (EN)**: English movies and global content.
- **Consequences**: OCR and Whisper models are loaded and tuned specifically for these 5 character sets and vocabularies.

---

## ADR-004: Speech-to-Text (ASR) Engine via whisper-rs (CUDA)
- **Status**: Accepted (2026-11-22)
- **Context**: Real-time dubbing requires low-latency speech recognition directly on local hardware without cloud latency or subscription fees.
- **Decision**: Use `whisper-rs` (binding directly to `whisper.cpp` with NVIDIA CUDA acceleration) on Windows x64.
- **Consequences**: Runs locally on NVIDIA RTX 3050 with ~150-250ms latency using `ggml-small.bin` or `ggml-large-v3-turbo.bin` across VI, JA, ZH, TH, EN.

---

## ADR-005: Text-to-Speech (TTS) Engine via ONNX Runtime CUDA (VieNeu-TTS)
- **Status**: Accepted (2026-11-22)
- **Context**: VieNeu-TTS v3 Turbo provides natural Vietnamese voice dubbing. Its underlying neural architecture consists of flow-matching and neural vocoders with available ONNX computation graphs.
- **Decision**: Use crate `ort` (ONNX Runtime Rust bindings with CUDA Execution Provider) to load and execute VieNeu's computational graphs (`text_encoder.onnx`, `duration_predictor.onnx`, `vector_estimator.onnx`, `codec_decoder.onnx`) directly in native Rust.
- **Consequences**: 100% PyTorch-free and Python-free execution on GPU, retaining the natural Vietnamese voice while running within a standalone native process.

---

## ADR-006: Subtitle OCR Engine via ONNX Runtime & SIMD Image Processing
- **Status**: Accepted (2026-11-22)
- **Context**: Screen subtitle capture needs < 20ms latency and high accuracy on styled, stroked, and bordered fonts.
- **Decision**: Implement `ocr-engine-rs` using:
  - `ort` for DBNet detection and language-specific recognition models (VI: PP-OCRv6, JA: PP-OCRv4 Japan, ZH: PP-OCRv4 China, TH: PP-OCRv4 Thai, EN: PP-OCRv4 English).
  - `image` / `imageproc` for SIMD-accelerated contrast normalization and bounding box extraction.
  - `hashbrown` + phonological accent alignment (`_strip_accents`) for microsecond dictionary validation.
- **Consequences**: Replaces Python `ocr_engine.py` with an 8-15ms native OCR pipeline.

---

## ADR-007: Native Audio Pipeline & Jitter Buffer
- **Status**: Accepted (2026-11-22)
- **Context**: Streaming speech chunks must play seamlessly through system audio without gaps, clicks, or clock drift.
- **Decision**: Use `cpal` (Cross-Platform Audio Library for WASAPI) combined with the Rust-ported adaptive jitter buffer (`audio-pcm-rs`).
- **Consequences**: Ultra-low-latency direct hardware audio output bypassing browser audio clock limitations.

---

## ADR-008: Four-Wave Migration Staging
- **Status**: Accepted (2026-11-22)
- **Decision**: Migrate in 4 verified waves:
  - **Wave 1**: `ocr-engine-rs` (OCR for VI, JA, ZH, TH, EN + lexicon fusion).
  - **Wave 2**: `translation-router-rs` (Local/API translation for 5 languages).
  - **Wave 3**: `asr-tts-rs` (Whisper CUDA + VieNeu ONNX CUDA).
  - **Wave 4**: `livesub-app` (Native GUI, Transparent Overlay, CPAL audio, standalone executable packaging).

---

## ADR-009: Pure Rust VieNeu-TTS Engine (vieneu-tts-rs)
- **Status**: Accepted (2026-11-24)
- **Context**: The user explicitly requested migrating VieNeu-TTS from Python to pure Rust and removing all simulated Edge TTS / Google TTS proxies and WSOLA pitch distortions. The application requires 100% offline, pure native Rust speech synthesis with the authentic voices of VieNeu-TTS (Thái Sơn, Trúc Ly, Thiện Minh, Mai Anh, Thùy Dung, etc.).
- **Decision**:
  1. Build a dedicated crate `rust/vieneu-tts-rs` inside the Cargo workspace.
  2. Implement inference via `ort` (ONNX Runtime Rust with DirectML/CUDA GPU execution provider and CPU fallback) loading `vieneu_prefill.onnx`, `vieneu_decode_step.onnx`, `vieneu_acoustic_cached.onnx`, and `moss_audio_tokenizer_decode_full.onnx`.
  3. Integrate `sea-g2p-rs` (`tools/sea-g2p`, `default-features = false`) for zero-overhead, 100% native Rust Vietnamese text normalization and G2P phonemization.
  4. Load precomputed speaker embeddings (`speaker_emb` 192-dim) and reference codes (`ref_codes`) directly from `voices_v3_turbo.json` so preset voices boot in < 50ms without running `speaker_encoder.onnx`.
  5. Connect `rust/vieneu-tts-rs` directly into `rust/livesub-app/src/services/tts.rs` to serve 48kHz WAV audio natively at `/api/tts` and `/api/tts-stream`, permanently deprecating and removing `scripts/edge_tts_server.js`.
- **Consequences**:
  - Zero Python, zero Node.js, zero cloud dependencies.
  - Subtitle-to-voice latency drops from ~1800ms (cloud roundtrip) to ~90-120ms (local GPU inference on RTX 3050).
  - Authentic neural Vietnamese speech matching the official VieNeu-TTS repository.
