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
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
import edge_tts

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
    print("🚀 ĐÃ KÍCH HOẠT GPU NVIDIA RTX 3050 (CUDA float16) - Tốc độ siêu tốc ~0.3s!")
except Exception as ge:
    print(f"Chuyển sang CPU do lỗi CUDA: {ge}")
    whisper_model = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=8)
    print("✅ Đã sẵn sàng trên CPU (int8, 8 luồng)!")

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

# In-memory translation & audio cache
translation_cache = {}
audio_cache = {}

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
    cleaned = re.sub(r'[^\w\s\.,\?!\'\"À-ỹà-ỹ]', ' ', cleaned)
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

    # Clean dots in numbers (e.g. 250.000 -> 250 nghìn)
    cleaned = re.sub(r'(\d+)\.000\.000', r'\1 triệu', cleaned)
    cleaned = re.sub(r'(\d+)\.000', r'\1 nghìn', cleaned)
    cleaned = re.sub(r'(\d+)\.(\d+)', r'\1 \2', cleaned)
    cleaned = cleaned.replace('$', ' đô la ')
    cleaned = cleaned.replace('₫', ' đồng ')

    return re.sub(r'\s+', ' ', cleaned).strip()

def fast_translate_to_vi(text: str) -> str:
    cleaned = clean_speech_text(text)
    if not cleaned or len(cleaned) < 2:
        return ""

    # If text already contains Vietnamese accents, return directly to save latency
    if re.search(r'[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]', cleaned, re.IGNORECASE):
        return cleaned

    cache_key = cleaned.lower()
    if cache_key in translation_cache:
        return translation_cache[cache_key]

    try:
        url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=' + urllib.parse.quote(cleaned)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=2.0) as r:
            data = json.loads(r.read().decode('utf-8'))
            trans = ''.join([part[0] for part in data[0] if part and part[0]]).strip()
            if trans:
                translation_cache[cache_key] = trans
                return trans
    except Exception as e:
        print(f"Fast translate error: {e}")

    return cleaned

    return cleaned

# Google Voice Vietnamese (0.15s Latency, 100% Reliable Natural Voice)
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

async def generate_tts_bytes(text: str, voice: str = "google-vi") -> tuple[bytes, str]:
    cleaned = clean_speech_text(text)
    if not cleaned or not re.search(r'[a-zA-ZÀ-ỹ]', cleaned):
        return b"", "audio/mpeg"

    cache_key = f"{voice}:{cleaned}"
    if cache_key in audio_cache:
        return audio_cache[cache_key]

    audio_bytes = b""
    mime_type = "audio/mpeg"

    # Voice Option 1: Microsoft Neural (Hoài My hoặc Nam Minh)
    if voice in ["vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"]:
        audio_bytes = await synthesize_edge_tts(cleaned, voice)
        if not audio_bytes:
            print(f"⚠️ {voice} tạm thời không phản hồi, tự động dùng Google Voice Tiếng Việt...")
            audio_bytes = await asyncio.to_thread(synthesize_google_vi, cleaned)

    # Voice Option 2: Piper Neural (Offline)
    elif voice == "piper-vi":
        audio_bytes = generate_piper_wav(cleaned)
        mime_type = "audio/wav"

    # Voice Option 3: Google Voice Tiếng Việt (Default, 0.15s, siêu tốc)
    else:
        audio_bytes = await asyncio.to_thread(synthesize_google_vi, cleaned)

    # Fallback to Google Voice if needed
    if not audio_bytes:
        audio_bytes = await asyncio.to_thread(synthesize_google_vi, cleaned)
        mime_type = "audio/mpeg"

    if audio_bytes:
        audio_cache[cache_key] = (audio_bytes, mime_type)
        return audio_bytes, mime_type

    return b"", "audio/mpeg"

class SubtitleDubRequest(BaseModel):
    text: str
    voice: Optional[str] = "google-vi"

