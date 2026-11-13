// Publication hygiene tests: one test per category. Each builds its forbidden
// samples at run time, so no literal match exists in this file, then checks a
// positive sample, negative samples and the complete set of tracked files.
// Every tracked-file check first proves the Git list is this checkout's own,
// nonempty and complete, and that an empty or wrong list is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  ROOT,
  ANCHORS,
  scanText,
  scanTracked,
  trackedFiles,
  validateTrackedList,
} from '../tools/publication-hygiene.mjs';

const j = (...parts) => parts.join('');
const only = (findings, category) => findings.filter((f) => f.category === category);
const hits = (text, category, file = 'sample.txt') => only(scanText(text, { file, categories: [category] }), category);

// The full tracked list, validated before any text or binary filtering.
function checkedTrackedFiles() {
  const files = trackedFiles();
  assert.ok(files.length > 0, 'Git lists tracked files');
  for (const anchor of ANCHORS) assert.ok(files.includes(anchor), `${anchor} is tracked`);
  assert.ok(files.some((f) => f.endsWith('.png')), 'binary files are part of the list before filtering');
  assert.throws(() => validateTrackedList([]), /empty/);
  assert.throws(() => validateTrackedList(files.filter((f) => f !== 'README.md')), /anchor/);
  assert.throws(() => trackedFiles(path.join(ROOT, 'docs')), /different work tree/);
  return files;
}

function trackedFindings(category) {
  const files = checkedTrackedFiles();
  const res = scanTracked({ files, categories: [category] });
  assert.equal(res.tracked, files.length);
  assert.ok(res.scanned.length > 0 && res.scanned.length < files.length, 'text files scanned, binaries skipped');
  assert.ok(!res.scanned.some((f) => f.endsWith('.png')));
  return { res, findings: only(res.findings, category) };
}

function assertNoEcho(findings, value) {
  for (const f of findings) {
    assert.deepEqual(Object.keys(f).sort(), ['category', 'col', 'file', 'line']);
    assert.ok(!JSON.stringify(f).includes(value), 'a finding never repeats the matched text');
  }
}

test('local paths: user home and volume paths are found; repository, runner and system paths pass; tracked files have none', () => {
  const samples = [
    ['', 'Users', 'sample-person', 'notes.txt'].join('/'),
    ['', 'home', 'sample-person', 'project'].join('/'),
    ['', 'Volumes', 'SampleDrive', 'share'].join('/'),
    j('C:', '\\', ['Users', 'sample-person', 'file.txt'].join('\\')),
  ];
  for (const s of samples) {
    const found = hits(`see "${s}" for details`, 'local-path');
    assert.equal(found.length, 1, 'one finding per planted path');
    assert.equal(found[0].col, 6);
    assertNoEcho(found, s);
  }
  const negatives = [
    'public/lib/board.mjs',
    './test/fake-dom.mjs',
    ['', 'home', 'runner', 'work', 'repo'].join('/'),
    '/usr/bin/node',
    '/sys/fs/cgroup',
    j('https://www.example.com', ['', 'home', 'page'].join('/')),
    '/%2e%2e/etc/passwd',
  ];
  for (const s of negatives) assert.deepEqual(hits(`path ${s} here`, 'local-path'), [], s);
  assert.deepEqual(trackedFindings('local-path').findings, []);
});

test('private IPv4: private and shared ranges are found; loopback, documentation addresses and version numbers pass; tracked files have none', () => {
  const ip = (...octets) => octets.join('.');
  const samples = [ip(10, 1, 2, 3), ip(172, 20, 0, 9), ip(192, 168, 40, 2), ip(100, 70, 1, 1)];
  for (const s of samples) {
    const found = hits(`host ${s}:4317`, 'private-ipv4');
    assert.equal(found.length, 1, 'one finding per planted address');
    assertNoEcho(found, s);
  }
  const negatives = [
    ip(127, 0, 0, 1),
    ip(0, 0, 0, 0),
    ip(192, 0, 2, 10),
    ip(198, 51, 100, 7),
    ip(203, 0, 113, 5),
    ip(172, 32, 0, 1),
    j('Chrome/', ip(131, 0, 6778, 33)),
    j('v', ip(10, 4000, 2, 1)),
    ip(1, 10, 1, 2, 3),
  ];
  for (const s of negatives) assert.deepEqual(hits(`value ${s} here`, 'private-ipv4'), [], s);
  assert.deepEqual(trackedFindings('private-ipv4').findings, []);
});

