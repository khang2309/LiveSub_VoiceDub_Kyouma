"""Pure subtitle and translation helpers used by the realtime server.

This module intentionally has no ML imports so its behavior can be regression
tested without loading Whisper or a TTS model.
"""

import os
import json
import re
import urllib.parse
import urllib.request
import threading
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed


INVISIBLE_CHARS_RE = re.compile(r"[\u200b\u200e\u200f\ufeff]+")
CURRENT_MARKER = "[[[CURRENT]]]"
_TRANSLATED_MARKER_RE = re.compile(r"\[\[\[[^\]\r\n]+\]\]\]")
_BATCH_CAPTION_MARKER_RE = re.compile(r"\[\[\[(\d{6})\]\]\]")
_GEMINI_CIRCUIT_LOCK = threading.Lock()
_GEMINI_CIRCUIT = {
    "cooldown_until": 0.0,
    "last_error": None,
    "failures": 0,
}
_HTTP_SESSION = requests.Session()
_HTTP_SESSION.trust_env = False
_HTTP_SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
})
_HTTP_SESSION_LOCK = threading.Lock()


def should_translate_to_vietnamese(source_lang):
    """Avoid a redundant network translation when text is already Vietnamese."""
    language = (source_lang or "auto").lower().split("-")[0]
    return language != "vi"


def normalize_caption_text(text):
    text = INVISIBLE_CHARS_RE.sub("", text or "")
    return re.sub(r"\s+", " ", text).strip()


def merge_caption_text(existing, incoming):
    """Merge rolling captions and remove the largest word overlap."""
    existing = normalize_caption_text(existing)
    incoming = normalize_caption_text(incoming)
    if not existing:
        return incoming
    if not incoming:
        return existing

    existing_fold = existing.casefold()
    incoming_fold = incoming.casefold()
    if incoming_fold.startswith(existing_fold):
        return incoming
    if existing_fold.startswith(incoming_fold) or incoming_fold in existing_fold:
        return existing

    left = existing.split()
    right = incoming.split()
    max_overlap = min(len(left), len(right))
    overlap = 0
    for size in range(max_overlap, 0, -1):
        if [w.casefold() for w in left[-size:]] == [w.casefold() for w in right[:size]]:
            overlap = size
            break
    return " ".join(left + right[overlap:])


def merge_caption_segments(raw_segments, max_duration=7.0, max_words=30):
    """Turn YouTube rolling caption events into coherent timed sentences."""
    merged = []
    current = None

    for item in raw_segments:
        text = normalize_caption_text(item.get("text", ""))
        start = max(0.0, float(item.get("start", 0.0)))
        end = max(start + 0.05, float(item.get("end", start + 0.05)))
        if not text:
            continue
        candidate = {"start": start, "end": end, "text": text}
        if current is None:
            current = candidate
            continue

        pause = start - current["end"]
        rolling_update = (
            text.casefold().startswith(current["text"].casefold())
            or current["text"].casefold().startswith(text.casefold())
        )
        ends_sentence = bool(re.search(r"[.!?…]$", current["text"]))
        joined = merge_caption_text(current["text"], text)
        rolling_update_is_nearby = (
            rolling_update
            and pause <= 0.35
            and end - current["start"] <= max_duration
            and len(joined.split()) <= max_words
        )
        can_merge = (
            rolling_update_is_nearby
            or (
                pause < 0.8
                and end - current["start"] <= max_duration
                and len(joined.split()) <= max_words
                # Distinct completed sentences may overlap in YouTube's event
                # stream. The overlap is a display artifact, not permission to
                # combine two spoken lines into one late, oversized TTS cue.
                and not ends_sentence
            )
        )

        if can_merge:
            current["text"] = joined
            current["end"] = max(current["end"], end)
        else:
            merged.append(current)
            current = candidate

    if current is not None:
        merged.append(current)

    # Preserve the original speech start. YouTube caption events often overlap;
    # moving the next start to the previous end makes both subtitles and dubbing
    # audibly late. Shorten the previous display window instead.
    result = []
    for item in merged:
        item = dict(item)
        if result and item["start"] < result[-1]["end"]:
            result[-1]["end"] = max(result[-1]["start"] + 0.05, item["start"])
        if item["end"] <= item["start"]:
            item["end"] = item["start"] + 0.05
        result.append(item)
    return result


