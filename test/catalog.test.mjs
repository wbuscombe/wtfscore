// Deterministic checks of the SIMULATED seven-league catalog: leagues,
// seasons, periods, every exposed filter option, cascades, time-zone date
// membership, namespaced ids and invented data. Model tests, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildCatalog, LEAGUES, LEAGUE_IDS, ZONES, DEFAULT_ZONE, localDateKey, zonedToUtc, dateKeyLabel } from '../public/lib/catalog.mjs';
import { generateWeek } from '../public/lib/fixtures.mjs';
import { teamStatProblems, driveProblems, driveLines } from '../public/lib/sports.mjs';
import { FakeDocument } from './fake-dom.mjs';
import { buildSituationPanel } from '../public/lib/render.mjs';

const cat = buildCatalog();
const CT = DEFAULT_ZONE;
const ZONE_IDS = ZONES.map((z) => z.value);

test('seven leagues, one board at a time, in the planned order with plain names', () => {
  assert.deepEqual(LEAGUE_IDS, ['nfl', 'nba', 'mlb', 'nhl', 'ncaaf', 'ncaab', 'ncaaw']);
  assert.deepEqual(LEAGUES.map((l) => l.option), ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB (men)', 'NCAAW (women)']);
  assert.deepEqual(LEAGUES.map((l) => l.sport), ['football', 'basketball', 'baseball', 'hockey', 'football', 'basketball', 'basketball']);
  for (const id of LEAGUE_IDS) {
    const r = cat.resolve({ league: id }, CT);
    assert.equal(r.view.league, id);
    assert.ok(r.games.length > 0, id);
    for (const g of r.games) assert.equal(g.league, id, `${g.id} belongs to the selected league only`);
  }
});

test('NFL demo-current Week 11 is the first-load default and holds the original NFL fixture games', () => {
  const v = cat.defaultView(CT);
  assert.deepEqual({ league: v.league, season: v.season, period: v.period }, { league: 'nfl', season: '2026', period: 'w11' });
  const r = cat.resolve(v, CT);
  assert.equal(r.period.label, 'Week 11');
  assert.deepEqual(r.games.map((g) => g.localId).sort(), generateWeek().games.map((g) => g.id).sort());
  for (const id of LEAGUE_IDS) {
    for (const s of cat.seasons(id)) {
      const d = cat.resolve({ league: id, season: s.id }, CT);
      assert.ok(d.games.length > 0, `${id} ${s.id} default period has games`);
    }
  }
});

test('every league: two demo seasons, at least three regular periods and named postseason rounds, all with games in every time zone', () => {
  let checked = 0;
  for (const l of LEAGUES) {
    const seasons = cat.seasons(l.id);
    assert.equal(seasons.length, 2, l.id);
    assert.ok(seasons.every((s) => /demo season$/.test(s.label)), 'seasons are labelled demo');
    assert.equal(seasons.filter((s) => s.current).length, 1);
    for (const s of seasons) {
      for (const z of ZONE_IDS) {
        const ps = cat.periods(l.id, s.id, z);
        const regular = ps.filter((p) => p.phase === 'regular');
        const post = ps.filter((p) => p.phase === 'post');
        assert.ok(regular.length >= 3, `${l.id} ${s.id} ${z}: ${regular.length} regular periods`);
        assert.ok(post.length >= 3, `${l.id} ${s.id}: named postseason periods`);
        for (const p of post) assert.match(p.label, /[A-Za-z]{4,}/, `${l.id} ${p.id} has a name`);
        if (l.periodKind === 'week') for (const p of regular) assert.match(p.label, /^Week \d+$/, 'football browses by week');
        else for (const p of regular) assert.match(p.label, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) [A-Z][a-z]{2} \d{1,2}$/, 'other leagues browse by date');
        for (const p of ps) {
          const r = cat.resolve({ league: l.id, season: s.id, period: p.id }, z);
          assert.equal(r.view.period, p.id);
          assert.ok(r.games.length > 0, `${l.id} ${s.id} ${p.id} ${z} has games`);
          checked++;
        }
      }
    }
  }
  console.log(`catalog periods checked across zones: ${checked}`);
});

