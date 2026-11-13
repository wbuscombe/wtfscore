import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWeek } from '../public/lib/fixtures.mjs';
import { sortGames, kickoffKey, STATUS_GROUP, compareKickoff } from '../public/lib/model.mjs';

const week = generateWeek();

// Derived by hand from the fixture data: kickoff ascending, equal kickoffs by
// game id, the TBD kickoff last.
const EXPECTED = ['g11-104', 'g11-131', 'g11-118', 'g11-140', 'g11-149', 'g11-157', 'g11-162', 'g11-171', 'g11-126', 'g11-183', 'g11-112', 'g11-195', 'g11-108', 'g11-199', 'g11-166', 'g11-121'];

test('kickoff sort from the shuffled generator input', () => {
  const input = week.games;
  assert.notDeepEqual(input.map((g) => g.id), EXPECTED, 'input really is shuffled');
  const out = sortGames(input, 'kickoff');
  assert.deepEqual(out.map((g) => g.id), EXPECTED);
});

test('kickoff order invariants: non-decreasing kickoff, id tie-break, TBD last', () => {
  const out = sortGames(week.games);
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    assert.ok(kickoffKey(a) <= kickoffKey(b), `${a.id} before ${b.id}`);
    if (kickoffKey(a) === kickoffKey(b)) assert.ok(a.id < b.id, `tie ${a.id} < ${b.id}`);
  }
  assert.equal(out[out.length - 1].timeValid, false);
});

test('result is independent of input order across many shuffles', () => {
  const ref = sortGames(week.games).map((g) => g.id);
  for (let seed = 1; seed <= 40; seed++) {
    assert.deepEqual(sortGames(generateWeek({ seed }).games).map((g) => g.id), ref, `seed ${seed}`);
  }
});

test('sorting does not mutate its input', () => {
  const input = generateWeek().games;
  const before = input.map((g) => g.id);
  sortGames(input, 'kickoff');
  sortGames(input, 'status');
  assert.deepEqual(input.map((g) => g.id), before);
});

test('unparseable kickoff sorts last, then by id', () => {
  const games = [
    { id: 'b', kickoff: 'not a date', status: 'scheduled' },
    { id: 'a', kickoff: '2026-11-15T18:00:00Z', status: 'scheduled' },
    { id: 'c', kickoff: '2026-11-15T18:00:00Z', status: 'scheduled' },
    { id: 'aa', kickoff: 'also bad', status: 'scheduled' },
  ];
  assert.deepEqual(sortGames(games).map((g) => g.id), ['a', 'c', 'aa', 'b']);
});

test('status sort groups in progress, then upcoming, then final, then other', () => {
  const out = sortGames(week.games, 'status');
  const groups = out.map((g) => STATUS_GROUP[g.status] ?? 3);
  for (let i = 1; i < groups.length; i++) assert.ok(groups[i - 1] <= groups[i]);
  for (let i = 1; i < out.length; i++) {
    if (groups[i - 1] === groups[i]) assert.ok(compareKickoff(out[i - 1], out[i]) < 0, 'kickoff then id within a group');
  }
  assert.equal(out[0].status === 'live' || out[0].status === 'delayed', true);
  assert.equal(out[out.length - 1].status, 'unknown');
});

test('status sort: pinned expanded cards keep their slot; others fill around them', () => {
  const kick = sortGames(week.games, 'kickoff');
  const pins = new Map([
    ['g11-104', 0], // a final game held at the top
    ['g11-183', 9],
  ]);
  const out = sortGames(week.games, 'status', { pins });
  assert.equal(out[0].id, 'g11-104');
  assert.equal(out[9].id, 'g11-183');
  assert.deepEqual([...out.map((g) => g.id)].sort(), [...kick.map((g) => g.id)].sort(), 'still a permutation');
  const rest = out.filter((g) => !pins.has(g.id));
  for (let i = 1; i < rest.length; i++) {
    const ga = STATUS_GROUP[rest[i - 1].status] ?? 3;
    const gb = STATUS_GROUP[rest[i].status] ?? 3;
    assert.ok(ga < gb || (ga === gb && compareKickoff(rest[i - 1], rest[i]) < 0));
  }
});

test('invalid pins are ignored safely', () => {
  const pins = new Map([
    ['nope', 3],
    ['g11-104', 99],
    ['g11-131', 2],
    ['g11-157', 2],
  ]);
  const out = sortGames(week.games, 'status', { pins });
  assert.equal(out.length, week.games.length);
  assert.equal(new Set(out.map((g) => g.id)).size, week.games.length);
  assert.equal(out[2].id, 'g11-131', 'first claimant (by id) keeps a contested slot');
});
