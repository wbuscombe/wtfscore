import { uiChoose, uiControl, uiOptions, uiRow, uiLabel, uiValue } from './fake-dom.mjs';
// The Menu drives the real controller: every dropdown is changed through a
// change event on its native <select>, and each test asserts the state and the
// rendered board that result. Fake-DOM model tests, not browser evidence.
// 008: the board here is the Phone presentation (one test opens a game in
// place); the Sport row, the Date row and the Presentation row are new, and
// the League dropdown lists the leagues of the chosen sport. Sport and
// calendar transitions are tested at the end of this file and in calendar.test.mjs.
// 008002: a daily league's Period dropdown holds one Regular season choice and
// the named rounds; its dates are chosen with the Date control (the calendar),
// so a step to a date goes through that control, and the reveal-order observer
// watches the Date row too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDocument, FakeWindow, FakeEvent } from './fake-dom.mjs';
import { mountBoard, DEFAULT_SETTINGS, countText, REGULAR_CHOICE } from '../public/lib/board.mjs';
import { buildCatalog, LEAGUES, ZONES, SPORT_GROUPS, sportOfLeague, DAILY_LEAGUES, dateKeyLabel } from '../public/lib/catalog.mjs';
import { optionsOf } from '../public/lib/menu.mjs';
import { dayWords } from '../public/lib/calendar.mjs';
import { dims } from '../public/lib/sizing.mjs';
import { isExpandable, sortGames } from '../public/lib/model.mjs';

const cat = buildCatalog();
function setup({ width = 1440, height = 900 } = {}) {
  const win = new FakeWindow({ width, height });
  const doc = win.document;
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const app = mountBoard({ win, doc, root, presentation: 'phone' });
  app.openMenu();
  return { win, doc, root, app };
}
const sel = uiControl;
function choose(app, key, value) { return uiChoose(app, key, value); }
const values = (app, key) => uiOptions(app, key).map((o) => o.value);
const labels = (app, key) => uiOptions(app, key).map((o) => o.textContent);
const shownRows = (app) => [...app.header.rows, ...app.menu.rows].filter(([, r]) => !r.hidden).map(([k]) => k);
const ids = (app) => [...app.cards.keys()].sort();
const articles = (app) => app.board.children.filter((e) => e.tagName === 'ARTICLE');
const expectBoard = (app, view, zone = app.settings.zone) => cat.resolve(view, zone).games.map((g) => g.id).sort();

test('League: each of the seven leagues replaces the board with its own namespaced cards, its period and its controls; focus stays on the dropdown', () => {
  const { doc, app } = setup();
  const rows = { nfl: ['conference', 'division'], nba: ['conference', 'division'], mlb: ['subleague', 'division'], nhl: ['conference', 'division'], ncaaf: ['subdivision', 'conference', 'ranking'], ncaab: ['conference', 'ranking'], ncaaw: ['conference', 'ranking'] };
  let previous = ids(app);
  click(app.cards.get(previous.find((id) => isExpandable(app.view.games.find((g) => g.id === id)))).sections[1]);
  same(app.expansion.count(), 0, 'menu open: the board behind is inert');
  for (const l of [...LEAGUES.slice(1), LEAGUES[0]]) {
    choose(app, 'league', l.id);
    same(doc.activeElement, sel(app, 'league'), 'focus stays on the League dropdown');
    same(app.menuOpen, false, 'game selection is foreground; Menu is closed');
    same(app.view.league.id, l.id);
    assert.deepEqual(ids(app), expectBoard(app, { league: l.id }));
    assert.ok(ids(app).every((id) => id.startsWith(`${l.id}-`)), 'ids are namespaced');
    assert.ok(previous.every((id) => !app.cards.has(id)), 'no card from the previous league remains');
    assert.ok(articles(app).every((a) => a.getAttribute('data-id').startsWith(`${l.id}-`)), 'no stale card element on the board');
    same(articles(app).length, app.cards.size);
    same(app.expansion.count(), 0);
    assert.deepEqual(shownRows(app).filter((k) => !['sport', 'league', 'season', 'period', 'date', 'favorites', 'textSize', 'order', 'openLimit', 'zone', 'badges', 'presentation', 'screen'].includes(k)), rows[l.id], l.id);
    // 010: Favorite teams only for football, and football has no Order choice.
    same(uiRow(app, 'favorites').hidden, l.sport !== 'football', `${l.id}: Favorite teams only for football`);
    same(uiRow(app, 'order').hidden, l.sport === 'football', `${l.id}: Order for every sport but football`);
    same(uiControl(app, 'period').getAttribute('aria-haspopup'), l.periodKind === 'date' ? 'dialog' : 'listbox', `${l.id}: period opens the appropriate picker`);
    same(app.header.title.textContent, `${l.short} · ${app.view.period.label}`);
    assert.match(app.menu.context.textContent, new RegExp(`^Demo screen 1 · ${app.cards.size} games$`));
    assert.match(app.menu.summary.textContent, new RegExp(`^Showing ${app.cards.size} games: ${l.short} · `));
    if (l.periodKind === 'date') assert.deepEqual(uiOptions(app, 'period').map(o => [o.value, o.textContent]), [[REGULAR_CHOICE, 'Regular season'], ...app.view.periods.filter(p => p.phase === 'post').map(p => [p.id, p.label])]);
    else assert.ok(app.header.pickers.get('period').list.children.every(g => g.getAttribute('role') === 'group'), 'weeks and postseason grouped within each season');
    previous = ids(app);
  }
});

test('Season and period dropdowns change the visible games and the header; postseason rounds browse like weeks', () => {
  const { app } = setup();
  choose(app, 'season', '2025');
  same(app.view.season.id, '2025');
  same(app.view.period.id, 'w11', 'same week in the other season');
  assert.deepEqual(ids(app), expectBoard(app, { league: 'nfl', season: '2025', period: 'w11' }));
  assert.ok(app.view.games.every((g) => g.status === 'final'));
  choose(app, 'season', '2026');
  for (const p of values(app, 'period')) {
    choose(app, 'period', p);
    assert.deepEqual(ids(app), expectBoard(app, { league: 'nfl', season: '2026', period: p }), p);
    assert.ok(app.cards.size > 0);
    same(app.header.title.textContent, `NFL · ${app.view.period.label}`);
  }
  assert.deepEqual(labels(app, 'period'), ['Week 10', 'Week 11', 'Week 12', 'Wild Card round', 'Divisional round', 'Conference championships', 'Championship game']);
  choose(app, 'league', 'nba');
  // 008002: no dated slates in Period; the simulated current date is the Date control's
  same(uiLabel(app, 'period').textContent, 'Date or round');
  assert.deepEqual(labels(app, 'period').slice(0, 3), ['Regular season', 'Play-in tournament', 'First round']);
  same(uiValue(app, 'period'), REGULAR_CHOICE);
  same(app.view.period.id, 'd2026-11-15', 'the simulated current date');
  same(uiControl(app, 'period').textContent, 'Sun Nov 15');
});