test('game ids are namespaced by league and season and unique across the whole catalog; times are UTC', () => {
  const seen = new Set();
  let n = 0;
  for (const l of LEAGUES) {
    for (const s of cat.seasons(l.id)) {
      for (const g of cat.allGames(l.id, s.id)) {
        assert.ok(g.id.startsWith(`${l.id}-${s.id}-`), g.id);
        assert.ok(!seen.has(g.id), `duplicate ${g.id}`);
        seen.add(g.id);
        assert.match(g.kickoff, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        assert.equal(g.simulated, true);
        n++;
      }
    }
  }
  assert.ok(n > 600, `${n} games`);
});

// Explore each league's filters one and two levels deep from every season and
// period, and record which option values ever produce games.
function coverage(leagueId) {
  const offered = new Map();
  const covered = new Set();
  const note = (r) => {
    for (const c of r.controls) {
      if (!c.visible) continue;
      for (const o of c.options) if (o.value !== 'all') offered.set(`${c.key}:${o.value}`, `${c.label}: ${o.label}`);
      if (c.value !== 'all' && r.games.length) covered.add(`${c.key}:${c.value}`);
    }
  };
  for (const s of cat.seasons(leagueId)) {
    for (const p of cat.periods(leagueId, s.id, CT)) {
      const base = cat.resolve({ league: leagueId, season: s.id, period: p.id }, CT);
      note(base);
      for (const c of base.controls.filter((x) => x.visible)) {
        for (const o of c.options) {
          const r1 = cat.resolve({ league: leagueId, season: s.id, period: p.id, filters: { [c.key]: o.value } }, CT);
          note(r1);
          for (const c2 of r1.controls.filter((x) => x.visible && x.key !== c.key)) {
            for (const o2 of c2.options) note(cat.resolve({ league: leagueId, season: s.id, period: p.id, filters: { [c.key]: o.value, [c2.key]: o2.value } }, CT));
          }
        }
      }
    }
  }
  return { offered, covered };
}

test('every exposed filter option has representative games somewhere in its valid context, for all seven leagues', () => {
  const report = {};
  for (const id of LEAGUE_IDS) {
    const { offered, covered } = coverage(id);
    assert.ok(offered.size >= 4, `${id} offers filters`);
    for (const [k, label] of offered) assert.ok(covered.has(k), `${id} ${label} never shows a game`);
    report[id] = offered.size;
  }
  console.log(`filter options with games, per league: ${JSON.stringify(report)}`);
});

test('controls per league: conference and division; AL / NL with American and National League; FBS/FCS subdivision; college rankings and tournaments', () => {
  const keys = (id, period) => cat.resolve({ league: id, period }, CT).controls.filter((c) => c.visible).map((c) => `${c.key}=${c.label}`);
  assert.deepEqual(keys('nfl'), ['conference=Conference', 'division=Division']);
  assert.deepEqual(keys('nba'), ['conference=Conference', 'division=Division']);
  assert.deepEqual(keys('nhl'), ['conference=Conference', 'division=Division']);
  assert.deepEqual(keys('mlb'), ['subleague=AL / NL', 'division=Division']);
  assert.deepEqual(keys('ncaaf'), ['subdivision=Subdivision', 'conference=Conference', 'ranking=Ranking']);
  assert.deepEqual(keys('ncaab'), ['conference=Conference', 'ranking=Ranking']);
  assert.deepEqual(keys('ncaab', 'weekend-2'), ['tournament=Tournament', 'round=Round']);
  assert.deepEqual(keys('ncaaw', 'final-weekend'), ['tournament=Tournament', 'round=Round']);
  const mlb = cat.resolve({ league: 'mlb' }, CT).controls;
  assert.deepEqual(mlb[0].options.map((o) => o.label), ['Both leagues', 'American League', 'National League']);
  assert.ok(!mlb.some((c) => c.label === 'League'), 'no second control called League');
  assert.ok(mlb[1].options.some((o) => o.label === 'AL West'));
  const nfl = cat.resolve({ league: 'nfl' }, CT).controls;
  assert.deepEqual(nfl[0].options.map((o) => o.label), ['All conferences', 'AFC', 'NFC']);
  assert.ok(nfl[1].options.some((o) => o.label === 'NFC North'));
});

test('cascade: a parent change repopulates its children and resets values that no longer apply', () => {
  let r = cat.resolve({ league: 'nfl', filters: { conference: 'nfc', division: 'nfc-north' } }, CT);
  assert.equal(r.view.filters.division, 'nfc-north');
  assert.ok(r.controls[1].options.every((o) => o.value === 'all' || o.value.startsWith('nfc-')), 'NFC divisions only');
  r = cat.resolve({ league: 'nfl', filters: { conference: 'afc', division: 'nfc-north' } }, CT);
  assert.equal(r.view.filters.division, 'all', 'an NFC division is reset under AFC');
  r = cat.resolve({ league: 'nfl', filters: { conference: 'all', division: 'nfc-north' } }, CT);
  assert.equal(r.view.filters.division, 'nfc-north', 'a division stays valid under all conferences');
  r = cat.resolve({ league: 'ncaaf', filters: { subdivision: 'fcs', conference: 'lakeshore', ranking: 'top25' } }, CT);
  assert.equal(r.view.filters.conference, 'all', 'an FBS conference is reset under FCS');
  const rank = r.controls.find((c) => c.key === 'ranking');
  assert.equal(rank.visible, false, 'no ranking filter for FCS');
  assert.equal(rank.value, 'all');
  r = cat.resolve({ league: 'ncaab', period: 'd2026-11-15', filters: { conference: 'coastal', tournament: 'inv' } }, CT);
  assert.equal(r.controls.find((c) => c.key === 'tournament').visible, false, 'no tournament filter in the regular season');
  r = cat.resolve({ league: 'ncaab', period: 'weekend-2', filters: { conference: 'coastal', round: 's16' } }, CT);
  assert.equal(r.view.filters.conference, 'all', 'conference filter does not apply to tournament weekends');
  assert.equal(r.view.filters.tournament, 'ncaa', 'NCAA tournament is the default in its tournament period');
  assert.equal(r.view.filters.round, 's16');
  r = cat.resolve({ league: 'ncaab', period: 'weekend-2', filters: { tournament: 'inv', round: 's16' } }, CT);
  assert.equal(r.view.filters.round, 'all', 'an NCAA round is reset under the invitational');
  r = cat.resolve({ league: 'ncaab', period: 'weekend-2', filters: { tournament: 'all', round: 's16' } }, CT);
  assert.equal(r.controls.find((c) => c.key === 'round').visible, false, 'no round filter across all tournaments');
  r = cat.resolve({ league: 'nba', filters: { conference: '<script>', division: 'x' } }, CT);
  assert.deepEqual([r.view.filters.conference, r.view.filters.division], ['all', 'all'], 'unknown values fall back');
});

test('a group filter matches a game when either team belongs, including cross-group games', () => {
  for (const [league, key, value] of [['nfl', 'conference', 'afc'], ['nba', 'conference', 'west'], ['mlb', 'subleague', 'al'], ['nhl', 'division', 'east-midland'], ['ncaaf', 'conference', 'piedmont'], ['ncaab', 'conference', 'prairie']]) {
    let cross = 0;
    for (const s of cat.seasons(league)) {
      for (const p of cat.periods(league, s.id, CT)) {
        const all = cat.resolve({ league, season: s.id, period: p.id }, CT);
        const r = cat.resolve({ league, season: s.id, period: p.id, filters: { [key]: value } }, CT);
        const member = (abbr) => all.teams[abbr].groups[key] === value;
        const want = all.games.filter((g) => member(g.away) || member(g.home)).map((g) => g.id);
        if (!r.controls.find((c) => c.key === key).visible) continue;
        assert.deepEqual(r.games.map((g) => g.id), want, `${league} ${p.id} ${key}=${value}`);
        cross += r.games.filter((g) => member(g.away) !== member(g.home)).length;
      }
    }
    assert.ok(cross > 0, `${league}: some ${value} games are against teams outside it`);
  }
});

test('rankings are invented ranks 1-16; Top 10 is inside Top 25 and each shown game has a ranked team', () => {
  for (const league of ['ncaaf', 'ncaab', 'ncaaw']) {
    const all = cat.resolve({ league }, CT);
    const ranks = Object.values(all.teams).map((t) => t.rank).filter((x) => x !== null).sort((a, b) => a - b);
    assert.deepEqual(ranks, Array.from({ length: 16 }, (_, i) => i + 1));
    const t25 = cat.resolve({ league, filters: { ranking: 'top25' } }, CT).games.map((g) => g.id);
    const t10 = cat.resolve({ league, filters: { ranking: 'top10' } }, CT);
    assert.ok(t10.games.length > 0 && t10.games.length <= t25.length && t25.length <= all.games.length);
    for (const g of t10.games) {
      assert.ok(t25.includes(g.id));
      assert.ok([g.away, g.home].some((a) => all.teams[a].rank !== null && all.teams[a].rank <= 10));
    }
  }
});

test('college basketball (men and women): the NCAA tournament plus another invitational, each with named rounds and games', () => {
  for (const [league, inv] of [['ncaab', 'Riverlight Invitational'], ['ncaaw', 'Summit Invitational']]) {
    const rounds = { ncaa: new Set(), inv: new Set() };
    for (const s of cat.seasons(league)) {
      for (const p of cat.periods(league, s.id, CT).filter((x) => x.phase === 'post')) {
        const r = cat.resolve({ league, season: s.id, period: p.id }, CT);
        const t = r.controls.find((c) => c.key === 'tournament');
        assert.equal(t.value, 'ncaa', `${league} ${p.id}: NCAA tournament by default`);
        assert.deepEqual(t.options.map((o) => o.label), ['NCAA tournament', inv, 'All tournaments']);
        for (const tv of ['ncaa', 'inv']) {
          const rt = cat.resolve({ league, season: s.id, period: p.id, filters: { tournament: tv } }, CT);
          assert.ok(rt.games.length > 0, `${league} ${p.id} ${tv} has games`);
          assert.ok(rt.games.every((g) => g.tournament === tv));
          for (const o of rt.controls.find((c) => c.key === 'round').options.filter((x) => x.value !== 'all')) {
            const rr = cat.resolve({ league, season: s.id, period: p.id, filters: { tournament: tv, round: o.value } }, CT);
            assert.ok(rr.games.length > 0 && rr.games.every((g) => g.round === o.value && g.roundLabel === o.label));
            rounds[tv].add(o.label);
          }
        }
        const both = cat.resolve({ league, season: s.id, period: p.id, filters: { tournament: 'all' } }, CT);
        assert.equal(both.games.length, cat.resolve({ league, season: s.id, period: p.id, filters: { tournament: 'ncaa' } }, CT).games.length + cat.resolve({ league, season: s.id, period: p.id, filters: { tournament: 'inv' } }, CT).games.length);
      }
    }
    assert.deepEqual([...rounds.ncaa].sort(), ['Championship', 'Elite Eight', 'Final Four', 'First Four', 'First Round', 'Second Round', 'Sweet 16']);
    assert.deepEqual([...rounds.inv].sort(), ['Final', 'First Round', 'Quarterfinals', 'Second Round', 'Semifinals']);
  }
});

test('an intentional empty combination is a real empty result with filters to clear (FCS in bowl week)', () => {
  const r = cat.resolve({ league: 'ncaaf', period: 'bowls', filters: { subdivision: 'fcs' } }, CT);
  assert.equal(r.games.length, 0);
  assert.equal(r.filtersActive, true);
  assert.ok(r.periodGames.length > 0, 'the period itself has games');
  assert.equal(cat.resolve({ league: 'ncaaf', period: 'bowls' }, CT).filtersActive, false);
});

test('time zones: UTC start times, local display dates, and each regular game in exactly one date period per zone', () => {
  for (const id of ['nba', 'mlb', 'nhl', 'ncaab', 'ncaaw']) {
    for (const s of cat.seasons(id)) {
      const regular = cat.allGames(id, s.id).filter((g) => g.phase === 'regular').map((g) => g.id).sort();
      for (const z of ZONE_IDS) {
        const seen = [];
        for (const p of cat.periods(id, s.id, z).filter((x) => x.phase === 'regular')) {
          const r = cat.resolve({ league: id, season: s.id, period: p.id }, z);
          for (const g of r.games) {
            assert.equal(localDateKey(g.kickoff, z), p.dateKey, `${g.id} listed on its local date in ${z}`);
            assert.equal(dateKeyLabel(p.dateKey), p.label);
            seen.push(g.id);
          }
        }
        assert.deepEqual(seen.sort(), regular, `${id} ${s.id} ${z}: a partition of the regular games`);
      }
    }
  }
});

test('time zones: late games move to the calendar date they fall on in the chosen zone', () => {
  const nba = cat.allGames('nba', '2026-27');
  const sat11 = nba.find((g) => g.kickoff === '2026-11-15T05:00:00Z');
  assert.ok(sat11, 'Sat 11:00 PM Central game');
  assert.equal(localDateKey(sat11.kickoff, 'America/Chicago'), '2026-11-14');
  assert.equal(localDateKey(sat11.kickoff, 'America/Los_Angeles'), '2026-11-14');
  assert.equal(localDateKey(sat11.kickoff, 'America/New_York'), '2026-11-15');
  assert.equal(localDateKey(sat11.kickoff, 'UTC'), '2026-11-15');
  const inPeriod = (z, key) => cat.resolve({ league: 'nba', period: `d${key}` }, z).games.some((g) => g.id === sat11.id);
  assert.ok(inPeriod('America/Chicago', '2026-11-14') && !inPeriod('America/Chicago', '2026-11-15'));
  assert.ok(inPeriod('America/New_York', '2026-11-15') && !inPeriod('America/New_York', '2026-11-14'));
  const sun930 = nba.find((g) => g.kickoff === '2026-11-16T03:30:00Z');
  assert.ok(cat.resolve({ league: 'nba', period: 'd2026-11-15' }, 'America/Chicago').games.some((g) => g.id === sun930.id));
  assert.ok(cat.resolve({ league: 'nba', period: 'd2026-11-16' }, 'UTC').games.some((g) => g.id === sun930.id));
  const mlb = cat.allGames('mlb', '2026').find((g) => g.kickoff === '2026-09-24T04:40:00Z');
  assert.ok(mlb, 'Wed 11:40 PM Central game');
  assert.equal(localDateKey(mlb.kickoff, 'America/Chicago'), '2026-09-23');
  assert.equal(localDateKey(mlb.kickoff, 'America/New_York'), '2026-09-24');
  assert.equal(zonedToUtc('2026-11-15', '15:50', 'America/Chicago'), '2026-11-15T21:50:00Z', 'standard time');
  assert.equal(zonedToUtc('2026-09-24', '19:40', 'America/Chicago'), '2026-09-25T00:40:00Z', 'daylight time');
});

test('season switch keeps the same week or round, or the same position among regular dates', () => {
  assert.equal(cat.equivalentPeriod('nfl', '2026', '2025', 'w11', CT), 'w11');
  assert.equal(cat.equivalentPeriod('nba', '2026-27', '2025-26', 'finals', CT), 'finals');
  const a = cat.periods('nba', '2026-27', CT).filter((p) => p.phase === 'regular').map((p) => p.id);
  const b = cat.periods('nba', '2025-26', CT).filter((p) => p.phase === 'regular').map((p) => p.id);
  assert.equal(cat.equivalentPeriod('nba', '2026-27', '2025-26', a[1], CT), b[1]);
});

test('statuses follow each league\'s fixed simulated moment: prior seasons final, later periods scheduled, live games on the current board', () => {
  for (const l of LEAGUES) {
    const [cur, prev] = cat.seasons(l.id);
    for (const g of cat.allGames(l.id, prev.id)) assert.equal(g.status, 'final', `${g.id} prior season`);
    const now = Date.parse(l.simNow);
    for (const g of cat.allGames(l.id, cur.id)) {
      if (g.status === 'scheduled') assert.ok(Date.parse(g.kickoff) > now, `${g.id} scheduled in the future`);
      if (g.status === 'final') assert.ok(Date.parse(g.kickoff) < now, `${g.id} final in the past`);
    }
    const board = cat.resolve({ league: l.id }, CT);
    assert.ok(board.games.some((g) => ['live', 'halftime', 'delayed'].includes(g.status)), `${l.id} current board has a game in progress`);
    assert.ok(board.games.some((g) => g.status === 'final'), `${l.id} current board has a final`);
    assert.ok(board.games.some((g) => g.status === 'scheduled'), `${l.id} current board has a pregame`);
  }
});

test('linescores, totals and per-sport units are consistent', () => {
  const reg = { quarters: 4, halves: 2, periods: 3, innings: 9 };
  for (const l of LEAGUES) {
    for (const s of cat.seasons(l.id)) {
      for (const g of cat.allGames(l.id, s.id)) {
        if (!g.linescore) {
          assert.ok(['scheduled', 'postponed'].includes(g.status), `${g.id} ${g.status}`);
          assert.equal(g.total, null);
          continue;
        }
        const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);
        assert.equal(g.total.away, sum(g.linescore.away), g.id);
        assert.equal(g.total.home, sum(g.linescore.home), g.id);
        if (g.status === 'final') {
          assert.notEqual(g.total.away, g.total.home, `${g.id} final has a winner`);
          assert.ok(g.linescore.away.length >= reg[g.format], `${g.id} played regulation`);
          assert.equal(g.overtime === true, l.sport !== 'baseball' && g.linescore.away.length > reg[g.format]);
        }
        if (l.sport === 'baseball') {
          assert.ok(g.hits.away >= g.total.away && g.hits.home >= g.total.home, `${g.id} hits >= runs`);
          assert.ok(Number.isInteger(g.errors.away));
        }
        if (g.status === 'final' || g.status === 'live') assert.ok(g.leaders, `${g.id} has leaders`);
      }
    }
  }
});

