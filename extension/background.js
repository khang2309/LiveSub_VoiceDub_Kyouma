// LiveSub Studio Extension - Background Service Worker (Manifest V3)
// Fast heartbeat, zero-stall routing, and native desktop app bridge

let localEngineOnline = false;

// Default settings
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['isDubbingActive', 'voice', 'subMode', 'duckPercent', 'showFloatingWidget'], (data) => {
    if (data.isDubbingActive === undefined) {
      chrome.storage.local.set({
        isDubbingActive: true,
        voice: 'Trúc Ly',
        subMode: 'vi_only',
        duckPercent: 10,
        syncSpeed: true,
        ocrScan: false,
        showFloatingWidget: false, // Default FALSE: non-intrusive
        fontSize: 26
      });
    }
  });
});

// Periodic lightweight check if desktop engine (port 3000) is online
async function checkEngineHeartbeat() {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 500);
    const res = await fetch('http://localhost:3000/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(tid);
    localEngineOnline = (res && res.ok);
  } catch (_) {
    localEngineOnline = false;
  }
}

// Initial check & heartbeat every 10s
checkEngineHeartbeat();
setInterval(checkEngineHeartbeat, 10000);

// In-memory audio synthesis cache
const bgAudioCache = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SYNTHESIZE_TTS') {
    handleSynthesizeTTS(request.text, request.voice)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: String(err), offline: true }));
    return true; // Keep message channel open for async response
  } else if (request.type === 'OCR_FRAME') {
    handleOcrFrame(request.imageData, request.sourceLang)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ empty: true, offline: true }));
    return true;
  } else if (request.type === 'CHECK_LOCAL_ENGINE') {
    checkEngineHeartbeat().then(() => {
      sendResponse({ online: localEngineOnline });
    });
    return true;
  }
});

async function handleSynthesizeTTS(text, voice) {
  if (!text || !text.trim()) return { success: false };
  const trimmed = text.trim();
  const v = voice || 'Trúc Ly';
  const cacheKey = `${v}:::${trimmed}`;

  if (bgAudioCache.has(cacheKey)) {
    return bgAudioCache.get(cacheKey);
  }

  // If local engine is offline, immediately return offline in 0ms!
  // Do NOT stall the browser waiting for timeouts!
  if (!localEngineOnline) {
    return { success: false, offline: true };
  }

  // Local LiveSub pure Rust native engine at http://localhost:3000
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 4500);
    const res = await fetch('http://localhost:3000/api/dub-subtitle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, voice: v }),
      signal: controller.signal
    });
    clearTimeout(tid);
    if (res.ok) {
      const data = await res.json();
      if (data && data.audio_base64) {
        bgAudioCache.set(cacheKey, data);
        if (bgAudioCache.size > 200) {
          const firstKey = bgAudioCache.keys().next().value;
          bgAudioCache.delete(firstKey);
        }
        return data;
      }
    }
  } catch (_) {
    localEngineOnline = false; // Mark offline so subsequent calls don't stall
  }

  return { success: false, offline: true };
}

async function handleOcrFrame(base64Image, sourceLang = 'auto') {
  if (!base64Image || !localEngineOnline) {
    return { empty: true, offline: !localEngineOnline };
  }

  try {
    const res = await fetch(`data:image/png;base64,${base64Image}`);
    const blob = await res.blob();
    const form = new FormData();
    form.append('image', blob, 'frame.png');
    form.append('source_lang', sourceLang);

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 3000);
    const ocrRes = await fetch('http://localhost:3000/api/ocr-subtitle', {
      method: 'POST',
      body: form,
      signal: controller.signal
    });
    clearTimeout(tid);

    if (ocrRes.ok) {
      return await ocrRes.json();
    }
  } catch (e) {
    localEngineOnline = false;
    return { empty: true, offline: true };
  }

  return { empty: true };
}
