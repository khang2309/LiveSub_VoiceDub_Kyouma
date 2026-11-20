"""Language-aware translation router for every audio capture source."""

from __future__ import annotations

import os
import threading
import time

from latency_metrics import LatencyWindow


class TranslationRouter:
    def __init__(self, english_local, multilingual_local, network_service, cache=None):
        self.english_local = english_local
        self.multilingual_local = multilingual_local
        self.network_service = network_service
        self.cache = cache if cache is not None else {}
        self._metrics_lock = threading.Lock()
        self._metrics = {
            "calls": 0,
            "last_provider": None,
            "last_source_language": None,
            "last_latency_ms": None,
            "fallbacks": 0,
            "last_error": None,
        }
        self._latencies = LatencyWindow()
        self._startup_routes = {}
        self._startup_benchmarks = {}
        self._network_cooldown_until = 0.0

    @staticmethod
    def normalize_language(language: str) -> str:
        value = (language or "auto").lower().replace("_", "-")
        aliases = {"cmn": "zh", "yue": "zh", "jp": "ja", "kr": "ko"}
        if value in {"zh-cn", "zh-hans", "zh-tw", "zh-hant"}:
            return value
        base = value.split("-")[0]
        return aliases.get(base, base)

    @property
    def azure_configured(self) -> bool:
        return bool(
            os.environ.get("AZURE_TRANSLATOR_KEY")
            or os.environ.get("AZURE_TRANSLATION_KEY")
        )

    @property
    def fastest_mode(self) -> bool:
        return os.environ.get("TRANSLATION_MODE", "fastest").lower() != "private"

    def _record(self, provider, source, started, error=None, fallback=False):
        latency_ms = round((time.perf_counter() - started) * 1000, 1)
        self._latencies.add(latency_ms)
        with self._metrics_lock:
            self._metrics["calls"] += 1
            self._metrics["last_provider"] = provider
            self._metrics["last_source_language"] = source
            self._metrics["last_latency_ms"] = latency_ms
            if fallback:
                self._metrics["fallbacks"] += 1
            self._metrics["last_error"] = str(error) if error else None

    def _provider_order(self, source):
        if self.fastest_mode:
            local = None
            if source == "en" and self.english_local.available:
                local = "vinai"
            elif self.multilingual_local.supports(source):
                local = "nllb"
            selected = self._startup_routes.get(source)
            if selected == "network" and time.time() < self._network_cooldown_until and local:
                return [local, "network"]
            if selected == local and local:
                return [local, "network"]
            if local:
                return ["network", local]
            return ["network"]
        if source == "en" and self.english_local.available:
            return ["vinai", "azure" if self.azure_configured else "network"]
        # For Asian and other supported languages, a configured commercial API
        # gets first choice. Without a key, NLLB gives a private/offline path.
        if self.azure_configured:
            return ["azure", "nllb", "network"]
        if self.multilingual_local.supports(source):
            return ["nllb", "network"]
        return ["network"]

    def benchmark_startup(self):
        """Benchmark each language family once and keep that route for the session."""
        if not self.fastest_mode or self._startup_routes:
            return dict(self._startup_routes)
        # DNS/TLS setup can consume most of the public endpoint's short
        # timeout. Warm it once without scoring so the measured route reflects
        # steady-state sentence latency rather than a one-off cold connection.
        try:
            self.network_service.translate(
                "Hello.", source_lang="en", target_lang="vi"
            )
        except Exception:
            pass
        samples = {
            "en": "This is a short startup translation speed test.",
            "ko": "이것은 시작할 때 한 번만 실행하는 번역 속도 테스트입니다.",
            "ja": "これは起動時に一度だけ行う翻訳速度テストです。",
            "zh": "这是仅在启动时运行一次的翻译速度测试。",
        }
        for source, sample in samples.items():
            candidates = []
            network_latencies = []
            for attempt in range(3):
                started = time.perf_counter()
                try:
                    probe = f"{sample} {attempt + 1}"
                    if self.network_service.translate(probe, source_lang=source, target_lang="vi"):
                        network_latencies.append(
                            round((time.perf_counter() - started) * 1000, 1)
                        )
                except Exception:
                    pass
            # Public endpoints are only selected when every startup sample is
            # successful. One fast response followed by timeouts is worse than
            # a stable local model for realtime dubbing.
            if len(network_latencies) == 3:
                network_median = sorted(network_latencies)[1]
                candidates.append((network_median, "network"))

            local_provider = "vinai" if source == "en" else "nllb"
            started = time.perf_counter()
            try:
                if local_provider == "vinai" and self.english_local.available:
                    result = self.english_local.translate(sample)
                elif local_provider == "nllb" and self.multilingual_local.supports(source):
                    result = self.multilingual_local.translate(sample, source, "vi")
                else:
                    result = None
                if result:
                    candidates.append((round((time.perf_counter() - started) * 1000, 1), local_provider))
            except Exception:
                pass

            self._startup_benchmarks[source] = {
                provider: latency for latency, provider in candidates
            }
            self._startup_benchmarks[source]["network_successes"] = len(network_latencies)
            self._startup_benchmarks[source]["network_attempts"] = 3
            if candidates:
                self._startup_routes[source] = min(candidates)[1]
        return dict(self._startup_routes)

    def translate(self, text, source_lang="auto", target_lang="vi", previous_context=""):
        source = self.normalize_language(source_lang)
        target = self.normalize_language(target_lang)
        if not text or source == target:
            return text
        key = (source, target, text.casefold(), "router-v1")
        if key in self.cache:
            return self.cache[key]

        errors = []
        for position, provider in enumerate(self._provider_order(source)):
            started = time.perf_counter()
            try:
                if provider == "vinai":
                    result = self.english_local.translate(text)
                elif provider == "nllb":
                    result = self.multilingual_local.translate(text, source, target)
                else:
                    result = self.network_service.translate(
                        text,
                        source_lang=source,
                        target_lang=target,
                        previous_context=previous_context,
                    )
                if result:
                    self.cache[key] = result
                    self._record(provider, source, started, fallback=position > 0)
                    return result
            except Exception as error:
                if provider == "network":
                    self._network_cooldown_until = time.time() + 60
                errors.append(error)
                self._record(provider, source, started, error=error, fallback=position > 0)
        raise RuntimeError("; ".join(str(error) for error in errors) or "No translation provider")

    def translate_many(self, texts, source_lang="auto", target_lang="vi"):
        source = self.normalize_language(source_lang)
        target = self.normalize_language(target_lang)
        if source == target:
            return list(texts)
        errors = []
        for position, provider in enumerate(self._provider_order(source)):
            started = time.perf_counter()
            try:
                if provider == "vinai":
                    result = self.english_local.translate_many(list(texts))
                elif provider == "nllb":
                    result = self.multilingual_local.translate_many(
                        list(texts), source, target
                    )
                else:
                    result = self.network_service.translate_many(
                        list(texts), source_lang=source, target_lang=target
                    )
                self._record(provider, source, started, fallback=position > 0)
                return result
            except Exception as error:
                if provider == "network":
                    self._network_cooldown_until = time.time() + 60
                errors.append(error)
                self._record(provider, source, started, error=error, fallback=position > 0)
        raise RuntimeError("; ".join(str(error) for error in errors) or "No translation provider")

    def snapshot(self):
        with self._metrics_lock:
            metrics = dict(self._metrics)
        return {
            "mode": "hybrid",
            "policy": "fastest-network-first" if self.fastest_mode else "private-local-first",
            "azure_configured": self.azure_configured,
            "official_api_configured": {
                "azure": self.azure_configured,
                "google_cloud": bool(os.environ.get("GOOGLE_TRANSLATE_API_KEY")),
                "deepl": bool(os.environ.get("DEEPL_API_KEY")),
            },
            "routing": {
                "en": "network/API -> VinAI local" if self.fastest_mode else "VinAI local -> network/API",
                "ko/ja/zh/other": "network/API -> NLLB local" if self.fastest_mode else "NLLB local -> network/API",
                "vi": "bypass",
            },
            "startup_routes": dict(self._startup_routes),
            "startup_benchmarks_ms": dict(self._startup_benchmarks),
            "network_cooldown_seconds": max(0, round(self._network_cooldown_until - time.time(), 1)),
            "metrics": metrics,
            "latency": self._latencies.snapshot(),
            "english_local": self.english_local.snapshot(),
            "multilingual_local": self.multilingual_local.snapshot(),
        }
