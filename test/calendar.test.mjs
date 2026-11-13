import { uiChoose, uiControl, uiOptions, uiRow, uiLabel, uiValue } from './fake-dom.mjs';
// Daily schedules anchored to an injected clock, and the Date calendar in the
// Menu, through the real handlers on the fake DOM. Every clock here is a fixed
// instant: nothing depends on when the tests run. Model tests, not browser or
// device evidence. 008002: a daily league's Period holds one Regular season
// choice and the named rounds; the Date control is the only date chooser and a
// round hides it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWindow, FakeEvent } from './fake-dom.mjs';
import { mountBoard, REGULAR_CHOICE } from '../public/lib/board.mjs';
import { buildCatalog, LEAGUES, ZONES, DAILY_LEAGUES, localDateKey, dayDiff, validDateKey, shiftKey, dateKeyLabel } from '../public/lib/catalog.mjs';
import { optionsOf } from '../public/lib/menu.mjs';
import { monthGrid, moveKey, addMonths, dayWords, monthTitle } from '../public/lib/calendar.mjs';

const ZONE_IDS = ZONES.map((z) => z.value);
const CT = 'America/Chicago';
const at = (iso) => Date.parse(iso);
// Fixed clocks: today, daylight-time starts and ends, a leap day, month and year
// rollovers, and instants where the date differs between zones.
const CLOCKS = {
  today: at('2026-11-12T20:30:00Z'),
  dstStart: at('2027-03-14T08:30:00Z'),
  dstEnd: at('2026-11-01T07:30:00Z'),
  leapDay: at('2028-02-29T18:00:00Z'),
  monthEnd: at('2027-04-30T23:30:00Z'),
  yearEnd: at('2026-12-31T23:59:00Z'),
  newYear: at('2027-01-01T00:01:00Z'),
  zoneMidnight: at('2026-11-13T05:30:00Z'), // Thu 11:30 PM Central, Fri 12:30 AM Eastern, Fri 5:30 AM UTC
  nextAutumn: at('2027-11-14T16:00:00Z'),
};
const plain = buildCatalog();
const SAFE = (g) => {
  const { kickoff, ...rest } = g;
  return JSON.stringify(rest);
};

