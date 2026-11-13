import { uiChoose, uiControl, uiOptions, uiRow, uiValue } from './fake-dom.mjs';
// The TV details window and the Auto/TV/Phone presentation, driven through the
// real board handlers on the fake DOM with a fixed clock. These are model
// tests of handlers, state, focus and geometry numbers; they are not browser
// pixels, Safari keyboard, Android TV remote or human evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWindow, FakeEvent } from './fake-dom.mjs';
import { mountBoard } from '../public/lib/board.mjs';
import { LEAGUES } from '../public/lib/catalog.mjs';
import { isExpandable } from '../public/lib/model.mjs';
import { presentationFor, PANELS, PRESENTATIONS, popupLayout, HINT, TV_MIN_HEIGHT } from '../public/lib/popup.mjs';
import { TEXT_SIZES } from '../public/lib/chrome.mjs';
import { optionsOf } from '../public/lib/menu.mjs';
import { TEAM_STAT_ROWS, teamStatRows, sportOf } from '../public/lib/sports.mjs';
import { TEXT_FLOOR_PX, TOTALS_FLOOR_PX } from '../public/lib/sizing.mjs';

const NOW = Date.parse('2026-11-12T20:30:00Z'); // fixed clock: Thu Nov 12, 2:30 PM Central
const PHONE = [[390, 844], [430, 932], [844, 390], [932, 430], [956, 440], [820, 1180], [960, 960]];
const TV = [[853, 480], [959, 540], [960, 480], [960, 540], [961, 960], [1280, 720], [1920, 1080]];

function setup({ width = 1920, height = 1080, presentation } = {}) {
  const win = new FakeWindow({ width, height, now: NOW });
  const doc = win.document;
  const root = doc.createElement('div');
  root.id = 'app';
  doc.body.appendChild(root);
  const app = mountBoard({ win, doc, root, ...(presentation ? { presentation } : {}) });
  return { win, doc, root, app };
}
const click = (el, init = {}) => el.dispatchEvent(new FakeEvent('click', init));
const key = (el, k, init = {}) => el.dispatchEvent(new FakeEvent('keydown', { key: k, ...init }));
const keyup = (el, k) => el.dispatchEvent(new FakeEvent('keyup', { key: k }));
const same = (a, b, msg) => assert.ok(a === b, msg); // never ask assert to diff two DOM nodes
function choose(app, k, value) { return uiChoose(app, k, value); }
function toLeague(app, id) {
  app.openMenu();
  choose(app, 'league', id);
  app.closeMenu();
}
const gameOf = (app, id) => app.view.games.find((g) => g.id === id);
const openable = (app) => app.order.filter((id) => isExpandable(gameOf(app, id)));
const scoreBox = (app, id) => app.cards.get(id).sections[1].byClass('status')[0];
const tabbable = (doc) => doc.documentElement.all((e) => e.focusable() && e.tabIndex >= 0);
const open = (app, doc, id) => {
  app.cards.get(id).root.focus();
  key(app.cards.get(id).root, 'Enter');
};

test('Auto rule: TV only when wider than tall and at least 460 CSS px tall; every stated phone and TV size, 459 against 460, the square; explicit choices win', () => {
  same(TV_MIN_HEIGHT, 460);
  for (const [w, h] of PHONE) same(presentationFor('auto', { w, h }), 'phone', `${w}x${h}`);
  for (const [w, h] of TV) same(presentationFor('auto', { w, h }), 'tv', `${w}x${h}`);
  same(presentationFor('auto', { w: 1280, h: 459 }), 'phone', 'height 459');
  same(presentationFor('auto', { w: 1280, h: 460 }), 'tv', 'height 460');
  same(presentationFor('auto', { w: 700, h: 700 }), 'phone', 'a square is not wider than tall');
  same(presentationFor('auto', { w: 701, h: 700 }), 'tv');
  same(presentationFor('auto', { w: 460, h: 460 }), 'phone');
  same(presentationFor('tv', { w: 390, h: 844 }), 'tv');
  same(presentationFor('phone', { w: 1920, h: 1080 }), 'phone');
  for (const [w, h] of [...PHONE, ...TV]) {
    const { app } = setup({ width: w, height: h });
    same(app.presentation, 'auto', 'a fresh page starts on Auto');
    same(app.mode, PHONE.some(([a, b]) => a === w && b === h) ? 'phone' : 'tv', `board at ${w}x${h}`);
  }
  same(setup({ width: 390, height: 844, presentation: 'tv' }).app.mode, 'tv');
  same(setup({ width: 1920, height: 1080, presentation: 'phone' }).app.mode, 'phone');
});

