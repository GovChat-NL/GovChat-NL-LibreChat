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

function extractWavDataBuffer(buf) {
  const riff = buf.toString('ascii', 0, 4);
  const wave = buf.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Fixture is not a valid WAV file');
  }

  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (id === 'data') {
      return buf.subarray(dataStart, Math.min(dataEnd, buf.length));
    }
    off = dataEnd + (len % 2);
  }
  throw new Error('WAV data chunk not found');
}

function toBase64(buf) {
  return Buffer.from(buf).toString('base64');
}

async function run() {
  const env = readEnv(path.resolve(__dirname, '.env'));
  const token = String(env.REALTIME_STT_TOKEN || env.N8N_WEBHOOK_TOKEN || '').trim();
  const model = process.argv[2] || 'gpt-4o-realtime-preview';
  const provider = process.argv[3] || 'litellm';
  const baseWs = process.argv[4] || 'ws://localhost:3080/govchat-api/realtime-stt';
  const audioPath = path.resolve(__dirname, 'tests/fixtures/transcript-sample-nl.wav');

  if (!fs.existsSync(audioPath)) {
    throw new Error(`missing audio fixture: ${audioPath}`);
  }
  if (!token) {
    throw new Error('REALTIME_STT_TOKEN/N8N_WEBHOOK_TOKEN missing in .env');
  }

  const wsUrl = new URL(baseWs);
  wsUrl.searchParams.set('token', token);

  const wav = fs.readFileSync(audioPath);
  const pcm = extractWavDataBuffer(wav);

  console.log('CONNECT', wsUrl.toString());
  console.log('MODEL', model, 'PROVIDER', provider, 'PCM_BYTES', pcm.length);

  const ws = new WebSocket(wsUrl);

  const transcriptFinal = [];
  let sawReady = false;

  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('Timeout waiting for realtime transcript events'));
    }, 60000);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        type: 'start',
        provider,
        model,
        language: 'nl',
      }));

      const chunkSize = 4096;
      for (let i = 0; i < pcm.length; i += chunkSize) {
        const slice = pcm.subarray(i, Math.min(i + chunkSize, pcm.length));
        ws.send(JSON.stringify({ type: 'audio.append', audio: toBase64(slice) }));
      }
      ws.send(JSON.stringify({ type: 'audio.commit' }));
    });

    ws.addEventListener('message', (ev) => {
      let msg = null;
      try {
        msg = JSON.parse(String(ev.data || ''));
      } catch {
        return;
      }
      const type = String(msg?.type || '');

      if (type === 'ready') {
        sawReady = true;
        console.log('EVENT ready');
      }

      if (type === 'transcript.final') {
        const text = String(msg?.segment?.text || '').trim();
        if (text) {
          transcriptFinal.push(text);
          console.log('EVENT transcript.final:', text);
          // one final segment is enough for deterministic validation
          clearTimeout(timeout);
          try { ws.close(); } catch {}
          resolve({ sawReady, transcriptFinal });
        }
      }

      if (type === 'error') {
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        reject(new Error(String(msg?.error || 'Unknown realtime error')));
      }
    });

    ws.addEventListener('close', () => {
      if (transcriptFinal.length > 0) return;
      if (sawReady) {
        clearTimeout(timeout);
        reject(new Error('Connection closed without transcript.final'));
      }
    });

    ws.addEventListener('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${err?.message || err}`));
    });
  });

  const result = await done;
  const merged = result.transcriptFinal.join(' ').trim();
  console.log('---');
  console.log('READY:', result.sawReady ? 'yes' : 'no');
  console.log('FINAL_TRANSCRIPT:', merged || '<empty>');
}

run().catch((e) => {
  console.error('FAIL:', e && e.message ? e.message : String(e));
  process.exit(1);
});

