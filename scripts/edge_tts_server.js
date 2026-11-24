const http = require('http');
const { EdgeTTS } = require('node-edge-tts');

// Bảng cấu hình toàn bộ giọng VieNeu-TTS & Microsoft Studio Neural
// Nam: vi-VN-NamMinhNeural, Nữ: vi-VN-HoaiMyNeural
const VOICE_PRESETS = {
  // Giọng Nam
  'namminh': { voice: 'vi-VN-NamMinhNeural', pitch: '+0Hz', rate: '+0%' },
  'thaison': { voice: 'vi-VN-NamMinhNeural', pitch: '-15Hz', rate: '+0%' },
  'thienminh': { voice: 'vi-VN-NamMinhNeural', pitch: '+2Hz', rate: '+0%' },
  'quangson': { voice: 'vi-VN-NamMinhNeural', pitch: '-8Hz', rate: '+0%' },
  'adam': { voice: 'vi-VN-NamMinhNeural', pitch: '+8Hz', rate: '+5%' },

  // Giọng Nữ
  'hoaimy': { voice: 'vi-VN-HoaiMyNeural', pitch: '+0Hz', rate: '+0%' },
  'trucly': { voice: 'vi-VN-HoaiMyNeural', pitch: '+0Hz', rate: '+0%' },
  'thuydung': { voice: 'vi-VN-HoaiMyNeural', pitch: '+12Hz', rate: '+0%' },
  'maianh': { voice: 'vi-VN-HoaiMyNeural', pitch: '-6Hz', rate: '+0%' }
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
        const tts = new EdgeTTS({
          voice: cfg.voice,
          pitch: cfg.pitch,
          rate: cfg.rate
        });

        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*'
        });

        for await (const chunk of tts.streamAudio(text)) {
          if (Buffer.isBuffer(chunk)) {
            res.write(chunk);
          }
        }
        res.end();
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
    res.end(JSON.stringify({ status: 'ready', engine: 'VieNeu-Edge-Neural' }));
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