test('every visible filter option, in every league, changes the board to exactly the matching games', () => {
  const { doc, app } = setup();
  let changes = 0;
  for (const l of LEAGUES) {
    choose(app, 'league', l.id);
    const periods = values(app, 'period');
    // 008002: a daily league's periods[0] is Regular season, on the simulated current date (formerly its periods[1])
    for (const p of [l.periodKind === 'date' ? periods[0] : periods[1], periods[periods.length - 1]]) {
      choose(app, 'period', p);
      for (const key of shownRows(app).filter((k) => ['conference', 'subleague', 'subdivision', 'division', 'ranking', 'tournament', 'round'].includes(k))) {
        for (const v of values(app, key)) {
          if (uiRow(app, key).hidden) break;
          choose(app, key, v);
          changes++;
          same(doc.activeElement, sel(app, key), `${l.id} ${key}: focus stays`);
          assert.deepEqual(ids(app), cat.resolve(app.view.view, app.settings.zone).games.map((g) => g.id).sort());
          const fresh = cat.resolve({ league: l.id, period: p === REGULAR_CHOICE ? app.view.view.period : p, filters: { ...app.view.view.filters } }, app.settings.zone).games.map((g) => g.id).sort();
          assert.deepEqual(ids(app), fresh, `${l.id} ${p} ${key}=${v}`);
          if (app.cards.size === 0) same(app.empty.hidden, false, 'an empty result says so');
        }
        app.clearFilters();
      }
    }
  }
  assert.ok(changes > 120, `${changes} filter changes`);
});

test('cascade in the Menu: a parent change repopulates the child dropdown and resets a value that no longer applies', () => {
  const { app } = setup();
  choose(app, 'conference', 'nfc');
  assert.ok(values(app, 'division').every((v) => v === 'all' || v.startsWith('nfc-')));
  choose(app, 'division', 'nfc-north');
  assert.match(app.header.title.textContent, /^NFL · Week 11 · NFC North$/, 'the header names the active group');
  assert.ok(app.view.games.every((g) => [g.away, g.home].some((t) => app.view.teams[t].groups.division === 'nfc-north')));
  choose(app, 'conference', 'afc');
  same(uiValue(app, 'division'), 'all');
  assert.ok(values(app, 'division').every((v) => v === 'all' || v.startsWith('afc-')));
  same(app.header.title.textContent, 'NFL · Week 11 · AFC');
  choose(app, 'league', 'ncaaf');
  choose(app, 'subdivision', 'fcs');
  same(uiRow(app, 'ranking').hidden, true, 'no ranking dropdown for FCS');
  assert.deepEqual(labels(app, 'conference'), ['All conferences', 'Riverland Conference', 'Piedmont League']);
  choose(app, 'subdivision', 'fbs');
  same(uiRow(app, 'ranking').hidden, false);
  choose(app, 'ranking', 'top10');
  assert.ok(app.view.games.length > 0 && app.view.games.every((g) => [g.away, g.home].some((t) => (app.view.teams[t].rank ?? 99) <= 10)));
  choose(app, 'league', 'mlb');
  same(uiLabel(app, 'subleague').textContent, 'AL / NL');
  assert.deepEqual(labels(app, 'subleague'), ['Both leagues', 'American League', 'National League']);
  choose(app, 'subleague', 'al');
  assert.ok(labels(app, 'division').includes('AL West') && !labels(app, 'division').some((x) => x.startsWith('NL')));
});

test('tournaments: NCAA tournament by default in tournament periods, another invitational, named rounds, and the round resets with its tournament', () => {
  for (const league of ['ncaab', 'ncaaw']) {
    const { app } = setup();
    choose(app, 'league', league);
    same(uiRow(app, 'tournament').hidden, true, 'no tournament dropdown on a regular-season date');
    choose(app, 'period', 'weekend-2');
    assert.deepEqual(shownRows(app).filter((k) => ['conference', 'ranking', 'tournament', 'round'].includes(k)), ['tournament', 'round']);
    same(uiValue(app, 'tournament'), 'ncaa');
    assert.deepEqual(labels(app, 'round'), ['All rounds', 'Sweet 16', 'Elite Eight']);
    choose(app, 'round', 's16');
    assert.ok(app.cards.size === 4 && app.view.games.every((g) => g.round === 's16'));
    assert.match(app.header.title.textContent, /Tournaments: second weekend · NCAA tournament · Sweet 16$/);
    choose(app, 'tournament', 'inv');
    same(uiValue(app, 'round'), 'all', 'the NCAA round is reset');
    assert.deepEqual(labels(app, 'round'), ['All rounds', 'Quarterfinals']);
    assert.ok(app.view.games.every((g) => g.tournament === 'inv'));
    choose(app, 'tournament', 'all');
    same(uiRow(app, 'round').hidden, true);
    same(app.cards.size, cat.resolve({ league, period: 'weekend-2', filters: { tournament: 'all' } }, 'America/Chicago').games.length);
  }
});

test('empty result: a clear No games message on the board, and Clear filters from the board or the Menu brings games back', () => {
  const { doc, app } = setup();
  choose(app, 'league', 'ncaaf');
  choose(app, 'subdivision', 'fcs');
  choose(app, 'period', 'bowls');
  same(app.cards.size, 0);
  same(articles(app).length, 0, 'no stale cards behind the message');
  same(app.empty.hidden, false);
  assert.match(app.empty.textContent, /^No games match these filters \(NCAAF · 2026 demo season · Bowl games · FCS\)\.Clear filters$/);
  assert.match(app.menu.context.textContent, /No games$/);
  app.openMenu();
  click(app.menu.clearBtn);
  same(app.empty.hidden, true);
  same(app.cards.size, cat.resolve({ league: 'ncaaf', period: 'bowls' }, 'America/Chicago').games.length);
  same(uiValue(app, 'subdivision'), 'all');
  choose(app, 'subdivision', 'fcs');
  app.closeMenu();
  const btn = app.empty.byClass('empty-clear')[0];
  same(btn.hidden, false);
  click(btn);
  assert.ok(app.cards.size > 0);
  same(doc.activeElement, app.cards.get(app.order[0]).root, 'focus moves to the first game');
  same(app.clearFilters(), false, 'nothing left to clear');
  assert.match(app.live.textContent, /No filters to clear/);
});

