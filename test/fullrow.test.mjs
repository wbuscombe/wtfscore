import { uiChoose, uiControl, uiOptions, uiRow, uiValue } from './fake-dom.mjs';
// Full-row expansion through the real controller handlers (click and the
// Menu's native dropdowns) at 1920, 1280, 960 and 390 CSS px and every offered
// text size, with several games open and after filter changes. Each expanded
// game must take one whole row at its place in the chosen order. The
// comparison is always against the same view with the same earlier-open
// state. These are model geometry tests; actual Safari pixels are not checked here.
// Opening in place is the Phone presentation. 390x844 stays on Auto (and
// must resolve to Phone); the wide windows, where Auto picks TV, choose Phone
// explicitly.
// Games have no per-game More/Leaders button; each later step is another
// activation of the same score box (the whole-card path the button duplicated).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWindow, FakeEvent } from './fake-dom.mjs';
import { mountBoard } from '../public/lib/board.mjs';
import { boardViolations, boardRects, computeBoardLayout } from '../public/lib/board-layout.mjs';
import { TEXT_SIZES } from '../public/lib/chrome.mjs';
import { isExpandable } from '../public/lib/model.mjs';
import { optionsOf } from '../public/lib/menu.mjs';

const WIDTHS = [[1920, 1080], [1280, 720], [960, 540], [390, 844]];
const EPS = 0.01;
function setup(width, height) {
  const win = new FakeWindow({ width, height });
  const doc = win.document;
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const tvByAuto = width > height && height >= 460;
  const app = mountBoard({ win, doc, root, presentation: tvByAuto ? 'phone' : 'auto' });
  same(app.mode, 'phone', `${width}x${height} opens games in place`);
  if (!tvByAuto) same(app.presentation, 'auto', `${width}x${height} is Phone on Auto`);
  return { win, doc, app };
}
const click = (el) => el.dispatchEvent(new FakeEvent('click'));
function choose(app, key, value) { return uiChoose(app, key, value); }
const box = (p) => [p.x, p.y, p.w, p.h];
const boxes = (app) => new Map(app.layout.placements.map((p) => [p.id, box(p)]));
const cell = (app, id) => app.layout.placements.find((p) => p.id === id);
const scoreOf = (app, id) => app.cards.get(id).sections[1].byClass('status')[0];
const openable = (app) => app.order.filter((id) => isExpandable(app.view.games.find((g) => g.id === id)));
// A division whose board has a game that can open.
function pickDivision(app) {
  for (const o of uiOptions(app, 'division')) {
    if (o.value === 'all') continue;
    const r = app.catalog.resolve({ ...app.view.view, filters: { ...app.view.view.filters, division: o.value } }, app.settings.zone);
    if (r.games.some(isExpandable)) return o.value;
  }
  throw new Error('no division with a game that can open');
}

// The full-row contract for one open game, checked on the layout the
// controller applied and on the CSS geometry it wrote to the card element.
function checkFullRow(app, id, before, label) {
  const L = app.layout;
  const g = L.frame;
  const p = cell(app, id);
  const prior = before.get(id);
  same(boardViolations(L).length, 0, `${label}: ${JSON.stringify(boardViolations(L).slice(0, 3))}`);
  assert.ok(Math.abs(p.x - g.insetX) < EPS && Math.abs(p.w - g.contentW) < EPS, `${label}: spans the whole content width`);
  const el = app.cards.get(id).root;
  same(el.style.getPropertyValue('width'), `${Math.round(p.w * 100) / 100}px`, `${label}: the element got the full width`);
  for (const q of L.placements) {
    if (q.id === id) continue;
    assert.ok(q.y + q.h <= p.y + EPS || q.y >= p.y + p.h - EPS, `${label}: ${q.id} is in the open card's row`);
    if (q.sortedIndex < p.sortedIndex) assert.deepEqual(box(q), before.get(q.id), `${label}: earlier ${q.id} moved`);
    else assert.ok(q.y >= p.y + p.h - EPS, `${label}: later ${q.id} is not below`);
  }
  if (Math.abs(prior[0] - g.insetX) < EPS) assert.ok(Math.abs(p.y - prior[1]) < EPS, `${label}: first in its row, so it kept its row`);
  else assert.ok(p.y > prior[1] + EPS, `${label}: moved once to the start of the next row`);
  const read = [...L.placements].sort((a, b) => (Math.abs(a.y - b.y) > 0.5 ? a.y - b.y : a.x - b.x)).map((x) => x.id);
  assert.deepEqual(read, app.order, `${label}: reading order is the chosen order, no backfill`);
  for (const r of boardRects(L)) assert.ok(r.x >= -EPS && r.x + r.w <= L.viewport.w + EPS, `${label}: ${r.id} ${r.part} inside the page width`);
}

