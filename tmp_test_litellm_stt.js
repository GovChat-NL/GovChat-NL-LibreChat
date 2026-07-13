const fs = require('fs');
const path = require('path');

function readEnv(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    out[k] = v;
  }
  return out;
}

async function run() {
  const env = readEnv(path.resolve(__dirname, '.env'));
  const key = String(env.LITELLM_API_KEY || '').trim();
  const base = String(env.LITELLM_URL || 'http://localhost:4000').trim().replace(/\/$/, '');
  const audioPath = path.resolve(__dirname, 'tests/fixtures/transcript-sample-nl.wav');
  const model = process.argv[2] || 'gpt-4o-transcribe';

  if (!fs.existsSync(audioPath)) throw new Error(`missing audio fixture: ${audioPath}`);
  if (!key) throw new Error('LITELLM_API_KEY missing in .env');

  const audio = fs.readFileSync(audioPath);
  const boundary = '----stt' + Date.now() + Math.random().toString(16).slice(2);
  const chunks = [];
  const put = (s) => chunks.push(Buffer.from(s, 'utf8'));

  put(`--${boundary}\r\n`);
  put('Content-Disposition: form-data; name="model"\r\n\r\n');
  put(`${model}\r\n`);
  put(`--${boundary}\r\n`);
  put('Content-Disposition: form-data; name="language"\r\n\r\n');
  put('nl\r\n');
  put(`--${boundary}\r\n`);
  put('Content-Disposition: form-data; name="file"; filename="sample.wav"\r\n');
  put('Content-Type: audio/wav\r\n\r\n');
  chunks.push(audio);
  put(`\r\n--${boundary}--\r\n`);

  const body = Buffer.concat(chunks);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  console.log('POST', `${base}/v1/audio/transcriptions`, `model=${model}`, `bytes=${audio.length}`);
  const res = await fetch(`${base}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
    signal: controller.signal,
  });
  clearTimeout(timer);

  const text = await res.text();
  console.log('status:', res.status);
  console.log('body:', text.slice(0, 3000));
  if (!res.ok) process.exit(1);
}

run().catch((e) => {
  if (e && e.cause) {
    console.error('CAUSE:', e.cause && e.cause.message ? e.cause.message : String(e.cause));
  }
  console.error('FAIL:', e && e.message ? e.message : String(e));
  process.exit(1);
});

