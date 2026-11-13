import { uiChoose, uiControl, uiOptions, uiRow, uiValue } from './fake-dom.mjs';
// Behaviour tests for the score-first board, driven through the same event
// handlers the browser uses, on the fake DOM. These are model tests: they are
// not browser, Safari, device, touch or human-latency evidence.
// Earlier design changes these tests follow: the one Settings button and its
// three radio groups became the one Menu with native <select> controls, and
// the earlier "keep place if all three parts fit from the card's column" rule
// became "an open game always takes one full row at its place".
// These tests open games in place, which is the Phone presentation, so
// their 1440x900 board picks Phone explicitly (Auto would pick TV there). The
// TV details window and the Auto rule at real phone and TV sizes are tested in
// popup.test.mjs.
// Later design changes these tests follow: no game has a per-game More/Leaders
// button (each step is another activation of the score box or Enter); the NFL
// board keeps one fixed football order (favorites, in progress, upcoming,
// final) with no Order choice, so the start-time and live-first Order checks
// run on NBA; Right on a football game reaches its own favorite star.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWindow, FakeEvent } from './fake-dom.mjs';
import { mountBoard, DEFAULT_SETTINGS, scaleFor } from '../public/lib/board.mjs';
import { generateWeek, prng } from '../public/lib/fixtures.mjs';
import { isExpandable, sortGames, sortFootball } from '../public/lib/model.mjs';
import { TEXT_SIZES, ORDERS, OPEN_LIMITS } from '../public/lib/chrome.mjs';
import { optionsOf } from '../public/lib/menu.mjs';
import { dims, TEXT_FLOOR_PX, TOTALS_FLOOR_PX } from '../public/lib/sizing.mjs';

const NS = (id) => `nfl-2026-${id}`;
const BASE = generateWeek();
const KICKOFF_IDS = sortGames(BASE.games, 'kickoff').map((g) => NS(g.id));
const FOOTBALL_IDS = sortFootball(BASE.games).map((g) => NS(g.id)); // no favorites yet
const EXPANDABLE = sortGames(BASE.games, 'kickoff').filter(isExpandable).map((g) => NS(g.id));
const NOT_EXPANDABLE = sortGames(BASE.games, 'kickoff').filter((g) => !isExpandable(g)).map((g) => NS(g.id));
const ENGINEERING = /\bLC ?[1-4]\b|\bexpand ?[36]\b|\bviewport\b|\bDPR\b|\bmodel\b|\bJSON\b|\bcompar(e|ison)\b|\bG1\b|\bstage ?[123]\b|\bpreset|\bcandidate|\bscenario|\bDEL-\d|\bfixture|\bmetric/i;

function setup({ width = 1440, height = 900, search = '', seed, presentation = 'phone' } = {}) {
  const win = new FakeWindow({ width, height, search });
  const doc = win.document;
  const root = doc.createElement('div');
  root.id = 'app';
  doc.body.appendChild(root);
  const week = seed === undefined ? undefined : generateWeek({ seed });
  const app = mountBoard({ win, doc, root, week, presentation });
  return { win, doc, root, app };
}

const click = (el) => el.dispatchEvent(new FakeEvent('click'));
const press = (el, key, init = {}) => el.dispatchEvent(new FakeEvent('keydown', { key, ...init }));
function choose(app, key, value) { return uiChoose(app, key, value); }
const stages = (app) => new Map([...app.cards.keys()].map((id) => [id, app.expansion.stageOf(id)]));
const cellOf = (app, id) => app.layout.placements.find((p) => p.id === id);
const scoreText = (app, id) => app.cards.get(id).sections[1].byClass('status')[0];
const cardIdsInDom = (app) => app.board.children.filter((e) => e.tagName === 'ARTICLE').map((e) => e.getAttribute('data-id'));
const box = (p) => [p.x, p.y, p.w, p.h];
const boxes = (app) => new Map(app.layout.placements.map((p) => [p.id, box(p)]));

// The geometry the controller actually wrote on an element: translate, width, height.
function styleBox(el) {
  const m = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\)$/.exec(el.style.getPropertyValue('transform'));
  assert.ok(m, `transform ${el.style.getPropertyValue('transform')}`);
  return [Number(m[1]), Number(m[2]), parseFloat(el.style.getPropertyValue('width')), parseFloat(el.style.getPropertyValue('height'))];
}