test('every width and offered text size: first, middle and last games of a row each open into one full row; stage 3 moves nothing; close restores', () => {
  let n = 0;
  const tally = {};
  for (const [w, h] of WIDTHS) {
    for (const t of TEXT_SIZES) {
      const { app } = setup(w, h);
      app.openMenu();
      choose(app, 'textSize', t.value);
      app.closeMenu();
      const closed = boxes(app);
      const cols = app.layout.frame.cols;
      const rowOf = (id) => cell(app, id).row;
      const picks = new Set();
      for (const id of openable(app)) {
        const c = cell(app, id);
        if (c.col === 0 || c.col === cols - 1 || c.col === Math.floor((cols - 1) / 2)) picks.add(id);
      }
      for (const id of picks) {
        const label = `${w} ${t.value} ${id} col ${cell(app, id).col} row ${rowOf(id)}`;
        click(scoreOf(app, id));
        checkFullRow(app, id, closed, label);
        const s2 = boxes(app);
        click(scoreOf(app, id));
        same(app.expansion.stageOf(id), 3);
        assert.deepEqual(boxes(app), s2, `${label}: the second activation moved something`);
        click(scoreOf(app, id));
        assert.deepEqual(boxes(app), closed, `${label}: closing restores the compact board`);
        const k = `${w} ${cell(app, id).col === 0 ? 'kept' : 'next-row'}`;
        tally[k] = (tally[k] ?? 0) + 1;
        n++;
      }
    }
  }
  console.log(`controller full-row opens: ${n} ${JSON.stringify(tally)}`);
  assert.ok(n >= 40);
});

test('several open games at once: each opens against the same view and earlier-open state; the board matches the model layout', () => {
  for (const [w, h] of WIDTHS) {
    for (const t of [TEXT_SIZES[0], TEXT_SIZES[3]]) {
      const { app } = setup(w, h);
      app.openMenu();
      choose(app, 'textSize', t.value);
      choose(app, 'openLimit', '6');
      app.closeMenu();
      const ids = openable(app);
      const picks = [ids[1], ids[4], ids[7], ids[9]].filter(Boolean);
      for (const id of picks) {
        const before = boxes(app);
        click(scoreOf(app, id));
        checkFullRow(app, id, before, `${w} ${t.value} multi ${id}`);
        const model = computeBoardLayout({ items: app.order.map((x) => ({ id: x, stage: app.expansion.stageOf(x) })), viewport: app.layout.viewport, scale: app.layout.scale, headerHeight: app.layout.frame.header.h });
        assert.deepEqual(app.layout.placements.map(box), model.placements.map(box));
      }
      for (const id of picks) {
        const before = boxes(app);
        click(scoreOf(app, id));
        assert.deepEqual(boxes(app), before, `${w} ${t.value} ${id} leaders moved a card`);
      }
      same(app.expansion.count(), picks.length);
    }
  }
});

