import { uiChoose } from './fake-dom.mjs';
// 010 football priority frame: the decision table (both leagues, every margin
// and clock boundary, missing and invalid data, quarters, halftime, final,
// overtime and red zone), touchdown combinations (G4), the card and details
// window frame, fixture-reachable cases and the CSS that draws them. Model
// tests: the pixels themselves are checked in a browser, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeDocument, FakeWindow, FakeEvent } from './fake-dom.mjs';
import { footballPriority, footballClockSeconds, FOOTBALL_PRIORITY, FOOTBALL_CUE_STATUSES, cues } from '../public/lib/sports.mjs';
import { buildCard, buildScorecard, frameCue, cardLabel } from '../public/lib/render.mjs';
import { buildCatalog, LEAGUES } from '../public/lib/catalog.mjs';
import { mountBoard } from '../public/lib/board.mjs';

const TEAMS = {
  AAA: { abbr: 'AAA', name: 'Alpha Owls', color: '#335577', record: '5-4', rank: null },
  BBB: { abbr: 'BBB', name: 'Beta Hawks', color: '#775533', record: '4-5', rank: null },
};
const ZONE = 'America/Chicago';
const mk = (league, over = {}) => ({
  id: `${league}-2026-t-01`, league, sport: 'football', format: 'quarters', away: 'AAA', home: 'BBB', kickoff: '2026-11-15T18:00:00Z',
  status: 'live', period: 4, clock: '1:59', total: { away: 14, home: 14 }, linescore: null, redZone: false, overtime: false,
  scoringCue: null, possession: null, situation: null, timeouts: null, lastPlay: null, leaders: null, missing: [], network: 'SIM', corrected: null,
  ...over,
});
const keyOf = (g) => (footballPriority(g) ? footballPriority(g).key : null);
const MARGINS = [0, 7, 8, 9, 10, 11];
const O = 'late-orange';
const Y = 'late-yellow';
// Explicit table: rows are clocks, columns the margins above (0 is a tie).
const TABLE = {
  '1:59': [O, O, O, Y, Y, null],
  '2:00': [O, O, O, Y, Y, null],
  '2:01': [Y, Y, Y, Y, Y, null],
  '4:59': [Y, Y, Y, Y, Y, null],
  '5:00': [Y, Y, Y, Y, Y, null],
  '5:01': [null, null, null, null, null, null],
};

test('decision table, both football leagues: Q4 clocks 1:59/2:00/2:01 and 4:59/5:00/5:01 against margins tie/7/8/9/10/11, either team leading', () => {
  let n = 0;
  for (const lg of ['nfl', 'ncaaf']) {
    for (const [clock, row] of Object.entries(TABLE)) {
      MARGINS.forEach((m, i) => {
        for (const lead of ['away', 'home']) {
          const total = lead === 'away' ? { away: 20 + m, home: 20 } : { away: 20, home: 20 + m };
          same(keyOf(mk(lg, { clock, total })), row[i], `${lg} ${clock} margin ${m} ${lead} leads`);
          n++;
        }
      });
    }
  }
  same(n, 144);
  same(footballClockSeconds('2:00'), 120);
  same(footballClockSeconds('1:59'), 119);
  same(footballClockSeconds('5:00'), 300);
  same(footballClockSeconds('5:01'), 301);
  same(footballClockSeconds('0:00'), 0);
  same(footballClockSeconds('15:00'), 900);
});

