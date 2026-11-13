// WTFScore - source and fixture hygiene scanner.
// Rejects an unobfuscated expletive or source-site branding in text files.
// Patterns are stored only as character codes and compiled at runtime into
// character-class regular expressions, so this file contains no literal
// forbidden word. Findings never echo the matched text.
//
// Usage: node tools/hygiene-scan.mjs <path> [<path> ...]
// Exit status: 0 clean, 1 findings, 2 usage error or nothing scanned.

import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ENCODED = Object.freeze([
  { category: 'expletive', mode: 'substring', codes: [102, 117, 99, 107] },
  { category: 'expletive', mode: 'word', codes: [115, 104, 105, 116] },
  { category: 'brand', mode: 'substring', codes: [101, 115, 112, 110] },
  { category: 'brand', mode: 'substring', codes: [100, 105, 115, 110, 101, 121] },
  { category: 'brand', mode: 'substring', codes: [103, 97, 109, 101, 99, 97, 115, 116] },
]);

const TEXT_EXT = new Set(['.mjs', '.js', '.cjs', '.html', '.css', '.md', '.json', '.txt', '.svg', '.yml', '.yaml']);
const SKIP_NAMES = new Set(['.DS_Store', 'node_modules', '.git']);

function charClass(code) {
  const ch = String.fromCharCode(code);
  const lo = ch.toLowerCase();
  const up = ch.toUpperCase();
  return lo === up ? `\\x${code.toString(16).padStart(2, '0')}` : `[${lo}${up}]`;
}

export function compilePatterns() {
  return ENCODED.map((p, i) => {
    const body = p.codes.map(charClass).join('');
    const source = p.mode === 'word' ? `(?<![A-Za-z])${body}(?![A-Za-z])` : body;
    return { id: `${p.category}#${i + 1}`, category: p.category, re: new RegExp(source, 'g') };
  });
}

// Only for planting canaries in an evidence directory (tools/plant-canary.mjs).
export function decodedTerm(category, index = 0) {
  const list = ENCODED.filter((p) => p.category === category);
  const p = list[index];
  return p ? String.fromCharCode(...p.codes) : null;
}

export function scanText(text, { file = '<text>' } = {}) {
  const findings = [];
  const lines = String(text).split(/\r?\n/);
  const patterns = compilePatterns();
  lines.forEach((line, i) => {
    for (const p of patterns) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(line)) !== null) {
        findings.push({ file, line: i + 1, col: m.index + 1, id: p.id, category: p.category });
        if (m[0].length === 0) p.re.lastIndex++;
      }
    }
  });
  return findings;
}

async function walk(target, out) {
  const info = await lstat(target);
  if (info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    const entries = await readdir(target);
    entries.sort();
    for (const name of entries) {
      if (SKIP_NAMES.has(name)) continue;
      await walk(path.join(target, name), out);
    }
  } else if (info.isFile() && TEXT_EXT.has(path.extname(target).toLowerCase())) {
    out.push(target);
  }
}

export async function scanPaths(paths) {
  const files = [];
  for (const p of paths) await walk(path.resolve(p), files);
  const findings = [];
  for (const f of files) findings.push(...scanText(await readFile(f, 'utf8'), { file: f }));
  return { filesScanned: files.length, files, findings };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('usage: node tools/hygiene-scan.mjs <path> [<path> ...]');
    process.exit(2);
  }
  const res = await scanPaths(args);
  const report = {
    scanner: path.relative(process.cwd(), fileURLToPath(import.meta.url)) || 'hygiene-scan.mjs',
    filesScanned: res.filesScanned,
    findingCount: res.findings.length,
    findings: res.findings.map((f) => `${f.file}:${f.line}:${f.col} ${f.id}`),
  };
  console.log(JSON.stringify(report, null, 1));
  if (res.filesScanned === 0) process.exit(2);
  process.exit(res.findings.length ? 1 : 0);
}
