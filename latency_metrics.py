"""Small bounded latency window for realtime diagnostics."""

from __future__ import annotations

import threading
from collections import deque


class LatencyWindow:
    def __init__(self, size: int = 200):
        self._values = deque(maxlen=size)
        self._lock = threading.Lock()

    def add(self, value_ms: float):
        with self._lock:
            self._values.append(float(value_ms))

    def snapshot(self):
        with self._lock:
            values = sorted(self._values)
        if not values:
            return {"samples": 0, "p50_ms": None, "p95_ms": None, "p99_ms": None}

        def percentile(value):
            index = min(len(values) - 1, round((len(values) - 1) * value))
            return round(values[index], 1)

        return {
            "samples": len(values),
            "p50_ms": percentile(0.50),
            "p95_ms": percentile(0.95),
            "p99_ms": percentile(0.99),
        }
