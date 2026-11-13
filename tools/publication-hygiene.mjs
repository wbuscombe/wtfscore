// WTFScore - publication hygiene checks for tracked source and docs.
// Six categories stay out of published files: local user paths, private IPv4
// addresses, email addresses, planning identifiers in code comments, planning
// identifiers in test titles, and em dashes in Markdown. Findings report file,
// line, column and category only; the matched text is never echoed.
//
// Comment and title checks use a small lexer, so the same identifiers inside
// string literals, regular expressions or code are not treated as comments.
//
// Usage: node tools/publication-hygiene.mjs
// Lists the files Git tracks in this checkout and scans them.
// Exit status: 0 clean, 1 findings, 2 the tracked-file list failed validation.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Files that must be present in any genuine checkout of this repository. A list
// without them is the wrong tree, so no scan result built on it can pass.
export const ANCHORS = Object.freeze([
  'public/index.html',
  'public/lib/g1.mjs',
  'README.md',
  'LICENSE',
  'docs/screenshots/manifest.json',
  'tools/publication-hygiene.mjs',
  'test/publication-hygiene.test.mjs',
]);

export const CATEGORIES = Object.freeze(['local-path', 'private-ipv4', 'email', 'comment-planning-id', 'test-title-planning-id', 'markdown-em-dash']);

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
// RFC 1918 ranges and the shared carrier-grade range. Loopback, unspecified and
// documentation addresses are not private network details.
const PRIVATE_IPV4 = new RegExp(
  `(?<![\\w.])(?:10(?:\\.${OCTET}){3}|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.${OCTET}){2}|192\\.168(?:\\.${OCTET}){2}|100\\.(?:6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])(?:\\.${OCTET}){2})(?!\\w|\\.\\d)`,
  'g',
);

// A home or mounted-volume directory followed by a user or volume name. The CI
// runner's own home is a generic build path, not a personal one.
const LOCAL_PATH = /(?<![\w.~-])(?:\/(?:Users|home|Volumes)\/(?!runner(?![\w.-]))[\w.-]+|[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\\s"']+)/g;

const EMAIL = /(?<![\w.%+-])[A-Za-z0-9][\w.%+-]*@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![\w-])/g;
// Domains reserved for documentation and testing, and GitHub's no-reply relay.
const EMAIL_ALLOWED_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost|users\.noreply\.github\.com)$/i;

// Planning identifiers: work-item codes (one to four capitals, a hyphen and a
// number), zero-padded sequence numbers of three or six digits, one-letter
// gate labels (C, G or K and a digit) and numbered plan-section references.
// Standards names with the work-item shape are allowed.
const PLANNING_ID = new RegExp([
  '(?<![\\w-])[A-Z]{1,4}-\\d{1,3}(?![\\w-])',
  '(?<![\\w.#])0\\d{2}(?:0\\d{2})?(?![\\w.])',
  '(?<![\\w-])[CGK][1-9](?![\\w-])',
  '(?<![\\w-])[Pp]lan v?\\d+(?:\\.\\d+)+(?!\\w)',
].join('|'), 'g');
const PLANNING_ID_ALLOWED = /^(?:UTF|ISO|SHA|RFC|CVE|IEEE|WCAG)-/;

const EM_DASH = new RegExp(String.fromCharCode(0x2014), 'g');

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function locate(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: index - starts[lo] + 1 };
}

// Regex matches in a text segment that starts at `offset` within the file.
function matchesIn(segment, offset, re, accept = () => true) {
  const hits = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(segment)) !== null) {
    if (accept(m)) hits.push(offset + m.index);
    if (m[0].length === 0) re.lastIndex++;
  }
  return hits;
}

const isPlanningId = (m) => !PLANNING_ID_ALLOWED.test(m[0]);

// ---------------------------------------------------------------------------
// JavaScript lexer: comments, string and template literals, regular expressions.
// It needs to be accurate for this repository's modules, not a full parser.

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

