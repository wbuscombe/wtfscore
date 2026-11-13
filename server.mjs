// WTFScore DEL-0 - local preview server.
// Serves ./public read-only on 127.0.0.1:4317 only. No writes, no outbound
// calls, no dependencies. Run: node server.mjs

import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOST = '127.0.0.1';
export const PORT = 4317;
export const PUBLIC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store',
});

export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
});

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

function send(res, status, body, extra = {}) {
  const buf = Buffer.from(body ?? '');
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': String(buf.length), ...extra });
  res.end(buf);
}

function within(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

export function createHandler({ root = PUBLIC_ROOT, allowedHosts = ALLOWED_HOSTS } = {}) {
  const rootResolved = path.resolve(root);
  let rootReal = null;
  return async function handle(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
      const hostHeader = String(req.headers?.host ?? '').toLowerCase();
      if (!allowedHosts.has(hostHeader)) return send(res, 421, 'Misdirected request\n');
      const rawUrl = String(req.url ?? '');
      if (!rawUrl.startsWith('/') || rawUrl.startsWith('//')) return send(res, 400, 'Bad request\n');
      const rawPath = rawUrl.split('?')[0].split('#')[0];
      let decoded;
      try {
        decoded = decodeURIComponent(rawPath);
      } catch {
        return send(res, 400, 'Bad request\n');
      }
      if (decoded.includes('\0') || decoded.includes('\\')) return send(res, 400, 'Bad request\n');
      const segments = decoded.split('/').filter(Boolean);
      if (segments.some((s) => s === '..' || s.startsWith('.'))) return send(res, 404, 'Not found\n');
      let rel = segments.join('/');
      if (rel === '' || decoded.endsWith('/')) rel = path.posix.join(rel, 'index.html');
      const target = path.resolve(rootResolved, rel);
      if (!within(rootResolved, target)) return send(res, 404, 'Not found\n');
      const type = MIME[path.extname(target).toLowerCase()];
      if (!type) return send(res, 404, 'Not found\n');
      let real;
      try {
        rootReal ??= await realpath(rootResolved);
        real = await realpath(target);
      } catch {
        return send(res, 404, 'Not found\n');
      }
      if (!within(rootReal, real)) return send(res, 404, 'Not found\n');
      const info = await stat(real);
      if (!info.isFile()) return send(res, 404, 'Not found\n');
      const body = await readFile(real);
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': String(body.length) });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      send(res, 500, 'Internal error\n');
    }
  };
}

// `factory` is injectable so tests can check the bind address without a socket.
export function startServer({ host = HOST, port = PORT, factory = http.createServer, log = console.log } = {}) {
  if (host !== HOST) throw new Error('WTFScore prototype binds 127.0.0.1 only');
  const server = factory(createHandler());
  server.listen(port, host, () => log(`WTFScore DEL-0 prototype (SIMULATED) at http://${host}:${port}/  pid=${process.pid} node=${process.version}`));
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const server = startServer();
  const stop = (sig) => {
    console.log(`received ${sig}; closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