// Full-row rule through the real handlers: the open card either kept its row
// start (it was first in its row) or moved once to the start of the next row;
// either way it spans the whole content width.
function placeOf(app, before, after) {
  const g = app.layout.frame;
  if (after.x !== g.insetX || after.w !== g.contentW) return 'other';
  if (after.y === before.y && before.x === g.insetX) return 'kept';
  if (after.y > before.y) return 'next-row';
  return 'other';
}

// Text a person or assistive technology can meet: visible text plus labels and
// titles, skipping hidden subtrees.
function shownText(node, out = []) {
  if (node.hidden) return out;
  for (const c of node.childNodes) {
    if (c.nodeType === 3) out.push(c.data);
    else shownText(c, out);
  }
  for (const a of ['aria-label', 'title', 'label']) {
    const v = node.getAttribute(a);
    if (v) out.push(v);
  }
  if (node.title) out.push(node.title);
  return out;
}

test('default page is the scoreboard: one quiet header with SIMULATED, one Menu control, closed sheet, no diagnostics', () => {
  const { doc, root, app, win } = setup();
  assert.deepEqual(root.children.map((e) => e.id), ['board', 'menu-scrim', 'menu', 'live']);
  same(doc.getElementById('diag'), null);
  same(app.dev, false);
  same(app.header.title.textContent, 'NFL · Week 11');
  same(app.header.sim.textContent, 'SIMULATED');
  const chromeButtons = app.board.all((e) => e.tagName === 'BUTTON' && !e.closest('.card') && !e.closest('.empty'));
  const shown = chromeButtons.filter(b => { for (let p = b; p; p = p.parentNode) if (p.hidden) return false; return true; });
  assert.deepEqual(shown.map(b => b.textContent), ['NFL', 'Week 11', 'All conferences', 'All divisions', 'Menu'], 'foreground choices and exactly one Menu');
  same(app.header.menuBtn.getAttribute('aria-haspopup'), 'dialog');
  same(app.menu.sheet.hidden, true);
  same(app.menu.scrim.hidden, true);
  same(app.empty.hidden, true);
  same(app.cards.size, 16);
  same(app.expansion.count(), 0);
  assert.deepEqual({ ...app.settings }, { ...DEFAULT_SETTINGS });
  assert.deepEqual(app.order, FOOTBALL_IDS, '010: the fixed football order');
  same(doc.title, 'Demo screen 1 · WTFScore · SIMULATED');
  assert.doesNotMatch(shownText(root).join('\n'), ENGINEERING);
  same(win.frameCalls + win.timerCalls + win.historyCalls, 0, 'startup schedules nothing and writes no URL');
});

test('one click on a score box changes exactly one game by exactly one stage, keeps focus there, and starts no timer', () => {
  for (const id of EXPANDABLE) {
    const { win, doc, app } = setup();
    const before = stages(app);
    const cell = { ...cellOf(app, id) };
    const applies = app.stats.applies;
    click(scoreText(app, id));
    const changed = [...stages(app)].filter(([k, v]) => before.get(k) !== v);
    assert.deepEqual(changed, [[id, 2]], id);
    same(app.stats.activations, 1);
    same(app.stats.pointer, 1);
    same(app.stats.transitions, 1);
    same(app.stats.applies, applies + 1, 'one layout pass');
    const ref = app.cards.get(id);
    same(doc.activeElement, ref.root, 'focus is on the same card');
    same(app.focusedId, id);
    same(ref.sections[2].hidden, false);
    same(ref.sections[3].hidden, true);
    same(ref.act, null, '010: no per-game More/Leaders button');
    assert.match(ref.root.getAttribute('aria-label'), /Situation open\. Enter shows leaders, Escape closes\.$/);
    const after = cellOf(app, id);
    const where = placeOf(app, cell, after);
    assert.ok(where === 'kept' || where === 'next-row', `${id}: kept its row start or moved once to the next row (${where})`);
    same(after.place, where);
    same(where === 'kept', cell.col === 0, 'only a card that was first in its row keeps its place');
    same(after.w, app.layout.frame.contentW, 'an open game spans the whole row');
    same(win.frameCalls + win.timerCalls, 0, 'no frame or timer scheduled');
    same(win.historyCalls, 0, 'no URL write');
    assert.match(app.live.textContent, /situation open/);
  }
});

test('a pregame, postponed or unknown game ignores activation: no state change, focus kept, reason announced', () => {
  same(NOT_EXPANDABLE.length, 6);
  for (const id of NOT_EXPANDABLE) {
    const { doc, app, win } = setup();
    click(scoreText(app, id));
    press(app.cards.get(id).root, 'Enter');
    same(app.stats.transitions, 0, id);
    same(app.stats.noChange, 2);
    same(app.expansion.count(), 0);
    same(doc.activeElement, app.cards.get(id).root);
    assert.match(app.live.textContent, /no details/);
    same(app.cards.get(id).act, null, 'no open control');
    same(win.frameCalls + win.timerCalls, 0);
  }
});

