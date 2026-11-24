const http = require('http');
const { EdgeTTS } = require('node-edge-tts');

const ttsMap = {
  'vi-VN-HoaiMyNeural': new EdgeTTS({ voice: 'vi-VN-HoaiMyNeural' }),
  'vi-VN-NamMinhNeural': new EdgeTTS({ voice: 'vi-VN-NamMinhNeural' })
};

function resolveVoice(voice) {
  if (!voice) return 'vi-VN-HoaiMyNeural';
  const v = String(voice).toLowerCase();
  if (v.includes('nam') || v.includes('minh') || v.includes('son') || v.includes('sơn') || v.includes('adam')) {
    return 'vi-VN-NamMinhNeural';
  }
  return 'vi-VN-HoaiMyNeural';
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
        const voiceKey = resolveVoice(payload.voice);
        let tts = ttsMap[voiceKey];
        if (!tts) {
          tts = new EdgeTTS({ voice: voiceKey });
          ttsMap[voiceKey] = tts;
        }

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
    res.end(JSON.stringify({ status: 'ready', voices: ['vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural'] }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = 3005;
const HOST = '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`LiveSub Edge TTS neural server running at http://${HOST}:${PORT}`);
});
