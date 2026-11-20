"""Realtime caption arbitration backed by the optional Rust/PyO3 extension."""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
import re
import threading
import time
import unicodedata

try:
    from livesub_core_rs import CaptionGate as _RustCaptionGate
except ImportError as error:  # pragma: no cover - exercised on machines without Rust build
    _RustCaptionGate = None
    _RUST_IMPORT_ERROR = str(error)
else:
    _RUST_IMPORT_ERROR = None


@dataclass(frozen=True)
class GateDecision:
    accepted: bool
    similarity: float
    reason: str


def _canonicalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text or "").casefold()
    return re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE).strip()


def _similarity(left: str, right: str) -> float:
    if left == right:
        return 1.0
    if not left or not right:
        return 0.0
    previous = list(range(len(right) + 1))
    for left_index, left_char in enumerate(left, 1):
        current = [left_index]
        for right_index, right_char in enumerate(right, 1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_char != right_char),
                )
            )
        previous = current
    return 1.0 - previous[-1] / max(len(left), len(right))


def _equivalent(left: str, right: str, similarity: float) -> bool:
    if left == right or similarity >= 0.88:
        return True
    shorter, longer = sorted((left, right), key=len)
    return len(shorter) >= 12 and shorter in longer and len(shorter) / len(longer) >= 0.82


class _PythonCaptionGate:
    def __init__(self, window_ms: int, max_entries: int):
        self.window_ms = max(1, int(window_ms))
        self.max_entries = max(1, int(max_entries))
        self._sessions = defaultdict(lambda: {"entries": deque(), "sequence": {}})
        self._lock = threading.Lock()

    def check(self, session_id: str, source: str, text: str, sequence: int, now_ms: int):
        canonical = _canonicalize(text)
        if not canonical:
            return False, 0.0, "empty"
        with self._lock:
            state = self._sessions[session_id]
            entries = state["entries"]
            while entries and now_ms - entries[0][2] > self.window_ms:
                entries.popleft()
            last_sequence = state["sequence"].get(source)
            if sequence > 0 and last_sequence is not None and sequence <= last_sequence:
                return False, 1.0, "stale_sequence"
            if sequence > 0:
                state["sequence"][source] = sequence
            best = 0.0
            for prior_source, prior_text, prior_time in entries:
                similarity = _similarity(canonical, prior_text)
                best = max(best, similarity)
                if prior_source != source and _equivalent(canonical, prior_text, similarity):
                    return False, similarity, "cross_source_duplicate"
                if prior_source == source and canonical == prior_text and now_ms - prior_time <= self.window_ms:
                    return False, 1.0, "same_source_duplicate"
            entries.append((source, canonical, now_ms))
            while len(entries) > self.max_entries:
                entries.popleft()
            return True, best, "accepted"

    def reset(self, session_id=None):
        with self._lock:
            if session_id is None:
                self._sessions.clear()
            else:
                self._sessions.pop(session_id, None)


class RealtimeCaptionArbiter:
    """Reject stale/duplicate OCR and ASR captions before translation and TTS."""

    def __init__(self, window_ms: int = 5000, max_entries: int = 32):
        if _RustCaptionGate is not None:
            self._gate = _RustCaptionGate(window_ms, max_entries)
            self.backend = "rust-pyo3"
        else:
            self._gate = _PythonCaptionGate(window_ms, max_entries)
            self.backend = "python-fallback"

    @property
    def native(self) -> bool:
        return self.backend == "rust-pyo3"

    @property
    def import_error(self):
        return _RUST_IMPORT_ERROR

    def check(self, session_id, source, text, sequence=0, now_ms=None) -> GateDecision:
        timestamp = int(time.monotonic() * 1000) if now_ms is None else int(now_ms)
        accepted, similarity, reason = self._gate.check(
            str(session_id or "default"),
            str(source or "unknown"),
            str(text or ""),
            max(0, int(sequence or 0)),
            max(0, timestamp),
        )
        return GateDecision(bool(accepted), float(similarity), str(reason))

    def reset(self, session_id=None):
        self._gate.reset(None if session_id is None else str(session_id))

    def snapshot(self):
        return {
            "backend": self.backend,
            "native": self.native,
            "import_error": self.import_error,
        }