test('no per-game More or Leaders button; each score-box activation is one step (situation, leaders, close); the situation close button collapses in one press', () => {
  const { app, doc } = setup();
  const id = EXPANDABLE[3];
  const ref = app.cards.get(id);
  same(ref.act, null);
  assert.deepEqual(ref.root.all((e) => e.tagName === 'BUTTON').map((b) => b.getAttribute('data-action')), ['favorite', 'collapse'], 'only the football star and the situation close button');
  assert.ok(ref.root.all((e) => e.tagName === 'BUTTON').every((b) => !['more', 'leaders'].includes(b.textContent)), 'no More or Leaders button text');
  assert.match(ref.root.getAttribute('aria-label'), /Details closed\. Enter shows the situation\.$/);
  click(scoreText(app, id));
  same(app.expansion.stageOf(id), 2);
  assert.match(ref.root.getAttribute('aria-label'), /Situation open\. Enter shows leaders/);
  click(scoreText(app, id));
  same(app.expansion.stageOf(id), 3);
  same(ref.sections[3].hidden, false, 'the leaders content is still there');
  assert.ok(ref.sections[3].byClass('ldr').length >= 3);
  assert.match(ref.root.getAttribute('aria-label'), /Situation and leaders open\. Enter closes/);
  click(scoreText(app, id));
  same(app.expansion.stageOf(id), 1);
  same(ref.sections[2].hidden, true);
  click(scoreText(app, id));
  click(scoreText(app, id));
  const closeBtn = ref.sections[2].all((e) => e.getAttribute('data-action') === 'collapse')[0];
  same(closeBtn.textContent, 'close');
  click(closeBtn);
  same(app.expansion.stageOf(id), 1);
  same(app.stats.activations, 6);
  same(app.stats.transitions, 6);
  same(app.stats.pointer, 5);
  same(app.stats.button, 1);
  same(doc.activeElement, ref.root);
  click(scoreText(app, id));
  click(ref.sections[2].children[1]); // a click inside open details only focuses the game
  same(app.expansion.stageOf(id), 2);
  same(app.stats.activations, 7);
});

test('keyboard: Enter and Space step forward, Escape steps back, arrows move focus spatially, focus stays on the card', () => {
  const { doc, app } = setup();
  // The fixed football order puts games in progress first; its first game is the one opened here.
  const id = app.order[0];
  assert.ok(EXPANDABLE.includes(id));
  const ref = app.cards.get(id);
  ref.root.focus();
  same(doc.activeElement, ref.root);
  press(ref.root, 'Enter');
  same(app.expansion.stageOf(id), 2);
  press(ref.root, ' ');
  same(app.expansion.stageOf(id), 3);
  press(ref.root, 'Escape');
  same(app.expansion.stageOf(id), 2);
  press(ref.root, 'Escape');
  same(app.expansion.stageOf(id), 1);
  same(doc.activeElement, ref.root);
  same(app.stats.key, 4);
  same(app.stats.transitions, 4);
  press(ref.root, 'Enter', { repeat: true });
  same(app.expansion.stageOf(id), 1, 'a held key repeating does not step again');
  // The card's inner button is its favorite star (no More/Leaders button).
  const game = app.view.games.find((g) => g.id === id);
  ref.fav.focus();
  same(press(ref.fav, 'Enter'), true, 'Enter on an inner button is left to the button');
  same(app.expansion.stageOf(id), 1, 'no step from the keydown itself');
  same(app.favorites.isFavorite(game), false, 'no favorite change from the keydown itself');
  click(ref.fav, { detail: 0 }); // the button's own click
  same(app.expansion.stageOf(id), 1, 'the star never steps the game');
  same(app.favorites.isFavorite(game), true, 'exactly one favorite change for one Enter on the star');
  same(app.stats.favoriteToggles, 1);
  click(ref.fav, { detail: 0 });
  same(app.favorites.override(id), null, 'back to following its teams');
  ref.root.focus();
  press(ref.root, 'Enter');
  same(app.expansion.stageOf(id), 2);
  same(doc.activeElement, ref.root);

  const ids = app.order;
  const at = (i) => app.cards.get(ids[i]).root;
  same(app.layout.frame.cols, 4);
  same(ids[0], id, 'the open game is the first on the board');
  assert.deepEqual([cellOf(app, ids[0]).span, cellOf(app, ids[1]).row, cellOf(app, ids[1]).col], [4, 1, 0], 'the open card takes the whole first row; the next game starts the next row');
  at(0).focus();
  const before = stages(app);
  press(doc.activeElement, 'ArrowDown');
  same(doc.activeElement, at(1), 'down from the full-row card goes to the first game below it');
  press(doc.activeElement, 'ArrowRight');
  same(doc.activeElement, app.cards.get(ids[1]).fav, '010: Right on a football game reaches its own star');
  press(doc.activeElement, 'ArrowRight');
  same(doc.activeElement, at(2), '010: Right from the star moves as Right from its game');
  press(doc.activeElement, 'ArrowDown');
  same(doc.activeElement, at(6), 'down goes to the same column of the next row');
  press(doc.activeElement, 'ArrowLeft');
  same(doc.activeElement, at(5));
  press(doc.activeElement, 'ArrowUp');
  same(doc.activeElement, at(1));
  press(doc.activeElement, 'ArrowUp');
  same(doc.activeElement, at(0), 'up from the row below reaches the full-row card');
  assert.deepEqual(stages(app), before, 'arrows never change a game');
  same(app.stats.arrowMoves, 7);
  for (const [cid, r] of app.cards) same(r.root.tabIndex, 0, `${cid} is in the Tab order`);
  same(app.header.menuBtn.tabIndex, 0);
});

