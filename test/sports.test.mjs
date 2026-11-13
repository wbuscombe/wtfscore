// Sport-specific cards for all four families and seven leagues: linescore
// columns and totals, periods and clocks, situation lines, leader categories,
// pregame and final states, unavailable data, and the subtle and strong cues
// with positive and negative cases. Rendered on the fake DOM; model tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDocument } from './fake-dom.mjs';
import { buildCatalog, LEAGUES, DEFAULT_ZONE } from '../public/lib/catalog.mjs';
import { buildCard, cardLabel, statusInfo, badgeFor, contrastRatio } from '../public/lib/render.mjs';
import { cues, lateInHalf, lateInPeriod, runnersInScoringPosition, scoreColumns, TEAM_STAT_ROWS, teamStatRows, teamStatProblems, driveLines, driveProblems, spotWords } from '../public/lib/sports.mjs';
import { generateWeek } from '../public/lib/fixtures.mjs';
import { isExpandable } from '../public/lib/model.mjs';

const cat = buildCatalog();
const CT = DEFAULT_ZONE;
const ALLOWED_TAGS = new Set(['ARTICLE', 'DIV', 'SPAN', 'BUTTON']);
const board = (league, extra = {}) => cat.resolve({ league, ...extra }, CT);
function render(game, teams) {
  const doc = new FakeDocument();
  const ref = buildCard(doc, game, teams, { zone: CT });
  for (const e of doc.created) assert.ok(ALLOWED_TAGS.has(e.tagName), `${game.id}: ${e.tagName}`);
  return ref;
}
// Every text a person can meet in a card, opened or not.
function allText(el, out = []) {
  for (const c of el.childNodes) {
    if (c.nodeType === 3) out.push(c.data);
    else allText(c, out);
  }
  for (const a of ['aria-label', 'title']) if (el.getAttribute(a)) out.push(el.getAttribute(a));
  if (el.title) out.push(el.title);
  return out.join('\n');
}
const head = (ref) => ref.sections[1].byClass('lhead')[0].children.slice(1).map((e) => e.textContent);
const tag = (ref) => ref.root.byClass('tag').map((t) => t.textContent);
const byScript = (games, pred) => {
  const g = games.find(pred);
  assert.ok(g, 'fixture present');
  return g;
};

test('linescore columns follow the sport: quarters, halves, hockey periods, baseball R H E', () => {
  const want = { nfl: ['1', '2', '3', '4', '', 'T'], ncaaf: ['1', '2', '3', '4', '', 'T'], nba: ['1', '2', '3', '4', '', 'T'], ncaaw: ['1', '2', '3', '4', '', 'T'], ncaab: ['1', '2', '', 'T'], nhl: ['1', '2', '3', '', 'T'], mlb: ['R', 'H', 'E'] };
  for (const l of LEAGUES) {
    const r = board(l.id);
    for (const g of r.games) {
      const ref = render(g, r.teams);
      const h = head(ref);
      if (g.overtime) assert.equal(h[h.length - 2], 'OT', `${g.id} OT column labelled`);
      else assert.deepEqual(h, want[l.id], `${l.id} ${g.id}`);
      for (const row of ref.sections[1].byClass('trow')) {
        const tot = row.byClass('tot')[0].textContent;
        const side = row === ref.sections[1].byClass('trow')[0] ? 'away' : 'home';
        if (g.status === 'scheduled') assert.equal(tot, '0', 'pregame 0');
        else if (g.total) assert.equal(tot, String(g.total[side]), `${g.id} total`);
      }
    }
  }
});

test('pregame cards: 0-0, blank units, start time in the screen zone, not expandable, for every league', () => {
  for (const l of LEAGUES) {
    const r = board(l.id);
    const g = r.games.find((x) => x.status === 'scheduled');
    assert.ok(g, `${l.id} has a pregame game`);
    const ref = render(g, r.teams);
    assert.equal(ref.act, null);
    assert.equal(isExpandable(g), false);
    for (const row of ref.sections[1].byClass('trow')) {
      assert.equal(row.byClass('tot')[0].textContent, '0');
      assert.ok(row.byClass('q').every((q) => q.textContent === ''), `${l.id} blank units`);
    }
    assert.match(statusInfo(g, CT).text, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2}\s[AP]M$/);
    assert.ok(cardLabel(g, r.teams, 1, CT).includes('No details: pregame.'));
  }
});

