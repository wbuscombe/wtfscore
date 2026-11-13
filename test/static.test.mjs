// Static source checks for the browser code. These are a SOURCE INVENTORY, not
// a browser network trace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = path.join(ROOT, 'public');

async function listFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p)));
    else out.push(p);
  }
  return out.sort();
}

const files = await listFiles(PUBLIC);
const texts = new Map();
for (const f of files) texts.set(f, await readFile(f, 'utf8'));
const rel = (f) => path.relative(PUBLIC, f);
const src = (r) => texts.get(path.join(PUBLIC, r));

test('public/ holds only the expected kinds of files', () => {
  for (const f of files) assert.match(f, /\.(html|css|mjs)$/, rel(f));
  assert.ok(files.length >= 10);
});

test('no HTML-parsing sinks or dynamic code in browser code', () => {
  const sinks = ['inner' + 'HTML', 'outer' + 'HTML', 'insertAdjacent' + 'HTML', 'document.' + 'write', 'ev' + 'al(', 'new ' + 'Function', 'setAttribute(\'style', 'createContextual' + 'Fragment', 'DOMParser'];
  for (const [f, t] of texts) for (const s of sinks) assert.ok(!t.includes(s), `${rel(f)} uses ${s}`);
});

test('no browser storage, cookies, saved preferences or history writes in browser code: Demo screens live in memory only', () => {
  const apis = ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'navigator.storage', 'caches.open', 'openDatabase', 'history.', 'location.hash', 'location.search ='];
  for (const [f, t] of texts) for (const s of apis) assert.ok(!t.includes(s), `${rel(f)} uses ${s}`);
});

