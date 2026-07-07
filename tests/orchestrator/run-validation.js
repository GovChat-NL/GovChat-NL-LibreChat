#!/usr/bin/env node
/**
 * Robust orchestrator validation suite.
 *
 * Covers:
 * - text-only behavior
 * - multimodal (image + text) behavior
 * - wrapped payload shape (n8n-openai-bridge style)
 * - root payload shape (direct webhook style)
 *
 * Also reports BLOCKED state when no language model/provider is configured.
 */

const fs = require('fs');
const path = require('path');

function getArg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  if (i >= 0 && i + 1 < process.argv.length) return String(process.argv[i + 1] || '').trim();
  return fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function toDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeByExt = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  const mime = mimeByExt[ext] || 'application/octet-stream';
  const b64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function resolveImagePath(inputPath) {
  const candidates = [
    inputPath,
    'GovChat-NL-LibreChat/tests/fixtures/number-grid.png',
    'tmp-validation/number-grid.png',
    'number-grid.png',
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return inputPath;
}

function extractStreamingText(rawText) {
  if (typeof rawText !== 'string') return '';
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const chunks = [];
  for (const line of lines) {
    try {
      const evt = JSON.parse(line);
      if (evt && evt.type === 'item' && typeof evt.content === 'string') {
        chunks.push(evt.content);
      }
    } catch {
      // ignore
    }
  }
  return chunks.join('').trim();
}

function extractFromObject(obj) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj.trim();
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const t = extractFromObject(item);
      if (t) return t;
    }
    return '';
  }
  if (typeof obj === 'object') {
    for (const key of ['output', 'response', 'text', 'content', 'result', 'message']) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    for (const key of ['messages', 'data', 'items']) {
      if (Array.isArray(obj[key])) {
        const t = extractFromObject(obj[key]);
        if (t) return t;
      }
    }
    if (obj.body) {
      const t = extractFromObject(obj.body);
      if (t) return t;
    }
  }
  return '';
}

function detectBlockedReason(res) {
  const hay = `${String(res.rawText || '')}\n${String(res.extracted || '')}`.toLowerCase();
  const blockedMarkers = [
    'no models',
    'model not found',
    'no deployments available',
    'litellm',
    'provider not configured',
    'invalid api key',
    'authentication',
    'unauthorized',
    'insufficient_quota',
    'rate limit',
    'openaierror',
    'azure',
    'vision-aanroep gaf een fout',
    'model ondersteunt deze image-analyse niet',
    'unsupported_image_or_model',
  ];

  for (const marker of blockedMarkers) {
    if (hay.includes(marker)) {
      return `Language model/provider lijkt niet correct geconfigureerd (${marker}).`;
    }
  }

  if (res.status >= 500 && !String(res.extracted || '').trim()) {
    return 'Webhook/LLM backend geeft serverfout zonder bruikbare output.';
  }

  return null;
}

async function postJson(url, token, payload) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const rawText = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = rawText;
  }

  const extracted = extractFromObject(parsed) || extractStreamingText(rawText);
  return { ok: res.ok, status: res.status, extracted, rawText };
}

function mkPayload({ wrapped, token, currentMessage, messages, sessionId }) {
  const core = {
    systemPrompt: '',
    currentMessage,
    chatInput: currentMessage,
    messages,
    sessionId,
    userId: 'orchestrator-validation',
    isTask: false,
    taskType: null,
  };

  if (!wrapped) return core;
  return {
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    params: {},
    query: {},
    body: core,
  };
}

function printHeader(title) {
  console.log('\n' + '='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));
}

function statusLabel(result) {
  if (result.blocked) return 'BLOCKED';
  return result.ok ? 'PASS' : 'FAIL';
}