test('display settings each change the board: text size, order, games open at once, time zone and local badges', () => {
  const { doc, app } = setup();
  const created = doc.created.length;
  choose(app, 'textSize', 'largest');
  same(app.board.style.getPropertyValue('--f'), String(dims(10).f));
  choose(app, 'order', 'status');
  same(app.settings.order, 'kickoff', '010: football has no Order choice; its fixed order applies');
  same(app.view.games.find((g) => g.id === app.order[0]).status !== 'final', true);
  choose(app, 'openLimit', '2');
  same(app.settings.openLimit, 2);
  same(doc.created.length, created, 'no element created by display choices');
  assert.ok(articles(app).every((a) => a.byClass('badge').every((b) => b.hidden)), 'badges start off');
  choose(app, 'badges', 'on');
  assert.ok(articles(app).every((a) => a.byClass('badge').length === 2 && a.byClass('badge').every((b) => !b.hidden)));
  choose(app, 'badges', 'off');
  assert.ok(articles(app).every((a) => a.byClass('badge').every((b) => b.hidden)));
  const pre = app.view.games.find((g) => g.localId === 'g11-108');
  assert.match(app.cards.get(pre.id).status.textContent, /^Sun 7:20\sPM$/);
  choose(app, 'zone', 'America/New_York');
  assert.match(app.cards.get(pre.id).status.textContent, /^Sun 8:20\sPM$/, 'start times shown in the chosen zone');
  assert.match(app.header.sim.title, /Eastern/);
  choose(app, 'zone', 'UTC');
  assert.match(app.cards.get(pre.id).status.textContent, /^Mon 1:20\sAM$/);
  same(app.view.period.id, 'w11', 'a week holds its games in any zone');
  // 010: Order still changes a non-football board.
  choose(app, 'league', 'nba');
  choose(app, 'order', 'status');
  same(app.settings.order, 'status');
  assert.deepEqual(app.order, sortGames(app.view.games, 'status').map((g) => g.id));
  same(app.view.games.find((g) => g.id === app.order[0]).status !== 'final', true);
});

test('time zone changes date membership for date leagues: a late game moves to its local date; open games that stay remain open', () => {
  const { app } = setup();
  choose(app, 'league', 'nba');
  pickDay(app, '2026-11-14'); // 008002: dates are chosen in the calendar
  const late = app.view.games.find((g) => g.kickoff === '2026-11-15T05:00:00Z');
  assert.ok(late, 'Sat 11:00 PM Central game on Saturday in Central');
  app.closeMenu();
  assert.match(app.cards.get(late.id).status.textContent, /^Final · Sat$/, 'a Saturday final in Central');
  const keep = app.view.games.find((g) => g.status === 'final' && g.id !== late.id);
  click(app.cards.get(keep.id).sections[1]);
  same(app.expansion.stageOf(keep.id), 2);
  app.openMenu();
  choose(app, 'zone', 'America/New_York');
  same(app.view.period.id, 'd2026-11-14');
  assert.ok(!app.cards.has(late.id), 'in Eastern it is a Sunday game');
  same(app.expansion.stageOf(keep.id), 2, 'a game still on the board stays open');
  pickDay(app, '2026-11-15');
  assert.ok(app.cards.has(late.id));
  assert.match(app.cards.get(late.id).status.textContent, /^Final · Sun$/, 'the same game is a Sunday final in Eastern');
  assert.deepEqual(labels(app, 'zone'), ZONES.map((z) => z.label));
});

test('two RAM-only Demo screens keep independent filters and settings; switching restores each; a reload starts fresh', () => {
  const { doc, app, win, root } = setup();
  choose(app, 'league', 'mlb');
  choose(app, 'subleague', 'nl');
  choose(app, 'textSize', 'larger');
  choose(app, 'zone', 'America/Los_Angeles');
  choose(app, 'screen', '1');
  same(doc.activeElement, sel(app, 'screen'));
  same(app.screen.index, 1);
  same(app.view.league.id, 'nfl', 'screen 2 starts on the default board');
  assert.deepEqual({ ...app.settings }, { ...DEFAULT_SETTINGS });
  same(doc.title, 'Demo screen 2 · WTFScore · SIMULATED');
  choose(app, 'league', 'nhl');
  choose(app, 'badges', 'on');
  choose(app, 'screen', '0');
  same(app.view.league.id, 'mlb');
  same(uiValue(app, 'subleague'), 'nl');
  same(app.settings.textSize, 'larger');
  same(app.settings.zone, 'America/Los_Angeles');
  same(app.board.style.getPropertyValue('--f'), String(dims(9).f));
  assert.ok(app.view.games.every((g) => [g.away, g.home].some((t) => app.view.teams[t].groups.subleague === 'nl')));
  choose(app, 'screen', '1');
  same(app.view.league.id, 'nhl');
  same(app.settings.badges, 'on');
  assert.ok(articles(app).every((a) => a.byClass('badge').every((b) => !b.hidden)));
  const fresh = new FakeWindow({ width: 1440, height: 900 });
  const r2 = fresh.document.createElement('div');
  fresh.document.body.appendChild(r2);
  const again = mountBoard({ win: fresh, doc: fresh.document, root: r2 });
  same(again.view.league.id, 'nfl', 'nothing survives a reload');
  assert.deepEqual({ ...again.settings }, { ...DEFAULT_SETTINGS });
  same(win.frameCalls + win.timerCalls + win.historyCalls, 0, 'no timers or URL writes');
  assert.ok(root);
});

test('screen name: editable, sanitized, at most 32 characters, shown in the page title, Menu context and screen dropdown only', () => {
  const { doc, app } = setup();
  const input = app.menu.nameInput;
  input.focus();
  const hostile = `  <img src=x onerror=alert(1)>${String.fromCharCode(0x202e)} Den ${String.fromCharCode(0)}TV ${'x'.repeat(40)}`;
  input.value = hostile;
  input.dispatchEvent(new FakeEvent('input'));
  const name = app.screen.name;
  assert.ok(Array.from(name).length <= 32);
  assert.ok(!/[\u0000-\u001f]/.test(name) && !name.includes(String.fromCharCode(0x202e)));
  assert.ok(name.startsWith('<img src=x onerror=alert(1)>'), 'kept as text, not markup');
  same(doc.title, `${name} · WTFScore · SIMULATED`);
  same(app.menu.context.textContent, `${name} · 16 games`);
  same(uiOptions(app, 'screen')[0].textContent, name);
  same(doc.activeElement, input, 'typing keeps focus in the field');
  input.dispatchEvent(new FakeEvent('change'));
  same(input.value, name, 'the field shows the cleaned name when done');
  assert.ok(!app.header.root.textContent.includes(name), 'the main header stays compact: no screen name');
  input.value = '   ';
  input.dispatchEvent(new FakeEvent('change'));
  same(app.screen.name, 'Demo screen 1', 'an empty name falls back');
  choose(app, 'screen', '1');
  same(input.value, 'Demo screen 2');
});