export function lexJs(text) {
  const comments = [];
  const tokens = [];
  const n = text.length;
  const stack = [];
  let i = 0;
  let prev = null;

  const regexAllowed = () => {
    if (!prev) return true;
    if (prev.type === 'num' || prev.type === 'str' || prev.type === 'tpl' || prev.type === 'regex') return false;
    if (prev.type === 'id') return REGEX_AFTER_WORD.has(prev.value);
    return ![')', ']', '}', '++', '--'].includes(prev.value);
  };

  const push = (tok) => {
    tokens.push(tok);
    prev = tok;
  };

  function readQuoted(q) {
    const start = i;
    i++;
    let value = '';
    while (i < n && text[i] !== q) {
      if (text[i] === '\\') {
        value += text.slice(i, i + 2);
        i += 2;
      } else if (text[i] === '\n') {
        break;
      } else {
        value += text[i++];
      }
    }
    i++;
    push({ type: 'str', value, start });
  }

  // Reads template text up to the closing backtick or the next `${`.
  function readTemplate(tok) {
    while (i < n) {
      const c = text[i];
      if (c === '\\') {
        tok.value += text.slice(i, i + 2);
        i += 2;
      } else if (c === '`') {
        i++;
        return;
      } else if (c === '$' && text[i + 1] === '{') {
        tok.value += '${}';
        i += 2;
        stack.push(tok);
        prev = { type: 'punct', value: '{' };
        return;
      } else {
        tok.value += c;
        i++;
      }
    }
  }

  if (text.startsWith('#!')) while (i < n && text[i] !== '\n') i++;

  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (c === '/' && d === '/') {
      const start = i;
      while (i < n && text[i] !== '\n') i++;
      comments.push({ start, text: text.slice(start, i), kind: 'line' });
    } else if (c === '/' && d === '*') {
      const start = i;
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      comments.push({ start, text: text.slice(start, i), kind: 'block' });
    } else if (c === '/' && regexAllowed()) {
      const start = i;
      i++;
      let inClass = false;
      while (i < n && text[i] !== '\n') {
        const r = text[i];
        if (r === '\\') i += 2;
        else if (r === '[') { inClass = true; i++; }
        else if (r === ']') { inClass = false; i++; }
        else if (r === '/' && !inClass) { i++; break; }
        else i++;
      }
      while (i < n && /[a-z]/i.test(text[i])) i++;
      push({ type: 'regex', value: text.slice(start, i), start });
    } else if (c === "'" || c === '"') {
      readQuoted(c);
    } else if (c === '`') {
      const tok = { type: 'tpl', value: '', start: i };
      i++;
      push(tok);
      readTemplate(tok);
    } else if (c === '}' && stack.length && stack[stack.length - 1] !== '{') {
      const tok = stack.pop();
      i++;
      prev = tok;
      readTemplate(tok);
    } else if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < n && /[\w$]/.test(text[i])) i++;
      push({ type: 'id', value: text.slice(start, i), start });
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d))) {
      const start = i;
      while (i < n && /[\w.]/.test(text[i])) i++;
      push({ type: 'num', value: text.slice(start, i), start });
    } else {
      const start = i;
      let value = c;
      if ((c === '+' || c === '-') && d === c) value = c + c;
      else if (c === '?' && d === '.') value = '?.';
      i += value.length;
      if (c === '{') stack.push('{');
      else if (c === '}' && stack.length) stack.pop();
      push({ type: 'punct', value, start });
    }
  }
  return { comments, tokens };
}

// Test titles: the first argument of a bare `test(` call, when it is a string or
// template literal. Template substitutions read as `${}`.
export function testTitles(text) {
  const { tokens } = lexJs(text);
  const titles = [];
  for (let k = 0; k + 2 < tokens.length; k++) {
    const t = tokens[k];
    if (t.type !== 'id' || t.value !== 'test') continue;
    const before = tokens[k - 1];
    if (before && before.type === 'punct' && (before.value === '.' || before.value === '?.')) continue;
    if (tokens[k + 1].type !== 'punct' || tokens[k + 1].value !== '(') continue;
    const arg = tokens[k + 2];
    if (arg.type === 'str' || arg.type === 'tpl') titles.push({ start: arg.start + 1, text: arg.value });
  }
  return titles;
}

// ---------------------------------------------------------------------------
// Comments in the other tracked source types.

export function cssComments(text) {
  const comments = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
      i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      comments.push({ start: i, text: text.slice(i, stop), kind: 'block' });
      i = stop;
    } else {
      i++;
    }
  }
  return comments;
}

export function htmlComments(text) {
  const comments = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf('<!--', from);
    if (start < 0) return comments;
    const end = text.indexOf('-->', start + 4);
    const stop = end < 0 ? text.length : end + 3;
    comments.push({ start, text: text.slice(start, stop), kind: 'block' });
    from = stop;
  }
}

export function pythonComments(text) {
  const comments = [];
  let i = 0;
  let triple = null;
  while (i < text.length) {
    if (triple) {
      const end = text.indexOf(triple, i);
      i = end < 0 ? text.length : end + 3;
      triple = null;
      continue;
    }
    const c = text[i];
    if ((c === '"' || c === "'") && text.startsWith(c.repeat(3), i)) {
      triple = c.repeat(3);
      i += 3;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
      i++;
    } else if (c === '#') {
      const start = i;
      while (i < text.length && text[i] !== '\n') i++;
      comments.push({ start, text: text.slice(start, i), kind: 'line' });
    } else {
      i++;
    }
  }
  return comments;
}