test('Escape on a closed card steps back the most recently opened game; focus stays where it was', () => {
  const { doc, app } = setup();
  const [a, b] = EXPANDABLE;
  click(scoreText(app, a));
  click(scoreText(app, b));
  const pre = NOT_EXPANDABLE[0];
  app.cards.get(pre).root.focus();
  press(doc.activeElement, 'Escape');
  same(app.expansion.stageOf(b), 1);
  same(app.expansion.stageOf(a), 2);
  same(doc.activeElement, app.cards.get(pre).root);
});

test('the same keyed card elements persist through open, order, text size, open-limit and badge changes; nothing is rebuilt', () => {
  const { doc, app } = setup();
  const before = new Map([...app.cards].map(([id, ref]) => [id, ref.root]));
  const articles = () => doc.created.filter((e) => e.tagName === 'ARTICLE').length;
  same(articles(), 16);
  const focusId = EXPANDABLE[2];
  click(scoreText(app, focusId));
  click(app.header.menuBtn);
  const created = doc.created.length;
  choose(app, 'order', 'status');
  choose(app, 'textSize', 'largest');
  choose(app, 'openLimit', '1');
  choose(app, 'badges', 'on');
  press(doc.activeElement, 'Escape');
  for (const [id, el] of before) {
    same(app.cards.get(id).root, el, id);
    assert.ok(el.isConnected);
    same(el.getAttribute('data-id'), id);
  }
  same(articles(), 16, 'no card element created after mount');
  same(doc.created.length, created, 'no element of any kind created by these choices');
  assert.deepEqual(cardIdsInDom(app), app.order, 'document order follows display order');
  same(doc.activeElement, app.cards.get(focusId).root, 'focus returned to the same card');
});

test('Full row through the handlers: each open takes a whole row at its place; earlier games stay; leaders move nothing; closing restores the board', () => {
  const tally = {};
  for (const width of [390, 960, 1280, 1440, 1920]) {
    for (const id of EXPANDABLE) {
      const { app } = setup({ width });
      const base = boxes(app);
      const baseCell = { ...cellOf(app, id) };
      click(scoreText(app, id));
      const s2 = boxes(app);
      const open = cellOf(app, id);
      const where = placeOf(app, baseCell, open);
      assert.ok(where === 'kept' || where === 'next-row', `${width} ${id}: ${where}`);
      tally[`${width} ${where}`] = (tally[`${width} ${where}`] ?? 0) + 1;
      for (const p of app.layout.placements) {
        if (p.sortedIndex < baseCell.sortedIndex) assert.deepEqual(s2.get(p.id), base.get(p.id), `${width} ${id}: earlier ${p.id} moved`);
        if (p.sortedIndex > baseCell.sortedIndex) assert.ok(p.y >= open.y + open.h, `${width} ${id}: later ${p.id} is not below the open card`);
        if (p.id !== id) assert.ok(p.y + p.h <= open.y + 0.01 || p.y >= open.y + open.h - 0.01, `${width} ${id}: ${p.id} shares the open card's row`);
      }
      click(scoreText(app, id));
      same(app.expansion.stageOf(id), 3);
      assert.deepEqual(boxes(app), s2, `${width} ${id}: showing leaders moved a card`);
      click(scoreText(app, id));
      same(app.expansion.stageOf(id), 1);
      assert.deepEqual(boxes(app), base, `${width} ${id}: closing restores every card`);
    }
  }
  console.log(`full-row handler placement: ${JSON.stringify(tally)}`);
});