test('Menu keyboard: Escape from a dropdown or the name field closes the sheet and restores focus; the page behind stays inert while open', () => {
  const { doc, app } = setup();
  choose(app, 'league', 'nhl');
  app.openMenu();
  same(app.board.hasAttribute('inert'), true);
  const first = app.cards.get(app.order[0]).root;
  first.focus();
  notSame(doc.activeElement, first, 'cards behind the open sheet cannot take focus');
  press(doc.activeElement, 'Escape');
  same(app.menuOpen, false);
  same(doc.activeElement, uiControl(app, 'league'), 'Menu returns focus to its previously focused header control');
  app.header.menuBtn.focus();
  click(app.header.menuBtn);
  press(doc.activeElement, 'Escape');
  same(doc.activeElement, app.header.menuBtn, 'Menu opened from its own button returns to that button');
  first.focus();
  click(app.header.menuBtn);
  app.menu.nameInput.focus();
  press(app.menu.nameInput, 'Escape');
  same(app.menuOpen, false);
  same(doc.activeElement, first, 'focus returns to the game that had it');
});

test('choosing a value that is not offered changes nothing and puts the dropdown back', () => {
  const { app } = setup();
  const before = ids(app);
  for (const [key, bad] of [['league', 'xfl'], ['period', 'w99'], ['division', 'mars'], ['zone', 'Europe/Paris'], ['textSize', 'tiny'], ['openLimit', '9'], ['screen', '7'], ['badges', 'yes']]) {
    const changes = app.stats.settingsChanges;
    if (app.header.pickers.has(key)) {
      if (app.menuOpen) click(app.menu.closeBtn);
      click(sel(app, key));
      assert.ok(!uiOptions(app, key).some(o => o.value === bad), 'invalid value is not offered');
      press(app.board.ownerDocument.activeElement, 'Escape');
    } else choose(app, key, bad);
    same(app.stats.settingsChanges, changes, key);
    notSame(uiValue(app, key), bad, `${key} shows a real value again`);
  }
  assert.deepEqual(ids(app), before);
});

function click(el) {
  return el.dispatchEvent(new FakeEvent('click'));
}
function press(el, key) {
  return el.dispatchEvent(new FakeEvent('keydown', { key }));
}

// ---------- Menu reveal order (state observer) ----------
// A Menu row that turns visible must already hold its own context's label,
// options and selected value: never zero options, and never options left from
// another league, period or tournament. Each filter row's hidden state, and the
// sheet's, is observed per instance; the expected options and value come from
// the controller's resolved view, which is already current when the Menu is
// synced. This proves the code's order only: the fake DOM does not paint, lay
// out or cache like WebKit.
const FILTER_KEYS = ['subleague', 'subdivision', 'conference', 'division', 'ranking', 'tournament', 'round'];
const kindOf = (p) => (p.phase === 'regular' ? 'regular' : p.tournaments && p.tournaments.length ? 'tournament' : 'postseason');
const pairText = (list) => list.map((o) => `${o[0]}=${o[1]}`).join('|');
const firstSeasonPeriods = (leagueId) => cat.periods(leagueId, cat.seasons(leagueId)[0].id, 'America/Chicago');

// 008002: the Date control is observed too. When its row turns visible it must
// already hold its label and the view's chosen date, with Period on Regular season.
function dateProblems(app) {
  const v = app.view;
  if (!v.daily || v.period.kind !== 'date') return ['Date check outside a regular-season date'];
  const out = [];
  if (uiLabel(app, 'period').textContent !== 'Date or round') out.push('period label');
  if (uiControl(app, 'period').textContent !== dateKeyLabel(v.period.dateKey)) out.push('chosen date label');
  if (!uiControl(app, 'period').getAttribute('aria-label').includes(dayWords(v.period.dateKey))) out.push('accessible chosen date');
  if (uiValue(app, 'period') !== REGULAR_CHOICE) out.push('regular season selection');
  return out;
}
// What the Period dropdown offers and shows: a daily league's one Regular season choice, then the rounds.
const periodChoices = (v) => (v.daily ? [[REGULAR_CHOICE, 'Regular season'], ...v.periods.filter((p) => p.phase !== 'regular').map((p) => [p.id, p.label])] : v.periods.map((p) => [p.id, p.label]));
const periodValue = (v) => (v.daily && v.period.kind === 'date' ? REGULAR_CHOICE : v.view.period);
const isDayId = (value) => /^d\d{4}-\d{2}-\d{2}$/.test(String(value));
const calendarCell = (app, key) => app.header.calendar.cells.find((c) => c.button.getAttribute('data-key') === key);
// A day through the Date control: open the calendar, page to the day's month, pick it.
function pickDay(app, key) {
  if (app.menuOpen) click(app.menu.closeBtn);
  click(uiControl(app, 'period'));
  same(app.calendarOpen, true, 'the Date control opens the calendar');
  for (let i = 0; i < 36 && !calendarCell(app, key); i++) click(key < app.calendarState.focus ? app.header.calendar.prev : app.header.calendar.next);
  click(calendarCell(app, key).button);
}
// A step to a regular-season date: Period Regular season when a round shows,
// then that day in the calendar when another day shows. Returns the control
// that then holds focus (the calendar returns focus to the Date control).
function chooseDay(app, id) {
  if (app.view.period.kind !== 'date') choose(app, 'period', REGULAR_CHOICE);
  else sel(app, 'period').focus();
  if (app.view.view.period === id) return sel(app, 'period');
  pickDay(app, id.slice(1));
  return uiControl(app, 'period');
}