# Direct Subtitle-to-Voiceover Endpoint (Latency < 0.2s)
@app.post("/api/dub-subtitle")
async def api_dub_subtitle(req: SubtitleDubRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text required")

    if is_hallucination_or_loop(req.text):
        return {"empty": True}

    translated = fast_translate_to_vi(req.text)
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

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "google-vi"

@app.post("/api/translate")
async def api_translate(req: TranslateRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text required")
    translated = fast_translate_to_vi(req.text)
    return {
        "original": req.text,
        "translated": translated or req.text,
        "from": req.from_lang,
        "to": req.to_lang
    }

@app.post("/api/tts")
async def api_tts(req: TTSRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text required")
    audio_bytes, mime = await generate_tts_bytes(req.text, req.voice or "google-vi")
    if not audio_bytes:
        raise HTTPException(status_code=500, detail="Could not generate TTS")
    return Response(content=audio_bytes, media_type=mime)

# Universal Audio Slicing & Transcription (Handles any App / Tab / Mic / Local File)
@app.post("/api/transcribe")
async def api_transcribe(
    audio: UploadFile = File(...),
    source_lang: Optional[str] = Form("auto"),
    dubbing: Optional[bool] = Form(True),
    voice: Optional[str] = Form("google-vi")
):
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

        segments, info = whisper_model.transcribe(
            tmp_path,
            language=lang_code,
            beam_size=1,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
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

        # Hard Anti-Hallucination & Repetition Guard
        if not raw_text or is_hallucination_or_loop(raw_text):
            return {"empty": True}

        full_text = clean_speech_text(raw_text)
        if not full_text or len(full_text) < 2 or not re.search(r'[a-zA-ZÀ-ỹ0-9]', full_text):
            return {"empty": True}

        # Filter junk hallucination tokens
        if full_text.lower() in ["you", "thank you", "bye", "subtitles by", "amara.org", "the end", "tiếp theo"]:
            return {"empty": True}

        translated_text = fast_translate_to_vi(full_text)
        if not translated_text:
            translated_text = full_text

        audio_b64 = None
        mime_type = "audio/mpeg"
        if dubbing and translated_text:
            audio_bytes, mime_type = await generate_tts_bytes(translated_text, voice=voice)
            if audio_bytes:
                audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

        print(f"🎙️ [AUDIO-DUB] ({voice}) {full_text} -> [VI] {translated_text}")

        return {
            "empty": False,
            "original": full_text,
            "translated": translated_text,
            "detected_lang": info.language or "auto",
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

@app.post("/api/youtube-subtitles")
async def api_youtube_subtitles(req: YouTubeSubtitleRequest):
    import yt_dlp
    url = req.url.strip()
    if not url.startswith("http"):
        url = f"https://www.youtube.com/watch?v={url}"

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

            sub_track = None
            is_already_vi = False

            if 'vi' in subtitles:
                sub_track = subtitles['vi']
                is_already_vi = True
            elif 'vi' in auto_caps:
                sub_track = auto_caps['vi']
                is_already_vi = True
            elif 'en' in subtitles:
                sub_track = subtitles['en']
            elif 'en' in auto_caps:
                sub_track = auto_caps['en']
            else:
                all_keys = list(subtitles.keys()) or list(auto_caps.keys())
                if all_keys:
                    sub_track = subtitles.get(all_keys[0]) or auto_caps.get(all_keys[0])

            if not sub_track:
                return {
                    "success": False, 
                    "error": "Video này không có phụ đề sẵn (CC). Bạn có thể bật nút 'Bắt Đầu Thu Âm Trực Tiếp' để AI Whisper GPU nhận diện âm thanh và lồng tiếng theo thời gian thực!"
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

            # Natural Sentence Merger & Collision Eliminator
            merged = []
            curr = None
            for s in raw_segments:
                if not curr:
                    curr = dict(s)
                    continue

                if s['start'] >= curr['start'] and s['end'] <= curr['end'] and s['text'] in curr['text']:
                    continue

                pause = s['start'] - curr['end']
                duration = curr['end'] - curr['start']
                ends_sentence = bool(re.search(r'[\.\?!…]$', curr['text']))
                same_text = (curr['text'] == s['text'])

                if same_text:
                    curr['end'] = max(curr['end'], s['end'])
                    continue

                starts_lowercase = s['text'][0].islower() if s['text'] else False
                is_connective = bool(re.match(r'^(và|để|nhưng|bởi|vì|mà|thì|là|rằng|nên|cho|với|and|or|but|because|so|to|that|which|who|whom)\b', s['text'], re.IGNORECASE))
                can_merge = (pause < 0.8 and duration < 6.0 and len(curr['text'].split()) < 26) and (
                    not ends_sentence or starts_lowercase or is_connective
                )

                if can_merge:
                    if s['text'] not in curr['text']:
                        curr['text'] += ' ' + s['text']
                    curr['end'] = max(curr['end'], s['end'])
                else:
                    if curr['end'] > curr['start']:
                        merged.append(curr)
                    curr = dict(s)
            if curr and curr['end'] > curr['start']:
                merged.append(curr)

            # Secondary pass: format complete coherent sentences and translate
            segments = []
            for m in merged:
                if segments and m['start'] < segments[-1]['end'] - 0.2:
                    if m['text'] in segments[-1]['original']:
                        continue
                    m['start'] = segments[-1]['end']

                orig = m['text']
                trans = orig if is_already_vi else fast_translate_to_vi(orig)
                if not trans:
                    trans = orig

                segments.append({
                    "start": m['start'],
                    "end": m['end'],
                    "original": orig,
                    "translated": trans
                })

            return {
                "success": True,
                "title": info.get('title', 'YouTube Video'),
                "duration": info.get('duration', 0),
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
    index_path = os.path.join(os.path.dirname(__file__), "public", "index.html")
    return FileResponse(index_path, headers={
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0"
    })

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