test('one connected card in the DOM: open parts are placed inside the game card, side by side when they fit, with no separate band element', () => {
  for (const [width, want] of [[1920, 'ltr'], [1280, 'ltr'], [960, 'ltr'], [390, 'stack']]) {
    const { app } = setup({ width });
    const id = EXPANDABLE.find((x) => cellOf(app, x).col === 0);
    const ref = app.cards.get(id);
    const kids = app.board.children.length;
    for (const stage of [2, 3]) {
      click(scoreText(app, id)); // the next step is another activation of the score box
      const p = cellOf(app, id);
      same(ref.root.getAttribute('data-arrangement'), want, `${width} stage ${stage}`);
      assert.deepEqual(styleBox(ref.root), [p.x, p.y, p.w, p.h].map((v) => Math.round(v * 100) / 100));
      const shown = [1, 2, 3].filter((s) => !ref.sections[s].hidden);
      assert.deepEqual(shown, stage === 2 ? [1, 2] : [1, 2, 3]);
      const rects = shown.map((s) => styleBox(ref.sections[s]));
      let area = 0;
      rects.forEach(([x, y, w, h], i) => {
        area += w * h;
        assert.ok(x >= -0.01 && y >= -0.01 && x + w <= p.w + 0.02 && y + h <= p.h + 0.02, `${width} part ${shown[i]} inside its card`);
        const next = rects[i + 1];
        if (!next) return;
        if (want === 'ltr') assert.ok(Math.abs(next[0] - (x + w)) <= 0.02 && next[1] === y, `${width} parts adjacent left to right`);
        else assert.ok(Math.abs(next[1] - (y + h)) <= 0.02 && next[0] === x, `${width} parts stacked in the card`);
      });
      assert.ok(Math.abs(area - p.w * p.h) <= 2, `${width} stage ${stage}: parts fill the card with no empty block`);
      same(app.board.children.length, kids, 'no element added for details');
    }
  }
});

test('Games open at once (LRU): the default 3 closes the least recently opened; 1 gives one at a time', () => {
  const { app } = setup();
  const [a, b, c, d] = EXPANDABLE;
  for (const id of [a, b, c]) click(scoreText(app, id));
  assert.deepEqual(app.expansion.expandedIds(), [a, b, c]);
  click(scoreText(app, d));
  assert.deepEqual(app.expansion.expandedIds(), [b, c, d]);
  assert.match(app.live.textContent, /closed .* \(games open at once: 3\)/);
  same(app.cards.get(a).sections[2].hidden, true);
  same(cellOf(app, a).stage, 1, 'the closed game is compact again');
  app.openMenu();
  choose(app, 'openLimit', '1');
  assert.deepEqual(app.expansion.expandedIds(), [d]);
  app.closeMenu();
  click(scoreText(app, a));
  assert.deepEqual(app.expansion.expandedIds(), [a]);
  same(app.cards.get(d).sections[2].hidden, true);
  assert.match(app.cards.get(d).root.getAttribute('aria-label'), /Details closed\. Enter shows the situation\.$/);
});