test('decision table: earlier quarters never get a late cue; a valid red zone is red in any quarter and in overtime; overtime is orange at any score or clock and never yellow', () => {
  for (const lg of ['nfl', 'ncaaf']) {
    for (const period of [1, 2, 3]) {
      for (const clock of Object.keys(TABLE)) for (const m of MARGINS) same(keyOf(mk(lg, { period, clock, total: { away: 10 + m, home: 10 } })), null, `${lg} Q${period} ${clock} ${m}`);
      same(keyOf(mk(lg, { period, clock: '9:00', redZone: true })), 'rz', `${lg} Q${period} red zone`);
    }
    same(keyOf(mk(lg, { period: 4, clock: '1:00', total: { away: 21, home: 17 }, redZone: true })), 'rz', 'red beats the two-minute orange');
    same(keyOf(mk(lg, { period: 4, clock: '4:00', total: { away: 21, home: 12 }, redZone: true })), 'rz', 'red beats yellow');
    for (const period of [5, 6]) {
      same(keyOf(mk(lg, { period, clock: '9:00', total: { away: 45, home: 10 } })), 'ot', `${lg} OT${period - 4} large margin`);
      same(keyOf(mk(lg, { period, clock: '4:00', total: { away: 19, home: 10 } })), 'ot', 'overtime is never yellow');
      same(keyOf(mk(lg, { period, clock: '1:00', total: { away: 17, home: 17 }, redZone: true })), 'rz', 'red zone wins in overtime');
    }
    same(keyOf(mk(lg, { period: null, clock: null, total: null, overtime: true })), 'ot', 'known overtime qualifies without clock or score');
    same(FOOTBALL_PRIORITY.rz.color, 'red');
    same(FOOTBALL_PRIORITY.ot.color, 'orange');
    same(FOOTBALL_PRIORITY.late2.color, 'orange');
    same(FOOTBALL_PRIORITY.late5.color, 'yellow');
  }
});

test('decision table: halftime, final and games not in progress get no current cue; end of a period, delayed and suspended do; missing or invalid clock or score never invents a late cue', () => {
  assert.deepEqual([...FOOTBALL_CUE_STATUSES], ['live', 'end_period', 'delayed', 'suspended']);
  for (const lg of ['nfl', 'ncaaf']) {
    for (const status of ['halftime', 'final', 'scheduled', 'postponed', 'canceled', 'unknown']) {
      for (const over of [{ redZone: true, period: 2 }, { period: 5, overtime: true }, { period: 4, clock: '1:00', total: { away: 10, home: 7 } }]) {
        const g = mk(lg, { status, ...over });
        same(keyOf(g), null, `${lg} ${status} ${JSON.stringify(over)}`);
        same(cues(g).subtle, null, `${lg} ${status}: no current red-zone tag either`);
      }
    }
    same(keyOf(mk(lg, { status: 'end_period', clock: '0:00', total: { away: 17, home: 17 } })), O, 'end of Q4, tied');
    same(keyOf(mk(lg, { status: 'delayed', clock: '4:00', total: { away: 17, home: 14 } })), Y);
    same(keyOf(mk(lg, { status: 'suspended', period: 3, redZone: true })), 'rz');
    for (const clock of [null, undefined, '', '2:60', '1:5', 'abc', '-1:00', '1:59 ', '1:59.4']) same(keyOf(mk(lg, { clock, total: { away: 10, home: 7 } })), null, `${lg} clock ${JSON.stringify(clock)}`);
    for (const total of [null, undefined, { away: '7', home: 7 }, { away: 7 }, { away: -1, home: 0 }, { away: 1.5, home: 0 }, { away: Number.NaN, home: 0 }]) {
      same(keyOf(mk(lg, { clock: '1:00', total })), null, `${lg} total ${JSON.stringify(total)}`);
      same(keyOf(mk(lg, { clock: '1:00', total, period: 5 })), 'ot', 'known overtime still qualifies');
      same(keyOf(mk(lg, { clock: '1:00', total, redZone: true })), 'rz', 'a valid red zone still qualifies');
    }
    same(keyOf(mk(lg, { redZone: 'yes', clock: '9:00' })), null, 'only a valid red zone flag counts');
  }
  for (const sport of ['basketball', 'hockey', 'baseball']) same(footballPriority({ ...mk('nba'), sport, period: 4, clock: '1:00', total: { away: 80, home: 79 } }), null, `${sport}: no football cue`);
});