// Real-league team nicknames as truncated sha256 hashes (the same list the
// fixtures test uses), so this file names none of them.
const REAL_NICK = new Set(['99f78cb242dc2c85', '5afc47efb471c419', '6051c9461b4d52ad', 'a652518c696b409e', '5146ade2f3cf7a75', 'faa5af7cea8ae502', '0bfe298af0976c94', '3830580a8eeea6f3', 'f86aa868c3b4d5a0', '48fe20b1438396c8', '95077276ff3dc739', '81ac4a9305a1e8b9', '089604bb0ff1ecd1', '1529783191a84fbc', '4c7a13352465820b', '20eb2d6033563aa5', '0b04bad57d3b2c6f', 'b02620d925c8ba90', '75c1354b3457f0e5', 'ce1484f50441f993', '0309714f4cc5bdb8', '462aec2ca8883242', '5e10aaf3bc689abc', 'c7904c9551072c0c', '4b29228fc7204291', 'c94bb5f268d814b7', 'aae0a09ff5c9b924', 'b8bff3bb4bcf8cd7', '449f7e9884f85f30', '6b9c23d75f15ac5c', 'a8d6424c223b64eb', '5c20629531fe652b']);
const h16 = (x) => createHash('sha256').update(x).digest('hex').slice(0, 16);

