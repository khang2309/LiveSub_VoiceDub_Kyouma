import os
import json
import unittest
import urllib.error
from unittest.mock import patch

from livesub_core import (
    _GEMINI_CIRCUIT,
    _gemini_translate_fetch,
    _hybrid_translate_fetch,
    merge_caption_segments,
    TranslationService,
    select_caption_track,
    should_translate_to_vietnamese,
    build_live_transcribe_options,
)
from realtime_gate import RealtimeCaptionArbiter
from translation_router import TranslationRouter
from ocr_engine import SubtitleOCR

os.environ["TRANSLATION_MODE"] = "private"


class CaptionMergeTests(unittest.TestCase):
    def test_live_whisper_does_not_reinject_previous_transcript(self):
        options = build_live_transcribe_options("en")
        self.assertNotIn("initial_prompt", options)

    def test_rolling_caption_prefix_does_not_repeat(self):
        raw = [
            {"start": 0.0, "end": 1.0, "text": "Hello"},
            {"start": 0.4, "end": 1.8, "text": "Hello world"},
            {"start": 1.8, "end": 2.6, "text": "world again."},
        ]
        merged = merge_caption_segments(raw)
        text = " ".join(item["text"] for item in merged)
        self.assertEqual(text, "Hello world again.")
        self.assertTrue(all(item["end"] > item["start"] for item in merged))

    def test_repeated_caption_far_apart_remains_two_segments(self):
        raw = [
            {"start": 0.0, "end": 1.0, "text": "Thank you"},
            {"start": 60.0, "end": 61.0, "text": "Thank you"},
        ]
        merged = merge_caption_segments(raw)
        self.assertEqual(len(merged), 2)

    def test_overlapping_sentences_keep_their_original_speech_start(self):
        raw = [
            {"start": 10.0, "end": 12.4, "text": "First sentence."},
            {"start": 12.0, "end": 13.6, "text": "Second sentence."},
        ]

        merged = merge_caption_segments(raw)

        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[1]["start"], 12.0)
        self.assertLessEqual(merged[0]["end"], merged[1]["start"])


class RealtimeCaptionGateTests(unittest.TestCase):
    def test_cross_source_duplicate_is_rejected(self):
        gate = RealtimeCaptionArbiter(window_ms=5000)
        first = gate.check("session-a", "ocr", "With the arena now smaller.", 1, 1000)
        duplicate = gate.check("session-a", "asr", "With the arena now smaller", 1, 1400)

        self.assertTrue(first.accepted)
        self.assertFalse(duplicate.accepted)
        self.assertEqual(duplicate.reason, "cross_source_duplicate")

    def test_same_caption_after_expiry_is_allowed(self):
        gate = RealtimeCaptionArbiter(window_ms=1000)
        gate.check("session-a", "ocr", "Thank you", 1, 1000)
        later = gate.check("session-a", "asr", "Thank you", 1, 2100)

        self.assertTrue(later.accepted)


class OCRRoutingTests(unittest.TestCase):
    def test_korean_uses_dedicated_recognizer(self):
        engine = SubtitleOCR()
        self.assertEqual(engine._family("ko-KR").value, "korean")

    def test_dedicated_language_recognizers(self):
        engine = SubtitleOCR()
        self.assertEqual(engine._family("en").value, "en")
        self.assertEqual(engine._family("ja").value, "japan")
        self.assertEqual(engine._family("zh").value, "ch")
        self.assertEqual(engine._family("ko").value, "korean")

    def test_subtitle_geometry_rejects_sidebar_and_keeps_two_line_caption(self):
        texts = ["Juan plus one of the strong people", "is manageable.", "ALICE"]
        scores = [0.99, 0.99, 0.99]
        boxes = [
            [[100, 300], [600, 300], [600, 323], [100, 323]],
            [[220, 328], [480, 328], [480, 355], [220, 355]],
            [[780, 310], [900, 310], [900, 345], [780, 345]],
        ]
        selected = SubtitleOCR._select_subtitle_lines(texts, scores, boxes, 1000, 600)
        self.assertEqual(
            " ".join(text for text, _ in selected),
            "Juan plus one of the strong people is manageable.",
        )