test('every league: Enter, Space, the remote Select key, a click on the score and the more button each open the focused game in the details window; pregame games never open', () => {
  let opened = 0;
  let refused = 0;
  for (const l of LEAGUES) {
    const { app, doc } = setup();
    toLeague(app, l.id);
    same(app.mode, 'tv');
    for (const id of app.order) {
      const g = gameOf(app, id);
      const card = app.cards.get(id);
      const ways = [
        ['Enter', () => key(card.root, 'Enter')],
        ['Space', () => key(card.root, ' ')],
        ['Select', () => key(card.root, 'Select')],
        ['pointer', () => click(scoreBox(app, id))],
        ['button', () => card.act && click(card.act)],
      ];
      for (const [how, act] of ways) {
        card.root.focus();
        if (how === 'button') {
          same(card.act, null, '010: no per-game button; the whole card opens the details');
          continue;
        }
        act();
        if (!isExpandable(g)) {
          same(app.popup.open, false, `${id} (${g.status}) must not open by ${how}`);
          same(doc.activeElement, card.root, `${id}: focus stays on the game`);
          assert.match(app.live.textContent, /no details/);
          refused++;
          continue;
        }
        same(app.popup.open, true, `${id} opens by ${how}`);
        same(app.popup.gameId, id);
        same(app.popup.panel, 'situation', 'Situation first on every opening');
        const u = app.popup.ui;
        same(u.box.hidden, false);
        same(u.scrim.hidden, false);
        same(u.box.getAttribute('role'), 'dialog');
        same(u.box.getAttribute('aria-modal'), 'true');
        assert.match(u.box.getAttribute('aria-label'), new RegExp(`^Game details, ${app.view.teams[g.away].abbr} at ${app.view.teams[g.home].abbr}$`));
        same(app.board.hasAttribute('inert'), true, 'the board cannot take input');
        same(doc.activeElement, u.box, 'focus moves into the window');
        same(app.expansion.count(), 0, 'nothing opens in place on TV');
        same(card.root.getAttribute('data-stage'), '1');
        const text = u.score.textContent;
        for (const side of ['away', 'home']) assert.ok(text.includes(app.view.teams[g[side]].abbr) && text.includes(String(g.total[side])), `${id}: the score shows ${side}`);
        same(u.score.all((e) => e.tagName === 'BUTTON').length, 0, 'the score part has no button');
        key(u.box, 'Escape');
        same(app.popup.open, false);
        same(doc.activeElement, card.root, `${id}: Escape returns focus to the game`);
        opened++;
      }
    }
  }
  console.log(`details opened ${opened} times across seven leagues; pregame and other games refused ${refused} times`);
  assert.ok(opened > 150 && refused > 40);
});

test('Left and Right step Situation, Leaders, Team stats and wrap, one step per press; arrows are labelled, out of the tab order, work by click, and each change is announced', () => {
  const { app, doc } = setup();
  const id = openable(app)[0];
  open(app, doc, id);
  const u = app.popup.ui;
  same(u.prev.tabIndex, -1);
  same(u.next.tabIndex, -1);
  same(u.prev.getAttribute('aria-label'), 'Previous: Team stats');
  same(u.next.getAttribute('aria-label'), 'Next: Leaders');
  const seen = [app.popup.panel];
  for (let i = 0; i < 6; i++) {
    key(u.box, 'ArrowRight');
    seen.push(app.popup.panel);
    assert.match(u.title.textContent, new RegExp(`^${PANELS.find((p) => p.key === app.popup.panel).label} · \\d of 3$`));
    assert.match(u.live.textContent, new RegExp(`^${PANELS.find((p) => p.key === app.popup.panel).label}, \\d of 3$`), 'announced in the window');
  }
  assert.deepEqual(seen, ['situation', 'leaders', 'teamstats', 'situation', 'leaders', 'teamstats', 'situation']);
  same(app.popup.stats.ignoredKeys, 0, 'the Enter that opened the window is not taken as a press inside it');
  key(u.box, 'ArrowLeft');
  same(app.popup.panel, 'teamstats', 'Left wraps backwards');
  key(u.box, 'ArrowLeft', { repeat: true });
  key(u.box, 'ArrowRight', { repeat: true });
  same(app.popup.panel, 'teamstats', 'a held key repeats nothing');
  click(u.next, { detail: 1 });
  same(app.popup.panel, 'situation');
  same(doc.activeElement, u.box, 'focus goes back to the window after a click');
  click(u.prev, { detail: 1 });
  same(app.popup.panel, 'teamstats');
  same(app.popup.open, true);
});

