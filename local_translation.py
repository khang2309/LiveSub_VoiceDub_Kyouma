"""Fast local English to Vietnamese translation with a network-free fallback path.

The model is converted once to CTranslate2 INT8 and loaded lazily so opening the
server stays cheap.  Translation runs on CPU to leave the small RTX 3050 VRAM
available to Whisper and VieNeu.
"""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path


class LocalEnViTranslator:
    def __init__(self, model_dir: str | os.PathLike[str]):
        self.model_dir = Path(model_dir)
        self._translator = None
        self._tokenizer = None
        self._load_lock = threading.Lock()
        self._translate_lock = threading.Lock()
        self.status = "idle" if self.available else "missing"
        self.error: str | None = None
        self.load_ms: float | None = None
        self.last_batch_ms: float | None = None

    @property
    def available(self) -> bool:
        return all(
            (self.model_dir / filename).exists()
            for filename in ("model.bin", "config.json", "sentencepiece.bpe.model")
        )

    def load(self) -> bool:
        if self._translator is not None:
            return True
        if not self.available:
            self.status = "missing"
            return False

        with self._load_lock:
            if self._translator is not None:
                return True
            self.status = "loading"
            started = time.perf_counter()
            try:
                import ctranslate2
                import sentencepiece as spm

                threads = max(1, min(8, os.cpu_count() or 4))
                self._tokenizer = spm.SentencePieceProcessor(
                    model_file=str(self.model_dir / "sentencepiece.bpe.model")
                )
                self._translator = ctranslate2.Translator(
                    str(self.model_dir),
                    device="cpu",
                    compute_type="int8",
                    inter_threads=1,
                    intra_threads=threads,
                )
                self.load_ms = round((time.perf_counter() - started) * 1000, 1)
                self.status = "ready"
                self.error = None
                return True
            except Exception as error:  # keep Google fallback usable
                self.status = "error"
                self.error = str(error)
                self._translator = None
                self._tokenizer = None
                return False

    def translate_many(self, texts: list[str], beam_size: int = 4) -> list[str]:
        if not texts:
            return []
        if not self.load():
            raise RuntimeError(self.error or "Local EN-VI model is unavailable")

        sources = [
            self._tokenizer.encode(text, out_type=str) + ["</s>", "en_XX"]
            for text in texts
        ]
        started = time.perf_counter()
        # A single queue keeps CPU usage bounded and gives predictable latency
        # when caption prefetch and live audio arrive at the same time.
        with self._translate_lock:
            results = self._translator.translate_batch(
                sources,
                target_prefix=[["vi_VN"] for _ in sources],
                beam_size=beam_size,
                max_decoding_length=192,
            )
        self.last_batch_ms = round((time.perf_counter() - started) * 1000, 1)

        translations = []
        for result, original in zip(results, texts):
            tokens = [
                token
                for token in result.hypotheses[0]
                if token not in {"vi_VN", "</s>"}
            ]
            value = self._tokenizer.decode(tokens).strip()
            translations.append(value or original)
        return translations

    def translate(self, text: str) -> str:
        return self.translate_many([text])[0]

    def snapshot(self) -> dict:
        return {
            "provider": "vinai/vinai-translate-en2vi-v2",
            "runtime": "CTranslate2 INT8 CPU",
            "status": self.status,
            "available": self.available,
            "load_ms": self.load_ms,
            "last_batch_ms": self.last_batch_ms,
            "error": self.error,
        }
