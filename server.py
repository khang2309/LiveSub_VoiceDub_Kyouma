import os
import sys
import io
import re
import wave
import json
import base64
import tempfile
import urllib.request
import urllib.parse
import asyncio
import time
import struct
import math
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import Response, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
import edge_tts
# Load optional .env file if present (e.g. AZURE_TRANSLATOR_KEY)
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(env_path):
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip().strip("\"'")
                    if k and k not in os.environ:
                        os.environ[k] = v
    except Exception as e:
        print(f"Notice: Failed to load .env: {e}")

from livesub_core import (
    TranslationService,
    merge_caption_segments,
    select_caption_track,
    should_translate_to_vietnamese,
)
from local_translation import LocalEnViTranslator, LocalMultilingualTranslator
from translation_router import TranslationRouter
from latency_metrics import LatencyWindow
from ocr_engine import SubtitleOCR

# 0. Setup NVIDIA CUDA DLLs for RTX 3050 GPU Acceleration
site_packages = os.path.join(sys.prefix, "Lib", "site-packages")
for sub in ["cublas", "cudnn", "cuda_nvrtc"]:
    p = os.path.join(site_packages, "nvidia", sub, "bin")
    if os.path.exists(p):
        try:
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(p)
            os.environ["PATH"] = p + ";" + os.environ["PATH"]
        except Exception as e:
            print(f"Error adding DLL path {p}: {e}")

from faster_whisper import WhisperModel
from piper.voice import PiperVoice

app = FastAPI(title="LiveSub & VoiceDub AI Studio")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom Middleware to disable browser caching completely
class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheMiddleware)

# 1. Initialize Whisper Model: Prefer GPU (CUDA float16, 0.3s), Fallback to CPU (int8)
print("⏳ Khởi tạo mô hình Faster-Whisper...")
try:
    whisper_model = WhisperModel("base", device="cuda", compute_type="float16")
    whisper_runtime = {"provider": "faster-whisper", "model": "base", "device": "cuda", "compute_type": "float16"}
    print("🚀 ĐÃ KÍCH HOẠT GPU NVIDIA RTX 3050 (CUDA float16) - Tốc độ siêu tốc ~0.3s!")
except Exception as ge:
    print(f"Chuyển sang CPU do lỗi CUDA: {ge}")
    whisper_model = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=8)
    whisper_runtime = {"provider": "faster-whisper", "model": "base", "device": "cpu", "compute_type": "int8"}
    print("✅ Đã sẵn sàng trên CPU (int8, 8 luồng)!")

_whisper_warm_task = None
_whisper_warm_state = {"status": "idle", "error": None}