def select_caption_track(subtitles, automatic_captions, preference="auto", video_language=""):
    """Select an explicit YouTube caption track without silently changing languages."""
    subtitles = subtitles or {}
    automatic_captions = automatic_captions or {}
    preference = (preference or "auto").lower()
    video_language = (video_language or "").split("-")[0].lower()

    def usable_keys(source):
        return [key for key in source if key and key != "live_chat"]

    def find_language(source, language):
        if not language:
            return None
        for key in usable_keys(source):
            if key.lower() == language or key.lower().split("-")[0] == language:
                return key
        return None

    if preference not in {"auto", "original"}:
        for source_name, source in (("manual", subtitles), ("automatic", automatic_captions)):
            key = find_language(source, preference)
            if key:
                return source[key], key.split("-")[0], source_name
        return None, preference, None

    # When auto / original:
    # 1. If author explicitly specified video language, use it.
    # 2. Prefer Vietnamese ('vi') if already available (100% human accuracy, zero translation error).
    # 3. Prefer English ('en') as most global videos are in English.
    # 4. Try other major creator languages: Japanese, Korean, Chinese, Spanish, French, German.
    candidates = []
    if video_language:
        candidates.append(video_language)
    for lang in ["vi", "en", "ja", "ko", "zh", "es", "fr", "de"]:
        if lang not in candidates:
            candidates.append(lang)

    for source_name, source in (("manual", subtitles), ("automatic", automatic_captions)):
        for cand in candidates:
            key = find_language(source, cand)
            if key:
                return source[key], key.split("-")[0], source_name
        keys = usable_keys(source)
        if keys:
            key = keys[0]
            return source[key], key.split("-")[0], source_name

    return None, "auto", None


def _google_translate_fetch(text, source_lang, target_lang):
    params = {
        "client": "gtx",
        "sl": source_lang or "auto",
        "tl": target_lang or "vi",
        "dt": "t",
        "q": text,
    }
    url = "https://translate.googleapis.com/translate_a/single?" + urllib.parse.urlencode(params)
    # One warmed keep-alive connection is shared by startup benchmarking and
    # live requests. The lock makes requests.Session safe across the caption
    # prefetch workers without opening a fresh TLS connection per sentence.
    with _HTTP_SESSION_LOCK:
        response = _HTTP_SESSION.get(url, timeout=(0.35, 0.75))
        response.raise_for_status()
        data = response.json()
    return "".join(part[0] for part in data[0] if part and part[0]).strip()


def _azure_translate_fetch(text, source_lang="auto", target_lang="vi", key=None, region="southeastasia"):
    if not key:
        return None
    url = f"https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to={target_lang}"
    if source_lang and source_lang != "auto":
        url += f"&from={source_lang}"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Ocp-Apim-Subscription-Region": region or "southeastasia",
        "Content-Type": "application/json",
    }
    body = json.dumps([{"text": text}]).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=3.0) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data[0]["translations"][0]["text"].strip()


def _google_cloud_translate_fetch(text, source_lang="auto", target_lang="vi", key=None):
    if not key:
        return None
    url = "https://translation.googleapis.com/language/translate/v2?" + urllib.parse.urlencode({"key": key})
    payload = {"q": text, "target": target_lang, "format": "text"}
    if source_lang and source_lang != "auto":
        payload["source"] = source_lang
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=2.5) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["data"]["translations"][0]["translatedText"].strip()


def _deepl_translate_fetch(text, source_lang="auto", target_lang="vi", key=None):
    if not key:
        return None
    endpoint = os.environ.get("DEEPL_API_URL", "https://api-free.deepl.com/v2/translate")
    body = {"text": [text], "target_lang": target_lang.upper()}
    if source_lang and source_lang != "auto":
        body["source_lang"] = source_lang.upper()
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"DeepL-Auth-Key {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=2.5) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["translations"][0]["text"].strip()


