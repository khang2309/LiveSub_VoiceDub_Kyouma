# LiveSub Domain Glossary (Python -> Rust)

This glossary defines standard terminology used across all LiveSub Rust crates to maintain naming consistency.

| Python Concept / Class | Rust Equivalent / Type | Description |
| :--- | :--- | :--- |
| `SubtitleOCR` | `struct OcrEngine` | Core engine managing DBNet detection and recognition ONNX sessions. |
| `ModelType` | `enum ModelSize { Tiny, Small, Medium, Server }` | Sizing of detection and recognition networks. |
| `LangRec` | `enum Language { Vi, Ja, Zh, Th, En }` | Supported source languages for OCR and translation. |
| `_strip_accents` | `fn strip_vietnamese_diacritics(&str) -> String` | Normalizes accented Vietnamese characters to ASCII base consonants/vowels. |
| `_fuse_dual_engine_words`| `fn fuse_ocr_words(rapid: &[Word], tess: &[Word]) -> String` | Phonological alignment between primary detector and secondary diacritic engines. |
| `LiveDubbingQueue` | `struct DubQueue` | Real-time thread-safe queue buffering translated lines awaiting TTS generation. |
| `AudioPCMBuffer` | `struct JitterBuffer` | Adaptive sample FIFO buffer matching generation rate to audio hardware output. |
| `TranscriptionResult` | `struct SpeechSegment` | Timestamped dialogue segment from Whisper ASR. |
| `VieNeuTTS` | `struct VieneuEngine` | Multi-graph ONNX neural speech synthesizer with CUDA acceleration. |
| `TransparentOverlay` | `struct SubtitleOverlayWindow` | Click-through transparent desktop window displaying bilingual subtitles. |
