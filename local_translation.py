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

    def translate_many(self, texts: list[str], beam_size: int = 2) -> list[str]:
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


NLLB_LANGUAGE_CODES = {
    "af": "afr_Latn", "am": "amh_Ethi", "ar": "arb_Arab", "as": "asm_Beng",
    "az": "azj_Latn", "ba": "bak_Cyrl", "be": "bel_Cyrl", "bg": "bul_Cyrl",
    "bn": "ben_Beng", "bo": "bod_Tibt", "bs": "bos_Latn",
    "ca": "cat_Latn", "cs": "ces_Latn", "cy": "cym_Latn", "da": "dan_Latn",
    "de": "deu_Latn", "el": "ell_Grek", "en": "eng_Latn", "es": "spa_Latn",
    "et": "est_Latn", "eu": "eus_Latn", "fa": "pes_Arab", "fi": "fin_Latn",
    "fo": "fao_Latn", "fr": "fra_Latn", "gl": "glg_Latn", "gu": "guj_Gujr",
    "ha": "hau_Latn", "he": "heb_Hebr", "hi": "hin_Deva", "hr": "hrv_Latn",
    "ht": "hat_Latn", "hu": "hun_Latn", "hy": "hye_Armn", "id": "ind_Latn",
    "is": "isl_Latn", "it": "ita_Latn", "ja": "jpn_Jpan", "jw": "jav_Latn",
    "ka": "kat_Geor", "kk": "kaz_Cyrl", "km": "khm_Khmr", "kn": "kan_Knda",
    "ko": "kor_Hang", "lb": "ltz_Latn", "lo": "lao_Laoo",
    "lt": "lit_Latn", "lv": "lvs_Latn", "mg": "plt_Latn", "mi": "mri_Latn",
    "mk": "mkd_Cyrl", "ml": "mal_Mlym", "mn": "khk_Cyrl", "mr": "mar_Deva",
    "ms": "zsm_Latn", "mt": "mlt_Latn", "my": "mya_Mymr", "ne": "npi_Deva",
    "nl": "nld_Latn", "nn": "nno_Latn", "no": "nob_Latn", "oc": "oci_Latn",
    "pa": "pan_Guru", "pl": "pol_Latn", "ps": "pbt_Arab", "pt": "por_Latn",
    "ro": "ron_Latn", "ru": "rus_Cyrl", "sa": "san_Deva", "sd": "snd_Arab",
    "si": "sin_Sinh", "sk": "slk_Latn", "sl": "slv_Latn", "sn": "sna_Latn",
    "so": "som_Latn", "sq": "als_Latn", "sr": "srp_Cyrl", "su": "sun_Latn",
    "sv": "swe_Latn", "sw": "swh_Latn", "ta": "tam_Taml", "te": "tel_Telu",
    "tg": "tgk_Cyrl", "th": "tha_Thai", "tk": "tuk_Latn", "tl": "tgl_Latn",
    "tr": "tur_Latn", "tt": "tat_Cyrl", "uk": "ukr_Cyrl", "ur": "urd_Arab",
    "uz": "uzn_Latn", "vi": "vie_Latn", "yo": "yor_Latn", "zh": "zho_Hans",
    "zh-cn": "zho_Hans", "zh-hans": "zho_Hans", "zh-tw": "zho_Hant",
    "zh-hant": "zho_Hant", "yue": "yue_Hant",
}


class LocalMultilingualTranslator(LocalEnViTranslator):
    """NLLB-200 CTranslate2 backend for non-English speech.

    It deliberately runs on CPU: Whisper and VieNeu retain the RTX 3050 while
    translation can execute concurrently without GPU memory contention.
    """

    def __init__(self, model_dir: str | os.PathLike[str]):
        super().__init__(model_dir)
        self.last_source_language: str | None = None

    @staticmethod
    def normalize_language(language: str) -> str:
        value = (language or "").lower().replace("_", "-")
        if value in NLLB_LANGUAGE_CODES:
            return value
        return value.split("-")[0]

    def supports(self, language: str) -> bool:
        return self.normalize_language(language) in NLLB_LANGUAGE_CODES

    def translate_many(
        self,
        texts: list[str],
        source_lang: str,
        target_lang: str = "vi",
        beam_size: int = 2,
    ) -> list[str]:
        if not texts:
            return []
        source = self.normalize_language(source_lang)
        target = self.normalize_language(target_lang)
        if source == target:
            return list(texts)
        if not self.supports(source) or not self.supports(target):
            raise ValueError(f"Unsupported NLLB route: {source_lang} -> {target_lang}")
        if not self.load():
            raise RuntimeError(self.error or "Local NLLB model is unavailable")

        source_token = NLLB_LANGUAGE_CODES[source]
        target_token = NLLB_LANGUAGE_CODES[target]
        sources = [
            [source_token] + self._tokenizer.encode(text, out_type=str) + ["</s>"]
            for text in texts
        ]
        started = time.perf_counter()
        with self._translate_lock:
            results = self._translator.translate_batch(
                sources,
                target_prefix=[[target_token] for _ in sources],
                beam_size=beam_size,
                max_decoding_length=192,
            )
        self.last_batch_ms = round((time.perf_counter() - started) * 1000, 1)
        self.last_source_language = source

        translations = []
        ignored = {target_token, "</s>"}
        for result, original in zip(results, texts):
            tokens = [token for token in result.hypotheses[0] if token not in ignored]
            value = self._tokenizer.decode(tokens).strip()
            translations.append(value or original)
        return translations

    def translate(self, text: str, source_lang: str, target_lang: str = "vi") -> str:
        return self.translate_many([text], source_lang, target_lang)[0]

    def snapshot(self) -> dict:
        return {
            "provider": "facebook/nllb-200-distilled-600M",
            "runtime": "CTranslate2 INT8 CPU",
            "status": self.status,
            "available": self.available,
            "supported_routes": sorted(NLLB_LANGUAGE_CODES),
            "last_source_language": self.last_source_language,
            "load_ms": self.load_ms,
            "last_batch_ms": self.last_batch_ms,
            "error": self.error,
            "license_note": "CC-BY-NC-4.0; local non-commercial use",
        }