// 010: Favorite teams (football only) and Order (every sport but football) are
// observed too: shown only in their own context and already filled.
const FOOTBALL = ['nfl', 'ncaaf'];
function rowProblems(app, key) {
  if (key === 'date') return dateProblems(app);
  if (key === 'favorites') {
    const v = app.view;
    if (!FOOTBALL.includes(v.league.id)) return ['Favorite teams shown outside football'];
    const s = sel(app, key);
    const have = uiOptions(app, key).map((o) => o.value);
    const out = [];
    if (have[0] !== 'none' || have.slice(1).sort().join() !== Object.keys(v.teams).sort().join()) out.push(`options are not this league's teams (${have.length})`);
    if (uiValue(app, key) !== 'none' || uiOptions(app, key).filter((o) => o.selected).length !== 1) out.push(`selected ${s.value}, want none`);
    if (uiLabel(app, key).textContent !== 'Favorite teams') out.push('label');
    return out;
  }
  if (key === 'order') {
    if (FOOTBALL.includes(app.view.league.id)) return ['Order shown for football'];
    const s = sel(app, key);
    const have = uiOptions(app, key).map((o) => o.value).join();
    return have === 'kickoff,status' && s.value === app.settings.order ? [] : [`order options ${have}, value ${s.value}`];
  }
  const s = sel(app, key);
  const c = app.view.controls.find((x) => x.key === key && x.visible);
  if (!c) return ['shown although the current view has no such control'];
  const have = uiOptions(app, key).map((o) => [o.value, o.textContent]);
  const want = c.options.map((o) => [o.value, o.label]);
  const out = [];
  if (!have.length) out.push('zero options');
  else if (pairText(have) !== pairText(want)) {
    const sameValues = have.map((o) => o[0]).join('|') === want.map((o) => o[0]).join('|');
    const show = (list) => list.map((o) => (sameValues ? `${o[0]}=${o[1]}` : o[0])).join('|');
    out.push(`options of another context (${show(have)}; want ${show(want)})`);
  }
  const picked = uiOptions(app, key).filter((o) => o.selected).map((o) => o.value);
  if (uiValue(app, key) !== c.value || !have.some((o) => o[0] === c.value) || picked.length !== 1 || picked[0] !== c.value) out.push(`selected ${JSON.stringify(s.value)}/${picked.join('|') || 'none'}, want ${c.value}`);
  if (uiLabel(app, key).textContent !== c.label) out.push(`label ${uiLabel(app, key).textContent}, want ${c.label}`);
  return out;
}

function observe(app) {
  const events = [];
  let label = 'start';
  const note = (key, how) => events.push({ step: label, key, how, problems: rowProblems(app, key) });
  const watch = (node, onShow) => {
    const own = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'hidden');
    Object.defineProperty(node, 'hidden', {
      configurable: true,
      get() {
        return own.get.call(this);
      },
      set(v) {
        if (!v && own.get.call(this)) onShow();
        own.set.call(this, v);
      },
    });
    const remove = node.removeAttribute;
    node.removeAttribute = function (k) {
      if (k === 'hidden' && this.attributes.has('hidden')) onShow();
      return remove.call(this, k);
    };
  };
  for (const key of ['favorites', 'order', ...FILTER_KEYS]) watch(uiRow(app, key), () => note(key, 'row shown'));
  watch(app.menu.sheet, () => {
    for (const key of ['favorites', 'order']) if (!uiRow(app, key).hidden) note(key, 'sheet shown');
  });
  return { events, at: (name) => (label = name), verifyDate() { if (app.view.daily && app.view.period.kind === 'date') note('date', 'foreground period updated'); } };
}

function observedBoard() {
  const run = setup();
  run.obs = observe(run.app);
  run.nodes = new Map([...run.app.menu.selects, ...[...run.app.header.pickers].map(([key,p]) => [key,p.button])]);
  run.dateBtn = uiControl(run.app,'period');
  return run;
}

const describe = (app) => {
  const t = app.view.controls.find((c) => c.key === 'tournament' && c.visible);
  return `${app.view.league.id}[${kindOf(app.view.period)} ${app.view.period.id}${t ? ` ${t.value}` : ''}]`;
};

// The state after a change: the changed dropdown keeps focus and identity, every
// dropdown is the same node, the shown rows are the view's controls, each shown
// dropdown holds the view's options and value, and the counts match the board.
function afterChange(run, key, value, focusTo = null) {
  const { app, doc } = run;
  const v = app.view;
  const out = [];
  const actual = key === 'screen' ? String(app.screen.index) : ['league','season','period'].includes(key) ? key === 'period' && value !== REGULAR_CHOICE ? v.view.period : uiValue(app,key) : v.view.filters[key];
  if (actual !== value) out.push(`${key} did not become ${value}`);
  if (doc.activeElement !== (focusTo || sel(app,key))) out.push(`focus left ${key}`);
  for (const [k,node] of run.nodes) if (sel(app,k) !== node || node.parentNode !== uiRow(app,k)) out.push(`${k} control replaced`);
  if (uiControl(app,'period') !== run.dateBtn || run.dateBtn.parentNode !== uiRow(app,'period')) out.push('shared period/date button replaced');
  if (v.daily && v.period.kind === 'date') for (const problem of dateProblems(app)) out.push(`date: ${problem}`);
  if (app.calendarOpen || !app.header.calendar.root.hidden) out.push('calendar left open');
  if (app.menu.selects.has(key) ? !app.menuOpen || app.menu.sheet.hidden : app.menuOpen) out.push('wrong foreground/Menu input state');
  const football = FOOTBALL.includes(v.league.id);
  if (uiRow(app,'favorites').hidden === football) out.push('Favorite teams visibility');
  if (uiRow(app,'order').hidden !== football) out.push('Order visibility');
  for (const k of ['favorites','order']) if (!uiRow(app,k).hidden) for (const problem of rowProblems(app,k)) out.push(`${k}: ${problem}`);
  const want = v.controls.filter(c=>c.visible).map(c=>c.key).sort();
  const shown = shownRows(app).filter(k=>FILTER_KEYS.includes(k)).sort();
  if (want.join() !== shown.join()) out.push('filter rows do not match current context');
  for (const k of shown) for (const problem of rowProblems(app,k)) out.push(`${k}: ${problem}`);
  const allLeagues = SPORT_GROUPS.flatMap(sp=>sp.leagues.map(id=>LEAGUES.find(l=>l.id===id)));
  const flat = { league: allLeagues.map(l=>[l.id,l.option]), season:v.seasons.map(x=>[x.id,x.label]), period:periodChoices(v) };
  for (const k of ['league','season','period']) {
    const have = uiOptions(app,k).map(o=>[o.value,o.textContent]);
    if (pairText(have)!==pairText(flat[k]) || uiValue(app,k)!==(k==='period'?periodValue(v):v.view[k])) out.push(`${k} choices/value do not match context`);
  }
  const n=v.games.length;
  if (app.cards.size!==n || articles(app).length!==n) out.push('card count');
  if (app.menu.context.textContent!==`${app.screen.name} · ${countText(n)}`) out.push('Menu context count');
  if (!app.menu.summary.textContent.startsWith(`Showing ${countText(n).toLowerCase()}: ${v.league.short} · `)) out.push('Menu summary');
  return out;
}

