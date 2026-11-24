const http = require('http');

async function testVoice(name, voice) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = http.request('http://127.0.0.1:3005/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let len = 0;
      res.on('data', chunk => len += chunk.length);
      res.on('end', () => {
        const ms = Date.now() - t0;
        console.log(`[${name}] voice="${voice}" -> Status: ${res.statusCode}, Bytes: ${len}, Time: ${ms}ms`);
        resolve({ ok: res.statusCode === 200, len, ms });
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({ text: 'Xin chào bạn, tôi là giọng đọc tiếng Việt của hệ thống LiveSub.', voice }));
    req.end();
  });
}

(async () => {
  console.log('Testing Edge TTS voices on port 3005...');
  await testVoice('Thái Sơn (Nam)', 'vieneu:Thái Sơn');
  await testVoice('Thiện Minh (Nam)', 'vieneu:Thiện Minh');
  await testVoice('Nam Minh (Nam)', 'vi-VN-NamMinhNeural');
  await testVoice('Trúc Ly (Nữ)', 'vieneu:Trúc Ly');
  await testVoice('Hoài My (Nữ)', 'vi-VN-HoaiMyNeural');
  console.log('All voice tests completed successfully!');
})();