test('status words per sport: quarters, halves, hockey periods and innings; no quarter words outside quarter sports', () => {
  const seen = { nba: [], ncaaw: [], ncaab: [], nhl: [], mlb: [], ncaaf: [] };
  for (const id of Object.keys(seen)) for (const g of board(id).games) if (g.status !== 'scheduled' && g.status !== 'final') seen[id].push(statusInfo(g, CT).text);
  assert.ok(seen.nba.includes('Q2 · 1:24') && seen.nba.includes('Q4 · 0:48'));
  assert.ok(seen.ncaaw.includes('Q2 · 1:50'));
  assert.ok(seen.ncaab.includes('H1 · 1:40') && seen.ncaab.includes('H2 · 0:55') && seen.ncaab.includes('Halftime'));
  assert.ok(seen.nhl.includes('P3 · 0:40') && seen.nhl.includes('P1 · 1:30'));
  assert.ok(seen.mlb.includes('Top 5th') && seen.mlb.includes('Bot 4th'));
  assert.ok(seen.ncaaf.includes('Q2 · 11:32'));
  for (const t of [...seen.ncaab, ...seen.nhl, ...seen.mlb]) assert.doesNotMatch(t, /\bQ[1-4]\b/);
  const fin = board('mlb', { season: '2025' }).games.find((g) => g.innings > 9);
  if (fin) assert.match(statusInfo(fin, CT).text, /^Final\/1[0-9] · /);
});