test('email: real-looking addresses are found; reserved example domains and the GitHub no-reply form pass; tracked files have none', () => {
  const at = (user, domain) => j(user, '@', domain);
  const sample = at('sample.person', j('mail', '.', 'invalidtld-sample', '.', 'net'));
  const found = hits(`contact ${sample} today`, 'email');
  assert.equal(found.length, 1);
  assertNoEcho(found, sample);
  const negatives = [
    at('someone', 'example.com'),
    at('someone', 'example.org'),
    at('person', 'mail.example'),
    at('ci', 'build.test'),
    at('12345+sample-user', 'users.noreply.github.com'),
    j('actions/checkout', '@', '9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0'),
    '@media (max-width: 600px)',
  ];
  for (const s of negatives) assert.deepEqual(hits(`value ${s} here`, 'email'), [], s);
  assert.deepEqual(trackedFindings('email').findings, []);
});

test('comment planning identifiers: work-item codes, sequence numbers, gate labels and plan sections in comments are found; the same text in strings and legitimate names pass; tracked files have none', () => {
  const code = j('AB', 'C-', '12');
  const seq = j('0', '07');
  const gate = j('G', '3');
  const plan = j('plan ', '4', '.', '2');
  const positives = [
    [`// ${code}: card order`, 'a.mjs'],
    [`const x = 1; // ${seq} change`, 'a.mjs'],
    [`/* ${gate} decision */`, 'a.css'],
    [`# see ${plan}`, 'a.py'],
    [`  # ${code}\nkey: value`, 'a.yml'],
    [`<!-- ${seq} -->`, 'a.html'],
  ];
  for (const [text, file] of positives) {
    const found = hits(text, 'comment-planning-id', file);
    assert.equal(found.length, 1, `${file}: one finding`);
    assertNoEcho(found, code);
  }
  const negatives = [
    [`const label = '${code} stays in data'; // ordinary comment`, 'a.mjs'],
    [`const re = /${code}/; const t = \`${seq} ${gate}\`;`, 'a.mjs'],
    ['// candidates LC1 to LC4, quarters Q2 and Q4, the LRU cap and a TD tag', 'a.mjs'],
    ['// UTF-8 text, a 1-2 card lookahead, 0-6 open, 1920x1080, game g11-112, seconds 00-59, 0.005 s', 'a.mjs'],
    ['/* step 5 is the baseline; a D-pad moves focus */', 'a.css'],
    [`run: |\n  # ${code} inside a script block\n  echo ok`, 'a.yml'],
    [`value = "${code}"  # ordinary comment`, 'a.py'],
  ];
  for (const [text, file] of negatives) assert.deepEqual(hits(text, 'comment-planning-id', file), [], text);
  assert.deepEqual(trackedFindings('comment-planning-id').findings, []);
});

test('test-title planning identifiers: titles carrying codes or labels are found; titles with candidate, quarter and size names pass; tracked files have none', () => {
  const code = j('XY', '-', '7');
  const seq = j('0', '11');
  const gate = j('K', '2');
  for (const title of [`${code} keeps focus`, `${seq} header picker`, `${gate}: arrows move focus`, `matches the pre-${j('0', '08')} catalog`]) {
    const found = hits(`test('${title}', () => {});`, 'test-title-planning-id', 'a.test.mjs');
    assert.equal(found.length, 1, title);
    assertNoEcho(found, title);
  }
  assert.equal(hits(`test(\`${code} \${'x'} title\`, () => {});`, 'test-title-planning-id', 'a.test.mjs').length, 1, 'template titles too');
  const negatives = [
    "test('LC4 gives the expanded card a full row; Q4 clocks 1:59/2:00; 1920x1080 at scale 1-10', () => {});",
    "test('LRU cap: cap 1 gives one-at-a-time, TD and OT tags', () => {});",
    `test('ordinary title', () => { assert.ok(true, '${code} in an assertion message'); });`,
    `const re = /${code}/; re.test('${seq} is not a title');`,
  ];
  for (const text of negatives) assert.deepEqual(hits(text, 'test-title-planning-id', 'a.test.mjs'), [], text);
  assert.deepEqual(trackedFindings('test-title-planning-id').findings, []);
});

test('Markdown em dash: an em dash in Markdown is found; hyphens, en dashes and em dashes outside Markdown pass; tracked files have none', () => {
  const em = String.fromCharCode(0x2014);
  const en = String.fromCharCode(0x2013);
  const found = hits(`A sentence ${em} with a dash.`, 'markdown-em-dash', 'notes.md');
  assert.equal(found.length, 1);
  assert.equal(found[0].col, 12);
  assertNoEcho(found, em);
  assert.deepEqual(hits(`Pages 1${en}2 and well-known terms - fine.`, 'markdown-em-dash', 'notes.md'), []);
  assert.deepEqual(hits(`const text = 'fixture ${em} text';`, 'markdown-em-dash', 'fixtures.mjs'), []);
  const { res, findings } = trackedFindings('markdown-em-dash');
  assert.ok(res.scanned.some((f) => f.endsWith('.md')), 'Markdown files are scanned');
  assert.deepEqual(findings, []);
});
