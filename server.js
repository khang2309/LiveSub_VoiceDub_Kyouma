const express = require('express');
const cors = require('cors');
const path = require('path');
const { translate } = require('google-translate-api-x');
const { EdgeTTS } = require('node-edge-tts');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Supported Voices
const VOICES = [
  { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My (Nữ - Truyền cảm, tự nhiên)', lang: 'vi-VN', gender: 'Female' },
  { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh (Nam - Trầm ấm, thời sự)', lang: 'vi-VN', gender: 'Male' }
];

// Fallback translation using MyMemory if Google encounters rate limit
async function fallbackTranslate(text, from, to) {
  try {
    const langPair = `${from || 'auto'}|${to || 'vi'}`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.responseData && json.responseData.translatedText) {
      return {
        text: json.responseData.translatedText,
        from: from || 'auto'
      };
    }
  } catch (err) {
    console.error('Fallback translate error:', err.message);
  }
  return { text: text, from: from || 'auto' };
}

// Translate endpoint
app.post('/api/translate', async (req, res) => {
  const { text, from = 'auto', to = 'vi', customApiKey = '', engine = 'auto' } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const cleanText = text.trim();

  // Try Google Translate API first
  try {
    const result = await translate(cleanText, {
      from: from === 'auto' ? undefined : from,
      to: to || 'vi'
    });
    return res.json({
      original: cleanText,
      translated: result.text,
      detectedLang: result.from && result.from.language && result.from.language.iso ? result.from.language.iso : from,
      engine: 'google'
    });
  } catch (err) {
    console.warn('Google Translate error, trying fallback:', err.message);
    try {
      const fallback = await fallbackTranslate(cleanText, from, to);
      return res.json({
        original: cleanText,
        translated: fallback.text,
        detectedLang: fallback.from,
        engine: 'mymemory'
      });
    } catch (fallbackErr) {
      return res.status(500).json({
        error: 'Translation failed',
        details: fallbackErr.message
      });
    }
  }
});

// Text-to-Speech endpoint (Microsoft Edge Neural Voices)
app.post('/api/tts', async (req, res) => {
  const { text, voice = 'vi-VN-HoaiMyNeural', rate = '+0%', pitch = '+0Hz', volume = '+0%' } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Text is required for TTS' });
  }

  try {
    const tts = new EdgeTTS({
      voice: voice,
      rate: rate,
      pitch: pitch,
      volume: volume
    });

    const chunks = [];
    for await (const chunk of tts.streamAudio(text.trim())) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      }
    }

    const audioBuffer = Buffer.concat(chunks);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'no-cache'
    });
    return res.send(audioBuffer);
  } catch (err) {
    console.error('TTS synthesis error:', err);
    return res.status(500).json({ error: 'TTS failed', details: err.message });
  }
});

// Get available voices
app.get('/api/voices', (req, res) => {
  res.json({ voices: VOICES });
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 LiveSub & VoiceDub Server đang chạy tại:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`====================================================`);
});