test('no network APIs and no external URLs in browser code', () => {
  const apis = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'import(', 'navigator.serviceWorker'];
  for (const [f, t] of texts) {
    for (const s of apis) assert.ok(!t.includes(s), `${rel(f)} uses ${s}`);
    assert.ok(!/https?:\/\//i.test(t), `${rel(f)} has an absolute URL`);
    if (/\.(css|html)$/.test(f)) assert.ok(!/url\(/i.test(t), `${rel(f)} loads a CSS url()`);
    else assert.ok(!/\burl\(/i.test(t), `${rel(f)} builds a CSS url() string`);
    assert.ok(!/@import/i.test(t), `${rel(f)} uses @import`);
  }
});

function moduleGraph(entry) {
  const seen = new Set();
  const queue = [path.join(PUBLIC, entry)];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    const t = texts.get(f);
    assert.ok(t !== undefined, `${f} exists in public/`);
    for (const m of t.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)';/gms)) {
      const spec = m[1];
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${rel(f)} imports ${spec}`);
      const target = path.resolve(path.dirname(f), spec);
      assert.ok(target.startsWith(PUBLIC + path.sep), `${spec} stays inside public/`);
      queue.push(target);
    }
  }
  return [...seen].map(rel).sort();
}

test('static dependency inventory: the page imports only relative scoreboard modules, never the comparison, summary, decision-sheet, measure or preset code', () => {
  const inventory = moduleGraph('app.mjs');
  console.log(`static module inventory (${inventory.length}): ${inventory.join(', ')}`);
  for (const needed of ['lib/board.mjs', 'lib/board-layout.mjs', 'lib/render.mjs', 'lib/chrome.mjs', 'lib/catalog.mjs', 'lib/sports.mjs', 'lib/menu.mjs']) assert.ok(inventory.includes(needed), needed);
  for (const banned of ['lib/metrics.mjs', 'lib/g1.mjs', 'lib/measure.mjs', 'lib/presets.mjs']) assert.ok(!inventory.includes(banned), `${banned} is developer/Node-only`);
});

test('normal-path source never names the old comparison, summary, table or URL-writing routines', () => {
  const banned = ['comparisonFor', 'contractSummary', 'contractMatrix', 'computeMetrics', 'g1Numbers', 'G1_PROPOSALS', 'measureBrowser', 'renderSummary', 'renderG1', 'renderCompare', 'scheduleCompare', 'scheduleMeasure', 'makeTable', 'replaceState', 'pushState', 'setInterval', 'computeLayout('];
  for (const r of ['app.mjs', 'lib/board.mjs', 'lib/board-layout.mjs', 'lib/render.mjs', 'lib/chrome.mjs', 'lib/diag.mjs', 'lib/catalog.mjs', 'lib/sports.mjs', 'lib/menu.mjs']) {
    for (const b of banned) assert.ok(!src(r).includes(b), `${r} mentions ${b}`);
  }
  const board = src('lib/board.mjs');
  for (const m of board.matchAll(/\bdiag\.(\w+)\(/g)) {
    const before = board.slice(Math.max(0, m.index - 40), m.index);
    assert.match(before, /(if \(diag\)|diag \? )\s*$/, `diag.${m[1]}( is guarded`);
  }
  same((board.match(/buildCard\(/g) || []).length, 1, 'cards are built in one place, once per game at mount');
});

test('index.html: one external module script, one stylesheet, no inline script, style or handlers, no old controls', () => {
  const html = src('index.html');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  same(scripts.length, 1);
  assert.match(scripts[0][1], /type="module"\s+src="\/app\.mjs"/);
  same(scripts[0][2].trim(), '');
  assert.ok(!/<style\b/i.test(html));
  assert.ok(!/\sstyle\s*=/i.test(html));
  assert.ok(!/\son[a-z]+\s*=/i.test(html));
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  assert.deepEqual(links, ['<link rel="stylesheet" href="/styles.css">']);
  assert.ok(html.includes('SIMULATED'));
  for (const old of ['exp3', 'exp6', 'candidates', 'preset', 'panel-', 'tablist', 'Expand', 'LC1', 'G1']) assert.ok(!html.includes(old), `index.html still has ${old}`);
});

test('model presets stay labelled as model sizes and stay out of the page', () => {
  const presets = src('lib/presets.mjs');
  assert.ok(presets.includes('NOT browser'));
  assert.ok(!moduleGraph('app.mjs').includes('lib/presets.mjs'));
});

const css = () => src('styles.css');

test('CSS: the [hidden] guard is the first rule and the only !important display rule', () => {
  assert.match(css(), /^\[hidden\] \{ display: none !important; \}/);
  const c = css().replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(c, /^\[hidden\] \{ display: none !important; \}/);
  const important = [...c.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /!important/.test(m[2]));
  same(important.length, 1, 'only one rule uses !important');
  same(important[0][1].trim(), '[hidden]');
  for (const m of c.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/hidden/.test(m[1]) && m[1].trim() !== '[hidden]') assert.fail(`another rule targets hidden elements: ${m[1].trim()}`);
  }
});

test('CSS: each game is one connected card: one outer border on the card, and only thin dividers between its parts', () => {
  const c = css().replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...c.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const after = rules.filter((r) => r.sel === '.card::after');
  same(after.length, 1, 'one outer border element per card');
  assert.match(after[0].body, /border: 1px solid var\(--line\);/);
  assert.match(after[0].body, /pointer-events: none;/);
  assert.match(after[0].body, /top: 0; right: 0; bottom: 0; left: 0;/);
  const sec = rules.find((r) => r.sel === '.sec');
  assert.ok(sec && !/border/.test(sec.body), 'a part has no border of its own');
  for (const r of rules.filter((x) => /\.sec[123]?\b/.test(x.sel) && /border/.test(x.body))) {
    assert.match(r.sel, /^\.card\[data-arrangement="(ltr|stack)"\] \.sec2, \.card\[data-arrangement="\1"\] \.sec3$/, `only dividers between parts: ${r.sel}`);
    assert.match(r.body.trim(), /^border-(left|top): 1px solid var\(--line-strong\);$/);
  }
});

test('CSS: quiet styling: no gradients, shadows, rounded corners, text shadows or web fonts; monospace board with a system font stack', () => {
  const c = css();
  for (const bad of [/gradient\(/i, /box-shadow/i, /text-shadow/i, /@font-face/i, /filter\s*:/i]) assert.ok(!bad.test(c), `styles.css uses ${bad}`);
  for (const m of c.matchAll(/border-radius\s*:\s*([^;]+);/g)) same(m[1].trim(), '0', 'square corners only');
  assert.ok(c.includes('system-ui') && c.includes('ui-monospace'));
  const keyframes = [...c.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual(keyframes, ['sheet-up'], 'only the pull-up motion; no flashing cues');
  assert.ok(!/transition\s*:/.test(c), 'no geometry transitions delaying visible state');
});

test('CSS: board text is at least 12 base px (14.4 CSS px at the default text size); fixed text at least 14 px', () => {
  const c = css();
  const scaled = [...c.matchAll(/calc\((\d+(?:\.\d+)?)px \* var\(--f\)\)\s*(?:\/|;|\s+var)/g)];
  const fontScaled = [...c.matchAll(/font(?:-size)?\s*:[^;]*?calc\((\d+(?:\.\d+)?)px \* var\(--f\)\)/g)].map((m) => Number(m[1]));
  assert.ok(fontScaled.length >= 20, `found ${fontScaled.length} scaled font sizes`);
  for (const n of fontScaled) assert.ok(n >= 12, `scaled font ${n} base px`);
  assert.ok(scaled.length > 0);
  const fixed = [...c.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  for (const n of fixed) assert.ok(n >= 14, `fixed font ${n}px`);
  assert.match(c, /--f: 1\.2;/, 'default factor matches the Standard text size (scale 7)');
});

test('Menu uses native labelled selects; foreground header alone uses labelled button/listbox pickers and the calendar dialog', () => {
  const menu = src('lib/menu.mjs');
  for (const need of ["'select'", "'option'", "'optgroup'", "'label'", "setAttribute('for'"]) assert.ok(menu.includes(need), `menu builds ${need}`);
  for (const [f,t] of texts) for (const role of ['listbox','combobox','menuitem', "'menu'"]) {
    if (rel(f)==='lib/header.mjs' && role==='listbox') continue;
    assert.ok(!t.includes(`role', ${role.startsWith("'") ? role : `'${role}'`}`), `${rel(f)} builds an unapproved ${role}`);
  }
  const header=src('lib/header.mjs');
  for (const need of ["'button'", "'listbox'", "'dialog'", "'aria-haspopup'", "'aria-expanded'", "'aria-controls'", "'aria-labelledby'", "'aria-selected'"]) assert.ok(header.includes(need), `header supplies ${need}`);
});

test('touch targets: the Menu button, sheet close, dropdowns, name field and buttons are at least 44 CSS px', () => {
  const c = css();
  for (const sel of ['.menu-btn', '.sheet-close', '.msel', '.mtext', '.mbtn']) {
    const m = c.match(new RegExp(`\\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`));
    assert.ok(m, sel);
    assert.match(m[1], /min-height: 44px/, `${sel} min-height`);
    assert.match(m[1], /min-width: 44px/, `${sel} min-width`);
  }
});

function same(a,b,msg) { const short=x=>x===null||typeof x!=='object'&&typeof x!=='function'?String(x).slice(0,160):'<object>'; assert.ok(a===b,msg||`${short(a)} !== ${short(b)}`); }