test('G4 touchdown combinations: with red zone, overtime, late orange or late yellow the priority frame stays and the TD tag stays visible; the green touchdown frame shows only without a priority cue', () => {
  const cases = [
    ['rz', mk('nfl', { scoringCue: 'TD', redZone: true, period: 2, clock: '7:00', total: { away: 7, home: 3 } }), 'red', 'RZ', 'tag-rz'],
    ['ot', mk('ncaaf', { scoringCue: 'TD', period: 5, clock: '6:00', total: { away: 30, home: 24 } }), 'orange', 'OT', 'tag-prio'],
    ['late-orange', mk('nfl', { scoringCue: 'TD', clock: '1:30', total: { away: 21, home: 17 } }), 'orange', 'Late 2:00', 'tag-prio'],
    ['late-yellow', mk('ncaaf', { scoringCue: 'TD', clock: '4:30', total: { away: 27, home: 17 } }), 'yellow', 'Late 5:00', 'tag-prio'],
  ];
  for (const [key, g, color, tag, tagCls] of cases) {
    const doc = new FakeDocument();
    const ref = buildCard(doc, g, TEAMS, { zone: ZONE, favorite: false });
    const r = ref.root;
    assert.ok(r.hasClass('prio') && r.hasClass(`prio-${color}`), `${key}: ${color} frame`);
    same(r.hasClass('td-frame'), false, `${key}: no green touchdown frame`);
    assert.ok(r.hasClass('cue-strong') && r.hasClass('td'), `${key}: still a touchdown`);
    same(r.getAttribute('data-cue'), key);
    same(frameCue(g).cls, `prio prio-${color}`);
    const tdTags = r.byClass('tag-td');
    same(tdTags.length, 1);
    same(tdTags[0].textContent, 'TD');
    assert.ok(!tdTags[0].hidden && !tdTags[0].parentNode.hidden, `${key}: the TD tag stays visible`);
    const p = r.byClass(tagCls);
    same(p.length, 1, `${key}: one priority tag`);
    same(p[0].textContent, tag);
    same(r.byClass('tag').filter((t) => t.textContent === 'RZ').length, key === 'rz' ? 1 : 0, 'never a second RZ tag');
    assert.match(r.getAttribute('aria-label'), /Touchdown\./);
    assert.ok(r.getAttribute('aria-label').includes(footballPriority(g).words), `${key}: the cue in words`);
    const sc = buildScorecard(doc, g, TEAMS, { zone: ZONE });
    same(sc.byClass('tag-td').length, 1, 'the details score part keeps the TD tag');
  }
  const td = mk('nfl', { scoringCue: 'TD', period: 2, clock: '7:00', total: { away: 7, home: 3 } });
  const ref = buildCard(new FakeDocument(), td, TEAMS, { zone: ZONE, favorite: false });
  assert.ok(ref.root.hasClass('td-frame') && !ref.root.hasClass('prio'), 'a touchdown alone keeps its green frame');
  same(ref.root.getAttribute('data-cue'), 'td');
  const plain = buildCard(new FakeDocument(), mk('nfl', { period: 2, clock: '7:00' }), TEAMS, { zone: ZONE, favorite: false });
  same(plain.root.getAttribute('data-cue'), null);
  assert.ok(!plain.root.hasClass('prio') && !plain.root.hasClass('td-frame'));
  same(cardLabel(mk('nfl', { period: 5, clock: '6:00' }), TEAMS, 1, ZONE).includes('Overtime.'), true);
});

const cat = buildCatalog();
const allGames = (lg) => cat.seasons(lg).flatMap((s) => cat.allGames(lg, s.id));

