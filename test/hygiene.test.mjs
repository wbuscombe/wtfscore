// Hygiene scanner tests. Forbidden terms are built from character codes at run
// time; no forbidden word appears literally in this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { scanText, scanPaths, compilePatterns, decodedTerm } from '../tools/hygiene-scan.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCANNER = fileURLToPath(new URL('../tools/hygiene-scan.mjs', import.meta.url));

const E = decodedTerm('expletive', 0);
const S = decodedTerm('expletive', 1);
const B = decodedTerm('brand', 0);

test('patterns are compiled from codes into character classes', () => {
  const pats = compilePatterns();
  assert.equal(pats.length, 5);
  for (const p of pats) {
    assert.ok(p.re.source.includes('['), 'character classes');
    assert.ok(!/[a-z]{3,}/i.test(p.re.source.replace(/\[[^\]]*\]/g, '').replace(/\\x[0-9a-f]{2}/gi, '').replace(/\(\?<?[!=]\[A-Za-z\]\)/g, '')), `${p.id} holds no literal word`);
  }
});

test('the scanner source itself contains no forbidden literal', async () => {
  const src = await readFile(SCANNER, 'utf8');
  assert.deepEqual(scanText(src), []);
  for (const term of [E, S, B]) assert.ok(!src.toLowerCase().includes(term.toLowerCase()));
});

test('detects an unobfuscated expletive in any case, also inside a longer word', () => {
  assert.equal(scanText(`What the ${E.toUpperCase()} is the score`).length, 1);
  assert.equal(scanText(`${E[0].toUpperCase()}${E.slice(1)}ing late field goal`).length, 1);
  assert.equal(scanText(`${S} happens`).length, 1);
  assert.equal(scanText(`x\n\ny ${E}`)[0].line, 3);
});

test('whole-word rule avoids false positives inside identifiers', () => {
  assert.deepEqual(scanText(`pu${S}ems and ${S}ake`), []);
});

test('detects source-site branding in any case, including in URLs', () => {
  assert.equal(scanText(`see ${B.toUpperCase()} scores`).length, 1);
  assert.equal(scanText(`www.${B}.example/nfl`).length, 1);
  assert.equal(scanText(`${decodedTerm('brand', 1)} terms`).length, 1);
  assert.equal(scanText(`${decodedTerm('brand', 2)} view`).length, 1);
});

test('obfuscated name and tagline pass', () => {
  assert.deepEqual(scanText('WTFScore: What the F%$& is the score?'), []);
  assert.deepEqual(scanText('What the F%$&amp; is the score?'), []);
  assert.deepEqual(scanText('wtfscore'), []);
});

test('findings never echo the matched text', () => {
  const f = scanText(`a ${E} b`)[0];
  assert.deepEqual(Object.keys(f).sort(), ['category', 'col', 'file', 'id', 'line']);
});

test('the whole source and fixture tree is clean', async () => {
  const res = await scanPaths([ROOT]);
  assert.ok(res.filesScanned >= 20, `scanned ${res.filesScanned} files`);
  assert.ok(res.files.some((f) => f.endsWith('fixtures.mjs')), 'fixtures included');
  assert.ok(res.files.some((f) => f.endsWith('README.md')), 'README included');
  assert.ok(res.files.some((f) => f.endsWith('hygiene-scan.mjs')), 'scanner scans itself');
  assert.deepEqual(res.findings, []);
});