test('Order: football keeps one fixed order from any shuffled input (in progress, upcoming, final, other), with no Order choice; NBA keeps start time and live games first', () => {
  for (const seed of [1, 2, 3, 7, 99, 2026]) assert.deepEqual(setup({ seed }).app.order, FOOTBALL_IDS, `seed ${seed}`);
  const { app } = setup();
  assert.deepEqual(cardIdsInDom(app), FOOTBALL_IDS);
  const groups = app.order.map((id) => BASE.games.find((g) => NS(g.id) === id).status);
  assert.deepEqual(groups.slice(0, 6).sort(), ['delayed', 'live', 'live', 'live', 'live', 'live'], 'the six in-progress games come first');
  same(groups[groups.length - 1], 'unknown', 'unknown status sorts last');
  const firstFinal = groups.indexOf('final');
  const lastLive = Math.max(groups.lastIndexOf('live'), groups.lastIndexOf('delayed'));
  const firstScheduled = groups.indexOf('scheduled');
  assert.ok(lastLive < firstScheduled && firstScheduled < firstFinal, 'in progress, then upcoming, then final');
  app.openMenu();
  same(app.menu.rows.get('order').hidden, true, 'no Order choice for football');
  choose(app, 'order', 'status');
  same(app.settings.order, 'kickoff', 'a stray Order change is refused on football');
  assert.deepEqual(app.order, FOOTBALL_IDS);
  // Other sports keep both orders (start time stable by id, live games first).
  choose(app, 'league', 'nba');
  same(app.menu.rows.get('order').hidden, false);
  const games = app.view.games;
  const kick = sortGames(games, 'kickoff').map((g) => g.id);
  assert.deepEqual(app.order, kick);
  choose(app, 'order', 'status');
  const want = sortGames(games, 'status').map((g) => g.id);
  assert.deepEqual(app.order, want);
  assert.deepEqual(cardIdsInDom(app), want);
  const st = app.order.map((id) => games.find((g) => g.id === id).status);
  const rank = { live: 0, halftime: 0, end_period: 0, delayed: 0, suspended: 0, scheduled: 1, postponed: 1, final: 2 };
  for (let i = 1; i < st.length; i++) assert.ok((rank[st[i - 1]] ?? 3) <= (rank[st[i]] ?? 3), 'in progress, then upcoming, then final, then other');
  choose(app, 'order', 'kickoff');
  assert.deepEqual(app.order, kick);
  assert.deepEqual(cardIdsInDom(app), kick);
});

test('Order change keeps open games in their place and keeps them open', () => {
  // Football has no Order choice, so this runs on NBA (pins still apply there).
  const { app } = setup();
  app.openMenu();
  choose(app, 'league', 'nba');
  app.closeMenu();
  const id = app.order.filter((x) => isExpandable(app.view.games.find((g) => g.id === x))).find((x, i, list) => {
    const status = (y) => app.view.games.find((g) => g.id === y).status;
    return status(x) === 'final' && list.some((y) => ['live', 'halftime', 'end_period'].includes(status(y)) && app.order.indexOf(y) > app.order.indexOf(x));
  });
  assert.ok(id, 'an open final game that live-first would otherwise move');
  click(scoreText(app, id));
  const index = app.order.indexOf(id);
  const unpinned = sortGames(app.view.games, 'status').map((g) => g.id).indexOf(id);
  notSame(unpinned, index, 'without its pin the game would move');
  app.openMenu();
  choose(app, 'order', 'status');
  same(app.order.indexOf(id), index);
  same(app.expansion.stageOf(id), 2);
});

test('Menu opens on one activation, moves focus to its first control and makes the page behind inert', () => {
  const { doc, app, win } = setup();
  const btn = app.header.menuBtn;
  same(btn.getAttribute('aria-expanded'), 'false');
  click(btn);
  same(app.menuOpen, true);
  same(app.menu.sheet.hidden, false);
  same(app.menu.scrim.hidden, false);
  same(app.board.hasAttribute('inert'), true);
  same(btn.getAttribute('aria-expanded'), 'true');
  same(doc.activeElement, app.menu.selects.get('favorites'));
  same(app.stats.settingsOpened, 1);
  click(btn);
  same(app.stats.settingsOpened, 1, 'a second open while open is a no-op');
  app.cards.get(EXPANDABLE[0]).root.focus();
  same(doc.activeElement, app.menu.selects.get('favorites'), 'cards behind the sheet cannot take focus');
  same(win.frameCalls + win.timerCalls, 0);
});

test('Menu: native labelled selects for every choice, a screen-name field, and one Close button', () => {
  const { app } = setup();
  const s = app.menu.sheet;
  same(s.getAttribute('role'), 'dialog');
  same(s.getAttribute('aria-modal'), 'true');
  same(s.getAttribute('aria-labelledby'), 'menu-title');
  for (const [key, sel] of app.menu.selects) {
    same(sel.tagName, 'SELECT', key);
    const label = app.menu.labels.get(key);
    same(label.tagName, 'LABEL');
    same(label.getAttribute('for'), sel.id);
    assert.ok(label.textContent.length > 2, `${key} has a human label`);
    same(sel.tabIndex, 0);
  }
  const visible = [...app.menu.rows].filter(([, r]) => !r.hidden).map(([k]) => k);
  assert.deepEqual(visible, ['favorites', 'textSize', 'openLimit', 'zone', 'badges', 'presentation', 'screen'], 'NFL shows sport, conference, division and (010) Favorite teams; the Date row, Order (010: football) and other league filters are hidden');
  assert.deepEqual(optionsOf(app.menu.selects.get('textSize')).map((o) => o.textContent), TEXT_SIZES.map((t) => t.label));
  assert.deepEqual(optionsOf(app.menu.selects.get('openLimit')).map((o) => o.textContent), OPEN_LIMITS.map(String));
  assert.deepEqual(optionsOf(app.menu.selects.get('order')).map((o) => o.textContent), ORDERS.map((o) => o.label));
  same(app.menu.nameInput.tagName, 'INPUT');
  same(app.menu.nameInput.getAttribute('maxlength'), '32');
  // The Date button and its calendar are also in the sheet, hidden for football.
  assert.deepEqual(s.all((e) => e.tagName === 'BUTTON' && !e.closest('.cal') && e !== uiControl(app, 'period')).map((b) => b.getAttribute('aria-label') || b.textContent), ['Close menu', 'Clear filters']);
  same(uiControl(app, 'period').getAttribute('aria-haspopup'), 'listbox', 'a football week uses the foreground listbox');
  same(app.header.calendar.root.hidden, true);
  same(s.all((e) => e.tagName === 'INPUT' && e.type === 'radio').length, 0, 'no radio groups remain');
});

