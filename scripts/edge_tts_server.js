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

function cacheAudio(cacheKey, audioBuffer) {
  if (!audioBuffer || audioBuffer.length <= 100) return;
  if (memoryCache.size >= MAX_CACHE_SIZE) {
    const firstKey = memoryCache.keys().next().value;
    memoryCache.delete(firstKey);
  }
  memoryCache.set(cacheKey, audioBuffer);
}

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
          cacheAudio(cacheKey, merged);
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

async function streamEdgeAudio(text, cfg, res, maxRetries = 2) {
  const cacheKey = `${cfg.voice}:${cfg.pitch}:${cfg.rate}:${text}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) {
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': cached.length,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
      'X-Audio-Format': 'mp3',
      'X-TTS-Streaming': '0',
      'X-TTS-Cache': 'hit'
    });
    res.end(cached);
    return;
  }

  // A duplicate request already being synthesized can safely reuse the final
  // buffer. New requests take the true chunked path below.
  if (inFlightRequests.has(cacheKey)) {
    const audioBuffer = await inFlightRequests.get(cacheKey);
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Access-Control-Allow-Origin': '*',
      'X-Audio-Format': 'mp3',
      'X-TTS-Streaming': '0',
      'X-TTS-Cache': 'shared'
    });
    res.end(audioBuffer);
    return;
  }

  let resolveFlight;
  let rejectFlight;
  const flight = new Promise((resolve, reject) => {
    resolveFlight = resolve;
    rejectFlight = reject;
  });
  // Avoid an unhandled rejection when no duplicate request is awaiting it.
  flight.catch(() => {});
  inFlightRequests.set(cacheKey, flight);

  let lastErr = null;
  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const chunks = [];
      try {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 120 * attempt));
        const tts = new EdgeTTS({
          voice: cfg.voice,
          pitch: cfg.pitch,
          rate: cfg.rate,
          // 96 kbps measured the same TTFA as 48 kbps on this machine while
          // preserving consonants and Vietnamese tone contours more clearly.
          outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
          timeout: 4000
        });

        for await (const chunk of tts.streamAudio(text)) {
          if (!Buffer.isBuffer(chunk) || chunk.length === 0) continue;
          if (!res.headersSent) {
            res.writeHead(200, {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*',
              'X-Audio-Format': 'mp3',
              'X-Audio-Sample-Rate': '24000',
              'X-Audio-Channels': '1',
              'X-TTS-Streaming': '1',
              'X-TTS-Cache': 'miss'
            });
          }
          chunks.push(chunk);
          if (!res.destroyed) res.write(chunk);
        }

        const merged = Buffer.concat(chunks);
        if (merged.length <= 100) throw new Error('Edge returned no usable audio');
        cacheAudio(cacheKey, merged);
        resolveFlight(merged);
        if (!res.destroyed) res.end();
        return;
      } catch (err) {
        lastErr = err;
        // HTTP status and MP3 bytes cannot be restarted after the first chunk.
        if (res.headersSent) throw err;
      }
    }
    throw lastErr || new Error('TTS streaming failed after retries');
  } catch (err) {
    rejectFlight(err);
    throw err;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && (req.url === '/tts' || req.url === '/api/tts' || req.url === '/api/tts-stream')) {
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
        if (req.url === '/api/tts-stream') {
          await streamEdgeAudio(text, cfg, res, 2);
          return;
        }
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