def _gemini_translate_fetch(text, source_lang="auto", target_lang="vi", key=None):
    """Context-aware batch translation with a quota/error circuit breaker."""
    if not key:
        return None
    with _GEMINI_CIRCUIT_LOCK:
        if time.time() < _GEMINI_CIRCUIT["cooldown_until"]:
            raise RuntimeError("Gemini translation is cooling down after a quota/provider error")

    primary_model = os.environ.get("GEMINI_TRANSLATION_MODEL", "gemini-3.1-flash-lite")
    fallback_models = os.environ.get(
        "GEMINI_TRANSLATION_FALLBACK_MODELS",
        "gemini-flash-lite-latest,gemini-2.5-flash-lite",
    ).split(",")
    models = []
    for candidate in [primary_model, *fallback_models]:
        candidate = candidate.strip()
        if candidate and candidate not in models:
            models.append(candidate)
    prompt = (
        f"Translate from {source_lang or 'auto'} to natural spoken {target_lang or 'vi'} "
        "for movie dubbing. Preserve meaning, tone, names, numbers, line order, "
        "and every [[[000000]]] marker exactly. Return only the translated text.\n"
        f"{text}"
    )
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 2048},
    }).encode("utf-8")
    last_error = None
    last_status = None
    for model in models:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{urllib.parse.quote(model, safe='-_.')}:generateContent"
        )
        request = urllib.request.Request(
            url,
            data=body,
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=10.0) as response:
                data = json.loads(response.read().decode("utf-8"))
            result = data["candidates"][0]["content"]["parts"][0]["text"].strip()
            if result:
                with _GEMINI_CIRCUIT_LOCK:
                    _GEMINI_CIRCUIT.update(cooldown_until=0.0, last_error=None)
                return result
        except Exception as error:
            last_error = error
            last_status = getattr(error, "code", None)
            # An invalid key affects every model; quota, model and transient
            # failures may be model-specific, so try the next configured model.
            if last_status in {401, 403}:
                break

    error = last_error or RuntimeError("Gemini returned no translation")
    # Provider failures must never stall every following subtitle. NMT/local
    # fallbacks are used during the circuit-breaker cooldown.
    cooldown = 3600 if last_status in {401, 403} else 300
    with _GEMINI_CIRCUIT_LOCK:
        _GEMINI_CIRCUIT["cooldown_until"] = time.time() + cooldown
        _GEMINI_CIRCUIT["last_error"] = (
            f"HTTP {last_status}: {error}" if last_status else str(error)
        )
        _GEMINI_CIRCUIT["failures"] += 1
    raise error


def _hybrid_translate_fetch(text, source_lang, target_lang):
    # Gemini is substantially more context-aware but measured at 1-3 seconds
    # per request on the free tier. Use it only for prefetched caption batches,
    # never for live per-sentence audio where it would add visible delay.
    gemini_key = os.environ.get("GEMINI_API_KEY")
    gemini_mode = os.environ.get("GEMINI_TRANSLATION_MODE", "prefetch").lower()
    is_caption_batch = bool(_BATCH_CAPTION_MARKER_RE.search(text or ""))
    if gemini_key and (gemini_mode == "all" or (gemini_mode == "prefetch" and is_caption_batch)):
        try:
            result = _gemini_translate_fetch(text, source_lang, target_lang, key=gemini_key)
            if result:
                return result
        except Exception:
            # Quota/token/timeout errors immediately fall through to NMT. The
            # circuit breaker prevents repeated Gemini attempts for a while.
            pass

    # Explicit official APIs win when configured. They are measurable and have
    # stable quotas/terms; each failure falls through without losing a line.
    official = [
        (_deepl_translate_fetch, os.environ.get("DEEPL_API_KEY")),
        (_google_cloud_translate_fetch, os.environ.get("GOOGLE_TRANSLATE_API_KEY")),
    ]
    for fetcher, key in official:
        if not key:
            continue
        try:
            result = fetcher(text, source_lang, target_lang, key=key)
            if result:
                return result
        except Exception:
            pass
    azure_key = os.environ.get("AZURE_TRANSLATOR_KEY") or os.environ.get("AZURE_TRANSLATION_KEY")
    if azure_key:
        try:
            res = _azure_translate_fetch(
                text,
                source_lang=source_lang,
                target_lang=target_lang,
                key=azure_key,
                region=os.environ.get("AZURE_TRANSLATOR_REGION", "southeastasia"),
            )
            if res:
                return res
        except Exception:
            pass
    # Zero-key fast path. A short timeout lets the router fall back to local
    # inference instead of waiting through a network stall.
    return _google_translate_fetch(text, source_lang, target_lang)