function step(run, rec, name, group, key, value) {
  const before = run.obs.events.length;
  run.obs.at(name);
  const from = describe(run.app);
  let focusTo = null;
  if (typeof key === 'function') key(run.app);
  else if (key === 'period' && isDayId(value)) focusTo = chooseDay(run.app, value);
  else choose(run.app, key, value);
  run.obs.verifyDate();
  const shown = run.obs.events.slice(before);
  rec.push({ name, group, from, to: describe(run.app), shown, bad: shown.filter((e) => e.problems.length), post: typeof key === 'function' ? [] : afterChange(run, key, String(value), focusTo) });
  // The full case and any reveal problems are now plain recorded data.
  run.doc.releaseDetachedCreatedNodes();
}

function report(t, rec, title) {
  const lines = [];
  const groups = new Map();
  let shown = 0;
  let early = 0;
  for (const r of rec) {
    shown += r.shown.length;
    early += r.bad.length;
    const g = groups.get(r.group) || { steps: 0, shown: 0, bad: 0, keys: new Set() };
    g.steps++;
    g.shown += r.shown.length;
    g.bad += r.bad.length + r.post.length;
    for (const e of r.bad) g.keys.add(e.key);
    if (r.post.length) g.keys.add('after-change state');
    groups.set(r.group, g);
    for (const e of r.bad) lines.push(`${r.name} (${r.from} -> ${r.to}): ${e.key} ${e.how} with ${e.problems.join('; ')}`);
    for (const p of r.post) lines.push(`${r.name} (${r.from} -> ${r.to}): after the change, ${p}`);
  }
  t.diagnostic(`${title}: ${rec.length} transitions, ${shown} rows shown, ${early} shown before ready, ${lines.length} failures`);
  for (const [g, x] of groups) t.diagnostic(`  ${g}: ${x.steps} transitions, ${x.shown} rows shown, ${x.bad ? `FAIL ${x.bad} (${[...x.keys].join(', ')})` : 'pass'}`);
  if (lines.length) assert.fail(`${title}: ${lines.length} failing transitions\n${lines.join('\n')}`);
}

test('Menu reveal order 1/4: all 42 ordered league switches, from every period the source league offers, on a fresh board each', (t) => {
  const rec = [];
  const seen = new Map();
  const covered = new Set();
  const kinds = new Map();
  for (const a of LEAGUES) {
    for (const p of firstSeasonPeriods(a.id)) {
      if (!kinds.has(a.id)) kinds.set(a.id, new Set());
      kinds.get(a.id).add(kindOf(p));
      for (const b of LEAGUES) {
        if (b.id === a.id) continue;
        const run = observedBoard();
        const local = [];
        if (a.id !== 'nfl') step(run, local, `fresh board -> league ${a.id}`, `fresh nfl -> ${a.id}`, 'league', a.id);
        if (run.app.view.view.period !== p.id) step(run, local, `fresh ${a.id}: period ${run.app.view.view.period} -> ${p.id}`, `fresh ${a.id} period change`, 'period', p.id);
        step(run, local, `${a.id}[${kindOf(p)} ${p.id}] -> league ${b.id}`, `${a.id}[${kindOf(p)}] -> ${b.id}`, 'league', b.id);
        covered.add(`${a.id}>${b.id}`);
        for (const r of local) {
          // a setup step repeats exactly on every fresh board: report it once
          const sig = JSON.stringify([r.bad.map((e) => [e.key, e.problems]), r.post]);
          if (seen.has(r.name)) {
            same(sig, seen.get(r.name), `${r.name} is deterministic`);
            continue;
          }
          seen.set(r.name, sig);
          rec.push(r);
        }
      }
    }
  }
  same(covered.size, 42, 'every ordered pair of the seven leagues');
  for (const id of ['nfl', 'nba', 'mlb', 'nhl', 'ncaaf']) assert.deepEqual([...kinds.get(id)].sort(), ['postseason', 'regular'], id);
  for (const id of ['ncaab', 'ncaaw']) assert.deepEqual([...kinds.get(id)].sort(), ['regular', 'tournament'], id);
  report(t, rec, 'fresh-board league switches');
});

test('Menu reveal order 2/4: the same switches walked on one board, so each starts from whatever the previous context left', (t) => {
  const rec = [];
  const run = observedBoard();
  let i = 0;
  for (const a of LEAGUES) {
    for (const p of firstSeasonPeriods(a.id)) {
      for (const b of LEAGUES) {
        if (b.id === a.id) continue;
        const g = `${a.id}[${kindOf(p)}] -> ${b.id}`;
        if (run.app.view.league.id !== a.id) step(run, rec, `#${++i} ${describe(run.app)} -> league ${a.id}`, g, 'league', a.id);
        if (run.app.view.view.period !== p.id) step(run, rec, `#${++i} ${describe(run.app)} -> period ${p.id}`, g, 'period', p.id);
        step(run, rec, `#${++i} ${describe(run.app)} -> league ${b.id}`, g, 'league', b.id);
      }
    }
  }
  report(t, rec, 'one-board league walk');
});

test('Menu reveal order 3/4: every period change within every league, including the tournament periods that show Tournament and Round', (t) => {
  const rec = [];
  for (const l of LEAGUES) {
    const run = observedBoard();
    if (l.id !== 'nfl') step(run, rec, `fresh board -> league ${l.id}`, `fresh nfl -> ${l.id}`, 'league', l.id);
    const list = firstSeasonPeriods(l.id);
    let i = 0;
    for (const p of list) {
      for (const q of list) {
        if (q.id === p.id) continue;
        if (run.app.view.view.period !== p.id) step(run, rec, `${l.id} #${++i} ${describe(run.app)} -> period ${p.id}`, `${l.id} ${kindOf(run.app.view.period)} -> ${kindOf(p)}`, 'period', p.id);
        step(run, rec, `${l.id} #${++i} ${describe(run.app)} -> period ${q.id}`, `${l.id} ${kindOf(p)} -> ${kindOf(q)}`, 'period', q.id);
      }
    }
  }
  report(t, rec, 'within-league period changes');
});