// YAML: `#` after whitespace (or at line start) outside quoted scalars. Block
// scalar bodies (`|` and `>`) hold content, such as scripts, not comments.
export function yamlComments(text) {
  const comments = [];
  const lines = text.split('\n');
  let offset = 0;
  let blockIndent = -1;
  let quote = null;
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const blank = line.trim() === '';
    if (blockIndent >= 0 && (blank || indent > blockIndent)) {
      offset += line.length + 1;
      continue;
    }
    blockIndent = -1;
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (quote === '"') {
        if (c === '\\') i += 2;
        else { if (c === '"') quote = null; i++; }
      } else if (quote === "'") {
        if (c === "'" && line[i + 1] === "'") i += 2;
        else { if (c === "'") quote = null; i++; }
      } else if (c === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
        comments.push({ start: offset + i, text: line.slice(i), kind: 'line' });
        break;
      } else if ((c === '"' || c === "'") && (i === 0 || /[\s:,[{-]/.test(line[i - 1]))) {
        quote = c;
        i++;
      } else {
        i++;
      }
    }
    if (!quote && /(?:^|[\s:-])[|>][+-]?\d*\s*(?:#.*)?$/.test(line.replace(/\s+$/, ''))) blockIndent = indent;
    offset += line.length + 1;
  }
  return comments;
}

export function commentsFor(file, text) {
  const ext = path.extname(file).toLowerCase();
  if (['.mjs', '.js', '.cjs'].includes(ext)) return lexJs(text).comments;
  if (ext === '.css') return cssComments(text);
  if (ext === '.html') return htmlComments(text);
  if (ext === '.py') return pythonComments(text);
  if (ext === '.yml' || ext === '.yaml') return yamlComments(text);
  return [];
}

// ---------------------------------------------------------------------------
// Category scans. Each returns findings without the matched text.

export function scanText(text, { file = '<text>', categories = CATEGORIES } = {}) {
  const starts = lineStarts(text);
  const out = [];
  const add = (category, indexes) => {
    for (const idx of indexes) {
      const pos = locate(starts, idx);
      out.push({ file, line: pos.line, col: pos.col, category });
    }
  };
  const ext = path.extname(file).toLowerCase();
  if (categories.includes('local-path')) add('local-path', matchesIn(text, 0, LOCAL_PATH));
  if (categories.includes('private-ipv4')) add('private-ipv4', matchesIn(text, 0, PRIVATE_IPV4));
  if (categories.includes('email')) add('email', matchesIn(text, 0, EMAIL, (m) => !EMAIL_ALLOWED_DOMAIN.test(m[1])));
  if (categories.includes('comment-planning-id')) {
    for (const c of commentsFor(file, text)) add('comment-planning-id', matchesIn(c.text, c.start, PLANNING_ID, isPlanningId));
  }
  if (categories.includes('test-title-planning-id') && ['.mjs', '.js', '.cjs'].includes(ext)) {
    for (const t of testTitles(text)) add('test-title-planning-id', matchesIn(t.text, t.start, PLANNING_ID, isPlanningId));
  }
  if (categories.includes('markdown-em-dash') && ext === '.md') add('markdown-em-dash', matchesIn(text, 0, EM_DASH));
  return out.sort((a, b) => a.line - b.line || a.col - b.col || a.category.localeCompare(b.category));
}

// ---------------------------------------------------------------------------
// Tracked files. The complete Git list is validated before any filtering.

export function validateTrackedList(files, { anchors = ANCHORS } = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('tracked-file list is empty');
  const set = new Set(files);
  const missing = anchors.filter((a) => !set.has(a));
  if (missing.length) throw new Error(`tracked-file list is missing ${missing.length} anchor file(s): ${missing.join(', ')}`);
  return files;
}

// Git must resolve this checkout itself. Inherited GIT_DIR and GIT_WORK_TREE are
// honoured, so a nested checkout lists its own files rather than a parent's.
export function trackedFiles(root = ROOT) {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const top = path.resolve(run(['rev-parse', '--show-toplevel']).trim());
  if (top !== path.resolve(root)) throw new Error('Git resolved a different work tree than this checkout');
  return validateTrackedList(run(['ls-files', '-z', '--full-name']).split('\0').filter(Boolean));
}

export function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

export function scanTracked({ root = ROOT, files = trackedFiles(root), categories = CATEGORIES } = {}) {
  validateTrackedList(files);
  const findings = [];
  const scanned = [];
  for (const rel of files) {
    const buf = readFileSync(path.join(root, rel));
    if (isBinary(buf)) continue;
    scanned.push(rel);
    findings.push(...scanText(buf.toString('utf8'), { file: rel, categories }));
  }
  return { tracked: files.length, scanned, findings };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  let res;
  try {
    res = scanTracked();
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, res.findings.filter((f) => f.category === c).length]));
  console.log(JSON.stringify({ tracked: res.tracked, scanned: res.scanned.length, counts, findings: res.findings.map((f) => `${f.file}:${f.line}:${f.col} ${f.category}`) }, null, 1));
  process.exit(res.findings.length ? 1 : 0);
}
