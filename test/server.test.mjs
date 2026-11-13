import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHandler, startServer, HOST, PORT, CSP, SECURITY_HEADERS } from '../server.mjs';

const SERVER_SRC = fileURLToPath(new URL('../server.mjs', import.meta.url));
const handler = createHandler();

function mockRes() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end(body) {
      this.body = body === undefined ? null : Buffer.from(body);
    },
  };
}

async function request(url, { method = 'GET', host = `${HOST}:${PORT}` } = {}) {
  const res = mockRes();
  await handler({ method, url, headers: host === null ? {} : { host } }, res);
  return res;
}

test('serves the page with CSP and security headers', async () => {
  const res = await request('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['Content-Type'], /^text\/html/);
  assert.equal(res.headers['Content-Security-Policy'], CSP);
  for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self'", "connect-src 'self'"]) assert.ok(CSP.includes(d), d);
  assert.ok(!CSP.includes('unsafe-inline') && !CSP.includes('unsafe-eval') && !CSP.includes('*'));
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.ok(res.body.toString('utf8').includes('SIMULATED'));
});

test('serves modules with a JavaScript MIME type; HEAD has no body', async () => {
  const js = await request('/app.mjs');
  assert.equal(js.status, 200);
  assert.match(js.headers['Content-Type'], /^text\/javascript/);
  const head = await request('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
});

test('path traversal and dotfiles never escape the public root', async () => {
  const serverText = await readFile(SERVER_SRC, 'utf8');
  const attempts = [
    '/../server.mjs', '/%2e%2e/server.mjs', '/..%2fserver.mjs', '/%2e%2e%2f%2e%2e%2fetc/passwd', '/lib/../../server.mjs',
    '/lib/%2e%2e/%2e%2e/server.mjs', '/..\\server.mjs', '/%5c..%5cserver.mjs', '/%00', '/index.html%00.css', '/.env', '/lib/.hidden.mjs',
    '//etc/passwd', 'http://evil.example/', '/%E0%A4%A', '/....//server.mjs',
  ];
  for (const url of attempts) {
    const res = await request(url);
    assert.ok([400, 404].includes(res.status), `${url} -> ${res.status}`);
    const body = res.body ? res.body.toString('utf8') : '';
    assert.ok(!body.includes('createHandler') && body.length < 64, `${url} leaked content`);
    assert.equal(res.headers['Content-Security-Policy'], CSP, 'errors carry the security headers too');
  }
  assert.ok(serverText.includes('createHandler'), 'probe string is real');
});

test('unknown files, directories and types are 404', async () => {
  for (const url of ['/nope.html', '/lib/', '/lib', '/server.mjs', '/test/server.test.mjs']) {
    const res = await request(url);
    assert.equal(res.status, 404, url);
  }
});

test('only GET and HEAD are allowed', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const res = await request('/', { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.Allow, 'GET, HEAD');
  }
});

test('foreign Host headers are refused (DNS rebinding guard)', async () => {
  for (const host of ['evil.example', 'evil.example:4317', '127.0.0.1:80', '0.0.0.0:4317', '', null]) {
    const res = await request('/', { host });
    assert.equal(res.status, 421, String(host));
  }
  assert.equal((await request('/', { host: 'localhost:4317' })).status, 200);
});

test('binds 127.0.0.1:4317 only, never a wildcard address', () => {
  const calls = [];
  const fake = () => ({
    listen(port, host, cb) {
      calls.push({ port, host });
      if (cb) cb();
    },
  });
  startServer({ factory: fake, log: () => {} });
  assert.deepEqual(calls, [{ port: 4317, host: '127.0.0.1' }]);
  assert.throws(() => startServer({ host: '0.0.0.0', factory: fake, log: () => {} }));
  assert.throws(() => startServer({ host: '::', factory: fake, log: () => {} }));
});

test('static inventory: only local read APIs, no writes, no outbound calls, no wildcard bind', async () => {
  const src = await readFile(SERVER_SRC, 'utf8');
  const imports = [...src.matchAll(/^import\s+(.+?)\s+from\s+'([^']+)';$/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(imports.map((i) => i[1]).sort(), ['node:fs/promises', 'node:http', 'node:path', 'node:url']);
  const fsImport = imports.find((i) => i[1] === 'node:fs/promises')[0];
  assert.equal(fsImport.replace(/\s+/g, ' '), '{ readFile, stat, realpath }');
  for (const bad of ['writeFile', 'appendFile', 'createWriteStream', 'mkdir', 'unlink', 'rename', 'fetch(', 'http.request', 'http.get', "'node:https'", "'node:net'", "'node:dgram'", 'child_process', '0.0.0.0', 'process.env']) {
    assert.ok(!src.includes(bad), `server.mjs must not contain ${bad}`);
  }
  assert.equal(Object.keys(SECURITY_HEADERS).includes('Content-Security-Policy'), true);
});