test('the score stays fixed while the lower part changes, and the lower panels hold each sport\'s situation, leaders and checked team stats', () => {
  let checked = 0;
  for (const l of LEAGUES) {
    const { app, doc } = setup();
    toLeague(app, l.id);
    for (const id of openable(app)) {
      const g = gameOf(app, id);
      open(app, doc, id);
      const u = app.popup.ui;
      const score = u.score.textContent;
      const body = () => u.body.textContent;
      if (sportOf(g) === 'football' && g.status !== 'final') {
        assert.match(body(), /(Drive|Last drive) · /, `${id}: the drive is shown`);
        if (g.drive.inProgress) {
          same(u.body.byClass('dstart').length, 1, `${id}: the drive start is drawn`);
          assert.match(u.body.byClass('field')[0].getAttribute('aria-label'), /drive started at /);
        }
      }
      if (g.status === 'final') assert.match(body(), /Final · no live/, `${id}: a final says so and draws no live graphic`);
      key(u.box, 'ArrowRight');
      same(u.body.byClass('ldr').length, 3, `${id}: three leader rows`);
      key(u.box, 'ArrowRight');
      const rows = u.body.all((e) => e.tagName === 'TR' && e.parentNode.tagName === 'TBODY');
      same(rows.length, TEAM_STAT_ROWS[sportOf(g)].length, `${id}: team stat rows`);
      const want = teamStatRows(g);
      rows.forEach((r, i) => same(r.textContent, `${want[i].label}${want[i].away}${want[i].home}`));
      assert.match(body(), /Not live statistics/);
      same(u.score.textContent, score, `${id}: the score never changes`);
      key(u.box, 'GoBack');
      checked++;
    }
  }
  assert.ok(checked > 40, `${checked} games checked`);
});

test('Select, Enter and Space do nothing inside, even when an arrow holds focus; a click a key or remote produced on an arrow is ignored', () => {
  const { app, doc } = setup();
  const id = openable(app)[1];
  open(app, doc, id);
  const u = app.popup.ui;
  for (const k of ['Enter', ' ', 'Spacebar', 'Select']) {
    const ok = key(u.box, k);
    same(ok, false, `${k} is consumed`);
    keyup(u.box, k);
    same(app.popup.open, true);
    same(app.popup.panel, 'situation');
  }
  for (const arrow of [u.next, u.prev]) {
    arrow.focus();
    same(doc.activeElement, arrow, 'an arrow can hold focus after a pointer press in some browsers');
    for (const k of ['Enter', ' ', 'Select']) {
      same(key(arrow, k), false, `${k} on an arrow is consumed`);
      click(arrow); // the click a browser would make from that key, while the key is down
      keyup(arrow, k);
      click(arrow, { detail: 0 }); // a click with no pointer behind it
      same(app.popup.panel, 'situation', `${k} on an arrow changes nothing`);
    }
  }
  assert.ok(app.popup.stats.ignoredClicks >= 12);
  same(app.popup.open, true);
  same(app.expansion.count(), 0);
});

test('Up and Down only scroll the lower part: never close, never change the panel, never move the board', () => {
  const { app, doc } = setup();
  const id = openable(app)[2];
  open(app, doc, id);
  const u = app.popup.ui;
  const focusBefore = app.focusedId;
  key(u.box, 'ArrowDown');
  key(u.box, 'ArrowDown', { repeat: true });
  same(u.body.scrollTop, 80);
  key(u.box, 'ArrowUp');
  same(u.body.scrollTop, 40);
  key(u.box, 'ArrowUp');
  key(u.box, 'ArrowUp');
  same(u.body.scrollTop, 0, 'never above the top');
  same(app.popup.open, true);
  same(app.popup.panel, 'situation');
  same(app.focusedId, focusBefore, 'the board focus did not move');
  same(app.stats.arrowMoves, 0);
  key(u.box, 'ArrowDown');
  key(u.box, 'ArrowRight');
  same(u.body.scrollTop, 0, 'a new panel starts at its top');
});