async def warm_whisper_engine():
    if _whisper_warm_state["status"] in {"warming", "ready"}:
        return
    _whisper_warm_state.update(status="warming", error=None)

    def run_warmup():
        path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                path = tmp.name
            # Low-amplitude tone forces encoder/decoder CUDA kernels to run;
            # plain silence may be removed before inference by VAD.
            with wave.open(path, "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(16000)
                frames = bytearray()
                for index in range(8000):
                    sample = int(180 * math.sin(2 * math.pi * 220 * index / 16000))
                    frames.extend(struct.pack("<h", sample))
                wav_file.writeframes(frames)
            segments, _ = whisper_model.transcribe(
                path,
                language="en",
                beam_size=1,
                vad_filter=False,
                without_timestamps=True,
            )
            list(segments)
        finally:
            if path and os.path.exists(path):
                os.remove(path)

    try:
        await asyncio.to_thread(run_warmup)
        _whisper_warm_state["status"] = "ready"
    except Exception as error:
        _whisper_warm_state.update(status="error", error=str(error))


def schedule_whisper_warmup():
    global _whisper_warm_task
    if _whisper_warm_state["status"] in {"warming", "ready"}:
        return
    if _whisper_warm_task is None or _whisper_warm_task.done():
        _whisper_warm_task = asyncio.create_task(warm_whisper_engine())

# 2. Load Piper Local Neural Model (offline option with auto-download if missing)
piper_model_path = os.path.join(os.path.dirname(__file__), "models", "piper", "vi_VN-vais1000-medium.onnx")
piper_json_path = os.path.join(os.path.dirname(__file__), "models", "piper", "vi_VN-vais1000-medium.onnx.json")

piper_voice = None
def load_piper_voice():
    global piper_voice
    if piper_voice:
        return piper_voice
    piper_dir = os.path.dirname(piper_model_path)
    if not os.path.exists(piper_dir):
        os.makedirs(piper_dir, exist_ok=True)
    if not os.path.exists(piper_model_path):
        print("⏳ Đang tải mô hình giọng Piper AI tiếng Việt từ HuggingFace (60MB)...")
        onnx_url = "https://huggingface.co/rhasspy/piper-voices/resolve/main/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx"
        urllib.request.urlretrieve(onnx_url, piper_model_path)
        print("✅ Tải hoàn tất mô hình Piper ONNX!")
    if not os.path.exists(piper_json_path):
        json_url = "https://huggingface.co/rhasspy/piper-voices/resolve/main/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx.json"
        urllib.request.urlretrieve(json_url, piper_json_path)
    try:
        piper_voice = PiperVoice.load(piper_model_path, config_path=piper_json_path)
        print("✅ Piper AI Neural (offline) đã sẵn sàng!")
        return piper_voice
    except Exception as pe:
        print(f"Lỗi tải Piper: {pe}")
        return None

if os.path.exists(piper_model_path) and os.path.exists(piper_json_path):
    load_piper_voice()

# 3. Load VieNeu-TTS v3 Turbo Engine (pnnbao97/VieNeu-TTS)
_vieneu_engine = None
_vieneu_warm_task = None
_vieneu_warm_state = {
    "status": "idle",
    "backend": None,
    "device": None,
    "error": None,
}

def get_vieneu_engine():
    global _vieneu_engine
    if _vieneu_engine is None:
        try:
            from vieneu import Vieneu
            print("🚀 Đang nạp mô hình VieNeu-TTS v3 Turbo (pnnbao97)...")
            # Four stream slots are enough for one browser and consume less of
            # the RTX 3050's 4 GB VRAM than the library default of sixteen.
            _vieneu_engine = Vieneu(
                device="cuda",
                backend="pytorch",
                max_streams=4,
                max_batch_size=8,
            )
            print("✅ VieNeu-TTS Engine (48kHz) đã sẵn sàng!")
        except Exception as e:
            print(f"⚠️ Lỗi khởi tạo VieNeu-TTS: {e}")
            _vieneu_engine = False
    return _vieneu_engine if _vieneu_engine is not False else None


def resolve_vieneu_voice(engine, requested: str) -> str:
    voices = getattr(engine, "_preset_voices", {}) or {}
    if requested in voices:
        return requested
    for fallback in ("Thái Sơn", "Trúc Ly"):
        if fallback in voices:
            return fallback
    return next(iter(voices), requested)


async def warm_vieneu_engine():
    """Load VieNeu and capture its first CUDA graph without blocking the page."""
    if _vieneu_warm_state["status"] in {"warming", "ready"}:
        return
    _vieneu_warm_state.update(status="warming", error=None)
    try:
        engine = await asyncio.to_thread(get_vieneu_engine)
        if engine is None:
            raise RuntimeError("VieNeu engine could not be initialized")
        _vieneu_warm_state["backend"] = getattr(engine, "backend", None)
        inner_engine = getattr(engine, "engine", None)
        _vieneu_warm_state["device"] = str(getattr(inner_engine, "device", None))
        def warm_streaming_path():
            # Consume the generator so the exact CUDA streaming graph used by
            # the browser is captured before the first real sentence.
            for _ in engine.infer_stream(
                "Xin chào, hệ thống lồng tiếng đã sẵn sàng.",
                voice="Thái Sơn",
                apply_watermark=False,
                max_chars=128,
            ):
                pass

        await asyncio.to_thread(warm_streaming_path)

        def benchmark_streaming_path():
            began = time.perf_counter()
            first_chunk_ms = None
            byte_count = 0
            for chunk in generate_vieneu_pcm_chunks(
                "Đây là phép đo tốc độ giọng đọc trực tiếp trên máy.",
                "Thái Sơn",
            ):
                if first_chunk_ms is None:
                    first_chunk_ms = (time.perf_counter() - began) * 1000
                byte_count += len(chunk)
            total_seconds = time.perf_counter() - began
            audio_seconds = byte_count / (48000 * 2) if byte_count else 0
            return (
                round(first_chunk_ms or total_seconds * 1000, 1),
                round(total_seconds / audio_seconds, 3) if audio_seconds else None,
            )

        # Other startup workers (Whisper, OCR and translators) may briefly
        # contend for CPU/GPU resources. A single sample can therefore mark a
        # realtime-capable local voice as slow. Keep the best of three warm
        # runs; this route is then fixed for the whole session.
        local_samples = []
        for _ in range(3):
            local_samples.append(await asyncio.to_thread(benchmark_streaming_path))
        local_ttfa_ms = min(sample[0] for sample in local_samples)
        valid_rtfs = [sample[1] for sample in local_samples if sample[1] is not None]
        local_rtf = min(valid_rtfs) if valid_rtfs else None
        _network_tts_state["vieneu_ttfa_ms"] = local_ttfa_ms
        _network_tts_state["vieneu_rtf"] = local_rtf
        _vieneu_warm_state["status"] = "ready"
        select_auto_tts_provider()
        print(
            "VieNeu warm-up ready "
            f"(backend={_vieneu_warm_state['backend']}, device={_vieneu_warm_state['device']})"
        )
    except Exception as error:
        _vieneu_warm_state.update(status="error", error=str(error))
        print(f"VieNeu warm-up failed: {error}")


def schedule_vieneu_warmup():
    global _vieneu_warm_task
    if _vieneu_warm_state["status"] in {"warming", "ready"}:
        return
    if _vieneu_warm_task is None or _vieneu_warm_task.done():
        _vieneu_warm_task = asyncio.create_task(warm_vieneu_engine())

# In-memory translation & audio cache
translation_cache = {}
audio_cache = {}
translation_service = TranslationService(cache=translation_cache)
local_translation = LocalEnViTranslator(
    os.path.join(
        os.path.dirname(__file__),
        "models",
        "vinai-translate-en2vi-v2-int8",
    )
)
multilingual_translation = LocalMultilingualTranslator(
    os.path.join(
        os.path.dirname(__file__),
        "models",
        "nllb-200-distilled-600M-int8",
    )
)
translation_router = TranslationRouter(
    local_translation,
    multilingual_translation,
    translation_service,
    cache=translation_cache,
)
subtitle_ocr = SubtitleOCR()
_ocr_warm_task = None
_translation_warm_task = None
_stream_metrics = {
    "requests": 0,
    "last_first_chunk_ms": None,
    "last_total_ms": None,
    "last_error": None,
}
_asr_latency = LatencyWindow()
_transcribe_total_latency = LatencyWindow()
_tts_first_chunk_latency = LatencyWindow()


async def warm_local_translation():
    await asyncio.gather(
        asyncio.to_thread(local_translation.load),
        asyncio.to_thread(multilingual_translation.load),
    )
    # Compare providers once after every local model is warm. Subsequent lines
    # use the fixed route and never pay for a fresh provider probe.
    await asyncio.to_thread(translation_router.benchmark_startup)


def schedule_translation_warmup():
    global _translation_warm_task
    if (
        local_translation.status in {"loading", "ready"}
        and multilingual_translation.status in {"loading", "ready"}
    ):
        return
    if _translation_warm_task is None or _translation_warm_task.done():
        _translation_warm_task = asyncio.create_task(warm_local_translation())


async def warm_ocr_engine():
    try:
        await asyncio.to_thread(subtitle_ocr.warmup)
    except Exception as error:
        print(f"OCR warm-up error: {error}")


def schedule_ocr_warmup():
    global _ocr_warm_task
    if subtitle_ocr.status in {"loading", "ready"}:
        return
    if _ocr_warm_task is None or _ocr_warm_task.done():
        _ocr_warm_task = asyncio.create_task(warm_ocr_engine())

# Anti-Hallucination & Repetition Interceptor
def is_hallucination_or_loop(text: str) -> bool:
    if not text:
        return True
    cleaned = text.strip()
    words = cleaned.split()
    if len(words) < 2:
        return False

    # 1. Any word repeated 2+ times consecutively: e.g. "có thể có thể"
    if re.search(r'(\b\w+\b)(?:\s+\1\b){2,}', cleaned, flags=re.IGNORECASE):
        return True

    # 2. Any 2-word phrase repeated 2+ times consecutively: e.g. "có thể có thể"
    if re.search(r'(\b\w+\s+\w+\b)(?:\s+\1\b){1,}', cleaned, flags=re.IGNORECASE):
        return True

    # 3. Vocabulary diversity ratio: if unique words < 45% of total words for len >= 5
    if len(words) >= 5:
        unique_ratio = len(set(w.lower() for w in words)) / len(words)
        if unique_ratio < 0.45:
            return True

    # 4. Max words: a single clause rarely exceeds 24 words
    if len(words) > 24:
        return True

    return False

def clean_speech_text(text: str) -> str:
    if not text:
        return ""
    # Strip sound tags
    cleaned = re.sub(r'\[.*?\]|\(.*?\)|♪+|♫+', '', text)
    # Keep currency/percent symbols until they have been expanded.
    cleaned = re.sub(r'[^\w\s\.,\?!\'\"$₫%À-ỹà-ỹ，。！？；：“”‘’（）\-]', ' ', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    # Deduplicate consecutive repeated words
    words = cleaned.split()
    if len(words) > 2:
        deduped = []
        i = 0
        while i < len(words):
            deduped.append(words[i])
            i += 1
            while i < len(words) and words[i].lower() == deduped[-1].lower():
                i += 1
        cleaned = " ".join(deduped)

    # Filter video timestamp / UI artifacts
    cleaned = re.sub(r'\b\d{1,2}:\d{2}(?::\d{2})?\b', '', cleaned)
    cleaned = re.sub(r'(?i)\b(?:truyengoc|báckinh|bickinh|backinh)\b', '', cleaned)

    # Clean dots in numbers (e.g. 250.000 -> 250 nghìn)
    cleaned = re.sub(r'(\d+)\.000\.000', r'\1 triệu', cleaned)
    cleaned = re.sub(r'(\d+)\.000', r'\1 nghìn', cleaned)
    cleaned = re.sub(r'(\d+)\.(\d+)', r'\1 \2', cleaned)
    cleaned = re.sub(r'\$(\s*)([\d,.]+)', r'\2 dollars', cleaned)
    cleaned = re.sub(r'([\d,.]+)(\s*)₫', r'\1 đồng', cleaned)

    return re.sub(r'\s+', ' ', cleaned).strip()

def fast_translate_to_vi(
    text: str,
    source_lang: str = "auto",
    target_lang: str = "vi",
    previous_context: str = ""
) -> str:
    cleaned = clean_speech_text(text)
    if not cleaned or len(cleaned) < 2:
        return ""
    source = (source_lang or "auto").split("-")[0].lower()
    target = (target_lang or "vi").split("-")[0].lower()
    if source == target or target != "vi":
        return cleaned

    try:
        return translation_router.translate(
            cleaned,
            source_lang=source,
            target_lang=target,
            previous_context=previous_context,
        )
    except Exception as e:
        print(f"Fast translate error: {e}")
    return cleaned


def translate_many_to_vi(texts: list[str], source_lang: str = "auto") -> list[str]:
    cleaned = [clean_speech_text(text) for text in texts]
    source = (source_lang or "auto").split("-")[0].lower()
    if source == "vi":
        return cleaned
    return translation_router.translate_many(cleaned, source, "vi")

# Google Voice Vietnamese (free network fallback; latency is measured at runtime)
def synthesize_google_vi(text: str) -> bytes:
    try:
        url = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=' + urllib.parse.quote(text)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=2.5) as r:
            return r.read()
    except Exception as e:
        print(f"Google TTS error: {e}")
        return b""

# Microsoft Edge-TTS (Hoài My & Nam Minh)
async def synthesize_edge_tts(text: str, voice: str) -> bytes:
    try:
        communicate = edge_tts.Communicate(text, voice)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        data = buf.getvalue()
        if len(data) > 200:
            return data
    except Exception as e:
        print(f"Edge TTS ({voice}) error: {e}")
    return b""


_network_tts_state = {
    "status": "idle",
    "selected": "google-vi",
    "google_ms": None,
    "edge_ms": None,
    "vieneu_ttfa_ms": None,
    "vieneu_rtf": None,
    "last_ms": None,
    "switches": 0,
    "error": None,
}
_network_tts_warm_task = None


def select_auto_tts_provider():
    """Choose once from startup benchmarks; never probe again per sentence."""
    google_ms = _network_tts_state.get("google_ms")
    edge_ms = _network_tts_state.get("edge_ms")
    local_ttfa = _network_tts_state.get("vieneu_ttfa_ms")
    local_rtf = _network_tts_state.get("vieneu_rtf")

    # Streaming local speech wins when it can keep generating faster than
    # playback. TTFA is the relevant latency because audio starts immediately.
    if local_ttfa is not None and local_rtf is not None and local_rtf < 0.95:
        network_complete = min(
            [value for value in (google_ms, edge_ms) if value is not None],
            default=float("inf"),
        )
        if local_ttfa <= network_complete + 100:
            _network_tts_state["selected"] = "vieneu:Thái Sơn"
            return

    candidates = []
    if google_ms is not None:
        candidates.append((google_ms, "google-vi"))
    if edge_ms is not None:
        candidates.append((edge_ms, "vi-VN-HoaiMyNeural"))
    if not candidates:
        return
    fastest_ms, fastest_name = min(candidates)
    if edge_ms is not None and (google_ms is None or edge_ms <= google_ms + 300):
        _network_tts_state["selected"] = "vi-VN-HoaiMyNeural"
    else:
        _network_tts_state["selected"] = fastest_name


async def warm_and_benchmark_network_tts():
    """Hide provider cold-start and choose the fastest usable free voice."""
    if _network_tts_state["status"] in {"warming", "ready"}:
        return
    _network_tts_state.update(status="warming", error=None)
    sample = "Xin chào, hệ thống đang khởi động."

    async def measure_google():
        # First call establishes DNS/TLS and is intentionally not scored.
        await asyncio.to_thread(synthesize_google_vi, "Xin chào.")
        started = time.perf_counter()
        data = await asyncio.to_thread(synthesize_google_vi, sample)
        return data, round((time.perf_counter() - started) * 1000, 1)

    async def measure_edge():
        await synthesize_edge_tts("Xin chào.", "vi-VN-HoaiMyNeural")
        started = time.perf_counter()
        data = await synthesize_edge_tts(sample, "vi-VN-HoaiMyNeural")
        return data, round((time.perf_counter() - started) * 1000, 1)

    try:
        (google_data, google_ms), (edge_data, edge_ms) = await asyncio.gather(
            measure_google(), measure_edge()
        )
        _network_tts_state["google_ms"] = google_ms if google_data else None
        _network_tts_state["edge_ms"] = edge_ms if edge_data else None
        candidates = []
        if google_data:
            candidates.append((google_ms, "google-vi"))
        if edge_data:
            candidates.append((edge_ms, "vi-VN-HoaiMyNeural"))
        if candidates:
            select_auto_tts_provider()
            _network_tts_state["status"] = "ready"
        else:
            raise RuntimeError("No network TTS provider responded")
    except Exception as error:
        _network_tts_state.update(status="error", error=str(error))


def schedule_network_tts_warmup():
    global _network_tts_warm_task
    if _network_tts_state["status"] in {"warming", "ready"}:
        return
    if _network_tts_warm_task is None or _network_tts_warm_task.done():
        _network_tts_warm_task = asyncio.create_task(warm_and_benchmark_network_tts())

# Piper Local Offline WAV
def generate_piper_wav(text: str) -> bytes:
    voice = load_piper_voice()
    if not voice:
        return b""
    try:
        chunks = list(voice.synthesize(text))
        if not chunks:
            return b""
        raw_pcm = b"".join([c.audio_int16_bytes for c in chunks])
        wav_io = io.BytesIO()
        with wave.open(wav_io, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(chunks[0].sample_rate)
            wav.writeframes(raw_pcm)
        return wav_io.getvalue()
    except Exception as e:
        print(f"Piper error: {e}")
        return b""

# VieNeu-TTS v3 Turbo Audio Generator (pnnbao97/VieNeu-TTS)
def generate_vieneu_wav(text: str, voice_name: str = "Trúc Ly") -> bytes:
    engine = get_vieneu_engine()
    if not engine:
        return b""
    try:
        voice_name = resolve_vieneu_voice(engine, voice_name)
        audio_arr = engine.infer(text, voice=voice_name)
        if audio_arr is None or len(audio_arr) == 0:
            return b""
        return audio_array_to_wav(audio_arr)
    except Exception as e:
        print(f"VieNeu-TTS ({voice_name}) error: {e}")
        return b""


def audio_array_to_wav(audio_arr) -> bytes:
    import numpy as np

    array = np.asarray(audio_arr)
    if np.issubdtype(array.dtype, np.floating):
        pcm = (np.clip(array, -1.0, 1.0) * 32767).astype("<i2")
    else:
        pcm = array.astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(48000)
        wav_file.writeframes(pcm.tobytes())
    return buf.getvalue()

async def generate_tts_bytes(text: str, voice: str = "vieneu:Trúc Ly") -> tuple[bytes, str]:
    cleaned = clean_speech_text(text)
    if not cleaned or not re.search(r'[a-zA-ZÀ-ỹ]', cleaned):
        return b"", "audio/mpeg"

    cache_key = f"{voice}:{cleaned}"
    if cache_key in audio_cache:
        return audio_cache[cache_key]

    audio_bytes = b""
    mime_type = "audio/mpeg"

    auto_requested = voice == "auto-fast"
    auto_started = time.perf_counter() if auto_requested else None
    if auto_requested:
        voice = _network_tts_state.get("selected") or "google-vi"

    # Voice Option 0: VieNeu-TTS (pnnbao97/VieNeu-TTS)
    if voice.startswith("vieneu:") or voice == "vieneu":
        voice_id = voice.split(":", 1)[1] if ":" in voice else "Trúc Ly"
        audio_bytes = await asyncio.to_thread(generate_vieneu_wav, cleaned, voice_id)
        if audio_bytes:
            mime_type = "audio/wav"
        else:
            print(f"⚠️ VieNeu-TTS ({voice_id}) không phản hồi, tự động dùng Google Voice...")
            audio_bytes = await asyncio.to_thread(synthesize_google_vi, cleaned)
            mime_type = "audio/mpeg"

    # Voice Option 1: Microsoft Neural (Hoài My hoặc Nam Minh)
    elif voice in ["vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"]:
        audio_bytes = await synthesize_edge_tts(cleaned, voice)
        if not audio_bytes:
            print(f"⚠️ {voice} tạm thời không phản hồi, tự động dùng Google Voice Tiếng Việt...")
            audio_bytes = await asyncio.to_thread(synthesize_google_vi, cleaned)

    # Voice Option 2: Piper Neural (Offline)
    elif voice == "piper-vi":
        audio_bytes = generate_piper_wav(cleaned)
        mime_type = "audio/wav"

    # Voice Option 3: Google Voice Tiếng Việt (free network fallback)
    else:
        audio_bytes = await asyncio.to_thread(synthesize_google_vi, cleaned)

    # Fallback to Google Voice if needed
    if not audio_bytes:
        audio_bytes = await asyncio.to_thread(synthesize_google_vi, cleaned)
        mime_type = "audio/mpeg"

    if auto_requested:
        elapsed_ms = round((time.perf_counter() - auto_started) * 1000, 1)
        _network_tts_state["last_ms"] = elapsed_ms
        # Provider selection is deliberately fixed for this server session.
        # Recording real latency does not issue a second probe or reroute the
        # next sentence behind the user's back.

    if audio_bytes:
        audio_cache[cache_key] = (audio_bytes, mime_type)
        return audio_bytes, mime_type

    return b"", "audio/mpeg"


def generate_vieneu_pcm_chunks(text: str, voice_name: str):
    """Yield headerless mono PCM16 chunks at 48 kHz as VieNeu generates them."""
    import numpy as np

    engine = get_vieneu_engine()
    if not engine:
        raise RuntimeError("VieNeu engine is unavailable")
    voice_name = resolve_vieneu_voice(engine, voice_name)
    for audio_arr in engine.infer_stream(
        text,
        voice=voice_name,
        apply_watermark=False,
        max_chars=192,
    ):
        if audio_arr is None or len(audio_arr) == 0:
            continue
        array = np.asarray(audio_arr)
        if np.issubdtype(array.dtype, np.floating):
            pcm = (np.clip(array, -1.0, 1.0) * 32767).astype("<i2")
        else:
            pcm = array.astype("<i2")
        yield pcm.tobytes()

class SubtitleDubRequest(BaseModel):
    text: str
    voice: Optional[str] = "google-vi"
    source_lang: Optional[str] = "auto"
    previous_context: Optional[str] = ""

# Direct Subtitle-to-Voiceover Endpoint (Latency < 0.2s)
@app.post("/api/dub-subtitle")
async def api_dub_subtitle(req: SubtitleDubRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text required")

    if is_hallucination_or_loop(req.text):
        return {"empty": True}

    if should_translate_to_vietnamese(req.source_lang):
        translated = fast_translate_to_vi(
            req.text, req.source_lang or "auto", "vi", req.previous_context or ""
        )
    else:
        translated = clean_speech_text(req.text)
    if not translated:
        translated = req.text

    audio_bytes, mime = await generate_tts_bytes(translated, req.voice or "google-vi")
    b64 = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else None

    print(f"⚡ [SUB-DUB] ({req.voice}) {req.text} -> {translated}")

    return {
        "original": req.text,
        "translated": translated,
        "audio_base64": b64,
        "audio_mime": mime
    }

class TranslateRequest(BaseModel):
    text: str
    from_lang: Optional[str] = "auto"
    to_lang: Optional[str] = "vi"
    previous_context: Optional[str] = ""

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "google-vi"


class TTSBatchRequest(BaseModel):
    texts: list[str]
    voice: Optional[str] = "vieneu:Trúc Ly"

@app.post("/api/translate")
async def api_translate(req: TranslateRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text required")
    translated = fast_translate_to_vi(
        req.text,
        req.from_lang or "auto",
        req.to_lang or "vi",
        req.previous_context or "",
    )
    return {
        "original": req.text,
        "translated": translated or req.text,
        "from": req.from_lang,
        "to": req.to_lang
    }


@app.post("/api/ocr-subtitle")
async def api_ocr_subtitle(
    image: UploadFile = File(...),
    source_lang: Optional[str] = Form("auto"),
    previous_context: Optional[str] = Form(""),
):
    """Read burned-in subtitle text from a browser-cropped video frame."""
    contents = await image.read()
    if len(contents) < 300:
        raise HTTPException(status_code=400, detail="Image too small")
    try:
        result = await asyncio.to_thread(
            subtitle_ocr.recognize, contents, source_lang or "auto"
        )
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"OCR unavailable: {error}")

    original = clean_speech_text(result["text"])
    if (
        not original
        or len(original) < 2
        or re.search(r'(?i)^(?:b[áa]ckinh|bickinh|truyengoc|\d+[:.]\d+)$', original.strip())
    ):
        return {"empty": True, **result}
    translation_started = time.perf_counter()
    translated = fast_translate_to_vi(
        original,
        source_lang=source_lang or "auto",
        target_lang="vi",
        previous_context=previous_context or "",
    )
    return {
        "empty": False,
        "original": original,
        "translated": translated or original,
        "translation_provider": translation_router.snapshot()["metrics"]["last_provider"],
        "timings": {
            "ocr_ms": result["latency_ms"],
            "translation_ms": round((time.perf_counter() - translation_started) * 1000, 1),
        },
        "confidence": result["confidence"],
        "ocr_engine": result["engine"],
    }

@app.post("/api/tts")
async def api_tts(req: TTSRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text required")
    audio_bytes, mime = await generate_tts_bytes(req.text, req.voice or "google-vi")
    if not audio_bytes:
        raise HTTPException(status_code=500, detail="Could not generate TTS")
    return Response(content=audio_bytes, media_type=mime)


@app.post("/api/tts-stream")
async def api_tts_stream(req: TTSRequest):
    """Stream VieNeu PCM to the browser instead of waiting for a complete WAV."""
    cleaned = clean_speech_text(req.text)
    if not cleaned:
        raise HTTPException(status_code=400, detail="Text required")
    voice = req.voice or "vieneu:Trúc Ly"
    if not voice.startswith("vieneu"):
        raise HTTPException(status_code=400, detail="Streaming is available for VieNeu voices")
    voice_name = voice.split(":", 1)[1] if ":" in voice else "Trúc Ly"
    # Do not let the first user sentence compete with CUDA graph/model warm-up.
    # Paying this one-time wait is preferable to streaming a broken, stuttering
    # first line. Later requests enter immediately.
    if _vieneu_warm_task is not None and not _vieneu_warm_task.done():
        await _vieneu_warm_task
    engine = await asyncio.to_thread(get_vieneu_engine)
    if engine is None:
        raise HTTPException(status_code=503, detail="VieNeu engine is unavailable")
    voice_name = resolve_vieneu_voice(engine, voice_name)

    def measured_stream():
        began = time.perf_counter()
        first = True
        _stream_metrics["requests"] += 1
        _stream_metrics["last_error"] = None
        try:
            for chunk in generate_vieneu_pcm_chunks(cleaned, voice_name):
                if first:
                    _stream_metrics["last_first_chunk_ms"] = round(
                        (time.perf_counter() - began) * 1000, 1
                    )
                    _tts_first_chunk_latency.add(_stream_metrics["last_first_chunk_ms"])
                    first = False
                yield chunk
            _stream_metrics["last_total_ms"] = round(
                (time.perf_counter() - began) * 1000, 1
            )
        except Exception as error:
            _stream_metrics["last_error"] = str(error)
            print(f"VieNeu streaming error: {error}")
            raise

    measured_rtf = _network_tts_state.get("vieneu_rtf")
    # Leave an 8% production margin for normal CUDA scheduling variance. The
    # browser may still use 1.50x for completed audio, and can accelerate up to
    # 1.30x for live PCM to catch up with video speech.
    safe_playback_rate = 1.0
    if measured_rtf:
        safe_playback_rate = min(1.30, max(0.80, 0.95 / measured_rtf))

    return StreamingResponse(
        measured_stream(),
        media_type="application/octet-stream",
        headers={
            "X-Audio-Format": "pcm_s16le",
            "X-Audio-Sample-Rate": "48000",
            "X-Audio-Channels": "1",
            "X-Safe-Playback-Rate": f"{safe_playback_rate:.3f}",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/tts-batch")
async def api_tts_batch(req: TTSBatchRequest):
    """Generate upcoming VieNeu cues in one GPU batch for subtitle prefetch."""
    texts = [clean_speech_text(text) for text in req.texts[:8]]
    if not texts or any(not text for text in texts):
        raise HTTPException(status_code=400, detail="1-8 non-empty texts required")
    voice = req.voice or "vieneu:Trúc Ly"
    if voice == "auto-fast":
        voice = _network_tts_state.get("selected") or "vieneu:Thái Sơn"
    if not voice.startswith("vieneu"):
        results = []
        for text in texts:
            data, mime = await generate_tts_bytes(text, voice)
            results.append({
                "audio_base64": base64.b64encode(data).decode("utf-8") if data else None,
                "audio_mime": mime,
            })
        return {"items": results}

    voice_name = voice.split(":", 1)[1] if ":" in voice else "Trúc Ly"
    engine = await asyncio.to_thread(get_vieneu_engine)
    if engine is None:
        raise HTTPException(status_code=503, detail="VieNeu engine is unavailable")
    voice_name = resolve_vieneu_voice(engine, voice_name)

    arrays = await asyncio.to_thread(
        engine.infer_batch,
        texts,
        voice=voice_name,
        batch_size=min(8, len(texts)),
        apply_watermark=False,
    )
    items = []
    for text, audio_arr in zip(texts, arrays):
        data = audio_array_to_wav(audio_arr)
        if data:
            audio_cache[f"{voice}:{text}"] = (data, "audio/wav")
        items.append({
            "audio_base64": base64.b64encode(data).decode("utf-8") if data else None,
            "audio_mime": "audio/wav",
        })
    return {"items": items}

# Universal Audio Slicing & Transcription (Handles any App / Tab / Mic / Local File)
@app.post("/api/transcribe")
async def api_transcribe(
    audio: UploadFile = File(...),
    source_lang: Optional[str] = Form("auto"),
    dubbing: Optional[bool] = Form(True),
    voice: Optional[str] = Form("google-vi"),
    previous_context: Optional[str] = Form("")
):
    request_started = time.perf_counter()
    contents = await audio.read()
    if len(contents) < 500:
        return {"empty": True, "reason": "audio too small"}

    # Detect extension from filename or default to .wav
    ext = ".wav" if (audio.filename and audio.filename.endswith(".wav")) else ".webm"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        lang_code = None
        if source_lang and source_lang != "auto":
            lang_code = source_lang.split("-")[0]

        asr_started = time.perf_counter()
        segments, info = whisper_model.transcribe(
            tmp_path,
            language=lang_code,
            beam_size=1,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            initial_prompt=(previous_context or "")[-300:] or None,
            without_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=160,
                threshold=0.25,
                speech_pad_ms=80
            ),
            repetition_penalty=1.20,
            no_repeat_ngram_size=2,
            compression_ratio_threshold=2.4,
            no_speech_threshold=0.60
        )

        texts = []
        for segment in segments:
            t = segment.text.strip()
            if t:
                texts.append(t)

        raw_text = " ".join(texts).strip()
        asr_ms = round((time.perf_counter() - asr_started) * 1000, 1)
        _asr_latency.add(asr_ms)

        # Hard Anti-Hallucination & Repetition Guard
        if not raw_text or is_hallucination_or_loop(raw_text):
            return {"empty": True}

        full_text = clean_speech_text(raw_text)
        if not full_text or len(full_text) < 1 or not any(c.isalnum() for c in full_text):
            return {"empty": True}

        # Filter junk hallucination tokens
        if full_text.lower() in ["you", "thank you", "bye", "subtitles by", "amara.org", "the end", "tiếp theo"]:
            return {"empty": True}

        effective_source_lang = (
            info.language
            if not source_lang or source_lang == "auto"
            else source_lang
        )
        translation_started = time.perf_counter()
        translated_text = fast_translate_to_vi(
            full_text,
            source_lang=effective_source_lang or "auto",
            target_lang="vi",
            previous_context=previous_context or "",
        )
        if not translated_text:
            translated_text = full_text
        translation_ms = round((time.perf_counter() - translation_started) * 1000, 1)

        audio_b64 = None
        mime_type = "audio/mpeg"
        if dubbing and translated_text:
            audio_bytes, mime_type = await generate_tts_bytes(translated_text, voice=voice)
            if audio_bytes:
                audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

        print(f"🎙️ [AUDIO-DUB] ({voice}) {full_text} -> [VI] {translated_text}")

        server_total_ms = round((time.perf_counter() - request_started) * 1000, 1)
        _transcribe_total_latency.add(server_total_ms)
        return {
            "empty": False,
            "original": full_text,
            "translated": translated_text,
            "detected_lang": info.language or "auto",
            "translation_provider": translation_router.snapshot()["metrics"]["last_provider"],
            "timings": {
                "asr_ms": asr_ms,
                "translation_ms": translation_ms,
                "server_total_ms": server_total_ms,
            },
            "audio_base64": audio_b64,
            "audio_mime": mime_type
        }
    except Exception as e:
        print(f"Transcribe error: {e}")
        return {"empty": True, "error": str(e)}
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except:
                pass

class YouTubeSubtitleRequest(BaseModel):
    url: str
    target_lang: Optional[str] = "vi"
    caption_mode: Optional[str] = "auto"
    caption_language: Optional[str] = "auto"

@app.post("/api/youtube-subtitles")
async def api_youtube_subtitles(req: YouTubeSubtitleRequest):
    import yt_dlp
    url = req.url.strip()
    if not url.startswith("http"):
        url = f"https://www.youtube.com/watch?v={url}"
    if req.caption_mode == "audio_only":
        return {
            "success": False,
            "mode": "audio_only",
            "error": "Đã chọn video chỉ có tiếng. Hãy bật thu âm Tab để Whisper nhận dạng trực tiếp."
        }

    def extract_subs():
        ydl_opts = {
            'skip_download': True,
            'quiet': True,
            'no_warnings': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            subtitles = info.get('subtitles', {}) or {}
            auto_caps = info.get('automatic_captions', {}) or {}

            sub_track, source_caption_lang, caption_source = select_caption_track(
                subtitles,
                auto_caps,
                preference=req.caption_language or "auto",
                video_language=info.get("language") or "",
            )
            is_already_vi = source_caption_lang == "vi"

            if not sub_track:
                return {
                    "success": False,
                    "mode": "no_captions",
                    "requested_caption_language": req.caption_language,
                    "error": "Không tìm thấy track phụ đề đúng lựa chọn. Hãy chọn Tự động hoặc dùng chế độ Chỉ có tiếng (Whisper)."
                }

            json_url = None
            for fmt in sub_track:
                if fmt.get('ext') == 'json3':
                    json_url = fmt.get('url')
                    break
            if not json_url and sub_track:
                json_url = sub_track[0].get('url')

            if not json_url:
                return {"success": False, "error": "Không tìm thấy định dạng phụ đề tương thích."}

            headers = {'User-Agent': 'Mozilla/5.0'}
            r_req = urllib.request.Request(json_url, headers=headers)
            with urllib.request.urlopen(r_req, timeout=8) as resp:
                raw_data = json.loads(resp.read().decode('utf-8'))

            events = raw_data.get('events', [])
            raw_segments = []

            for ev in events:
                tStartMs = ev.get('tStartMs', 0)
                dDurationMs = ev.get('dDurationMs', 2000)
                segs = ev.get('segs', [])
                text = "".join([s.get('utf8', '') for s in segs if 'utf8' in s])
                cleaned = re.sub(r'[\u200b\u200e\u200f\ufeff]+', '', text)
                cleaned = re.sub(r'\s+', ' ', cleaned).strip()

                if cleaned and not cleaned.startswith('\n') and len(cleaned) > 1:
                    start_sec = round(tStartMs / 1000.0, 2)
                    end_sec = round((tStartMs + dDurationMs) / 1000.0, 2)
                    raw_segments.append({
                        "start": start_sec,
                        "end": end_sec,
                        "text": cleaned
                    })

            # Normalize rolling captions ("Hello" -> "Hello world") before
            # sentence merging so repeated prefixes are never spoken twice.
            merged = merge_caption_segments(raw_segments)

            # Translate the real video CC in bounded parallel batches. The old
            # per-caption loop could make a long video wait hundreds of network
            # round trips before the player appeared.
            originals = [m['text'] for m in merged]
            translations = originals if is_already_vi else translate_many_to_vi(
                originals, source_lang=source_caption_lang
            )
            segments = [
                {
                    "start": m['start'],
                    "end": m['end'],
                    "original": original,
                    "translated": translated or original,
                }
                for m, original, translated in zip(merged, originals, translations)
            ]

            return {
                "success": True,
                "title": info.get('title', 'YouTube Video'),
                "duration": info.get('duration', 0),
                "caption_language": source_caption_lang,
                "caption_source": caption_source,
                "segments": segments
            }

    try:
        res = await asyncio.to_thread(extract_subs)
        return res
    except Exception as e:
        print(f"Error extracting youtube subtitles: {e}")
        return {"success": False, "error": str(e)}

@app.get("/")
async def get_index():
    schedule_whisper_warmup()
    schedule_vieneu_warmup()
    schedule_translation_warmup()
    schedule_ocr_warmup()
    schedule_network_tts_warmup()
    index_path = os.path.join(os.path.dirname(__file__), "public", "index.html")
    return FileResponse(index_path, headers={
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0"
    })


@app.get("/api/tts-status")
async def get_tts_status():
    return {
        **_vieneu_warm_state,
        "auto_provider": dict(_network_tts_state),
        "streaming": dict(_stream_metrics),
    }


@app.get("/api/pipeline-status")
async def get_pipeline_status():
    return {
        "asr": {
            **whisper_runtime,
            **_whisper_warm_state,
            "role": "final transcript",
            "latency": _asr_latency.snapshot(),
        },
        "translation": translation_router.snapshot(),
        "tts": {
            **_vieneu_warm_state,
            "auto_provider": dict(_network_tts_state),
            "streaming": {
                **dict(_stream_metrics),
                "first_chunk_latency": _tts_first_chunk_latency.snapshot(),
            },
        },
        "transcribe_endpoint": _transcribe_total_latency.snapshot(),
        "ocr": subtitle_ocr.snapshot(),
    }

# Overlay route
@app.get("/overlay")
async def get_overlay():
    overlay_path = os.path.join(os.path.dirname(__file__), "public", "overlay.html")
    return FileResponse(overlay_path)

# Mount static frontend
static_dir = os.path.join(os.path.dirname(__file__), "public")
app.mount("/", StaticFiles(directory=static_dir, html=True), name="public")

if __name__ == "__main__":
    import uvicorn
    print("====================================================")
    print("🚀 LiveSub & VoiceDub AI Studio")
    print("👉 http://localhost:3000")
    print("====================================================")
    uvicorn.run("server:app", host="0.0.0.0", port=3000, reload=False)
