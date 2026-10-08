'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8081);
const STORAGE_ROOT = process.env.EXCEL_STORAGE_ROOT || '/storage';
const FILES_DIR = path.join(STORAGE_ROOT, 'files');
const METADATA_DIR = path.join(STORAGE_ROOT, 'metadata');
const JWT_SECRET = String(process.env.JWT_REFRESH_SECRET || '');
const MAX_ARTIFACT_ID_LENGTH = 36;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function deny(response) {
  response.writeHead(404, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end();
}

function base64UrlDecode(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + padding, 'base64');
}

function parseCookies(header) {
  return Object.fromEntries(
    String(header || '').split(';').map((part) => {
      const index = part.indexOf('=');
      if (index < 0) return ['', ''];
      return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    }),
  );
}

function validateUserJwt(token) {
  if (!JWT_SECRET || !token) return null;
  const pieces = token.split('.');
  if (pieces.length !== 3) return null;
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = pieces;
    const header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8'));
    if (header.alg !== 'HS256') return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${encodedHeader}.${encodedPayload}`).digest();
    const supplied = base64UrlDecode(encodedSignature);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
    const payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
    if (!payload || typeof payload !== 'object' || (payload.exp && Number(payload.exp) <= Math.floor(Date.now() / 1000))) return null;
    return payload;
  } catch {
    return null;
  }
}

function userIdFromPayload(payload) {
  const candidate = payload?.id ?? payload?.userId ?? payload?._id ?? payload?.sub;
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 128 ? candidate : null;
}

function contentDisposition(filename) {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function resolveArtifact(artifactId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artifactId)) return null;
  const metadataPath = path.join(METADATA_DIR, `${artifactId}.json`);
  try {
    const metadata = JSON.parse(await fsp.readFile(metadataPath, 'utf8'));
    if (metadata.artifactId !== artifactId || typeof metadata.storageName !== 'string' || !metadata.storageName.endsWith('.xlsx')) return null;
    if (Number.isNaN(Date.parse(metadata.expiresAt)) || Date.parse(metadata.expiresAt) <= Date.now()) return null;
    const filePath = path.resolve(FILES_DIR, metadata.storageName);
    if (!filePath.startsWith(`${path.resolve(FILES_DIR)}${path.sep}`)) return null;
    return { metadata, filePath };
  } catch {
    return null;
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end('{"status":"ok"}');
    return;
  }

  const match = request.method === 'GET' && request.url?.match(/^\/api\/files\/download\/([0-9a-f-]{1,36})$/i);
  if (!match || match[1].length > MAX_ARTIFACT_ID_LENGTH) return deny(response);

  const cookies = parseCookies(request.headers.cookie);
  // LibreChat OpenID-reuse sessions intentionally store the signed local user
  // id in `openid_user_id`; local/password sessions use `refreshToken`.
  // Match LibreChat's own image middleware so downloads work for both flows.
  const sessionToken = cookies.token_provider === 'openid'
    ? cookies.openid_user_id
    : cookies.refreshToken;
  const payload = validateUserJwt(sessionToken);
  const userId = userIdFromPayload(payload);
  const artifact = await resolveArtifact(match[1]);
  if (!userId || !artifact || artifact.metadata.ownerUserId !== userId) return deny(response);

  try {
    const stat = await fsp.stat(artifact.filePath);
    if (!stat.isFile()) return deny(response);
    response.writeHead(200, {
      'Content-Type': XLSX_MIME,
      'Content-Length': stat.size,
      'Content-Disposition': contentDisposition(String(artifact.metadata.displayName || 'download.xlsx')),
      'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    fs.createReadStream(artifact.filePath).on('error', () => response.destroy()).pipe(response);
  } catch {
    return deny(response);
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`excel-artifacts listening on ${PORT}`));