for (const [how, act] of [
  ['Escape', (app, doc) => press(doc.activeElement, 'Escape')],
  ['the GoBack key', (app, doc) => press(doc.activeElement, 'GoBack')],
  ['the Close button', (app) => click(app.menu.closeBtn)],
  ['a click outside the sheet', (app) => click(app.menu.scrim)],
]) {
  test(`Menu closes with ${how} and focus returns to the game that had it`, () => {
    const { doc, app } = setup();
    const ref = app.cards.get(EXPANDABLE[1]);
    click(scoreText(app, EXPANDABLE[1]));
    click(app.header.menuBtn);
    act(app, doc);
    same(app.menuOpen, false);
    same(app.menu.sheet.hidden, true);
    same(app.menu.scrim.hidden, true);
    same(app.board.hasAttribute('inert'), false);
    same(app.header.menuBtn.getAttribute('aria-expanded'), 'false');
    same(doc.activeElement, ref.root);
    same(app.stats.settingsClosed, 1);
    same(app.expansion.stageOf(EXPANDABLE[1]), 2, 'closing the menu does not touch games');
  });
}

test('with nothing focused before, closing the Menu returns focus to the Menu button', () => {
  const { doc, app } = setup();
  click(app.header.menuBtn);
  press(doc.activeElement, 'Escape');
  same(doc.activeElement, app.header.menuBtn);
});

test('closed Menu content cannot take focus, and every card starts with its details hidden', () => {
  const { doc, app } = setup();
  for (const input of app.menu.sheet.all((e) => ['INPUT', 'BUTTON', 'SELECT'].includes(e.tagName))) {
    input.focus();
    notSame(doc.activeElement, input);
  }
  for (const ref of app.cards.values()) {
    same(ref.sections[2].hidden, true);
    same(ref.sections[3].hidden, true);
  }
});

test('Text size: every offered size keeps text >= 14 px and totals >= 28 px; changing it re-scales the same elements', () => {
  for (const t of TEXT_SIZES) {
    const d = dims(t.scale);
    assert.ok(d.minText >= TEXT_FLOOR_PX, `${t.label} smallest text ${d.minText}`);
    assert.ok(d.totalText >= TOTALS_FLOOR_PX, `${t.label} totals ${d.totalText}`);
  }
  same(TEXT_SIZES[0].value, DEFAULT_SETTINGS.textSize);
  const { app } = setup();
  same(app.board.style.getPropertyValue('--f'), String(dims(7).f));
  same(app.layout.scale, scaleFor('standard'));
  app.openMenu();
  choose(app, 'textSize', 'larger');
  same(app.board.style.getPropertyValue('--f'), String(dims(9).f));
  same(app.layout.scale, 9);
  same(app.stats.settingsChanges, 1);
  choose(app, 'textSize', 'larger');
  same(app.stats.settingsChanges, 1, 'choosing the current value is not a change');
});

test('old links with layout, scale, cap, panel, view or preset parameters open the normal quiet board', () => {
  const searches = [
    '?candidate=LC2&scale=3&cap=6&preset=d1280&expandedcount=6&sort=status&stage=2',
    '?panel=compare',
    '?panel=measure',
    '?panel=g1&view=full',
    '?view=board',
    '?league=nba&period=finals',
    '?devdiag=0',
    '?devdiag=true',
    '?diag=1',
  ];
  for (const search of searches) {
    const { doc, app, root } = setup({ search });
    same(app.dev, false, search);
    same(doc.getElementById('diag'), null, search);
    same(app.expansion.count(), 0, search);
    assert.deepEqual({ ...app.settings }, { ...DEFAULT_SETTINGS }, search);
    assert.deepEqual(app.order, FOOTBALL_IDS, search);
    assert.doesNotMatch(shownText(root).join('\n'), ENGINEERING, search);
  }
});

