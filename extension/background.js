// LiveSub Studio Extension - Background Service Worker (Manifest V3)

chrome.runtime.onInstalled.addListener(() => {
  // Set default settings on install
  chrome.storage.local.get(['isDubbingActive', 'voice', 'subMode', 'duckPercent'], (data) => {
    if (data.isDubbingActive === undefined) {
      chrome.storage.local.set({
        isDubbingActive: true,
        voice: 'Trúc Ly',
        subMode: 'vi_only',
        duckPercent: 10,
        syncSpeed: true,
        ocrScan: true,
        fontSize: 26
      });
    }
  });
});

// Cache audio synthesis requests in background memory
const bgAudioCache = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SYNTHESIZE_TTS') {
    handleSynthesizeTTS(request.text, request.voice)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: String(err) }));
    return true; // Keep message channel open for async response
  } else if (request.type === 'OCR_FRAME') {
    handleOcrFrame(request.imageData, request.sourceLang)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: String(err) }));
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

  // 1. Try local LiveSub pure Rust native engine at http://localhost:3000
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 1800);
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
  } catch (_) {}

  // 2. Fallback: try http://localhost:3000/api/tts
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 1800);
    const res = await fetch('http://localhost:3000/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, voice: v }),
      signal: controller.signal
    });
    clearTimeout(tid);
    if (res.ok) {
      const blob = await res.blob();
      const reader = new FileReader();
      const base64Data = await new Promise(resolve => {
        reader.onloadend = () => {
          const resStr = reader.result;
          resolve(resStr.split(',')[1] || '');
        };
        reader.readAsDataURL(blob);
      });
      const data = {
        success: true,
        audio_base64: base64Data,
        audio_mime: 'audio/wav',
        voice: v
      };
      bgAudioCache.set(cacheKey, data);
      return data;
    }
  } catch (_) {}

  // 3. Fallback: Google Translate TTS endpoint (short phrases)
  try {
    if (trimmed.length <= 160) {
      const googleTTSUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(trimmed)}&tl=vi&client=tw-ob`;
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(googleTTSUrl, { signal: controller.signal });
      clearTimeout(tid);
      if (res.ok) {
        const blob = await res.blob();
        const reader = new FileReader();
        const base64Data = await new Promise(resolve => {
          reader.onloadend = () => {
            const resStr = reader.result;
            resolve(resStr.split(',')[1] || '');
          };
          reader.readAsDataURL(blob);
        });
        return {
          success: true,
          audio_base64: base64Data,
          audio_mime: 'audio/mpeg',
          voice: 'google-vi'
        };
      }
    }
  } catch (_) {}

  return { success: false, error: 'All TTS engines offline' };
}

async function handleOcrFrame(base64Image, sourceLang = 'auto') {
  if (!base64Image) return { empty: true };
  try {
    // Convert base64 data to blob
    const res = await fetch(`data:image/jpeg;base64,${base64Image}`);
    const blob = await res.blob();
    const form = new FormData();
    form.append('image', blob, 'frame.jpg');
    form.append('source_lang', sourceLang);

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 2000);
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
    return { empty: true, offline: true };
  }
  return { empty: true };
}