test('Menu reveal order 4/4: named paths: NBA to MLB to NFL, out and back, college tournaments and rounds, back to NFL from a tournament period, filter reveals, screens, reopening', (t) => {
  const rec = [];
  const path = (name, moves) => {
    const run = observedBoard();
    for (const [key, value] of moves) step(run, rec, `${name}: ${typeof key === 'function' ? value : `${key} ${value}`}`, name, key, value);
  };
  path('NBA -> MLB -> NFL', [['league', 'nba'], ['league', 'mlb'], ['league', 'nfl']]);
  path('NFL -> MLB -> NFL', [['league', 'mlb'], ['league', 'nfl']]);
  path('NFL -> NCAAF -> NFL', [['league', 'ncaaf'], ['league', 'nfl']]);
  path('NCAAB -> NCAAF -> MLB -> NBA -> NFL', [['league', 'ncaab'], ['league', 'ncaaf'], ['league', 'mlb'], ['league', 'nba'], ['league', 'nfl']]);
  for (const l of ['ncaab', 'ncaaw']) {
    const reg = firstSeasonPeriods(l).find((p) => p.phase === 'regular').id;
    path(`${l} tournaments`, [['league', l], ['period', 'opening'], ['period', 'weekend-1'], ['tournament', 'inv'], ['tournament', 'all'], ['tournament', 'ncaa'], ['period', 'weekend-2'], ['round', 's16'], ['period', 'final-weekend'], ['tournament', 'inv'], ['period', reg], ['period', 'weekend-2'], ['league', 'nfl']]);
  }
  path('NCAAB all tournaments -> NCAAW tournament -> NFL', [['league', 'ncaab'], ['period', 'weekend-1'], ['tournament', 'all'], ['league', 'ncaaw'], ['period', 'weekend-1'], ['tournament', 'inv'], ['league', 'nfl']]);
  path('NCAAF subdivision', [['league', 'ncaaf'], ['subdivision', 'fcs'], ['subdivision', 'fbs'], ['league', 'ncaab']]);
  path('two screens', [['league', 'nba'], ['league', 'mlb'], ['screen', '1'], ['screen', '0'], ['league', 'ncaaw'], ['period', 'weekend-1'], ['screen', '1'], ['league', 'ncaab'], ['screen', '0']]);
  path('reopen the Menu', [['league', 'mlb'], [(app) => app.closeMenu(), 'close the Menu'], [(app) => app.openMenu(), 'open the Menu'], ['league', 'ncaaf']]);
  report(t, rec, 'named paths');
});

// ---------- 008: Sport -> League, with a fixed clock ----------
const CLOCK = Date.parse('2026-11-12T20:30:00Z'); // Thu Nov 12, 2:30 PM Central
const SPORT_OF = { nfl: 'football', ncaaf: 'football', nba: 'basketball', ncaab: 'basketball', ncaaw: 'basketball', mlb: 'baseball', nhl: 'hockey' };
const FIRST_OF = { football: 'nfl', basketball: 'nba', baseball: 'mlb', hockey: 'nhl' };
function clockBoard() {
  const win = new FakeWindow({ width: 1440, height: 900, now: CLOCK });
  const doc = win.document;
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const app = mountBoard({ win, doc, root });
  app.openMenu();
  const run = { win, doc, root, app, events: [], step: 'start' };
  // every new or filter row that turns visible must already be filled for the current view
  const check = (key) => {
    const v = app.view;
    if (key === 'date') return v.daily ? dateProblems(app) : [`date button shown for ${v.league.id} ${v.period.id}`]; // 008002: a regular-season date only, already filled
    return rowProblems(app, key);
  };
  for (const key of FILTER_KEYS) {
    const node = uiRow(app, key);
    const own = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'hidden');
    Object.defineProperty(node, 'hidden', {
      configurable: true,
      get() {
        return own.get.call(this);
      },
      set(v) {
        if (!v && own.get.call(this)) run.events.push({ step: run.step, key, problems: check(key) });
        own.set.call(this, v);
      },
    });
  }
  return run;
}
const dateLabel = (key) => cat.resolve({ league: 'nba', period: `d${key}` }, 'America/Chicago').period.label;
function go(run, key, value) {
  run.step = `${key} ${value}`;
  choose(run.app, key, value);
  const { app, doc } = run;
  const v = app.view;
  const out = [];
  if (doc.activeElement !== sel(app, key)) out.push(`focus left the ${key} dropdown`);
  const all = SPORT_GROUPS.flatMap(sp=>sp.leagues);
  if (values(app,'league').join()!==all.join()) out.push('grouped league options');
  if (uiValue(app,'league')!==v.league.id) out.push('league value');
  if (uiControl(app,'period').getAttribute('aria-haspopup')!==(v.daily?'dialog':'listbox')) out.push('period picker type');
  if (v.daily && v.period.kind==='date') for (const problem of dateProblems(app)) out.push(problem);
  const want = v.controls.filter((c) => c.visible).map((c) => c.key).sort().join();
  if (shownRows(app).filter((k) => FILTER_KEYS.includes(k)).sort().join() !== want) out.push('filter rows');
  if (app.cards.size !== v.games.length || app.menu.context.textContent !== `${app.screen.name} · ${countText(v.games.length)}`) out.push('counts');
  // All current-state and reveal checks above have consumed their inputs.
  run.doc.releaseDetachedCreatedNodes();
  return out;
}

test('Grouped League: four named sport groups contain all seven leagues, each direct choice keeps focus and fills its current filters before showing them', () => {
  const run=clockBoard(); const {app}=run;
  assert.deepEqual(app.header.pickers.get('league').list.children.map(g=>g.getAttribute('aria-label')), ['Football','Basketball','Baseball','Hockey']);
  same(app.menu.rows.has('sport'),false,'no Sport prerequisite');
  for (const sp of SPORT_GROUPS) for (const id of sp.leagues) {
    assert.deepEqual(go(run,'league',id),[],id);
    same(app.view.league.id,id);
    if(app.view.daily){ same(app.view.period.id,'d2026-11-12'); assert.ok(app.view.games.length>0); }
  }
  assert.ok(!values(app,'league').includes('curling'),'invalid sport is not offered');
  assert.deepEqual(run.events.filter(e=>e.problems.length),[]);
});

test('all 42 ordered league switches through grouped League with a fixed clock, from a fresh board each: rows filled before shown, focus kept, counts right; then back to NFL', (t) => {
  let switches = 0;
  let shown = 0;
  const bad = [];
  for (const a of LEAGUES) {
    for (const b of LEAGUES) {
      if (a.id === b.id) continue;
      const run = clockBoard();
      const path = [];
      const move = (id) => {
        if (run.app.view.league.id !== id) path.push(['league', id]);
      };
      const exec = () => {
        for (const [k, v] of path.splice(0)) {
          if ((k === 'league' && run.app.view.league.id === v)) continue;
          for (const p of go(run, k, v)) bad.push(`${a.id}>${b.id} ${k} ${v}: ${p}`);
        }
      };
      move(a.id);
      exec();
      same(run.app.view.league.id, a.id);
      move(b.id);
      exec();
      same(run.app.view.league.id, b.id, `${a.id} -> ${b.id}`);
      if (b.periodKind === 'date') same(run.app.view.period.id, 'd2026-11-12');
      move('nfl');
      exec();
      same(run.app.view.league.id, 'nfl');
      same(run.app.view.period.id, 'w11', 'back to NFL Week 11');
      switches++;
      shown += run.events.length;
      for (const e of run.events) if (e.problems.length) bad.push(`${a.id}>${b.id} at ${e.step}: ${e.key} shown with ${e.problems.join('; ')}`);
    }
  }
  t.diagnostic(`sport/league switches: ${switches} ordered pairs, ${shown} rows shown, ${bad.length} failures`);
  same(switches, 42);
  assert.deepEqual(bad, []);
});