class TranslationService:
    def __init__(self, fetcher=None, cache=None, max_cache_size=2048):
        self.fetcher = fetcher or _hybrid_translate_fetch
        self.cache = cache if cache is not None else {}
        self.max_cache_size = max_cache_size

    @staticmethod
    def _extract_current(translated):
        if not translated:
            return ""
        markers = list(_TRANSLATED_MARKER_RE.finditer(translated))
        if markers:
            return translated[markers[-1].end():].strip(" \t\r\n:-")
        lines = [line.strip() for line in translated.splitlines() if line.strip()]
        return lines[-1] if lines else translated.strip()

    def translate(self, text, source_lang="auto", target_lang="vi", previous_context=""):
        text = normalize_caption_text(text)
        context = normalize_caption_text(previous_context)[-500:]
        source_lang = (source_lang or "auto").split("-")[0]
        target_lang = (target_lang or "vi").split("-")[0]
        if not text:
            return ""
        if source_lang == target_lang:
            return text

        key = (source_lang, target_lang, context.casefold(), text.casefold(), "context-v1")
        if key in self.cache:
            return self.cache[key]

        payload = text
        if context:
            payload = f"{context}\n{CURRENT_MARKER}\n{text}"
        translated = self.fetcher(payload, source_lang, target_lang)
        if context and _TRANSLATED_MARKER_RE.search(translated or ""):
            result = self._extract_current(translated)
        elif context:
            # Some translation backends remove or rewrite delimiters. Never
            # return the translated context as if it were the current line.
            result = self.fetcher(text, source_lang, target_lang).strip()
        else:
            result = translated.strip()
        if result:
            self.cache[key] = result
            while len(self.cache) > self.max_cache_size:
                self.cache.pop(next(iter(self.cache)))
        return result or text

    def translate_many(
        self,
        texts,
        source_lang="auto",
        target_lang="vi",
        max_batch_items=16,
        max_batch_chars=2400,
        max_workers=6,
    ):
        """Translate timed captions in bounded parallel batches.

        Numbered markers make one network response reversible without changing
        caption order or timestamps. A malformed response safely falls back to
        translating only the affected batch item-by-item.
        """
        cleaned = [normalize_caption_text(text) for text in texts]
        source_lang = (source_lang or "auto").split("-")[0]
        target_lang = (target_lang or "vi").split("-")[0]
        if source_lang == target_lang:
            return cleaned
        if not cleaned:
            return []

        if (
            os.environ.get("GEMINI_API_KEY")
            and os.environ.get("GEMINI_TRANSLATION_MODE", "prefetch").lower() == "prefetch"
        ):
            # Larger, low-concurrency requests preserve context without
            # burning the free quota on hundreds of tiny subtitle fragments.
            max_batch_items = max(max_batch_items, 24)
            max_batch_chars = max(max_batch_chars, 4000)
            max_workers = min(max_workers, 2)

        batches = []
        current = []
        current_chars = 0
        for index, text in enumerate(cleaned):
            item_chars = len(text) + 20
            if current and (
                len(current) >= max_batch_items
                or current_chars + item_chars > max_batch_chars
            ):
                batches.append(current)
                current = []
                current_chars = 0
            current.append((index, text))
            current_chars += item_chars
        if current:
            batches.append(current)

        results = list(cleaned)

        def translate_batch(batch):
            payload = "\n".join(
                f"[[[{index:06d}]]]\n{text}" for index, text in batch
            )
            translated = self.fetcher(payload, source_lang, target_lang) or ""
            markers = list(_BATCH_CAPTION_MARKER_RE.finditer(translated))
            expected = [index for index, _ in batch]
            found = [int(marker.group(1)) for marker in markers]
            if found == expected:
                values = []
                for position, marker in enumerate(markers):
                    end = markers[position + 1].start() if position + 1 < len(markers) else len(translated)
                    values.append((found[position], translated[marker.end():end].strip()))
                if all(value for _, value in values):
                    return values

            values = []
            for index, text in batch:
                try:
                    value = self.fetcher(text, source_lang, target_lang).strip()
                except Exception:
                    value = text
                values.append((index, value or text))
            return values

        worker_count = max(1, min(max_workers, len(batches)))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [executor.submit(translate_batch, batch) for batch in batches]
            for future in as_completed(futures):
                for index, value in future.result():
                    results[index] = value

        return results
