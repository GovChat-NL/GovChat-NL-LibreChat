#!/usr/bin/env node
/**
 * Deterministic transcription validation against fixed audio fixture.
 */

const fs = require('fs');
const path = require('path');

function getArg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  if (i >= 0 && i + 1 < process.argv.length) return String(process.argv[i + 1] || '').trim();
  return fallback;
}

function getIntArg(name, fallback) {
  const raw = getArg(name, String(fallback));
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function getBoolArg(name, fallback = false) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const next = i + 1 < process.argv.length ? String(process.argv[i + 1] || '').trim().toLowerCase() : '';
  if (!next || next.startsWith('--')) return true;
  if (['1', 'true', 'yes', 'y', 'on'].includes(next)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(next)) return false;
  return true;
}

function readTokenFromEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return '';
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    if (k !== 'N8N_WEBHOOK_TOKEN') continue;
    return line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
}

function printHeader(title) {
  console.log('\n' + '='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function run() {
  const fixture = getArg('--audio', 'tests/fixtures/transcript-sample-nl.wav');
  const webhook = getArg('--webhook', 'http://localhost:3080/n8n/webhook/transcriptie-litellm');
  const model = getArg('--model', 'gpt-4o-transcribe');
  const language = getArg('--language', 'nl');
  const expectedWordsRaw = getArg('--expect-words', '');
  const timeoutMsRaw = Number(getArg('--timeout-ms', '20000'));
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 20000;
  const repeat = Math.max(1, getIntArg('--repeat', 1));
  const minChars = Math.max(0, getIntArg('--min-chars', 1));
  const strictHttp = getBoolArg('--strict-http', true);
  const verbose = getBoolArg('--verbose', false);

  const token =
    getArg('--token', process.env.N8N_WEBHOOK_TOKEN || '') ||
    readTokenFromEnvFile(path.resolve(__dirname, '../../.env'));

  printHeader('GovChat Transcript Validation');
  console.log('audio fixture :', fixture, fs.existsSync(fixture) ? '(found)' : '(missing)');
  console.log('webhook      :', webhook);
  console.log('token        :', token ? '<set>' : '<empty>');
  console.log('model/lang   :', `${model}/${language}`);
  console.log('expect words :', expectedWordsRaw || '<none>');
  console.log('timeout ms   :', timeoutMs);
  console.log('repeat       :', repeat);
  console.log('min chars    :', minChars);
  console.log('strict http  :', strictHttp ? 'yes' : 'no');

  if (!fs.existsSync(fixture)) {
    console.error('FAIL: audio fixture missing:', fixture);
    process.exit(1);
  }

  const audioBase64 = fs.readFileSync(fixture).toString('base64');
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-govchat-token'] = token;
  const sessionId = `validation-${Date.now()}`;
  const runs = [];

  for (let i = 0; i < repeat; i++) {
    const payload = {
      session_id: sessionId,
      chunk_index: i,
      mime_type: 'audio/wav',
      audio_base64: audioBase64,
      model,
      language,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(webhook, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err && err.name === 'AbortError'
        ? `Request timed out after ${timeoutMs}ms`
        : err && err.message
        ? err.message
        : String(err);
      throw new Error(`chunk ${i}: ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    const bodyText = await res.text();
    let body;
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      body = { raw: bodyText };
    }
    const text = normalizeText(body && body.text ? body.text : body && body.transcript ? body.transcript : '');
    const hasError = !!(body && body.error);
    runs.push({ chunk: i, status: res.status, hasError, text, body });

    if (verbose) {
      console.log(`chunk ${i} -> status=${res.status}, hasError=${hasError ? 'yes' : 'no'}, textLen=${text.length}`);
    }
  }

  const allText = normalizeText(runs.map((r) => r.text).filter(Boolean).join(' '));
  const anyError = runs.some((r) => r.hasError);
  const badHttp = runs.some((r) => !String(r.status).startsWith('2'));
  const expectedWords = expectedWordsRaw
    ? expectedWordsRaw
        .split(',')
        .map((s) => normalizeText(s))
        .filter(Boolean)
    : [];

  const missingWords = expectedWords.filter((w) => !allText.includes(w));

  printHeader('Result');
  console.log('chunks       :', runs.length);
  console.log('statuses     :', runs.map((r) => r.status).join(', '));
  console.log('error        :', anyError ? 'one or more chunks returned error payload' : '<none>');
  console.log('transcript   :', allText || '<empty>');
  if (expectedWords.length) {
    console.log('missing words:', missingWords.length ? missingWords.join(', ') : '<none>');
  }
  if (verbose && (badHttp || anyError)) {
    console.log('details      :', JSON.stringify(runs, null, 2));
  }

  const pass =
    (!strictHttp || !badHttp) &&
    !anyError &&
    allText.length >= minChars &&
    (expectedWords.length === 0 || missingWords.length === 0);

  printHeader('Summary');
  console.log('pass :', pass ? 'yes' : 'no');

  if (!pass) process.exit(1);
}

run().catch((err) => {
  console.error('FAIL:', err && err.message ? err.message : String(err));
  process.exit(1);
});