test('both college tournament paths through League: Basketball, NCAAB or NCAAW, a tournament period, NCAA and invitational rounds, then NFL', () => {
  for (const l of ['ncaab', 'ncaaw']) {
    const run = clockBoard();
    const { app } = run;
    const steps = [['league', 'nba'], ['league', l], ['period', 'weekend-2'], ['round', 's16'], ['tournament', 'inv'], ['round', 'inv-qf'], ['tournament', 'all'], ['period', 'final-weekend'], ['tournament', 'ncaa'], ['round', 'title'], ['league', 'nfl']];
    for (const [k, v] of steps) {
      assert.deepEqual(go(run, k, v), [], `${l} ${k} ${v}`);
      if (k === 'round' && v === 's16') assert.ok(app.view.games.length === 4 && app.view.games.every((g) => g.round === 's16' && g.tournament === 'ncaa'));
      if (k === 'round' && v === 'inv-qf') assert.ok(app.view.games.length > 0 && app.view.games.every((g) => g.tournament === 'inv'));
      if (k === 'period') assert.ok(!uiRow(app, 'period').hidden && app.header.calendar.root.hidden && !app.calendarOpen, 'round keeps the shared period button reachable and closes the calendar'); // 008002
    }
    same(app.view.league.id, 'nfl');
    same(app.view.period.id, 'w11');
    assert.deepEqual(run.events.filter((e) => e.problems.length), []);
    assert.ok(run.events.some((e) => e.key === 'round') && run.events.some((e) => e.key === 'tournament'));
  }
});

// ---------- 008002 (E1): the Date control in the reveal-order observer ----------
test('Menu reveal order, Date control: every Regular season <-> named round switch in all five daily leagues and every season fills the Date label and chosen date after the foreground period updates, keeps the same control and focus, and returns to the chosen date', (t) => {
  const rec = [];
  for (const l of DAILY_LEAGUES) {
    for (const s of cat.seasons(l, 'America/Chicago')) {
      const run = observedBoard();
      const g = `${l} ${s.id}`;
      step(run, rec, `${g}: league ${l}`, g, 'league', l);
      if (run.app.view.view.season !== s.id) step(run, rec, `${g}: season ${s.id}`, g, 'season', s.id);
      // a chosen day other than the default, so each return proves the date is kept
      const kept = run.app.view.periods.filter((p) => p.kind === 'date').map((p) => p.id).find((id) => id !== run.app.view.view.period);
      step(run, rec, `${g}: day ${kept}`, g, 'period', kept);
      same(run.app.view.view.period, kept);
      const rounds = run.app.view.periods.filter((p) => p.phase === 'post').map((p) => p.id);
      assert.ok(rounds.length >= 4, `${g}: named rounds`);
      for (const r of rounds) {
        step(run, rec, `${g}: Regular season -> ${r}`, g, 'period', r);
        same(uiRow(run.app, 'period').hidden, false, `${g} ${r}: the shared period button remains visible`);
        same(uiControl(run.app,'period').focusable(), true, `${g} ${r}: the shared period button remains reachable`);
        step(run, rec, `${g}: ${r} -> Regular season`, g, 'period', REGULAR_CHOICE);
        same(run.app.view.view.period, kept, `${g}: back on the chosen day after ${r}`);
      }
    }
  }
  const toRound = rec.filter((r) => / -> (?!Regular season)[^ ]+$/.test(r.name) && r.name.includes('Regular season ->'));
  const toRegular = rec.filter((r) => r.name.endsWith('-> Regular season'));
  const reveals = rec.flatMap((r) => r.shown.filter((e) => e.key === 'date'));
  t.diagnostic(`Date control: ${toRound.length} Regular season -> round and ${toRegular.length} round -> Regular season transitions in ${DAILY_LEAGUES.length} daily leagues, ${reveals.length} Date row reveals, ${reveals.filter((e) => e.problems.length).length} shown before ready`);
  same(toRound.length, toRegular.length);
  assert.ok(toRegular.length >= 40, `${toRegular.length} returns to Regular season`);
  assert.ok(toRegular.every((r) => r.shown.filter((e) => e.key === 'date').length === 1), 'every return to Regular season records the selected date once per return');
  assert.ok(toRound.every((r) => r.shown.every((e) => e.key !== 'date')), 'a round does not claim to show a regular date');
  report(t, rec, 'Date control Regular season <-> round');
});

// 011: history is kept until the case has checked it, then explicitly released.
test('fake DOM case cleanup releases detached history while preserving connected controls, identity, listeners and all DOM content', () => {
  const doc = new FakeDocument();
  const control = doc.createElement('button');
  control.textContent = 'Retained control';
  doc.body.appendChild(control);
  let clicks = 0;
  control.addEventListener('click', () => { clicks++; });
  const old = doc.createElement('div');
  const child = doc.createElement('button');
  old.appendChild(child);
  doc.body.appendChild(old);
  doc.body.removeChild(old);
  same(doc.created.length, 3, 'creation history survives until its assertions');
  assert.ok(doc.created.includes(old) && doc.created.includes(child));
  const live = doc.body.all(() => true);
  same(doc.releaseDetachedCreatedNodes(), 2);
  sameNodes(doc.created, [control], 'connected creation inventory');
  sameNodes(doc.body.all(() => true), live, 'cleanup does not remove DOM nodes');
  same(control.parentNode, doc.body);
  same(control.textContent, 'Retained control');
  same(control.listenerCount('click'), 1);
  control.click();
  same(clicks, 1, 'listeners still work');
  same(child.parentNode, old, 'detached subtree is not altered');
  same(doc.releaseDetachedCreatedNodes(), 0, 'a later cleanup keeps the connected inventory');
});

function sameNodes(actual, expected, message) { same(actual.length, expected.length, message); actual.forEach((node, i) => same(node, expected[i], message)); }

function same(a,b,msg) { const short=x=>x===null||typeof x!=='object'&&typeof x!=='function'?String(x).slice(0,160):'<object>'; assert.ok(a===b,msg||`${short(a)} !== ${short(b)}`); }

function notSame(a,b,msg) { assert.ok(a!==b,msg||'Expected different values or identities'); }