test('situation parts are sport-specific: field and downs only for football; possession and fouls; shots and power play; bases, count and innings', () => {
  const jargon = /\b(down|downs|yards?|yds|field|end zone|kick(off|ing)|1st & |2nd & |3rd & |red zone|touchdown|PASS|RUSH|REC)\b/i;
  for (const l of LEAGUES) {
    const r = board(l.id);
    for (const g of r.games.filter(isExpandable)) {
      const ref = render(g, r.teams);
      const s2 = ref.sections[2];
      const live = g.status !== 'final';
      if (l.sport === 'football') {
        if (live && g.situation && g.possession) assert.equal(s2.byClass('field').length, 1, `${g.id} field`);
        if (!live) assert.equal(s2.byClass('field').length, 0, `${g.id} final has no field`);
        continue;
      }
      assert.doesNotMatch(allText(ref.root), jargon, `${l.id} ${g.id} uses football words`);
      assert.equal(s2.byClass('field').length, 0);
      const text = s2.textContent;
      if (l.sport === 'basketball') {
        if (live && g.status === 'live') assert.match(text, /Possession [A-Z]{3}/);
        if (live) assert.match(text, /Team fouls [A-Z]{3} \d+ · [A-Z]{3} \d+/);
        if (live) assert.match(text, /Timeouts left [A-Z]{3} \d · [A-Z]{3} \d/);
      }
      if (l.sport === 'hockey') {
        assert.match(text, /Shots on goal|Shots not available/);
        if (live) assert.match(text, /Power play [A-Z]{3} · \d:\d\d left · 5 on 4|Even strength/);
      }
      if (l.sport === 'baseball') {
        assert.equal(s2.byClass('inn').length, 1, 'runs by inning');
        assert.deepEqual(s2.byClass('inn-head')[0].children.slice(1).map((c) => c.textContent).slice(0, 9), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
        if (live) {
          assert.equal(s2.byClass('diamond').length, 1);
          assert.match(text, /\d-\d count · \d outs?/);
          assert.match(text, /At bat .+ · Pitching .+/);
          assert.match(s2.byClass('diamond')[0].getAttribute('aria-label'), /^(Bases empty|Bases loaded|Runners? on .+)$/);
        } else assert.equal(s2.byClass('diamond').length, 0, 'final has no live bases graphic');
      }
      if (!live) assert.match(text, /Final · no live situation/);
      assert.ok(s2.byClass('play').length === 1, `${g.id} last play kept`);
    }
  }
});

test('leader categories per sport, with sport units', () => {
  const want = { football: ['PASS', 'RUSH', 'REC'], basketball: ['PTS', 'REB', 'AST'], hockey: ['G', 'A', 'SV'], baseball: ['BAT', 'RBI', 'PITCH'] };
  const unit = { football: / yds · /, basketball: / (pts|reb|ast) · /, hockey: / (G|A|saves) · /, baseball: /^[A-Z]{3} · \d/ };
  for (const l of LEAGUES) {
    const r = board(l.id);
    for (const g of r.games.filter(isExpandable)) {
      const rows = render(g, r.teams).sections[3].byClass('ldr');
      assert.deepEqual(rows.map((x) => x.byClass('lcat')[0].textContent), want[l.sport], `${g.id}`);
      for (const x of rows.filter((y) => !y.hasClass('miss'))) assert.match(x.byClass('lline')[0].textContent, unit[l.sport], `${g.id}`);
    }
  }
});

test('finals keep the last play and leaders but show no live graphic, in every sport', () => {
  for (const l of LEAGUES) {
    const r = board(l.id);
    const g = r.games.find((x) => x.status === 'final');
    const ref = render(g, r.teams);
    assert.equal(ref.sections[2].byClass('field').length + ref.sections[2].byClass('diamond').length, 0);
    assert.equal(ref.sections[2].byClass('play').length, 1);
    assert.ok(!ref.sections[2].byClass('play')[0].hasClass('miss'));
    assert.equal(ref.sections[3].byClass('ldr').filter((x) => !x.hasClass('miss')).length, 3);
    assert.match(statusInfo(g, CT).text, /^Final/);
  }
});

function cueOf(g, teams) {
  const ref = render(g, teams);
  const c = cues(g);
  const label = ref.root.getAttribute('aria-label');
  return { c, ref, label, subtle: ref.root.hasClass('cue-subtle'), strong: ref.root.hasClass('cue-strong'), tags: tag(ref) };
}

test('football cues: subtle red zone and strong touchdown only; no strong cue for a field goal, safety or extra point', () => {
  const wk = generateWeek();
  const nfl = board('nfl');
  const ns = (id) => nfl.games.find((g) => g.localId === id);
  let x = cueOf(ns('g11-183'), nfl.teams);
  assert.ok(x.subtle && !x.strong && x.tags.includes('RZ') && /Red zone\./.test(x.label));
  x = cueOf(ns('g11-195'), nfl.teams);
  assert.ok(x.strong && x.tags.includes('TD') && /Touchdown\./.test(x.label));
  x = cueOf(ns('g11-126'), nfl.teams);
  assert.ok(!x.strong && !x.subtle, 'field goal last play: no cue');
  assert.equal(wk.games.length, 16);
  const cf = board('ncaaf');
  const live = cf.games.filter((g) => g.status === 'live');
  for (const [cue, strong] of [['TD', true], ['FG', false], ['SAFETY', false], ['PAT', false]]) {
    const r = cueOf(byScript(live, (g) => g.scoringCue === cue), cf.teams);
    assert.equal(r.strong, strong, `${cue} strong ${strong}`);
    assert.equal(r.tags.includes('TD'), strong);
  }
  assert.ok(cueOf(byScript(live, (g) => g.situation && g.situation.yardsToEndzone === 12), cf.teams).tags.includes('RZ'), 'inside the 20');
  assert.ok(!cueOf(byScript(live, (g) => g.situation && g.situation.yardsToEndzone === 24), cf.teams).subtle, 'outside the 20');
});

test('basketball cues: subtle cue in the last two minutes of a HALF only (Q2/Q4 for NBA and women, either half for men); never for a basket', () => {
  for (const [league, yes, no] of [
    ['nba', [[2, '1:24'], [4, '0:48']], [[1, '1:10'], [3, '1:35'], [3, '7:02']]],
    ['ncaaw', [[2, '1:50'], [4, '1:05']], [[1, '1:30'], [3, '0:45'], [3, '6:00']]],
    ['ncaab', [[1, '1:40'], [2, '0:55']], [[2, '6:10'], [1, '9:00']]],
  ]) {
    const r = board(league);
    const live = r.games.filter((g) => g.status === 'live');
    for (const [p, clock] of yes) {
      const x = cueOf(byScript(live, (g) => g.period === p && g.clock === clock), r.teams);
      assert.ok(x.subtle && x.tags.includes('Late half') && /Last two minutes of the half\./.test(x.label), `${league} ${p} ${clock}`);
    }
    for (const [p, clock] of no) assert.ok(!cueOf(byScript(live, (g) => g.period === p && g.clock === clock), r.teams).subtle, `${league} ${p} ${clock} no cue`);
    const basket = byScript(live, (g) => g.scoringCue === 'BASKET');
    const b = cueOf(basket, r.teams);
    assert.ok(!b.strong && !b.tags.some((t) => /TD|RUN|GOAL/.test(t)), `${league} basket gets no strong cue`);
    assert.match(basket.lastPlay.text, /makes/);
  }
  const half = board('ncaab').games.find((g) => g.status === 'halftime');
  assert.ok(half && !cueOf(half, board('ncaab').teams).subtle, 'halftime is not a late-half moment');
  const g = structuredClone(board('nba').games.find((x) => x.status === 'live'));
  Object.assign(g, { period: 5, clock: '1:00' });
  assert.equal(lateInHalf(g), false, 'overtime is not a half');
  Object.assign(g, { period: 2, clock: '2:00' });
  assert.equal(lateInHalf(g), true, 'exactly two minutes left counts');
  Object.assign(g, { clock: '2:01' });
  assert.equal(lateInHalf(g), false);
});

test('hockey cues: subtle cue in the last two minutes of any period; strong cue only for a fresh goal', () => {
  const r = board('nhl');
  const live = r.games.filter((g) => g.status === 'live');
  for (const [p, clock] of [[1, '1:30'], [3, '0:40'], [2, '1:55']]) {
    const x = cueOf(byScript(live, (g) => g.period === p && g.clock === clock), r.teams);
    assert.ok(x.subtle && x.tags.includes('Late period') && /Last two minutes of the period\./.test(x.label), `P${p} ${clock}`);
  }
  assert.ok(!cueOf(byScript(live, (g) => g.clock === '8:00'), r.teams).subtle);
  const goal = cueOf(byScript(live, (g) => g.scoringCue === 'GOAL'), r.teams);
  assert.ok(goal.strong && goal.tags.includes('GOAL') && /Goal\./.test(goal.label) && !goal.subtle);
  const g = structuredClone(live[0]);
  Object.assign(g, { period: 4, clock: '1:30', scoringCue: null });
  assert.equal(lateInPeriod(g), true, 'overtime is a period');
  Object.assign(g, { status: 'end_period' });
  assert.equal(lateInPeriod(g), false, 'only while the clock runs');
});

test('baseball cues: subtle cue with a runner on second or third; strong cue only for a fresh run', () => {
  const r = board('mlb');
  const live = r.games.filter((g) => g.status === 'live');
  const bases = (b) => (g) => g.bases && g.bases.first === b[0] && g.bases.second === b[1] && g.bases.third === b[2] && g.scoringCue !== 'RUN';
  for (const b of [[false, true, false], [false, false, true], [true, true, true]]) {
    const x = cueOf(byScript(live, bases(b)), r.teams);
    assert.ok(x.subtle && x.tags.includes('RISP') && /Runner in scoring position\./.test(x.label), JSON.stringify(b));
  }
  for (const b of [[true, false, false], [false, false, false]]) assert.ok(!cueOf(byScript(live, bases(b)), r.teams).subtle, `no cue ${JSON.stringify(b)}`);
  const run = cueOf(byScript(live, (g) => g.scoringCue === 'RUN'), r.teams);
  assert.ok(run.strong && run.tags.includes('RUN') && /Run scored\./.test(run.label) && !run.subtle);
  assert.equal(runnersInScoringPosition({ ...live[0], status: 'final' }), false, 'finals carry no live cue');
});

test('cues never appear on pregame or final cards, and each cue is a text tag with a title', () => {
  for (const l of LEAGUES) {
    for (const s of cat.seasons(l.id)) {
      for (const g of cat.allGames(l.id, s.id)) {
        const c = cues(g);
        if (g.status === 'scheduled' || g.status === 'final') assert.ok(!c.subtle && !c.strong, `${g.id}`);
      }
    }
    const r = board(l.id);
    for (const g of r.games) {
      const ref = render(g, r.teams);
      for (const t of ref.root.byClass('tag')) assert.ok(t.textContent.length >= 2 && t.title.length >= 4, `${g.id} tag has words`);
    }
  }
});

test('unavailable data is labelled: missing hockey shots and the Missing data tag', () => {
  const r = board('nhl');
  const g = r.games.find((x) => x.shots === null && x.status === 'live');
  const ref = render(g, r.teams);
  assert.ok(ref.sections[2].byClass('miss').some((e) => e.textContent === 'Shots not available'));
  assert.deepEqual(ref.root.byClass('tag-miss').map((t) => t.textContent), ['Missing data']);
});

test('hostile strings stay inert text in every sport', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>" & &amp;';
  for (const l of LEAGUES) {
    const r = board(l.id);
    const g = structuredClone(r.games.find((x) => x.status === 'live'));
    g.lastPlay.text = evil;
    g.network = evil;
    const first = Object.keys(g.leaders)[0];
    g.leaders[first].name = evil;
    const teams = structuredClone(r.teams);
    teams[g.away] = { ...teams[g.away], name: evil, record: evil, color: 'red;background:url(x)' };
    const ref = render(g, teams);
    assert.ok(ref.root.textContent.includes(evil));
    for (const c of ref.root.byClass('chip')) assert.match(c.style.getPropertyValue('--chip'), /^#[0-9a-f]{6}$/);
  }
});

test('local team badges: two letters on the team colour with readable ink, DOM only, hidden by default', () => {
  let worst = Infinity;
  for (const l of LEAGUES) {
    const r = board(l.id);
    for (const t of Object.values(r.teams)) {
      const b = badgeFor(t);
      assert.match(b.text, /^[A-Z]{2}$/);
      worst = Math.min(worst, contrastRatio(b.color, b.ink));
    }
    const ref = render(r.games[0], r.teams);
    assert.equal(ref.badges.length, 2);
    assert.ok(ref.badges.every((x) => x.hidden && x.getAttribute('aria-hidden') === 'true'));
    assert.match(ref.badges[0].style.getPropertyValue('--badge'), /^#[0-9a-f]{6}$/);
  }
  assert.ok(worst >= 4.5, `badge ink contrast at least 4.5:1 (worst ${worst.toFixed(2)})`);
  const doc = new FakeDocument();
  const r = board('nba');
  const on = buildCard(doc, r.games[0], r.teams, { zone: CT, badges: true });
  assert.ok(on.badges.every((x) => !x.hidden));
});

test('scoreColumns is defined for every format', () => {
  assert.equal(scoreColumns({ sport: 'baseball' }).layout, 'bb');
  assert.equal(scoreColumns({ sport: 'hockey' }).layout, 'q3');
  assert.equal(scoreColumns({ sport: 'basketball', format: 'halves' }).layout, 'q2');
  assert.equal(scoreColumns({}).layout, 'q4', 'a game without a sport is pro football');
});

// ---------- team stats rows, drive words and their arithmetic checks ----------
const T = { AWY: { abbr: 'AWY' }, HOM: { abbr: 'HOM' } };

test('team stats rows per sport in plain words, with every value the data lacks reading "not available"', () => {
  assert.deepEqual(TEAM_STAT_ROWS.basketball.map((r) => r[0]), ['Field goals', 'Three-pointers', 'Free throws', 'Rebounds', 'Assists', 'Turnovers']);
  assert.deepEqual(TEAM_STAT_ROWS.football.map((r) => r[0]), ['First downs', 'Total yards', 'Passing yards', 'Rushing yards', 'Turnovers', 'Penalties']);
  assert.deepEqual(TEAM_STAT_ROWS.hockey.map((r) => r[0]), ['Goals', 'Shots on goal', 'Power plays', 'Faceoffs won', 'Hits', 'Penalty minutes']);
  assert.deepEqual(TEAM_STAT_ROWS.baseball.map((r) => r[0]), ['Runs', 'Hits', 'Errors', 'Home runs', 'Walks', 'Strikeouts', 'Left on base']);
  for (const l of LEAGUES) {
    for (const g of board(l.id).games.filter((x) => x.teamStats)) {
      const rows = teamStatRows(g);
      assert.equal(rows.length, TEAM_STAT_ROWS[g.sport].length);
      if (g.sport === 'baseball') assert.deepEqual(rows.slice(0, 3).map((r) => [r.away, r.home]), [[String(g.total.away), String(g.total.home)], [String(g.hits.away), String(g.hits.home)], [String(g.errors.away), String(g.errors.home)]], `${g.id}: R, H and E match the card`);
      if (g.sport === 'hockey') assert.deepEqual(rows[0].away, String(g.total.away));
    }
  }
  const nhl = board('nhl').games.find((g) => g.missing.includes('shots'));
  const shots = teamStatRows(nhl).find((r) => r.label === 'Shots on goal');
  assert.deepEqual([shots.away, shots.home, shots.miss], ['not available', 'not available', true]);
  assert.deepEqual(teamStatRows({ sport: 'hockey', teamStats: null }), [], 'no stats, no rows');
});

test('the arithmetic checks catch every broken rule: basketball points, makes and tries, hockey goals and shots, baseball R/H/E, football yards', () => {
  const bb = (s) => ({ sport: 'basketball', total: { away: 10, home: 0 }, teamStats: { away: { points: 10, fgm: 3, fga: 6, threes: 1, threeA: 3, ftm: 3, fta: 4, rebounds: 1, assists: 1, turnovers: 0, ...s }, home: { points: 0, fgm: 0, fga: 2, threes: 0, threeA: 0, ftm: 0, fta: 0, rebounds: 0, assists: 0, turnovers: 0 } } });
  assert.deepEqual(teamStatProblems(bb({})), [], '2 x 3 + 1 + 3 = 10, and a zero-point side');
  assert.ok(teamStatProblems(bb({ ftm: 2 })).some((p) => /points/.test(p)), 'points do not add up');
  assert.ok(teamStatProblems(bb({ fga: 2 })).some((p) => /FGM > FGA/.test(p)));
  assert.ok(teamStatProblems(bb({ threeA: 0 })).some((p) => /3PM > 3PA/.test(p)));
  assert.ok(teamStatProblems(bb({ fta: 1 })).some((p) => /FTM > FTA/.test(p)));
  assert.ok(teamStatProblems(bb({ assists: 4 })).some((p) => /assists/.test(p)));
  const hk = (s) => ({ sport: 'hockey', total: { away: 3, home: 1 }, shots: { away: 20, home: 18 }, teamStats: { away: { goals: 3, shots: 20, powerPlayGoals: 1, powerPlays: 2, faceoffsWon: 30, hits: 10, penaltyMinutes: 4, ...s }, home: { goals: 1, shots: 18, powerPlayGoals: 0, powerPlays: 1, faceoffsWon: 25, hits: 9, penaltyMinutes: 4 } } });
  assert.deepEqual(teamStatProblems(hk({})), []);
  assert.ok(teamStatProblems(hk({ shots: 2 })).some((p) => /goals > shots/.test(p)));
  assert.ok(teamStatProblems(hk({ goals: 2 })).some((p) => /goals differ/.test(p)));
  const bs = (s) => ({ sport: 'baseball', total: { away: 2, home: 0 }, hits: { away: 5, home: 3 }, errors: { away: 0, home: 1 }, teamStats: { away: { runs: 2, hits: 5, errors: 0, homeRuns: 1, walks: 2, strikeouts: 7, leftOnBase: 6, ...s }, home: { runs: 0, hits: 3, errors: 1, homeRuns: 0, walks: 1, strikeouts: 9, leftOnBase: 4 } } });
  assert.deepEqual(teamStatProblems(bs({})), []);
  assert.ok(teamStatProblems(bs({ hits: 6 })).some((p) => /hits differ/.test(p)));
  assert.ok(teamStatProblems(bs({ homeRuns: 3 })).some((p) => /home runs/.test(p)));
  const fb = (s) => ({ sport: 'football', total: { away: 7, home: 3 }, teamStats: { away: { points: 7, totalYards: 150, passingYards: 100, rushingYards: 50, firstDowns: 9, turnovers: 0, penalties: 2, penaltyYards: 10, ...s }, home: { points: 3, totalYards: 90, passingYards: 60, rushingYards: 30, firstDowns: 5, turnovers: 1, penalties: 1, penaltyYards: 5 } } });
  assert.deepEqual(teamStatProblems(fb({})), []);
  assert.ok(teamStatProblems(fb({ totalYards: 151 })).some((p) => /total yards/.test(p)));
});

test('drive words: where it started, how far, which way and where the ball is; a finished drive says how it ended; checks catch broken drives', () => {
  const base = { sport: 'football', away: 'AWY', home: 'HOM', status: 'live', possession: 'away', situation: { down: 2, distance: 4, yardsToEndzone: 38 } };
  const live = { ...base, drive: { team: 'away', direction: 'right', start: 75, end: 38, yards: 37, plays: 6, inProgress: true, result: null } };
  assert.deepEqual(driveProblems(live), []);
  assert.deepEqual(driveLines(live, T).map((l) => l.text), ['Drive · AWY · 6 plays, 37 yards', 'Started at the AWY 25 · ball on the HOM 38 · going → toward the HOM end zone']);
  const ko = { ...base, possession: 'home', situation: { phase: 'kickoff', yardsToEndzone: 65 }, drive: { team: 'home', direction: 'left', start: 75, end: 0, yards: 75, plays: 9, inProgress: false, result: 'Touchdown' } };
  assert.deepEqual(driveProblems(ko), []);
  assert.deepEqual(driveLines(ko, T).map((l) => l.text), ['Last drive · HOM touchdown · 9 plays, 75 yards', 'Started at the HOM 25 · ended at the AWY end zone · going ← toward the AWY end zone', 'Now: HOM kicking off from the HOM 35 ←']);
  const blank = { ...base, possession: null, situation: null, drive: { team: 'away', direction: 'right', start: 70, end: 20, yards: 50, plays: 8, inProgress: false, result: 'Field goal' } };
  assert.deepEqual(driveProblems(blank), []);
  assert.deepEqual(driveLines(blank, T).slice(-1), [{ cls: 'sline', text: 'Current ball position not available', miss: true }]);
  assert.deepEqual(driveLines({ ...base, drive: null }, T), [{ cls: 'sline', text: 'Drive not available', miss: true }]);
  assert.ok(driveProblems({ ...live, drive: { ...live.drive, yards: 36 } }).some((p) => /start/.test(p)), 'start - yards != end');
  assert.ok(driveProblems({ ...live, drive: { ...live.drive, direction: 'left' } }).includes('direction'));
  assert.ok(driveProblems({ ...live, drive: { ...live.drive, end: 40, start: 77 } }).some((p) => /situation/.test(p)));
  assert.ok(driveProblems({ ...live, drive: { ...live.drive, team: 'home', direction: 'left' } }).some((p) => /team/.test(p)));
  assert.ok(driveProblems({ ...ko, drive: { ...ko.drive, end: 3, yards: 72 } }).some((p) => /end zone/.test(p)));
  assert.equal(spotWords(50, 'AWY', 'HOM'), 'midfield');
  assert.equal(spotWords(100, 'AWY', 'HOM'), 'the AWY end zone');
});
