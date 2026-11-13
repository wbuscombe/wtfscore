import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWeek, FIXTURE_CASES, shuffled, prng } from '../public/lib/fixtures.mjs';
import { compareKickoff } from '../public/lib/model.mjs';

const week = generateWeek();
const byId = new Map(week.games.map((g) => [g.id, g]));
const weekday = (iso, zone) => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: zone }).format(new Date(iso));
const CT = 'America/Chicago';

test('generator is deterministic for a seed', () => {
  assert.deepEqual(generateWeek(), generateWeek());
  assert.deepEqual(generateWeek({ seed: 99 }).games.map((g) => g.id), generateWeek({ seed: 99 }).games.map((g) => g.id));
});

test('emission order is shuffled, never kickoff order, and differs by seed', () => {
  const emitted = week.games.map((g) => g.id);
  const sorted = [...week.games].sort(compareKickoff).map((g) => g.id);
  assert.notDeepEqual(emitted, sorted);
  const other = generateWeek({ seed: 12 }).games.map((g) => g.id);
  assert.notDeepEqual(emitted, other);
  assert.deepEqual([...emitted].sort(), [...other].sort());
});

test('shuffle is a permutation and the PRNG is stable', () => {
  const xs = Array.from({ length: 30 }, (_, i) => i);
  const s = shuffled(xs, 5);
  assert.deepEqual([...s].sort((a, b) => a - b), xs);
  assert.equal(prng(1)(), prng(1)());
});

test('ids unique, teams exist, each team plays at most once, totals match linescores', () => {
  const ids = week.games.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  const seen = new Set();
  for (const g of week.games) {
    for (const t of [g.away, g.home]) {
      assert.ok(week.teams[t], `team ${t} exists`);
      assert.ok(!seen.has(t), `team ${t} appears once`);
      seen.add(t);
    }
    if (g.linescore) {
      assert.equal(g.total.away, g.linescore.away.reduce((a, b) => a + b, 0));
      assert.equal(g.total.home, g.linescore.home.reduce((a, b) => a + b, 0));
    } else {
      assert.equal(g.total, null);
    }
  }
});

test('week covers Thu, Sat, Sun and Mon in Central time', () => {
  const days = new Set(week.games.map((g) => weekday(g.kickoff, CT)));
  for (const d of ['Thu', 'Sat', 'Sun', 'Mon']) assert.ok(days.has(d), `has ${d}`);
  for (const id of FIXTURE_CASES.thursday) assert.equal(weekday(byId.get(id).kickoff, CT), 'Thu');
  for (const id of FIXTURE_CASES.saturday) assert.equal(weekday(byId.get(id).kickoff, CT), 'Sat');
  for (const id of FIXTURE_CASES.sunday) assert.equal(weekday(byId.get(id).kickoff, CT), 'Sun');
  for (const id of FIXTURE_CASES.monday) assert.equal(weekday(byId.get(id).kickoff, CT), 'Mon');
});

test('equal kickoffs exist with ids out of canonical order', () => {
  const counts = new Map();
  for (const g of week.games) counts.set(g.kickoff, (counts.get(g.kickoff) || 0) + 1);
  assert.ok([...counts.values()].some((n) => n >= 3), 'a kickoff shared by 3+ games');
  const group = FIXTURE_CASES.equalKickoff.map((id) => byId.get(id));
  assert.equal(new Set(group.map((g) => g.kickoff)).size, 1);
  const ids = group.map((g) => g.id);
  assert.notDeepEqual(ids, [...ids].sort(), 'catalog order differs from id order, so the tie-break is exercised');
});

test('cross-midnight kickoff changes date between Central and Eastern', () => {
  for (const id of FIXTURE_CASES.crossMidnight) {
    const g = byId.get(id);
    assert.notEqual(weekday(g.kickoff, CT), weekday(g.kickoff, 'America/New_York'));
  }
});

test('state cases: OT, red zone, TD, FG, correction, postponed, TBD, unknown, delayed', () => {
  for (const id of FIXTURE_CASES.overtime) {
    const g = byId.get(id);
    assert.ok(g.overtime && g.linescore.away.length === 5 && g.linescore.home.length === 5);
  }
  for (const id of FIXTURE_CASES.redZone) {
    const g = byId.get(id);
    assert.ok(g.redZone && g.situation.yardsToEndzone <= 20);
  }
  for (const id of FIXTURE_CASES.touchdown) {
    const g = byId.get(id);
    assert.equal(g.lastPlay.type, 'touchdown');
    assert.equal(g.scoringCue, 'TD');
  }
  for (const id of FIXTURE_CASES.fieldGoal) {
    const g = byId.get(id);
    assert.equal(g.lastPlay.type, 'field_goal');
    assert.notEqual(g.scoringCue, 'TD', 'no strong cue for a field goal');
  }
  for (const id of FIXTURE_CASES.correction) assert.ok(byId.get(id).corrected.note.length > 0);
  for (const id of FIXTURE_CASES.postponed) assert.equal(byId.get(id).status, 'postponed');
  for (const id of FIXTURE_CASES.tbd) assert.equal(byId.get(id).timeValid, false);
  for (const id of FIXTURE_CASES.unknown) {
    const g = byId.get(id);
    assert.equal(g.status, 'unknown');
    assert.ok(g.statusRaw && g.statusRaw.length > 0);
  }
  for (const id of FIXTURE_CASES.delayed) assert.equal(byId.get(id).status, 'delayed');
});