test('fixture-reachable cues: exactly NFL g11-183 and NCAAF w12-13 red zone, NFL g11-149 overtime and the two touchdowns; no other game in any league gets a frame cue', () => {
  const got = {};
  for (const l of LEAGUES) {
    for (const g of allGames(l.id)) {
      const fc = frameCue(g);
      if (fc) got[g.id] = fc.key;
      if (l.sport !== 'football') same(fc, null, `${g.id}: other sports keep their own cues`);
    }
  }
  assert.deepEqual(got, { 'nfl-2026-g11-149': 'ot', 'nfl-2026-g11-183': 'rz', 'nfl-2026-g11-195': 'td', 'ncaaf-2026-w12-09': 'td', 'ncaaf-2026-w12-13': 'rz' });
});

test('the TV details window frame shows the same cue as the game card, and nothing extra for a game without one', () => {
  for (const lg of ['nfl', 'ncaaf']) {
    const win = new FakeWindow({ width: 1920, height: 1080 });
    const doc = win.document;
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const app = mountBoard({ win, doc, root, presentation: 'tv' });
    if (lg !== 'nfl') {
      uiChoose(app, 'league', lg);
    }
    let framed = 0;
    let plain = 0;
    for (const [id, ref] of app.cards) {
      if (!ref.expandable) continue;
      const g = app.view.games.find((x) => x.id === id);
      const fc = frameCue(g);
      ref.root.focus();
      ref.root.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
      same(app.popup.open, true, id);
      const box = app.popup.ui.box;
      same(box.className, fc ? `pop ${fc.cls}` : 'pop', `${id}: the window frame`);
      same(box.getAttribute('data-cue'), ref.root.getAttribute('data-cue'), `${id}: same cue as the card`);
      if (fc) framed++;
      else plain++;
      box.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
      same(app.popup.open, false);
    }
    assert.ok(framed >= 2 && plain >= 1, `${lg}: ${framed} framed, ${plain} plain`);
  }
});

test('CSS: a 4 CSS px priority frame drawn over the touchdown green, one colour per cue, the same frame on the details window, a separate light focus ring, and a 44 x 44 CSS px star', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => {
    const m = bare.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
    assert.ok(m, `rule ${sel}`);
    return m[1];
  };
  assert.match(rule('.card.prio::after'), /border: 4px solid var\(--prio\);/);
  assert.match(rule('.pop.prio'), /border: 4px solid var\(--prio\);/);
  assert.match(rule('.card.prio::before'), /content: none;/, 'no second, amber edge under a priority frame');
  const focus = rule('.card.prio:focus-visible::after');
  assert.match(focus, /border-color: var\(--prio\);/, 'focus keeps the priority colour');
  assert.match(focus, /outline: 2px solid var\(--ink\);/);
  assert.match(focus, /outline-offset: 2px;/, 'the focus ring sits outside the frame');
  assert.ok(bare.indexOf('.card.cue-strong::after') < bare.indexOf('.card.prio::after'), 'priority is drawn over the touchdown green');
  assert.ok(bare.indexOf('.card:focus-visible::after') < bare.indexOf('.card.prio:focus-visible::after'));
  for (const c of ['red', 'orange', 'yellow']) {
    assert.match(bare, new RegExp(`\\.card\\.prio-${c}, \\.pop\\.prio-${c} \\{ --prio: var\\(--prio-${c}\\); \\}`));
    assert.match(bare, new RegExp(`--prio-${c}: #[0-9a-f]{6};`));
  }
  assert.match(rule('.tag-prio, .prio .tag-rz'), /color: var\(--prio\);/);
  const fav = rule('.fav');
  for (const need of [/min-width: 44px;/, /min-height: 44px;/, /width: 44px; height: 44px;/]) assert.match(fav, need);
  assert.match(rule('.fav:focus-visible'), /outline: 2px solid var\(--live\);/);
  assert.ok(!/(^|[\s,}])\.act\b/.test(bare), 'no style for the removed per-game button');
});

function same(a,b,msg) { const short=x=>x===null||typeof x!=='object'&&typeof x!=='function'?String(x).slice(0,160):'<object>'; assert.ok(a===b,msg||`${short(a)} !== ${short(b)}`); }