test('Back, Escape, GoBack and BrowserBack close and return focus to the same game; a click on the dimmed board closes it without touching the board', () => {
  for (const k of ['Escape', 'Esc', 'GoBack', 'BrowserBack', 'outside click']) {
    const { app, doc } = setup();
    const ids = openable(app);
    const id = ids[3];
    open(app, doc, id);
    const u = app.popup.ui;
    key(u.box, 'ArrowRight');
    const stages = [...app.cards.keys()].map((x) => app.expansion.stageOf(x)).join();
    if (k === 'outside click') click(u.scrim, { detail: 1 });
    else key(u.box, k);
    same(app.popup.open, false, k);
    same(u.box.hidden, true);
    same(u.scrim.hidden, true);
    same(app.board.hasAttribute('inert'), false);
    same(doc.activeElement, app.cards.get(id).root, `${k}: focus is back on the same game`);
    same([...app.cards.keys()].map((x) => app.expansion.stageOf(x)).join(), stages, `${k}: nothing behind was activated`);
    assert.match(app.live.textContent, /details closed/);
    open(app, doc, ids[0]);
    same(app.popup.panel, 'situation', 'reopening starts on Situation');
    same(app.popup.gameId, ids[0]);
  }
});

test('while open nothing outside can take focus or input: the board and Menu are out of reach, Tab stays in the window, and no hidden element is tabbable', () => {
  const { app, doc } = setup();
  const before = tabbable(doc).length;
  assert.ok(before > 10, 'cards and the Menu button are tabbable before');
  assert.ok(tabbable(doc).every((e) => !e.closest('.pop')), 'the closed window adds nothing to the tab order');
  const ids = openable(app);
  open(app, doc, ids[0]);
  const u = app.popup.ui;
  assert.deepEqual(tabbable(doc).map((e) => e.className), [], 'no tabbable element anywhere while the window is open');
  app.cards.get(ids[1]).root.focus();
  app.header.menuBtn.focus();
  same(doc.activeElement, u.box, 'the board and Menu button cannot take focus');
  key(u.box, 'Tab');
  key(u.box, 'Tab', {});
  same(doc.activeElement, u.box);
  click(scoreBox(app, ids[1]));
  key(app.cards.get(ids[1]).root, 'Enter');
  same(app.popup.gameId, ids[0], 'input on the board behind does nothing');
  same(app.menuOpen, false);
  key(u.box, 'Escape');
  assert.ok(tabbable(doc).length === before, 'after closing, the tab order is as before');
});

test('a resize across the TV rule or a Presentation change closes what was open safely, restores focus, and keeps the schedule and choices', () => {
  const { app, doc, win } = setup({ width: 1280, height: 720 });
  app.openMenu();
  choose(app, 'league', 'nba');
  choose(app, 'zone', 'America/New_York');
  app.closeMenu();
  const view = JSON.stringify(app.view.view);
  const ids = openable(app);
  open(app, doc, ids[1]);
  key(app.popup.ui.box, 'ArrowRight');
  win.resize(1280, 700);
  win.flush();
  same(app.mode, 'tv', 'still TV: a resize within TV keeps the window');
  same(app.popup.open, true);
  win.resize(390, 844);
  win.flush();
  same(app.mode, 'phone');
  same(app.popup.open, false, 'crossing to Phone closes the window');
  same(app.popup.ui.box.hidden, true);
  same(app.board.hasAttribute('inert'), false);
  same(doc.activeElement, app.cards.get(ids[1]).root, 'focus is back on the same game');
  same(JSON.stringify(app.view.view), view, 'the schedule and filters are kept');
  same(app.settings.zone, 'America/New_York');
  click(scoreBox(app, ids[1]));
  click(scoreBox(app, ids[1])); // 010: the next step is the score box again
  same(app.expansion.stageOf(ids[1]), 3, 'Phone opens in place');
  const inner = app.cards.get(ids[1]).sections[2].byClass('sbtn')[0];
  inner.focus();
  win.resize(1920, 1080);
  win.flush();
  same(app.mode, 'tv');
  same(app.expansion.count(), 0, 'crossing to TV closes the open game');
  same(app.cards.get(ids[1]).sections[2].hidden, true);
  same(doc.activeElement, app.cards.get(ids[1]).root, 'focus left the closed part for its game');
  same(JSON.stringify(app.view.view), view);
  same(app.presentation, 'auto', 'the choice is still Auto');
  app.openMenu();
  choose(app, 'presentation', 'phone');
  same(app.mode, 'phone');
  assert.match(app.live.textContent, /^Presentation: Phone$/);
  same(doc.activeElement, app.menu.selects.get('presentation'), 'focus stays on the dropdown');
  choose(app, 'presentation', 'tv');
  win.resize(390, 844);
  win.flush();
  same(app.mode, 'tv', 'an explicit TV choice ignores the window size');
  choose(app, 'presentation', 'auto');
  same(app.mode, 'phone');
  assert.match(app.live.textContent, /Phone for this window/);
});

