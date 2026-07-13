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

async function testWs(url, headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), 12000);

    ws.addEventListener('open', () => {
      clearTimeout(timer);
      done({ ok: true, reason: 'open' });
    });

    ws.addEventListener('error', (ev) => {
      clearTimeout(timer);
      done({ ok: false, reason: `error:${ev?.message || 'websocket error'}` });
    });

    ws.addEventListener('close', (ev) => {
      clearTimeout(timer);
      done({ ok: false, reason: `close:${ev.code}:${String(ev.reason || '')}` });
    });
  });
}

async function run() {
  const env = readEnv(path.resolve(__dirname, '.env'));
  const base = String(env.AZURE_OPENAI_REALTIME_API_BASE || '').trim().replace(/\/$/, '');
  const apiVersion = String(env.AZURE_OPENAI_REALTIME_API_VERSION || '').trim();
  const apiKey = String(env.AZURE_OPENAI_REALTIME_API_KEY || '').trim();
  const model = String(env.AZURE_OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview').trim();

  if (!base || !apiVersion || !apiKey) {
    throw new Error('Missing AZURE_OPENAI_REALTIME_API_BASE/API_VERSION/API_KEY in .env');
  }

  const wsBase = base.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
  const betaUrl = `${wsBase}/openai/realtime?api-version=${encodeURIComponent(apiVersion)}&deployment=${encodeURIComponent(model)}`;
  const gaUrl = `${wsBase}/openai/v1/realtime?model=${encodeURIComponent(model)}`;

  console.log('BETA_URL', betaUrl);
  const beta = await testWs(betaUrl, { 'api-key': apiKey, 'OpenAI-Beta': 'realtime=v1' });
  console.log('BETA_RESULT', JSON.stringify(beta));

  console.log('GA_URL', gaUrl);
  const ga = await testWs(gaUrl, { 'api-key': apiKey });
  console.log('GA_RESULT', JSON.stringify(ga));
}

run().catch((e) => {
  console.error('FAIL:', e && e.message ? e.message : String(e));
  process.exit(1);
});

