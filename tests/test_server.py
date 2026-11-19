import unittest
from unittest.mock import patch

from livesub_core import (
    merge_caption_segments,
    TranslationService,
    select_caption_track,
    should_translate_to_vietnamese,
)


class CaptionMergeTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