class CaptionTrackSelectionTests(unittest.TestCase):
    def test_explicit_english_does_not_silently_use_vietnamese(self):
        track, language, source = select_caption_track(
            {"vi": [{"url": "vi"}]}, {}, preference="en"
        )
        self.assertIsNone(track)
        self.assertEqual(language, "en")
        self.assertIsNone(source)

    def test_original_prefers_video_language_manual_track(self):
        track, language, source = select_caption_track(
            {"en": [{"url": "en"}], "ja": [{"url": "ja"}]},
            {"ja": [{"url": "auto-ja"}]},
            preference="original",
            video_language="ja-JP",
        )
        self.assertEqual(track[0]["url"], "ja")
        self.assertEqual((language, source), ("ja", "manual"))


class TranslationTests(unittest.TestCase):
    def test_gemini_switches_model_before_provider_fallback(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return json.dumps({
                    "candidates": [{
                        "content": {"parts": [{"text": "Xin chào"}]}
                    }]
                }).encode("utf-8")

        quota_error = urllib.error.HTTPError(
            "https://example.invalid", 429, "quota", {}, None
        )
        _GEMINI_CIRCUIT.update(cooldown_until=0.0, last_error=None, failures=0)
        with patch.dict(os.environ, {
            "GEMINI_TRANSLATION_MODEL": "primary-model",
            "GEMINI_TRANSLATION_FALLBACK_MODELS": "fallback-model",
        }), patch(
            "livesub_core.urllib.request.urlopen",
            side_effect=[quota_error, FakeResponse()],
        ) as mocked:
            translated = _gemini_translate_fetch(
                "Hello", "en", "vi", key="test-key"
            )
        self.assertEqual(translated, "Xin chào")
        self.assertEqual(mocked.call_count, 2)
        self.assertIn("fallback-model", mocked.call_args_list[1].args[0].full_url)

    def test_gemini_quota_error_falls_back_without_losing_caption_batch(self):
        payload = "[[[000000]]]\nHello there"
        with patch.dict(os.environ, {
            "GEMINI_API_KEY": "test-key",
            "GEMINI_TRANSLATION_MODE": "prefetch",
        }), patch("livesub_core._gemini_translate_fetch", side_effect=RuntimeError("429 quota")), patch(
            "livesub_core._google_translate_fetch", return_value="[[[000000]]]\nXin chào"
        ):
            self.assertEqual(
                _hybrid_translate_fetch(payload, "en", "vi"),
                "[[[000000]]]\nXin chào",
            )

    def test_vietnamese_dub_text_skips_redundant_network_translation(self):
        self.assertFalse(should_translate_to_vietnamese("vi"))
        self.assertFalse(should_translate_to_vietnamese("vi-VN"))
        self.assertTrue(should_translate_to_vietnamese("en"))

    def test_caption_batch_translation_uses_one_request_and_preserves_order(self):
        calls = []

        def fake_fetch(text, source, target):
            calls.append(text)
            return text.replace("first", "một").replace("second", "hai")

        service = TranslationService(fetcher=fake_fetch)
        translated = service.translate_many(["first line", "second line"], "en", "vi")

        self.assertEqual(translated, ["một line", "hai line"])
        self.assertEqual(len(calls), 1)

    def test_language_context_and_cache_key_are_respected(self):
        calls = []

        def fake_fetch(text, source, target):
            calls.append((text, source, target))
            return "BỐI CẢNH\n[[[HIỆN TẠI]]]\nBản dịch"

        service = TranslationService(fetcher=fake_fetch)
        first = service.translate("bank", source_lang="en", target_lang="vi", previous_context="river")
        second = service.translate("bank", source_lang="de", target_lang="vi", previous_context="river")
        cached = service.translate("bank", source_lang="en", target_lang="vi", previous_context="river")

        self.assertEqual(first, "Bản dịch")
        self.assertEqual(second, "Bản dịch")
        self.assertEqual(cached, first)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][1:], ("en", "vi"))
        self.assertIn("river", calls[0][0])

    def test_translation_cache_is_bounded(self):
        service = TranslationService(
            fetcher=lambda text, source, target: text,
            max_cache_size=2,
        )
        service.translate("one", source_lang="en")
        service.translate("two", source_lang="en")
        service.translate("three", source_lang="en")
        self.assertEqual(len(service.cache), 2)

    def test_missing_context_marker_falls_back_to_current_text_only(self):
        calls = []

        def fake_fetch(text, source, target):
            calls.append(text)
            if len(calls) == 1:
                return "Ngá»¯ cáº£nh vÃ  báº£n dá»‹ch bá»‹ gá»™p"
            return "Báº£n dá»‹ch hiá»‡n táº¡i"

        service = TranslationService(fetcher=fake_fetch)
        translated = service.translate("current", previous_context="context")
        self.assertEqual(translated, "Báº£n dá»‹ch hiá»‡n táº¡i")
        self.assertEqual(calls[-1], "current")


    def test_korean_japanese_chinese_translation(self):
        calls = []

        def fake_fetch(text, source, target):
            calls.append((text, source, target))
            mapping = {
                ("안녕하세요", "ko"): "Xin chào",
                ("こんにちは", "ja"): "Xin chào",
                ("你好", "zh"): "Xin chào",
            }
            return mapping.get((text, source), "Đã dịch")

        service = TranslationService(fetcher=fake_fetch)
        self.assertEqual(service.translate("안녕하세요", source_lang="ko"), "Xin chào")
        self.assertEqual(service.translate("こんにちは", source_lang="ja"), "Xin chào")
        self.assertEqual(service.translate("你好", source_lang="zh"), "Xin chào")
        self.assertEqual(len(calls), 3)

    def test_cjk_alphanumeric_detection(self):
        for sample in ["안녕하세요", "こんにちは", "你好", "Hello world"]:
            self.assertTrue(any(c.isalnum() for c in sample))
        self.assertFalse(any(c.isalnum() for c in "...   !!!"))

    def test_router_uses_vinai_for_english_and_nllb_for_asian_languages(self):
        class English:
            available = True
            def translate(self, text): return "vinai:" + text
            def snapshot(self): return {}

        class Multilingual:
            available = True
            def supports(self, language): return language in {"ko", "ja", "zh", "zh-cn"}
            def translate(self, text, source, target): return f"nllb:{source}:{text}"
            def snapshot(self): return {}

        class Network:
            def translate(self, text, **kwargs): return "network:" + text

        router = TranslationRouter(English(), Multilingual(), Network())
        self.assertEqual(router.translate("hello", "en"), "vinai:hello")
        self.assertEqual(router.translate("안녕", "ko"), "nllb:ko:안녕")
        self.assertEqual(router.translate("こんにちは", "ja"), "nllb:ja:こんにちは")
        self.assertEqual(router.translate("你好", "zh-CN"), "nllb:zh-cn:你好")

    def test_router_falls_back_to_network_without_dropping_text(self):
        class English:
            available = False
            def snapshot(self): return {}

        class Multilingual:
            available = True
            def supports(self, language): return True
            def translate(self, text, source, target): raise RuntimeError("local failed")
            def snapshot(self): return {}

        class Network:
            def translate(self, text, **kwargs): return "fallback:" + text

        router = TranslationRouter(English(), Multilingual(), Network())
        self.assertEqual(router.translate("bonjour", "fr"), "fallback:bonjour")
        self.assertEqual(router.snapshot()["metrics"]["fallbacks"], 1)

    def test_fastest_mode_uses_network_then_local(self):
        class English:
            available = True
            def translate(self, text): return "local:" + text
            def snapshot(self): return {}

        class Multilingual:
            available = False
            def supports(self, language): return False
            def snapshot(self): return {}

        class Network:
            def translate(self, text, **kwargs): return "network:" + text

        with patch.dict(os.environ, {"TRANSLATION_MODE": "fastest"}):
            router = TranslationRouter(English(), Multilingual(), Network())
            self.assertEqual(router.translate("hello", "en"), "network:hello")

    def test_startup_benchmark_fixes_route_for_the_session(self):
        class English:
            available = True
            def translate(self, text): return "local:" + text
            def snapshot(self): return {}

        class Multilingual:
            available = False
            def supports(self, language): return False
            def snapshot(self): return {}

        class Network:
            def translate(self, text, **kwargs): return "network:" + text

        with patch.dict(os.environ, {"TRANSLATION_MODE": "fastest"}):
            router = TranslationRouter(English(), Multilingual(), Network())
            routes = router.benchmark_startup()
            self.assertIn(routes.get("en"), {"network", "vinai"})
            first_routes = dict(routes)
            self.assertEqual(router.benchmark_startup(), first_routes)

    def test_proper_names_preservation(self):
        original = "You can't hide in the woods forever, Jeff."
        translated = "Anh không thể trốn trong rừng mãi được, jeff."
        preserved = TranslationRouter.preserve_proper_names(original, translated)
        self.assertEqual(preserved, "Anh không thể trốn trong rừng mãi được, Jeff.")

        original_twana = "I think Twana might be over there."
        translated_twana = "Tôi nghĩ twana có thể ở đằng kia."
        preserved_twana = TranslationRouter.preserve_proper_names(original_twana, translated_twana)
        self.assertEqual(preserved_twana, "Tôi nghĩ Twana có thể ở đằng kia.")

    def test_select_subtitle_lines_rejects_timestamps_and_spam(self):
        texts = ["TRUYENGOC59 39 Dua ddr", "BácKinh", "You can't hide forever, Jeff."]
        scores = [0.95, 0.92, 0.90]
        boxes = [
            [[200, 300], [500, 300], [500, 325], [200, 325]],
            [[250, 330], [350, 330], [350, 350], [250, 350]],
            [[150, 360], [600, 360], [600, 390], [150, 390]],
        ]
        selected = SubtitleOCR._select_subtitle_lines(texts, scores, boxes, 1000, 600)
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0][0], "You can't hide forever, Jeff.")

    def test_english_loanword_phonetics(self):
        from server import clean_speech_text
        self.assertEqual(clean_speech_text("Anh ấy là một HERO"), "Anh ấy là một hi-rô")
        self.assertEqual(clean_speech_text("Tôi đang chơi GAME này"), "Tôi đang chơi gêm này")
        self.assertEqual(clean_speech_text("Con BOSS cấp độ 100"), "Con bót cấp độ 100")
        self.assertEqual(clean_speech_text("OK tôi hiểu rồi"), "ô kê tôi hiểu rồi")

    def test_repair_vietnamese_ocr(self):
        from server import repair_vietnamese_ocr
        self.assertEqual(
            repair_vietnamese_ocr("Thuò l p quô, trong tên cüa ba vi công thân"),
            "Thuở lập quốc, trong tên của ba vị công thần"
        )
        self.assertEqual(
            repair_vietnamese_ocr("Vây là tù dó, nhüng tôc dugc Hoàng dé công nhân"),
            "Vậy là từ đó, những tộc được Hoàng đế công nhận"
        )
        self.assertEqual(
            repair_vietnamese_ocr("禾馬 váy là tù do, nhüng tôc dugc Hoàng dê công nhân"),
            "vậy là từ đó, những tộc được Hoàng đế công nhận"
        )
        self.assertEqual(
            repair_vietnamese_ocr("禾馬已 vè sau, nhúng chū khác"),
            "về sau, những chữ khác"
        )


if __name__ == '__main__':
    unittest.main()