test('daily leagues anchor to the clock: today in every zone is the original current slate, with games; every other date keeps its signed distance and wall-clock time; games, scores, plays, statuses and ids do not change', () => {
  const wallFormatter = new Intl.DateTimeFormat('en-US', { timeZone: CT, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const wall = (iso) => wallFormatter.format(new Date(iso));
  let games = 0;
  for (const [name, now] of Object.entries(CLOCKS)) {
    const cat = buildCatalog({ now });
    for (const l of LEAGUES) {
      for (const z of ZONE_IDS) {
        const today = localDateKey(new Date(now).toISOString(), z);
        const r = cat.resolve({ league: l.id }, z);
        const days = cat.anchorDays(l.id, z);
        if (l.periodKind !== 'date') {
          same(days, 0, `${l.id}: football weeks never move`);
          assert.deepEqual(r.games.map((g) => g.kickoff), plain.resolve({ league: l.id }, z).games.map((g) => g.kickoff));
          continue;
        }
        same(r.today, today, `${name} ${l.id} ${z}`);
        same(r.period.id, `d${today}`, `${name} ${l.id} ${z}: the default date is today`);
        assert.ok(r.games.length > 0, `${name} ${l.id} ${z}: today's slate has games`);
        same(days, dayDiff(localDateKey(l.simNow, z), today));
        for (const s of cat.seasons(l.id, z)) {
          const moved = cat.allGames(l.id, s.id, z);
          const orig = plain.allGames(l.id, s.id, z);
          same(moved.length, orig.length);
          same(new Set(moved.map((g) => g.id)).size, moved.length, 'no duplicate ids');
          moved.forEach((g, i) => {
            const o = orig[i];
            same(g.id, o.id);
            same(SAFE(g), SAFE(o), `${g.id}: only the start moved`);
            same(dayDiff(localDateKey(o.kickoff, CT), localDateKey(g.kickoff, CT)), days, `${g.id}: same signed distance`);
            same(wall(g.kickoff), wall(o.kickoff), `${g.id}: same Central start time`);
            games++;
          });
        }
      }
    }
  }
  console.log(`anchored game starts checked: ${games}`);
  assert.ok(games > 10000);
});

test('zone midnight, daylight time, leap day and year rollover: today follows the chosen zone and each daily league default shows that date', () => {
  const cat = buildCatalog({ now: CLOCKS.zoneMidnight });
  same(cat.resolve({ league: 'nba' }, CT).period.id, 'd2026-11-12');
  same(cat.resolve({ league: 'nba' }, 'America/New_York').period.id, 'd2026-11-13');
  same(cat.resolve({ league: 'nba' }, 'UTC').period.id, 'd2026-11-13');
  same(cat.resolve({ league: 'nba' }, 'America/Los_Angeles').period.id, 'd2026-11-12');
  const leap = buildCatalog({ now: CLOCKS.leapDay });
  for (const id of DAILY_LEAGUES) same(leap.resolve({ league: id }, CT).period.label, 'Tue Feb 29', id);
  const ny = buildCatalog({ now: CLOCKS.newYear });
  same(ny.resolve({ league: 'mlb' }, 'UTC').period.id, 'd2027-01-01');
  same(ny.resolve({ league: 'mlb' }, CT).period.id, 'd2026-12-31');
  for (const z of ZONE_IDS) for (const id of DAILY_LEAGUES) assert.ok(ny.resolve({ league: id }, z).games.length > 0, `${id} ${z} at the new year`);
  // across the spring daylight change the Central start times are unchanged
  const spring = buildCatalog({ now: CLOCKS.dstStart });
  const r = spring.resolve({ league: 'nhl' }, CT);
  same(r.period.id, 'd2027-03-14');
  for (const g of r.games) assert.ok(/^(11|12|14|15|19):(00|30)$/.test(new Intl.DateTimeFormat('en-US', { timeZone: CT, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(g.kickoff))), g.kickoff);
  // a year away, the demo season labels move with the schedule
  const later = buildCatalog({ now: CLOCKS.nextAutumn });
  assert.deepEqual(later.seasons('nba', CT).map((s) => s.label), ['2027–28 demo season', '2026–27 demo season']);
  assert.deepEqual(later.seasons('mlb', CT).map((s) => s.label), ['2027 demo season', '2026 demo season']);
  assert.deepEqual(later.seasons('nfl', CT).map((s) => s.label), ['2026 demo season', '2025 demo season'], 'football weeks and labels never move');
  assert.deepEqual(buildCatalog({ now: CLOCKS.today }).seasons('nba', CT).map((s) => s.label), plain.seasons('nba', CT).map((s) => s.label));
});

test('any valid date can be chosen: a date without games is an honest empty board for that date, never another date; invalid dates are refused', () => {
  const cat = buildCatalog({ now: CLOCKS.today });
  for (const id of DAILY_LEAGUES) {
    const r = cat.resolve({ league: id, period: 'd2026-11-20' }, CT);
    same(r.period.id, 'd2026-11-20');
    same(r.period.label, 'Fri Nov 20');
    assert.deepEqual(r.games, [], `${id}: no games outside the slates`);
    assert.ok(r.periods.some((p) => p.id === 'd2026-11-20'), 'the chosen date is listed so the dropdown can show it');
    for (const bad of ['d2026-02-30', 'd2026-13-01', 'd2026-11-31', 'dnope', 'd2027-02-29']) {
      same(cat.resolve({ league: id, period: bad }, CT).period.id, 'd2026-11-12', `${id} refuses ${bad}`);
    }
    same(cat.resolve({ league: id, period: 'd2028-02-29' }, CT).period.id, 'd2028-02-29', 'a real leap day is a date');
  }
  assert.ok(validDateKey('2028-02-29') && !validDateKey('2027-02-29') && !validDateKey('2026-04-31'));
  same(cat.resolve({ league: 'nfl', period: 'd2026-11-20' }, CT).period.id, 'w11', 'football has no dates');
  // the other demo season maps to the same day a season apart
  const r = cat.resolve({ league: 'nba' }, CT);
  const prev = cat.seasons('nba', CT)[1].id;
  const eq = cat.equivalentPeriod('nba', r.season.id, prev, r.period.id, CT);
  same(eq, `d${shiftKey('2026-11-12', -364)}`);
  assert.ok(cat.resolve({ league: 'nba', season: prev, period: eq }, CT).games.length > 0);
});

test('month grid, keyboard moves and words: six whole weeks from Sunday, leap years, month ends and year ends', () => {
  const g = monthGrid({ y: 2026, m: 11 });
  same(g.length, 42);
  same(g[0], '2026-11-01', 'Nov 1 2026 is a Sunday');
  same(g[41], '2026-12-12');
  const feb = monthGrid({ y: 2028, m: 2 });
  same(feb[0], '2028-01-30');
  assert.ok(feb.includes('2028-02-29'));
  same(moveKey('2026-12-31', 'ArrowRight'), '2027-01-01');
  same(moveKey('2027-01-01', 'ArrowLeft'), '2026-12-31');
  same(moveKey('2028-02-26', 'ArrowDown'), '2028-03-04');
  same(moveKey('2028-01-31', 'PageDown'), '2028-02-29');
  same(moveKey('2027-01-31', 'PageDown'), '2027-02-28');
  same(moveKey('2027-03-31', 'PageUp'), '2027-02-28');
  same(moveKey('2026-11-12', 'Home'), '2026-11-08');
  same(moveKey('2026-11-12', 'End'), '2026-11-14');
  same(moveKey('2026-11-12', 'Enter'), null);
  assert.deepEqual(addMonths({ y: 2026, m: 12 }, 1), { y: 2027, m: 1 });
  assert.deepEqual(addMonths({ y: 2027, m: 1 }, -1), { y: 2026, m: 12 });
  same(monthTitle({ y: 2027, m: 1 }), 'January 2027');
  same(dayWords('2028-02-29'), 'Tuesday, February 29, 2028');
});

function setup(now = CLOCKS.today, { width = 1920, height = 1080 } = {}) {
  const win = new FakeWindow({ width, height, now });
  const doc = win.document;
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const app = mountBoard({ win, doc, root });
  app.openMenu();
  return { win, doc, app };
}
const click = (el) => {
  // Header controls are outside the settings sheet: close it through its real button.
  const sheet = el.ownerDocument.getElementById('menu');
  if (sheet && !sheet.hidden && el.closest('#head')) sheet.byClass('sheet-close')[0].dispatchEvent(new FakeEvent('click'));
  return el.dispatchEvent(new FakeEvent('click', { detail: 1 }));
};
const key = (el, k) => el.dispatchEvent(new FakeEvent('keydown', { key: k }));
const same = (a, b, msg) => assert.ok(a === b, msg);
function choose(app, k, value) { return uiChoose(app, k, value); }
const cell = (app, k) => app.header.calendar.cells.find((c) => c.button.getAttribute('data-key') === k);

test('Date control: each daily league opens on today with games; the calendar opens on the selected day, marks game days in this and the neighbouring months, today and the selection', () => {
  for (const id of DAILY_LEAGUES) {
    const { app, doc } = setup();
    choose(app, 'league', id);
    assert.ok(app.view.games.length > 0, `${id}: today's default slate shows games`);
    same(app.view.period.id, 'd2026-11-12');
    const row = uiRow(app, 'date');
    same(row.hidden, false);
    same(uiControl(app, 'period').textContent, 'Thu Nov 12');
    same(uiControl(app, 'period').getAttribute('aria-controls'), app.header.periodPanel.id);
    assert.ok(uiControl(app, 'period').getAttribute('aria-label').includes('Date or round'));
    click(uiControl(app, 'period'));
    same(app.calendarOpen, true);
    same(app.header.calendar.root.hidden, false);
    same(uiControl(app, 'period').getAttribute('aria-expanded'), 'true');
    same(app.header.calendar.title.textContent, 'November 2026');
    const today = cell(app, '2026-11-12');
    same(doc.activeElement, today.button, 'focus on the selected day');
    same(today.button.tabIndex, 0);
    same(app.header.calendar.cells.filter((c) => c.button.tabIndex === 0).length, 1, 'one day in the tab order');
    assert.ok(today.button.hasClass('today') && today.button.hasClass('sel') && today.button.hasClass('has'));
    assert.match(today.button.getAttribute('aria-label'), /^Thursday, November 12, 2026, \d+ games?, today, selected$/);
    same(today.td.getAttribute('aria-selected'), 'true');
    same(today.mark.textContent, '•');
    for (const c of app.header.calendar.cells) {
      const n = app.view.gameDays.get(c.button.getAttribute('data-key')) ?? 0;
      same(c.button.hasClass('has'), n > 0, `${id} ${c.button.getAttribute('data-key')}`);
    }
    const marked = app.header.calendar.cells.filter((c) => c.button.hasClass('has')).map((c) => c.button.getAttribute('data-key'));
    assert.ok(marked.length >= 3, `${id}: game days are marked`);
    key(today.button, 'Escape');
    same(app.calendarOpen, false, 'Escape closes the calendar');
    same(app.menuOpen, false, 'the foreground calendar does not open settings Menu');
    same(doc.activeElement, uiControl(app, 'period'), 'focus returns to the Date button');
  }
  // neighbouring months: on Nov 30 the NBA slate spans Nov 29 to Dec 1, so each
  // month's grid marks the other month's game days too
  const { app } = setup(Date.parse('2026-11-30T20:00:00Z'));
  choose(app, 'league', 'nba');
  click(uiControl(app, 'period'));
  same(app.header.calendar.title.textContent, 'November 2026');
  const dec1 = cell(app, '2026-12-01');
  assert.ok(dec1.button.hasClass('other') && dec1.button.hasClass('has'), 'Dec 1 is marked from November');
  click(app.header.calendar.next);
  same(app.header.calendar.title.textContent, 'December 2026');
  for (const k of ['2026-11-29', '2026-11-30']) assert.ok(cell(app, k).button.hasClass('other') && cell(app, k).button.hasClass('has'), `${k} is marked from December`);
  assert.ok(cell(app, '2026-11-30').button.hasClass('today') && cell(app, '2026-11-30').button.hasClass('sel'), 'today and the selection show in the neighbouring month');
  click(app.header.calendar.prev);
  click(app.header.calendar.prev);
  same(app.header.calendar.title.textContent, 'October 2026');
  same(app.header.calendar.cells.filter((c) => c.button.hasClass('has')).length, 0, 'no games in October');
});

test('calendar keyboard and mouse: arrows, Home, End and Page keys move the one focusable day; picking a day with games shows them; a day without games says so with Today; Today resets; GoBack closes only the calendar', () => {
  const { app, doc } = setup();
  choose(app, 'league', 'nhl');
  click(uiControl(app, 'period'));
  const at = () => doc.activeElement.getAttribute('data-key');
  key(doc.activeElement, 'ArrowRight');
  same(at(), '2026-11-13');
  key(doc.activeElement, 'ArrowDown');
  same(at(), '2026-11-20');
  key(doc.activeElement, 'Home');
  same(at(), '2026-11-15');
  key(doc.activeElement, 'End');
  same(at(), '2026-11-21');
  key(doc.activeElement, 'PageDown');
  same(at(), '2026-12-21');
  same(app.header.calendar.title.textContent, 'December 2026');
  key(doc.activeElement, 'PageUp');
  key(doc.activeElement, 'ArrowUp');
  same(at(), '2026-11-14');
  same(app.header.calendar.cells.filter((c) => c.button.tabIndex === 0).length, 1);
  // a day with games
  click(cell(app, '2026-11-11').button);
  same(app.calendarOpen, false);
  same(app.view.period.id, 'd2026-11-11');
  assert.ok(app.view.games.length > 0);
  same(uiControl(app, 'period').textContent, 'Wed Nov 11');
  same(doc.activeElement, uiControl(app, 'period'));
  assert.match(app.live.textContent, /^Date: Wednesday, November 11, 2026\. \d+ games: NHL · /);
  // a day without games: honest empty board, Today offered, nothing substituted
  click(uiControl(app, 'period'));
  click(cell(app, '2026-11-26').button);
  same(app.view.period.id, 'd2026-11-26');
  same(app.cards.size, 0);
  same(app.empty.hidden, false);
  assert.match(app.empty.textContent, /^No games on Thursday, November 26, 2026\./);
  const todayBtn = app.empty.byClass('empty-today')[0];
  same(todayBtn.hidden, false);
  same(todayBtn.textContent, 'Today');
  // 008002: Period shows Regular season; the Date control shows the chosen date
  same(uiValue(app, 'period'), REGULAR_CHOICE, 'Period shows Regular season');
  same(uiControl(app, 'period').textContent, 'Thu Nov 26', 'the Date control shows the chosen date');
  // the choice survives a time zone change, a presentation change and closing the Menu
  choose(app, 'zone', 'America/Denver');
  choose(app, 'presentation', 'phone');
  app.closeMenu();
  app.openMenu();
  same(app.view.period.id, 'd2026-11-26');
  // Today from the calendar
  click(uiControl(app, 'period'));
  click(app.header.calendar.today);
  same(app.view.period.id, 'd2026-11-12');
  assert.ok(app.cards.size > 0);
  same(app.calendarOpen, false);
  // Today from the empty board
  click(uiControl(app, 'period'));
  click(cell(app, '2026-11-25').button);
  app.closeMenu();
  click(app.empty.byClass('empty-today')[0]);
  same(app.view.period.id, 'd2026-11-12');
  same(doc.activeElement, app.cards.get(app.order[0]).root, 'focus moves to the first game');
  // GoBack and BrowserBack close the calendar, not the Menu
  app.openMenu();
  for (const k of ['GoBack', 'BrowserBack', 'Esc']) {
    click(uiControl(app, 'period'));
    key(doc.activeElement, k);
    same(app.calendarOpen, false, k);
    same(app.menuOpen, false, k);
  }
  app.openMenu();
  key(doc.activeElement, 'Escape');
  same(app.menuOpen, false, 'Escape still closes the settings Menu');
});

test('switching to a football league changes the period button to a week picker and closes the calendar; a postseason round keeps the calendar reachable; Today returns from the other season', () => {
  const { app, doc } = setup();
  choose(app, 'league', 'nba');
  click(uiControl(app, 'period'));
  choose(app, 'league', 'nfl');
  same(app.calendarOpen, false);
  same(app.header.calendar.root.hidden, true);
  same(uiControl(app, 'period').getAttribute('aria-haspopup'), 'listbox');
  same(doc.activeElement, uiControl(app, 'league'));
  choose(app, 'league', 'ncaab');
  choose(app, 'period', 'weekend-2');
  same(uiRow(app, 'tournament').hidden, false);
  // 008002: a round hides the Date control; the calendar is reached again through Period, Regular season
  same(uiRow(app, 'period').hidden, false, 'a round keeps the shared period button visible');
  click(uiControl(app, 'period'));
  same(app.calendarOpen, true, 'the shared period button also opens the calendar from a round');
  choose(app, 'period', REGULAR_CHOICE);
  same(uiRow(app, 'date').hidden, false);
  click(uiControl(app, 'period'));
  same(app.header.calendar.title.textContent, 'November 2026', 'opens on today');
  click(app.header.calendar.today);
  same(app.view.period.id, 'd2026-11-12');
  choose(app, 'season', app.view.seasons[1].id);
  same(app.view.period.id, `d${shiftKey('2026-11-12', -364)}`, 'the same day of the other demo season');
  assert.ok(app.cards.size > 0);
  click(uiControl(app, 'period'));
  click(app.header.calendar.today);
  same(app.view.season.id, app.view.seasons[0].id, 'Today returns to the current demo season');
  same(app.view.period.id, 'd2026-11-12');
});

// ---------- 008002: one Regular season choice, one Date control ----------
const DATED = /^d\d{4}-\d{2}-\d{2}$/;
const periodPairs = (app) => uiOptions(app, 'period').map((o) => [o.value, o.textContent]);
function pickDay(app, k) {
  click(uiControl(app, 'period'));
  same(app.calendarOpen, true, 'the Date control opens the calendar');
  for (let i = 0; i < 36 && !cell(app, k); i++) click(k < app.calendarState.focus ? app.header.calendar.prev : app.header.calendar.next);
  click(cell(app, k).button);
}

test('daily Period in every league, season, time zone and chosen date: exactly one Regular season choice and the named rounds, never a dated slate; the one Date control is the only calendar opener and a round keeps the shared period entrypoint', () => {
  let states = 0;
  for (const id of DAILY_LEAGUES) {
    const { app } = setup();
    choose(app, 'league', id);
    const btn = uiControl(app, 'period');
    for (const season of app.view.seasons) {
      choose(app, 'season', season.id);
      for (const z of ZONE_IDS) {
        choose(app, 'zone', z);
        const rounds = app.view.periods.filter((p) => p.phase === 'post');
        assert.ok(rounds.length >= 4, `${id} ${season.id}: named rounds`);
        const want = [[REGULAR_CHOICE, 'Regular season'], ...rounds.map((p) => [p.id, p.label])];
        const start = app.view.period.dateKey;
        const withGames = [...app.view.gameDays.keys()].sort();
        // the current date, the first and last game days and a date without games
        for (const k of [start, withGames[0], withGames[withGames.length - 1], shiftKey(start, 40)]) {
          if (app.view.period.kind !== 'date') choose(app, 'period', REGULAR_CHOICE);
          if (app.view.period.dateKey !== k) pickDay(app, k);
          const at = `${id} ${season.id} ${z} ${k}`;
          same(app.view.period.id, `d${k}`, at);
          assert.deepEqual(periodPairs(app), want, `${at}: Regular season and the rounds only`);
          assert.ok(periodPairs(app).every(([v, label]) => !DATED.test(v) && !withGames.some((d) => dateKeyLabel(d) === label)), `${at}: no dated slate`);
          same(uiValue(app, 'period'), REGULAR_CHOICE, at);
          same(app.menu.sheet.all((e) => e.tagName === 'OPTION' && DATED.test(e.value)).length, 0, `${at}: no date list anywhere in the Menu`);
          sameNodes(app.board.all(e => e.getAttribute('aria-controls') === app.header.periodPanel.id), [btn], `${at}: one period button opens the calendar dialog`);
          same(app.menu.sheet.all(e => e.getAttribute('aria-controls') === app.header.periodPanel.id).length, 0, 'no duplicate Menu entry');
          same(uiRow(app, 'date').hidden, false, at);
          same(btn.textContent, dateKeyLabel(k), at);
          states++;
        }
        const chosen = app.view.period.id;
        for (const r of rounds) {
          choose(app, 'period', r.id);
          const at = `${id} ${season.id} ${z} ${r.id}`;
          assert.deepEqual(periodPairs(app), want, at);
          same(uiValue(app, 'period'), r.id, at);
          assert.ok(!uiRow(app, 'period').hidden && app.header.calendar.root.hidden && !app.calendarOpen, `${at}: the shared button stays visible and the calendar closes`);
          same(btn.focusable(), true, `${at}: period remains in the tab order`);
          states++;
        }
        choose(app, 'period', REGULAR_CHOICE);
        same(app.view.period.id, chosen, `${id} ${season.id} ${z}: Regular season returns to the chosen date`);
      }
    }
  }
  assert.ok(states > 400, `${states} Menu states checked`);
});

test('Date control keys and focus: click, Enter, Space and a remote Select open the calendar; a round closes it and keeps the shared period button; Regular season returns to the chosen date, a fresh daily view starts on today; football weeks unchanged', () => {
  const { app, doc } = setup();
  choose(app, 'league', 'nba');
  const btn = uiControl(app, 'period');
  same(uiLabel(app, 'period').textContent, 'Date or round');
  for (const k of ['Enter', ' ']) {
    btn.focus();
    const ev = new FakeEvent('keydown', { key: k });
    btn.dispatchEvent(ev);
    same(ev.defaultPrevented, true, `${JSON.stringify(k)} opens explicitly and suppresses the native follow-up click`);
    same(app.calendarOpen, true);
    key(doc.activeElement, 'Escape');
    same(app.calendarOpen, false);
    same(doc.activeElement, btn, 'focus returns to the Date control');
  }
  const sel = new FakeEvent('keydown', { key: 'Select' });
  btn.dispatchEvent(sel);
  same(sel.defaultPrevented, true);
  same(app.calendarOpen, true, 'a remote Select opens the calendar');
  same(doc.activeElement, cell(app, '2026-11-12').button, 'on the chosen day');
  same(app.stats.calendarOpens, 3);
  // a round while the calendar is open: it closes, the control leaves the tab order, focus stays on Period
  choose(app, 'period', 'r1');
  same(app.calendarOpen, false);
  assert.ok(app.header.calendar.root.hidden && !uiRow(app, 'period').hidden);
  same(btn.focusable(), true);
  same(doc.activeElement, uiControl(app, 'period'));
  click(btn);
  same(app.calendarOpen, true, 'calendar reachable from a round');
  key(doc.activeElement, 'Escape');
  btn.dispatchEvent(new FakeEvent('keydown', { key: 'Select' }));
  same(app.calendarOpen, true, 'remote Select also opens the calendar from a round');
  key(doc.activeElement, 'Escape');
  // Regular season: today here, then a chosen day is kept across rounds and screens' own choices
  choose(app, 'period', REGULAR_CHOICE);
  same(app.view.period.id, 'd2026-11-12');
  pickDay(app, '2026-11-20');
  same(app.view.period.id, 'd2026-11-20');
  same(doc.activeElement, btn);
  for (const r of ['play-in', 'finals']) {
    choose(app, 'period', r);
    choose(app, 'period', REGULAR_CHOICE);
    same(app.view.period.id, 'd2026-11-20', `back from ${r}: the chosen date`);
    same(btn.textContent, 'Fri Nov 20');
  }
  const empty = shiftKey('2026-11-12', 60);
  pickDay(app, empty);
  same(app.cards.size, 0, 'an empty date stays an honest empty board');
  choose(app, 'period', 'r2');
  choose(app, 'period', REGULAR_CHOICE);
  same(app.view.period.id, `d${empty}`, 'an empty chosen date is kept too');
  choose(app, 'period', REGULAR_CHOICE);
  same(app.view.period.id, `d${empty}`, 'choosing Regular season again changes nothing');
  // a fresh daily view starts on today, also after a round
  choose(app, 'period', 'cf');
  choose(app, 'league', 'nhl');
  same(app.view.period.id, 'd2026-11-12');
  choose(app, 'league', 'nba');
  same(app.view.period.id, 'd2026-11-12', 'a fresh NBA view starts on today');
  // football: weeks and rounds as before, no Date control
  choose(app, 'league', 'nfl');
  assert.deepEqual(periodPairs(app).map((p) => p[1]), ['Week 10', 'Week 11', 'Week 12', 'Wild Card round', 'Divisional round', 'Conference championships', 'Championship game']);
  same(uiLabel(app, 'period').textContent, 'Week or round');
  same(uiControl(app, 'period').getAttribute('aria-haspopup'), 'listbox');
});

function sameNodes(a,b,msg) { same(a.length,b.length,msg); a.forEach((node,i)=>same(node,b[i],msg)); }