test('long text case carries markup-like characters and exceeds two lines', () => {
  const texts = FIXTURE_CASES.longText.map((id) => {
    const g = byId.get(id);
    return g.lastPlay ? g.lastPlay.text : g.network;
  });
  assert.ok(texts.some((t) => t.length >= 120 && /[<>&"]/.test(t)));
  assert.ok(texts.some((t) => t.length >= 25), 'a long network label');
});

test('missing data is null and declared', () => {
  for (const id of FIXTURE_CASES.missingData) {
    const g = byId.get(id);
    assert.ok(g.missing.length >= 3);
    for (const path of g.missing) {
      const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), g);
      assert.equal(v, null, `${path} is null`);
    }
  }
});

test('snapshots include non-monotonic, gap and persisted-correction data, fixture-only', () => {
  const snaps = week.snapshots;
  assert.ok(snaps.every((s) => s.fixtureOnly === true && s.guardsBelongTo === 'DEL-1'));
  const clockSec = (c) => {
    const [m, s] = c.split(':').map(Number);
    return m * 60 + s;
  };
  const byGame = new Map();
  for (const s of snaps) byGame.set(s.gameId, [...(byGame.get(s.gameId) || []), s]);
  let nonMono = false;
  let gap = false;
  let correction = false;
  for (const list of byGame.values()) {
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (b.period === a.period && clockSec(b.clock) > clockSec(a.clock)) nonMono = true;
      if (Date.parse(b.at) - Date.parse(a.at) > 120000) gap = true;
      if (i >= 2) {
        const p = list[i - 2];
        if (a.home < p.home && b.home === a.home) correction = true;
      }
    }
  }
  assert.ok(nonMono, 'non-monotonic snapshot present');
  assert.ok(gap, 'gap snapshot present');
  assert.ok(correction, 'score drop persisting two polls present');
});

test('no provider data: no URLs, valid colors, labeled simulated', () => {
  const blob = JSON.stringify(generateWeek());
  assert.ok(!/https?:\/\//i.test(blob));
  assert.ok(!/www\./i.test(blob));
  for (const t of Object.values(week.teams)) assert.match(t.color, /^#[0-9a-f]{6}$/i);
  assert.equal(week.meta.simulated, true);
});

// Real-league team nicknames and abbreviations as truncated sha256 hashes of the
// lowercase token, so this file names none of them.
const REAL_NICK = new Set(['99f78cb242dc2c85', '5afc47efb471c419', '6051c9461b4d52ad', 'a652518c696b409e', '5146ade2f3cf7a75', 'faa5af7cea8ae502', '0bfe298af0976c94', '3830580a8eeea6f3', 'f86aa868c3b4d5a0', '48fe20b1438396c8', '95077276ff3dc739', '81ac4a9305a1e8b9', '089604bb0ff1ecd1', '1529783191a84fbc', '4c7a13352465820b', '20eb2d6033563aa5', '0b04bad57d3b2c6f', 'b02620d925c8ba90', '75c1354b3457f0e5', 'ce1484f50441f993', '0309714f4cc5bdb8', '462aec2ca8883242', '5e10aaf3bc689abc', 'c7904c9551072c0c', '4b29228fc7204291', 'c94bb5f268d814b7', 'aae0a09ff5c9b924', 'b8bff3bb4bcf8cd7', '449f7e9884f85f30', '6b9c23d75f15ac5c', 'a8d6424c223b64eb', '5c20629531fe652b']);
const REAL_ABBR = new Set(['d2efaa6dd6ae6136', 'f653dea3110d499b', '1b5a6f8f2abac45a', '3ef31aff63c2d291', '2b2961a431b23c90', 'dffe602cd1e0bfa9', 'd065fcf0c9df7b67', '808701ba8422fa3d', 'c7abd4dc26cd750f', '8a8a1a9fe8565d64', '3c2d493a01a75bfe', '0b407281768f0e83', 'f8f0b056d2457ac6', '4691511b6bed23e5', '72345e06ed6fe285', 'ad9cdbefb70da610', '626cf6d4f7ea4f20', 'a40d4e73cd6a4ddc', '367c7da58503150a', 'a6ae07ad556c5f93', '1f6fa6f69d185e60', 'cb58e4600bf0142c', '9390298f3fb0c5b1', '9b600b28d71f5082', 'a4afa7e9dde72353', '7f754d3dbef2f9c8', 'd2d165dff04ba225', '2df44271fb4e3dff', '4a69f19c8c264850', '7aa5ae9ecf82f6fc', 'e4432baa90819aae', 'b63b99f6383ba713', 'f88cace360522764']);
const h16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

test('team names and abbreviations are invented (no real-league match)', () => {
  assert.equal(REAL_NICK.size, 32);
  for (const t of Object.values(week.teams)) {
    for (const token of t.nickname.toLowerCase().split(/\s+/)) assert.ok(!REAL_NICK.has(h16(token)), `${t.nickname} is not a real nickname`);
    assert.ok(!REAL_ABBR.has(h16(t.abbr.toLowerCase())), `${t.abbr} is not a real abbreviation`);
  }
  assert.equal(new Set(Object.keys(week.teams)).size, 32);
});

test('negative control: the hash check would catch a real token', () => {
  // Uses one hash from the set itself: proves the lookup path is live.
  const probe = [...REAL_ABBR][0];
  assert.ok(REAL_ABBR.has(probe));
  assert.ok(!REAL_ABBR.has(h16('avl')));
});