async function run() {
  const webhook = getArg('--webhook', process.env.ORCHESTRATOR_WEBHOOK_URL || 'http://localhost:5678/webhook/orchestrator');
  const token = getArg('--token', process.env.N8N_WEBHOOK_TOKEN || 'local_n8n_webhook_token_change_me');
  const expectedDigit = getArg('--expect', '7');
  const onlyText = hasArg('--only-text');
  const imagePathRaw = getArg('--image', 'GovChat-NL-LibreChat/tests/fixtures/number-grid.png');
  const imagePath = resolveImagePath(imagePathRaw);

  printHeader('GovChat Orchestrator Validation Suite');
  console.log('webhook      :', webhook);
  console.log('token        :', token ? '<set>' : '<empty>');
  console.log('image fixture:', imagePath, fs.existsSync(imagePath) ? '(found)' : '(missing)');
  console.log('expect digit :', expectedDigit);

  const tests = [];

  const textCases = [
    {
      id: 'text-math-2plus2',
      prompt: 'Wat is 2+2? Antwoord alleen met het cijfer.',
      assert: (out) => /\b4\b/.test(out || ''),
    },
    {
      id: 'text-capital-nl',
      prompt: 'Wat is de hoofdstad van Nederland? Antwoord met één woord.',
      assert: (out) => /amsterdam/i.test(out || ''),
    },
  ];

  for (const wrapped of [true, false]) {
    for (const tc of textCases) {
      tests.push({
        id: `${tc.id}-${wrapped ? 'wrapped' : 'root'}`,
        run: async () => {
          const payload = mkPayload({
            wrapped,
            token,
            currentMessage: tc.prompt,
            sessionId: `validation-${tc.id}-${wrapped ? 'wrapped' : 'root'}`,
            messages: [{ role: 'user', content: [{ type: 'text', text: tc.prompt }] }],
          });

          const res = await postJson(webhook, wrapped ? '' : token, payload);
          const blockedReason = detectBlockedReason(res);
          if (blockedReason) {
            return {
              ok: false,
              blocked: true,
              detail: `status=${res.status}; ${blockedReason}; response=${JSON.stringify(res.extracted)}`,
            };
          }

          const low = String(res.extracted || '').toLowerCase();
          const notImageFallback = !low.includes('ik zie geen foto') && !low.includes('upload de afbeelding');
          const ok = res.ok && !!res.extracted && notImageFallback && tc.assert(res.extracted);
          return { ok, blocked: false, detail: `status=${res.status}; response=${JSON.stringify(res.extracted)}` };
        },
      });
    }
  }

  if (!onlyText) {
    if (!fs.existsSync(imagePath)) {
      tests.push({
        id: 'image-fixture-available',
        run: async () => ({
          ok: false,
          blocked: false,
          detail:
            `Image fixture not found at ${imagePath}. Place the file there or pass --image <path>.`,
        }),
      });
    } else {
      const dataUrl = toDataUrl(imagePath);
      for (const wrapped of [true, false]) {
        tests.push({
          id: `image-digit-${wrapped ? 'wrapped' : 'root'}`,
          run: async () => {
            const prompt = `Welke cijfers staan in het raster? Noem expliciet het cijfer ${expectedDigit}.`;
            const payload = mkPayload({
              wrapped,
              token,
              currentMessage: prompt,
              sessionId: `validation-image-${wrapped ? 'wrapped' : 'root'}`,
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } },
                  ],
                },
              ],
            });

            const res = await postJson(webhook, wrapped ? '' : token, payload);
            const blockedReason = detectBlockedReason(res);
            if (blockedReason) {
              return {
                ok: false,
                blocked: true,
                detail: `status=${res.status}; ${blockedReason}; response=${JSON.stringify(res.extracted)}`,
              };
            }

            const containsDigit = new RegExp(`\\b${expectedDigit}\\b`).test(res.extracted || '');
            const notImageFallback = !String(res.extracted || '').toLowerCase().includes('ik zie geen foto');
            const ok = res.ok && containsDigit && notImageFallback;
            return { ok, blocked: false, detail: `status=${res.status}; response=${JSON.stringify(res.extracted)}` };
          },
        });
      }
    }
  }

  printHeader('Running tests');
  const results = [];
  for (const test of tests) {
    const result = await test.run();
    results.push({ id: test.id, ...result });
    console.log(`[${statusLabel(result)}] ${test.id}`);
    console.log(`       ${result.detail}`);
  }

  const blocked = results.filter((r) => r.blocked);
  const failed = results.filter((r) => !r.ok && !r.blocked);

  printHeader('Summary');
  console.log(`total   : ${results.length}`);
  console.log(`pass    : ${results.filter((r) => r.ok).length}`);
  console.log(`blocked : ${blocked.length}`);
  console.log(`fail    : ${failed.length}`);

  if (blocked.length) {
    console.log('\nBlocked tests (omgeving/configuratie):');
    for (const b of blocked) console.log(`- ${b.id}`);
    process.exit(2);
  }

  if (failed.length) {
    console.log('\nFailed tests:');
    for (const f of failed) console.log(`- ${f.id}`);
    process.exit(1);
  }

  process.exit(0);
}

run().catch((err) => {
  console.error('Validation suite crashed:', err?.stack || err?.message || String(err));
  process.exit(2);
});