test('after filter, league and order changes the full-row rule still holds, with stable card elements per view', () => {
  for (const [w, h] of WIDTHS) {
    const { app, doc } = setup(w, h);
    for (const step of [
      () => choose(app, 'conference', 'nfc'),
      () => choose(app, 'division', pickDivision(app)),
      () => choose(app, 'league', 'nba'),
      () => choose(app, 'league', 'mlb'),
      () => choose(app, 'order', 'status'),
      () => choose(app, 'league', 'ncaab'),
      () => choose(app, 'league', 'nhl'),
    ]) {
      app.openMenu();
      step();
      app.closeMenu();
      const ids = openable(app);
      assert.ok(ids.length > 0);
      const id = ids[Math.min(ids.length - 1, 2)];
      const el = app.cards.get(id).root;
      const before = boxes(app);
      click(scoreOf(app, id));
      checkFullRow(app, id, before, `${w} ${app.view.league.id} ${id}`);
      same(app.cards.get(id).root, el, 'same element after opening');
      same(doc.activeElement, el, 'focus stays on the opened game');
      click(scoreOf(app, id));
      click(scoreOf(app, id));
    }
  }
});

test('a filter change keeps the open games that remain open and in full rows, and closes the ones that left', () => {
  const { app } = setup(1280, 720);
  const ids = openable(app);
  for (const id of ids.slice(0, 3)) click(scoreOf(app, id));
  const open = app.expansion.expandedIds();
  app.openMenu();
  choose(app, 'conference', 'afc');
  app.closeMenu();
  const still = open.filter((id) => app.cards.has(id));
  const gone = open.filter((id) => !app.cards.has(id));
  assert.deepEqual(app.expansion.expandedIds(), still);
  for (const id of gone) same(app.expansion.stageOf(id), 1);
  same(boardViolations(app.layout).length, 0);
  for (const id of still) same(cell(app, id).w, app.layout.frame.contentW);
});

test('intentional LRU autocollapse: opening one more than the limit closes the least recently opened game back to compact', () => {
  const { app } = setup(1920, 1080);
  app.openMenu();
  choose(app, 'openLimit', '2');
  app.closeMenu();
  const [a, b, c] = openable(app);
  click(scoreOf(app, a));
  click(scoreOf(app, b));
  const before = boxes(app);
  click(scoreOf(app, c));
  assert.deepEqual(app.expansion.expandedIds(), [b, c]);
  same(cell(app, a).stage, 1);
  same(app.cards.get(a).sections[2].hidden, true);
  assert.match(app.live.textContent, /closed .* \(games open at once: 2\)/);
  same(boardViolations(app.layout).length, 0);
  assert.notDeepEqual(boxes(app).get(a), before.get(a), 'the autocollapsed game returned to a compact cell');
});

test('scrolling: opening a fully visible game does not scroll; a game near the bottom scrolls only enough to show it, never past its top', () => {
  const { app, win } = setup(1280, 720);
  const ids = openable(app);
  click(scoreOf(app, ids[0]));
  same(win.scrolls.length, 0, 'the first game is visible: no scroll');
  click(scoreOf(app, ids[0]));
  click(scoreOf(app, ids[0]));
  const low = ids.filter((id) => cell(app, id).y + cell(app, id).h <= 720).pop();
  const lowTop = cell(app, low).y;
  click(scoreOf(app, low));
  const p = cell(app, low);
  const dy = win.scrolls.reduce((s, [, y]) => s + y, 0);
  if (p.y + p.h + app.layout.frame.gap > 720) {
    assert.ok(dy > 0 && dy <= p.y - app.layout.frame.gap, 'scrolled down, no further than the card top');
    assert.ok(Math.abs(dy - Math.min(p.y + p.h + app.layout.frame.gap - 720, p.y - app.layout.frame.gap)) < 1, 'only the minimum needed');
  } else same(dy, 0);
  assert.ok(lowTop >= 0);
});

function same(a,b,msg) { const short=x=>x===null||typeof x!=='object'&&typeof x!=='function'?String(x).slice(0,160):'<object>'; assert.ok(a===b,msg||`${short(a)} !== ${short(b)}`); }