test('normal use shows no engineering words and no link to diagnostics, even with details and the Menu open', () => {
  const { root, app } = setup();
  for (const id of EXPANDABLE.slice(0, 3)) {
    click(scoreText(app, id));
    click(scoreText(app, id));
  }
  click(app.header.menuBtn);
  const text = shownText(root).join('\n');
  assert.doesNotMatch(text, ENGINEERING);
  assert.doesNotMatch(text, /devdiag|diagnostic/i);
});

test('normal input path: 300 mixed inputs schedule no frame, timer or URL write; one layout pass per real change', () => {
  const { win, doc, app } = setup();
  const rnd = prng(404);
  const keys = ['textSize', 'openLimit', 'order', 'badges', 'zone', 'division', 'conference'];
  for (let i = 0; i < 300; i++) {
    const ids = [...app.cards.keys()];
    const id = ids[Math.floor(rnd() * ids.length)];
    const ref = app.cards.get(id);
    const r = rnd();
    if (app.menuOpen) {
      const key = keys[Math.floor(rnd() * keys.length)];
      const vals = uiOptions(app, key).map((o) => o.value);
      if (r < 0.7 && !uiRow(app, key).hidden) choose(app, key, vals[Math.floor(rnd() * vals.length)]);
      else press(doc.activeElement, 'Escape');
    } else if (!ref) continue;
    else if (r < 0.35) click(ref.sections[1].byClass('status')[0]);
    else if (r < 0.5 && ref.fav) click(ref.fav); // the star (there is no More/Leaders button)
    else if (r < 0.7) {
      ref.root.focus();
      press(ref.root, ['Enter', ' ', 'Escape', 'ArrowRight', 'ArrowDown'][Math.floor(rnd() * 5)]);
    } else if (r < 0.75) click(app.header.menuBtn);
    else click(ref.sections[1].byClass('trow')[0]);
  }
  same(win.frameCalls + win.timerCalls + win.historyCalls, 0);
  assert.ok(app.stats.favoriteToggles > 0, '010: the walk used the star');
  same(app.stats.applies, 1 + app.stats.transitions + app.stats.settingsChanges + app.stats.favoriteToggles, 'mount plus exactly one pass per change');
  assert.ok(app.stats.transitions > 50 && app.stats.settingsChanges > 0, `${app.stats.transitions} state changes, ${app.stats.settingsChanges} menu changes`);
  assert.ok(app.expansion.count() <= app.settings.openLimit);
});

test('developer diagnostics exist only with devdiag=1, read the same handlers, and are the only code that schedules timing work', () => {
  const { doc, win, app } = setup({ search: '?devdiag=1' });
  same(app.dev, true);
  const diagEl = doc.getElementById('diag');
  assert.ok(diagEl);
  same(diagEl.getAttribute('aria-label'), 'Developer diagnostics');
  win.flush();
  const id = EXPANDABLE[0];
  const frames = win.frameCalls;
  click(scoreText(app, id));
  same(win.frameCalls, frames + 1, 'one next-paint probe per activation');
  win.flush();
  const line = (k) => doc.getElementById(`diag-${k}`).textContent;
  assert.match(line('counts'), /^activations 1 \(pointer 1, button 0, key 0\) · state changes 1 · no change 0/);
  assert.match(line('last'), new RegExp(`${id} 1 to 2`));
  assert.match(line('focus'), new RegExp(`focused game ${id} · active element game ${id} \\(card\\)`));
  assert.match(line('timing'), /handler [\d.]+ ms \(state [\d.]+ ms\) · input to next paint [\d.]+ ms/);
  assert.match(line('model'), /^model 1920x1080 at this text size: \d+\/16 fully visible/);
  assert.match(line('visible'), /not measured/);
  assert.ok(win.marks.some(([k, n]) => k === 'measure' && n === 'wtfscore-input-to-paint'));
  same(win.historyCalls, 0);
});

function same(a,b,msg) { const short=x=>x===null||typeof x!=='object'&&typeof x!=='function'?String(x).slice(0,160):'<object>'; assert.ok(a===b,msg||`${short(a)} !== ${short(b)}`); }

function notSame(a,b,msg) { assert.ok(a!==b,msg||'Expected different values or identities'); }