test('teams are invented: unique names and abbreviations per league, valid colours, no real NFL nickname, no URLs', () => {
  for (const l of LEAGUES) {
    const teams = Object.values(cat.resolve({ league: l.id }, CT).teams);
    assert.equal(new Set(teams.map((t) => t.abbr)).size, teams.length);
    assert.equal(new Set(teams.map((t) => t.name)).size, teams.length);
    for (const t of teams) {
      assert.match(t.color, /^#[0-9a-f]{6}$/i);
      assert.match(t.abbr, /^[A-Z]{3}$/);
      for (const token of t.nickname.toLowerCase().split(/\s+/)) assert.ok(!REAL_NICK.has(h16(token)), `${l.id} ${t.nickname}`);
    }
  }
  const blob = JSON.stringify(LEAGUE_IDS.map((id) => cat.seasons(id).map((s) => cat.allGames(id, s.id))));
  assert.ok(!/https?:\/\//i.test(blob) && !/www\./i.test(blob));
});

// ---------- 008: derived drive and team stats ----------
const STARTED = new Set(['live', 'halftime', 'end_period', 'delayed', 'suspended', 'final']);
const IN_PROGRESS = new Set(['live', 'halftime', 'end_period', 'delayed', 'suspended']);
const everyGame = () => LEAGUES.flatMap((l) => cat.seasons(l.id).flatMap((s) => cat.allGames(l.id, s.id)));

// 008002: the canonical g11-112 gains an invented current position in the
// derived catalog only; these are the only original fields allowed to change.
const G112_SUPPLIED = ['possession', 'situation', 'lastPlay', 'missing'];
test('the original invented games are unchanged: every field of all 802 games except the new drive and team stats matches the pre-008 catalog', () => {
  const raw112 = generateWeek().games.find((g) => g.id === 'g11-112');
  const strip = (g) => {
    const { drive, teamStats, ...rest } = g;
    // 008002: g11-112's supplied current fields are compared with the raw fixture they replace
    if (g.id === 'nfl-2026-g11-112') for (const k of G112_SUPPLIED) rest[k] = raw112[k];
    return rest;
  };
  const blob = JSON.stringify(LEAGUE_IDS.map((id) => cat.seasons(id).map((s) => cat.allGames(id, s.id).map(strip))));
  assert.equal(everyGame().length, 802);
  assert.equal(createHash('sha256').update(blob).digest('hex'), '9978979297852f550fae3b321d26d0956222f1a0e72322b1bec9c2fb33dde362', 'fingerprint taken from the unchanged catalog before this change');
  const fx = new Map(generateWeek().games.map((g) => [g.id, g]));
  for (const g of cat.resolve({ league: 'nfl' }, CT).games) {
    const o = fx.get(g.localId);
    for (const [k, v] of Object.entries(o)) if (k !== 'id' && !(g.localId === 'g11-112' && G112_SUPPLIED.includes(k))) assert.deepEqual(g[k], v, `${g.id} ${k} kept from the original NFL week`);
  }
  const g112 = cat.resolve({ league: 'nfl' }, CT).games.find((g) => g.localId === 'g11-112');
  assert.deepEqual(G112_SUPPLIED.filter((k) => JSON.stringify(g112[k]) !== JSON.stringify(raw112[k])), G112_SUPPLIED, 'g11-112: exactly the supplied current fields differ from the raw fixture');
});

test('team stats for every started game in all seven leagues and both seasons add up to the score shown; none before a game starts; marked invented', () => {
  const counts = {};
  let zero = 0;
  let overtime = 0;
  for (const g of everyGame()) {
    if (!STARTED.has(g.status) || !g.linescore) {
      assert.equal(g.teamStats, null, `${g.id} (${g.status}) has no team stats`);
      continue;
    }
    assert.deepEqual(teamStatProblems(g), [], `${g.id} ${g.status}`);
    assert.equal(g.teamStats.simulated, true);
    if (g.total.away === 0 || g.total.home === 0) zero++;
    if (g.overtime) overtime++;
    counts[`${g.league} ${g.status}`] = (counts[`${g.league} ${g.status}`] ?? 0) + 1;
  }
  console.log(`team stats checked: ${JSON.stringify(counts)}; zero-score sides ${zero}; overtime ${overtime}`);
  for (const id of LEAGUE_IDS) {
    assert.ok(counts[`${id} final`] > 0, `${id} finals`);
    assert.ok(Object.keys(counts).some((k) => k.startsWith(`${id} `) && !k.endsWith('final')), `${id} games in progress`);
  }
  assert.ok(zero >= 5 && overtime >= 5, `zero scores (${zero}) and overtime (${overtime}) are covered`);
  const missing = cat.resolve({ league: 'nhl' }, CT).games.find((g) => g.missing.includes('shots'));
  assert.equal(missing.teamStats.away.shots, null, 'missing shots stay missing in team stats');
  const nfl = cat.resolve({ league: 'nfl' }, CT).games;
  assert.equal(nfl.find((g) => g.localId === 'g11-118').teamStats, null, 'an unknown status gets no stats');
  assert.equal(nfl.find((g) => g.localId === 'g11-162').teamStats, null, 'a postponed game gets no stats');
});

test('every in-progress football game has a drive with start, play count, yards and direction that add up, including the kickoffs and the game with no live position', () => {
  let n = 0;
  const kinds = {};
  for (const g of everyGame()) {
    if (g.sport !== 'football') {
      assert.equal(g.drive ?? null, null, `${g.id}: drives are football only`);
      continue;
    }
    if (!IN_PROGRESS.has(g.status)) {
      assert.equal(g.drive, null, `${g.id} (${g.status}) has no current drive`);
      continue;
    }
    assert.ok(g.drive, `${g.id} has a drive`);
    assert.deepEqual(driveProblems(g), [], g.id);
    const k = g.drive.inProgress ? 'in progress' : g.drive.result;
    kinds[k] = (kinds[k] ?? 0) + 1;
    n++;
  }
  console.log(`football drives: ${n} ${JSON.stringify(kinds)}`);
  for (const k of ['in progress', 'Touchdown', 'Field goal', 'Safety']) assert.ok(kinds[k] > 0, k);
  const nfl = new Map(cat.resolve({ league: 'nfl' }, CT).games.map((g) => [g.localId, g]));
  const gl = nfl.get('g11-183').drive;
  assert.deepEqual([gl.team, gl.end, gl.direction, gl.inProgress], ['away', 8, 'right', true], 'goal to go at the 8, driving right');
  const ko = nfl.get('g11-195').drive;
  assert.deepEqual([ko.team, ko.end, ko.result], ['away', 0, 'Touchdown'], 'the kicking team just scored a touchdown');
  // 008002: the game with no live position in its raw fixture has an invented current drive in the catalog
  const blank = nfl.get('g11-112');
  assert.equal(generateWeek().games.find((g) => g.id === 'g11-112').situation, null, 'the raw missing-data fixture keeps its missing position');
  assert.deepEqual([blank.drive.team, blank.drive.result, blank.drive.inProgress, blank.drive.end], ['home', null, true, blank.situation.yardsToEndzone], 'its current drive matches its current position');
  assert.equal(nfl.get('g11-140').drive.team, 'home', 'the delayed game keeps its drive');
});

// ---------- 008002: every live football game has a current position ----------
// A live football game must say where the ball is now: the team with the ball,
// a finite ball position, a valid down and distance (or a kickoff spot), and a
// drive that matches them. A last completed drive alone is not enough.
const towards = (side) => (side === 'away' ? 'right' : 'left');
function currentProblems(g) {
  const out = [];
  const s = g.situation;
  const d = g.drive;
  if (g.possession !== 'away' && g.possession !== 'home') out.push('no team with the ball');
  if (!s || !Number.isFinite(s.yardsToEndzone) || s.yardsToEndzone < 0 || s.yardsToEndzone > 100) return [...out, 'no current ball position'];
  if (!d || !Number.isFinite(d.start) || !Number.isFinite(d.end)) return [...out, 'no drive start'];
  if (d.direction !== towards(g.possession)) out.push('drive direction is not the team with the ball');
  if (s.phase === 'kickoff') {
    if (!Number.isInteger(s.yardsToEndzone) || s.yardsToEndzone < 50 || s.yardsToEndzone > 85) out.push(`kickoff spot ${s.yardsToEndzone}`);
    if (d.inProgress || d.team !== g.possession || !['Touchdown', 'Field goal', 'Safety'].includes(d.result)) out.push('a kickoff follows the kicking team\'s completed drive');
  } else {
    if (!Number.isInteger(s.down) || s.down < 1 || s.down > 4) out.push(`down ${s.down}`);
    if (!Number.isInteger(s.distance) || s.distance < 1 || (s.goalToGo ? s.distance !== s.yardsToEndzone : s.distance >= s.yardsToEndzone)) out.push(`distance ${s.distance} at ${s.yardsToEndzone}`);
    if (!d.inProgress || d.team !== g.possession || d.end !== s.yardsToEndzone || d.start < d.end) out.push('the current drive does not end at the ball');
  }
  return [...out, ...driveProblems(g)];
}
const UNKNOWN_NOW = /Current ball position not available|Drive not available|Situation not available|Down unknown|Field position unavailable/;

test('every live football game in every NFL and NCAAF season and period has a current ball position, the team with the ball, a valid down and distance and a drive that matches them (kickoffs: the kicking spot after the completed drive); nothing reads not available; unknown positions are rejected', () => {
  const seen = [];
  for (const league of ['nfl', 'ncaaf']) {
    for (const season of cat.seasons(league, CT)) {
      for (const period of cat.periods(league, season.id, CT)) {
        for (const g of cat.resolve({ league, season: season.id, period: period.id }, CT).periodGames) {
          if (!IN_PROGRESS.has(g.status)) continue;
          assert.deepEqual(currentProblems(g), [], g.id);
          const doc = new FakeDocument();
          const text = buildSituationPanel(doc, g, cat.resolve({ league, season: season.id, period: period.id }, CT).teams).textContent;
          assert.doesNotMatch(text, UNKNOWN_NOW, `${g.id}: the Situation panel knows where the ball is`);
          if (g.situation.phase === 'kickoff') assert.match(text, /Now: \w+ kicking off from /, `${g.id}: the kickoff spot`);
          else assert.match(text, /Drive · \w+ · \d+ plays?, -?\d+ yards?/, `${g.id}: the current drive`);
          seen.push(g.id);
        }
      }
    }
  }
  assert.equal(new Set(seen).size, seen.length, 'each game once');
  assert.ok(seen.includes('nfl-2026-g11-112'), 'including g11-112');
  assert.ok(seen.length >= 12, `${seen.length} live football games`);
  // negative cases: unknown or partial current positions are rejected
  const raw = { ...generateWeek().games.find((g) => g.id === 'g11-112'), drive: { team: 'away', direction: 'right', start: 47, end: 7, yards: 40, plays: 9, inProgress: false, result: 'Field goal' } };
  assert.ok(currentProblems(raw).includes('no current ball position'), 'a last completed drive alone is not a current position');
  assert.ok(currentProblems(raw).includes('no team with the ball'));
  const ok = cat.resolve({ league: 'nfl' }, CT).games.find((g) => g.localId === 'g11-183');
  assert.deepEqual(currentProblems(ok), []);
  const bad = (patch, want) => assert.ok(currentProblems({ ...ok, ...patch }).some((p) => p.includes(want)), `rejects ${want}`);
  bad({ situation: { ...ok.situation, yardsToEndzone: NaN } }, 'no current ball position');
  bad({ possession: null }, 'no team with the ball');
  bad({ situation: { ...ok.situation, down: 5 } }, 'down');
  bad({ situation: { down: 2, distance: 12, yardsToEndzone: 8 } }, 'distance');
  bad({ drive: { ...ok.drive, inProgress: false, result: 'Field goal' } }, 'the current drive does not end at the ball');
  bad({ drive: { ...ok.drive, end: 30, start: 44 } }, 'the current drive does not end at the ball');
  bad({ drive: { ...ok.drive, direction: 'left' } }, 'drive direction');
  bad({ drive: null }, 'no drive start');
  const ko = cat.resolve({ league: 'nfl' }, CT).games.find((g) => g.localId === 'g11-195');
  assert.deepEqual(currentProblems(ko), []);
  assert.ok(currentProblems({ ...ko, drive: { ...ko.drive, inProgress: true, result: null } }).some((p) => p.includes('completed drive')), 'a kickoff needs the completed drive');
  const doc = new FakeDocument();
  assert.match(buildSituationPanel(doc, raw, generateWeek().teams).textContent, UNKNOWN_NOW, 'the raw fixture still renders its gaps honestly');
  assert.deepEqual(driveLines(raw, generateWeek().teams).slice(-1).map((l) => l.text), ['Current ball position not available']);
});

test('g11-112 in the derived catalog: an invented current ZHG drive and last play, no added score; score, clock, status, linescore, network, timeouts, leaders and team stats unchanged; only the supplied fields leave the missing list; the raw fixture is untouched; repeat builds are identical', () => {
  const raw = generateWeek().games.find((g) => g.id === 'g11-112');
  assert.deepEqual([raw.possession, raw.situation, raw.lastPlay, raw.timeouts, raw.network], [null, null, null, null, null], 'raw fixture: still deliberately incomplete');
  assert.deepEqual(raw.missing, ['network', 'possession', 'situation', 'timeouts', 'lastPlay', 'leaders.receiving']);
  const get = (c, zone = CT) => c.resolve({ league: 'nfl', season: '2026', period: 'w11' }, zone).games.find((g) => g.localId === 'g11-112');
  const g = get(cat);
  assert.equal(g.possession, 'home');
  assert.deepEqual(g.situation, { down: 2, distance: 6, yardsToEndzone: 59 });
  assert.deepEqual(g.drive, { team: 'home', direction: 'left', start: 75, end: 59, yards: 16, plays: 2, inProgress: true, result: null });
  assert.deepEqual(g.lastPlay, { type: 'run', text: 'P. Moravec runs off right tackle for 4 yards to the ZHG 41.' });
  assert.doesNotMatch(g.lastPlay.text, /touchdown|field goal|safety|extra point|good|scores?\b/i, 'the last play adds no score');
  assert.deepEqual(driveProblems(g), []);
  assert.deepEqual(g.missing, ['network', 'timeouts', 'leaders.receiving'], 'only the supplied fields leave the missing list');
  for (const k of ['away', 'home', 'kickoff', 'status', 'period', 'clock', 'linescore', 'network', 'timeouts', 'leaders', 'week', 'timeValid', 'overtime', 'redZone', 'scoringCue', 'corrected']) assert.deepEqual(g[k], raw[k], `${k} unchanged`);
  assert.deepEqual(g.total, { away: 3, home: 0 });
  assert.equal(g.redZone, false, 'no red zone at its own 41');
  assert.deepEqual(g.teamStats, {
    simulated: true,
    away: { points: 3, totalYards: 55, passingYards: 35, rushingYards: 20, firstDowns: 4, turnovers: 0, penalties: 1, penaltyYards: 7 },
    home: { points: 0, totalYards: 92, passingYards: 66, rushingYards: 26, firstDowns: 6, turnovers: 0, penalties: 0, penaltyYards: 0 },
  }, 'team stats unchanged');
  assert.deepEqual(teamStatProblems(g), []);
  assert.ok(g.teamStats.home.rushingYards >= g.leaders.rushing.yards && g.leaders.rushing.team === 'ZHG', 'the ZHG rusher fits the team stats');
  // determinism: other builds, zones and an anchored clock give the same game
  const once = JSON.stringify(g);
  for (const c of [buildCatalog(), buildCatalog({ now: Date.parse('2026-11-12T20:30:00Z') })]) for (const z of ZONE_IDS) assert.equal(JSON.stringify(get(c, z)), once, `same g11-112 in ${z}`);
  assert.equal(JSON.stringify(generateWeek().games.find((x) => x.id === 'g11-112')), JSON.stringify(raw), 'the raw fixture is not changed by building the catalog');
  // what the Situation panel says
  const text = buildSituationPanel(new FakeDocument(), g, generateWeek().teams).textContent;
  assert.match(text, /2nd & 6 · ZHG 41 · ZHG ball ←/);
  assert.match(text, /Drive · ZHG · 2 plays, 16 yards/);
  assert.match(text, /Started at the ZHG 25 · ball on the ZHG 41 · going ← toward the YWK end zone/);
  assert.match(text, /P\. Moravec runs off right tackle for 4 yards to the ZHG 41\./);
  assert.match(text, /Timeouts not available/, 'unknown timeouts stay honest');
  assert.doesNotMatch(text, UNKNOWN_NOW);
});
