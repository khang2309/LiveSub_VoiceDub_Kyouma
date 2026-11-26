const http = require('http');
const { EdgeTTS } = require('node-edge-tts');

// Bảng cấu hình toàn bộ giọng VieNeu-TTS & Microsoft Studio Neural
// Nam: vi-VN-NamMinhNeural, Nữ: vi-VN-HoaiMyNeural
const VOICE_PRESETS = {
  // Giọng Nam Studio Neural (Rate +10% để đọc khớp nhịp phim nhanh nhẹn)
  'namminh': { voice: 'vi-VN-NamMinhNeural', pitch: '+0Hz', rate: '+10%' },
  'thaison': { voice: 'vi-VN-NamMinhNeural', pitch: '+0Hz', rate: '+10%' },
  'thienminh': { voice: 'vi-VN-NamMinhNeural', pitch: '+0Hz', rate: '+10%' },
  'quangson': { voice: 'vi-VN-NamMinhNeural', pitch: '+0Hz', rate: '+10%' },
  'adam': { voice: 'vi-VN-NamMinhNeural', pitch: '+0Hz', rate: '+10%' },

  // Giọng Nữ Studio Neural (Rate +10% để đọc khớp nhịp phim nhanh nhẹn)
  'hoaimy': { voice: 'vi-VN-HoaiMyNeural', pitch: '+0Hz', rate: '+10%' },
  'trucly': { voice: 'vi-VN-HoaiMyNeural', pitch: '+0Hz', rate: '+10%' },
  'thuydung': { voice: 'vi-VN-HoaiMyNeural', pitch: '+0Hz', rate: '+10%' },
  'maianh': { voice: 'vi-VN-HoaiMyNeural', pitch: '+0Hz', rate: '+10%' }
};

function removeVietnameseAccents(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

function getVoiceConfig(voice) {
  if (!voice) return VOICE_PRESETS['trucly'];
  const raw = String(voice);
  const v = removeVietnameseAccents(raw).replace(/[^a-z0-9]/g, '');

  // 1. Giọng Nam Neural (Thái Sơn, Thiện Minh, Nam Minh, Quang Sơn, Adam)
  if (v.includes('thaison')) return VOICE_PRESETS['thaison'];
  if (v.includes('thienminh')) return VOICE_PRESETS['thienminh'];
  if (v.includes('quangson')) return VOICE_PRESETS['quangson'];
  if (v.includes('adam')) return VOICE_PRESETS['adam'];
  if (v.includes('namminh') || v.includes('namneural') || v.includes('nam')) return VOICE_PRESETS['namminh'];

  // 2. Giọng Nữ Neural (Thùy Dung, Mai Anh, Hoài My, Trúc Ly)
  if (v.includes('thuydung')) return VOICE_PRESETS['thuydung'];
  if (v.includes('maianh')) return VOICE_PRESETS['maianh'];
  if (v.includes('hoaimy')) return VOICE_PRESETS['hoaimy'];
  if (v.includes('trucly') || v.includes('nu')) return VOICE_PRESETS['trucly'];

  return VOICE_PRESETS['trucly'];
}

// Bộ đệm LRU Cache 2048 câu để phản hồi ngay 0ms cho câu lặp lại
const memoryCache = new Map();
const MAX_CACHE_SIZE = 2048;

// Tránh gửi cùng một câu nhiều lần cùng một lúc tới server Microsoft
const inFlightRequests = new Map();

async function synthesizeWithRetry(text, cfg, maxRetries = 2) {
  const cacheKey = `${cfg.voice}:${cfg.pitch}:${cfg.rate}:${text}`;
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }

  if (inFlightRequests.has(cacheKey)) {
    return await inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    let lastErr = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Khi bị 429 hoặc lỗi kết nối, giãn cách một chút để Microsoft giải tỏa rate-limit
          await new Promise(r => setTimeout(r, 120 * attempt));
        }
        const tts = new EdgeTTS({
          voice: cfg.voice,
          pitch: cfg.pitch,
          rate: cfg.rate,
          timeout: 4000
        });

        const chunks = [];
        for await (const chunk of tts.streamAudio(text)) {
          if (Buffer.isBuffer(chunk)) {
            chunks.push(chunk);
          }
        }
        const merged = Buffer.concat(chunks);
        if (merged.length > 100) {
          if (memoryCache.size >= MAX_CACHE_SIZE) {
            const firstKey = memoryCache.keys().next().value;
            memoryCache.delete(firstKey);
          }
          memoryCache.set(cacheKey, merged);
          return merged;
        }
      } catch (err) {
        lastErr = err;
        // Tiếp tục thử lại nếu bị 429 hoặc socket closed
      }
    }
    throw lastErr || new Error('TTS synthesis failed after retries');
  })();

  inFlightRequests.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && (req.url === '/tts' || req.url === '/api/tts')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const text = (payload.text || '').trim();
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          return res.end('Empty text');
        }
        const cfg = getVoiceConfig(payload.voice);
        const audioBuffer = await synthesizeWithRetry(text, cfg, 2);

        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Content-Length': audioBuffer.length,
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(audioBuffer);
      } catch (err) {
        console.error('Edge TTS error:', err.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
        }
        res.end(err.message || 'TTS Error');
      }
    });
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ status: 'ready', engine: 'VieNeu-Edge-Neural', cached: memoryCache.size }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = 3005;
const HOST = '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`LiveSub VieNeu & Edge TTS Neural server listening on http://${HOST}:${PORT}`);
});
