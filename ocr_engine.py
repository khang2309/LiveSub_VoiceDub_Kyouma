"""Low-latency OCR for hard-coded movie subtitles.

RapidOCR uses PP-OCR ONNX models on CPU so it does not compete with Whisper
and VieNeu for the RTX 3050 VRAM. Engines are cached per script family.
"""

from __future__ import annotations

import re
import threading
import time

import numpy as np
from PIL import Image
from rapidocr import RapidOCR
from rapidocr.utils.typings import LangRec, ModelType


class SubtitleOCR:
    _LANG_MAP = {
        "ko": LangRec.KOREAN,
        "kr": LangRec.KOREAN,
        "en": LangRec.EN,
        "eng": LangRec.EN,
        "zh": LangRec.CH,
        "cmn": LangRec.CH,
        "ja": LangRec.JAPAN,
        "jp": LangRec.JAPAN,
        "vi": LangRec.LATIN,
        "latin": LangRec.LATIN,
        "es": LangRec.LATIN,
        "fr": LangRec.LATIN,
        "de": LangRec.LATIN,
        "th": LangRec.TH,
        "thai": LangRec.TH,
        "auto": LangRec.EN,
    }

    def __init__(self):
        self._engines: dict[LangRec, RapidOCR] = {}
        self._locks: dict[LangRec, threading.Lock] = {}
        self._state_lock = threading.Lock()
        self.status = "idle"
        self.error: str | None = None
        self.last_latency_ms: float | None = None

    @classmethod
    def normalize_language(cls, language: str) -> str:
        value = (language or "auto").lower().replace("_", "-")
        return value.split("-", 1)[0]

    def _family(self, language: str) -> LangRec:
        return self._LANG_MAP.get(self.normalize_language(language), LangRec.CH)

    def _get_engine(self, language: str) -> tuple[RapidOCR, threading.Lock]:
        family = self._family(language)
        with self._state_lock:
            if family not in self._engines:
                self.status = "loading"
                params = {
                    "Global.log_level": "error",
                    "Global.use_cls": False,
                    "Global.text_score": 0.58,
                    "Det.model_type": ModelType.TINY,
                    "Rec.model_type": ModelType.TINY,
                    "Rec.lang_type": family,
                    "EngineConfig.onnxruntime.intra_op_num_threads": 4,
                    "EngineConfig.onnxruntime.inter_op_num_threads": 1,
                }
                self._engines[family] = RapidOCR(params=params)
                self._locks[family] = threading.Lock()
        return self._engines[family], self._locks[family]

    def recognize(self, image_bytes: bytes, language: str = "auto") -> dict:
        started = time.perf_counter()
        try:
            engine, lock = self._get_engine(language)
            image = Image.open(__import__("io").BytesIO(image_bytes)).convert("RGB")
            array = np.asarray(image)
            acquired = lock.acquire(timeout=0.25)
            if not acquired:
                return {
                    "text": "",
                    "confidence": 0.0,
                    "latency_ms": 0.0,
                    "language": self.normalize_language(language),
                    "engine": "RapidOCR PP-OCRv6 tiny ONNX",
                    "congested": True,
                }
            try:
                result = engine(array, use_cls=False, text_score=0.58)
            finally:
                lock.release()
            texts = list(result.txts if result.txts is not None else ())
            scores = [
                float(value)
                for value in (result.scores if result.scores is not None else ())
            ]
            boxes = list(result.boxes if result.boxes is not None else ())
            accepted = self._select_subtitle_lines(
                texts, scores, boxes, array.shape[1], array.shape[0]
            )
            text = " ".join(item[0] for item in accepted)
            confidence = (
                round(sum(item[1] for item in accepted) / len(accepted), 4)
                if accepted
                else 0.0
            )
            self.last_latency_ms = round((time.perf_counter() - started) * 1000, 1)
            self.status = "ready"
            self.error = None
            return {
                "text": text,
                "confidence": confidence,
                "latency_ms": self.last_latency_ms,
                "language": self.normalize_language(language),
                "engine": "RapidOCR PP-OCRv6 tiny ONNX",
            }
        except Exception as error:
            self.status = "error"
            self.error = str(error)
            raise

    @staticmethod
    def _select_subtitle_lines(texts, scores, boxes, image_width, image_height):
        """Reject YouTube sidebars, navigation/comments and keep dialogue subtitles."""
        candidates = []
        junk_tail_regex = re.compile(
            r'(?i)(?:^|\s+)(?:'
            r't[oöô]i\s*s[oóọ]ng\s*s[oóọ]t|'
            r'mrbeast|'
            r'gta\s*(?:6|vi|v\b)|'
            r'grand\s*theft\s*auto|'
            r't[oó][\s\w]*k[eé]t\s*b[aạ]n|'
            r'b[aả]n\s*l[oồ]ng\s*ti[eê]ng|'
            r't[eé]c[eèé]|tecd|tacd|tiac[eèé]|teck|tetcd|cie|'
            r'clerk\s*baskets|baskets\s*threaten|threaten\s*o\s*clerk|'
            r'animehay|animevietsub|bit\.ly|citumo|rap\s*citu|hdbet|3bet|ch[oơ]ingay|n[oổ]\s*h[uũ]|'
            r'b[áa]ckinh|bickinh|backinh|truyengoc'
            r').*$'
        )

        for text, score, box in zip(texts, scores, boxes):
            text = (text or "").strip()
            if not text or score < 0.58 or not any(char.isalnum() for char in text):
                continue
            # Filter YouTube metadata timestamps like 59:39 or 59 39, standalone digits/counters (e.g. 23, 20)
            if re.search(r'^\s*\d{1,4}\s*$|\b\d{1,2}[:.]\d{2}\b|\b59\s*39\b', text):
                continue

            # Strip watermarks, ads, and video title badges from tail or full string
            cleaned_text = junk_tail_regex.sub('', text).strip()
            if not cleaned_text:
                continue
            text = cleaned_text

            # Filter watermarks, fansub credits, websites and ads (e.g. AnimeHay, AnimeVietsub, bit.ly, rap cituMo...)
            if re.search(r'(?i)(?:animehay|animevietsub|bit\.ly|cituMo|rap\s*citu|hdbet|3bet|chơingay|nổ\s*hũ|truyengoc|b[áa]ckinh|bickinh|backinh|\b(?:lượt xem|views?|người đăng ký|subscribers?|trước|ago|anker|soundcore|bình luận|comments?|chia sẻ|share|tải xuống|download|toàn cầu|thông minh toàn cầu|dẫn dắt bởi|phong thần|diễn nghĩa|trường giang|đấu trường sinh tử|mrbeast|gta\s*6|gta\s*vi|grand theft auto|kết bạn|ket ban|gaming|bản lồng tiếng|đăng ký)\b)', text):
                continue
            # Filter YouTube "...thêm" expand button
            if re.search(r'(?i)\bthêm\s*$', text):
                continue
            # Subtitle lines are spoken dialogue; reject long descriptions/paragraphs (> 25 words or > 120 chars)
            if len(text.split()) > 25 or len(text) > 120:
                continue
            # Filter short noise without alphabetic content or 1-4 char noise (e.g. Ta02, JNY, HE, CE)
            alpha_only = re.sub(r'[^a-zA-ZÀ-ỹ\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]', '', text)
            if len(alpha_only) < 2 or len(text.strip()) <= 4 and re.fullmatch(r'^[A-Za-z0-9\s]+$', text.strip()):
                continue

            # Detect corrupted Vietnamese Vietsub OCR (e.g. missing diacritics / Danish-German Latin glyphs å, ä, ö, ø, ß)
            if re.search(r'[åäöøß]|ngv[oò]i|thv[oò]ng|nu[aá]c\s*m[aå]t|lung\s*tr[oò]ng|l[aā]o\s*b[aà]|ky\s*vi[eê]n', text, re.IGNORECASE):
                continue

            xs = [float(point[0]) for point in box]
            ys = [float(point[1]) for point in box]
            height = max(ys) - min(ys)
            center_x = sum(xs) / len(xs)
            center_y = sum(ys) / len(ys)
            # Browser crops to subtitle area. Reject text outside valid frame bounds.
            if not (image_width * 0.01 <= center_x <= image_width * 0.99):
                continue
            if not (image_height * 0.03 <= center_y <= image_height * 0.97):
                continue
            if height < max(12.0, image_height * 0.015):
                continue
            candidates.append(
                {
                    "text": text,
                    "score": float(score),
                    "height": height,
                    "x": center_x,
                    "y": center_y,
                }
            )
        if not candidates:
            return []

        max_height = max(item["height"] for item in candidates)
        candidates = [item for item in candidates if item["height"] >= max_height * 0.55]
        candidates.sort(key=lambda item: item["y"])

        groups = []
        for item in candidates:
            matches = []
            for group in groups:
                previous = group[-1]
                group_x = sum(member["x"] for member in group) / len(group)
                if (
                    item["y"] - previous["y"] <= max(item["height"], previous["height"]) * 2.2
                    and abs(item["x"] - group_x) <= image_width * 0.45
                ):
                    matches.append(group)
            if matches:
                min(matches, key=lambda group: abs(item["y"] - group[-1]["y"])).append(item)
            else:
                groups.append([item])

        def group_score(group):
            avg_height = sum(item["height"] for item in group) / len(group)
            chars = min(80, sum(len(item["text"]) for item in group))
            center_x = sum(item["x"] for item in group) / len(group)
            center_penalty = abs(center_x - image_width / 2) / image_width * 10
            return avg_height + chars * 0.28 + min(3, len(group)) * 5 - center_penalty

        best = max(groups, key=group_score)
        total_words = sum(len(item["text"].split()) for item in best)
        if total_words > 22 or sum(len(item["text"]) for item in best) > 120:
            return []
        best = sorted(best[:3], key=lambda item: item["y"])
        return [(item["text"], item["score"]) for item in best]

    def warmup(self) -> None:
        # Small synthetic subtitle forces model resolution/session creation.
        from PIL import ImageDraw

        image = Image.new("RGB", (640, 96), "black")
        ImageDraw.Draw(image).text((20, 30), "Subtitle warmup 123", fill="white")
        buffer = __import__("io").BytesIO()
        image.save(buffer, format="PNG")
        self.recognize(buffer.getvalue(), "en")

    def snapshot(self) -> dict:
        return {
            "status": self.status,
            "error": self.error,
            "last_latency_ms": self.last_latency_ms,
            "loaded_families": [family.value for family in self._engines],
            "device": "cpu-onnx",
        }