test('Presentation is a quiet Menu choice, per Demo screen and in memory only; a reload starts on Auto', () => {
  const { app, win, root } = setup();
  app.openMenu();
  assert.deepEqual(optionsOf(app.menu.selects.get('presentation')).map((o) => o.textContent), PRESENTATIONS.map((p) => p.label));
  assert.deepEqual(PRESENTATIONS.map((p) => p.label), ['Auto', 'TV', 'Phone']);
  same(app.menu.labels.get('presentation').textContent, 'Presentation');
  choose(app, 'presentation', 'phone');
  choose(app, 'screen', '1');
  same(app.presentation, 'auto', 'screen 2 has its own choice');
  same(app.mode, 'tv');
  choose(app, 'screen', '0');
  same(app.presentation, 'phone');
  same(app.mode, 'phone');
  assert.ok(!('presentation' in app.settings), 'not part of the saved-looking settings object');
  const fresh = setup();
  same(fresh.app.presentation, 'auto', 'a reload starts on Auto');
  same(win.historyCalls + win.timerCalls, 0);
  assert.ok(root);
});

test('phone presentation preserved: on Auto at 390x844 and 430x932 a game opens in place in one full row, earlier games above and later ones below, nothing promoted', () => {
  for (const [w, h] of [[390, 844], [430, 932]]) {
    const { app } = setup({ width: w, height: h });
    same(app.mode, 'phone');
    const ids = openable(app);
    const id = ids[Math.floor(ids.length / 2)];
    const before = new Map(app.layout.placements.map((p) => [p.id, [p.x, p.y, p.w, p.h]]));
    const order = [...app.order];
    click(scoreBox(app, id));
    same(app.expansion.stageOf(id), 2);
    same(app.popup.open, false);
    const p = app.layout.placements.find((x) => x.id === id);
    assert.ok(Math.abs(p.x - app.layout.frame.insetX) < 0.01 && Math.abs(p.w - app.layout.frame.contentW) < 0.01, 'one full row');
    for (const q of app.layout.placements) {
      if (q.id === id) continue;
      if (q.sortedIndex < p.sortedIndex) assert.deepEqual([q.x, q.y, q.w, q.h], before.get(q.id), `${q.id} above stays put`);
      else assert.ok(q.y >= p.y + p.h - 0.01, `${q.id} continues below`);
    }
    assert.deepEqual(app.order, order, 'schedule order, nothing promoted');
    click(scoreBox(app, id));
    same(app.expansion.stageOf(id), 3);
    click(scoreBox(app, id));
    assert.deepEqual(new Map(app.layout.placements.map((q) => [q.id, [q.x, q.y, q.w, q.h]])), before, 'closing restores');
  }
});

test('details window model geometry at every TV size and text size: the score keeps about the top third and always fits; the lower part keeps room; text floors hold', () => {
  const rows = [];
  for (const [w, h] of TV) {
    for (const t of TEXT_SIZES) {
      const L = popupLayout({ w, h }, t.scale);
      assert.ok(L.scoreNeed <= L.scoreH + 0.01, `${w}x${h} ${t.value}: the score fits`);
      assert.ok(L.scoreH >= L.h / 3 - 0.01, 'at least a third');
      assert.ok(L.scoreH / L.h <= 0.5, `${w}x${h} ${t.value}: the score takes at most half (${(L.scoreH / L.h).toFixed(2)})`);
      assert.ok(L.lowerBody >= 4 * 20 * L.f, `${w}x${h} ${t.value}: at least four lines below`);
      assert.ok(L.textOk && L.minText >= TEXT_FLOOR_PX, 'text at least 14 px');
      assert.ok(L.totalsOk && L.totalText >= TOTALS_FLOOR_PX, 'totals at least 28 px');
      rows.push(`${w}x${h} ${t.value} score ${(100 * L.scoreH / L.h).toFixed(0)}%`);
    }
  }
  console.log(`details geometry: ${rows.join('; ')}`);
  same(HINT.startsWith('Back to close'), true, 'the visible hint says how to close');
});
