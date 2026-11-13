import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWeek } from '../public/lib/fixtures.mjs';
import { ExpansionState, isExpandable, notExpandableReason, spreadPick, clampCap, sortGames } from '../public/lib/model.mjs';

const week = generateWeek();
const games = week.games;
const ordered = sortGames(games);
const eligible = ordered.filter(isExpandable).map((g) => g.id);
const [A, B, C, D, E] = eligible;

test('eligibility: pregame, TBD, postponed and unknown never expand', () => {
  const byStatus = (s) => games.filter((g) => g.status === s);
  for (const s of ['scheduled', 'postponed', 'unknown']) {
    for (const g of byStatus(s)) {
      assert.equal(isExpandable(g), false, `${g.id} ${s}`);
      assert.ok(notExpandableReason(g).length > 0);
    }
  }
  for (const s of ['live', 'final', 'delayed']) for (const g of byStatus(s)) assert.equal(isExpandable(g), true);
  assert.ok(eligible.length >= 6, 'enough expandable games for 6-expanded scenarios');
});

test('advance on a pregame card is a no-op that reports why', () => {
  const st = new ExpansionState({ games, cap: 3 });
  const pre = games.find((g) => g.status === 'scheduled');
  const r = st.advance(pre.id);
  assert.equal(r.ok, false);
  assert.equal(st.stageOf(pre.id), 1);
  assert.equal(st.count(), 0);
});

test('stage transitions 1 -> 2 -> 3 -> 1', () => {
  const st = new ExpansionState({ games, cap: 3 });
  assert.equal(st.advance(A).to, 2);
  assert.equal(st.advance(A).to, 3);
  const back = st.advance(A);
  assert.equal(back.to, 1);
  assert.equal(st.count(), 0);
});

test('LRU cap: the least recently expanded card collapses in place', () => {
  const st = new ExpansionState({ games, cap: 3 });
  st.advance(A);
  st.advance(B);
  st.advance(C);
  const r = st.advance(D);
  assert.deepEqual(r.collapsed, [A]);
  assert.equal(st.stageOf(A), 1);
  assert.deepEqual(st.expandedIds(), [B, C, D]);
});

test('advancing an open card refreshes its recency', () => {
  const st = new ExpansionState({ games, cap: 3 });
  st.advance(A);
  st.advance(B);
  st.advance(C);
  st.advance(A); // A to stage 3: now most recent
  const r = st.advance(D);
  assert.deepEqual(r.collapsed, [B]);
  assert.equal(st.stageOf(A), 3);
});

test('cap 1 gives one-at-a-time', () => {
  const st = new ExpansionState({ games, cap: 1 });
  for (const id of [A, B, C, D, E]) {
    st.advance(id);
    assert.equal(st.count(), 1);
    assert.deepEqual(st.expandedIds(), [id]);
  }
});

test('lowering the cap collapses the oldest first; cap is clamped to 1-6', () => {
  const st = new ExpansionState({ games, cap: 6 });
  for (const id of [A, B, C, D, E]) st.advance(id);
  const collapsed = st.setCap(2);
  assert.deepEqual(collapsed, [A, B, C]);
  assert.deepEqual(st.expandedIds(), [D, E]);
  assert.equal(clampCap(0), 1);
  assert.equal(clampCap(99), 6);
  assert.equal(clampCap('x'), 3);
});

test('six simultaneous expansions at cap 6, and a seventh evicts one', () => {
  const st = new ExpansionState({ games, cap: 6 });
  for (const id of eligible.slice(0, 6)) st.advance(id);
  assert.equal(st.count(), 6);
  const r = st.advance(eligible[6]);
  assert.equal(r.collapsed.length, 1);
  assert.equal(st.count(), 6);
});

test('escape steps the focused card down, else the most recent expanded card', () => {
  const st = new ExpansionState({ games, cap: 3 });
  st.advance(A);
  st.advance(A); // stage 3
  st.advance(B); // stage 2
  assert.equal(st.escape(A).to, 2);
  const compact = ordered.find((g) => !isExpandable(g)).id;
  const r = st.escape(compact);
  assert.equal(r.id, B, 'most recently expanded card');
  assert.equal(st.stageOf(B), 1);
  st.escape(A);
  assert.equal(st.count(), 0);
  assert.equal(st.escape(A).ok, false, 'nothing to step down');
});

test('collapse goes straight to stage 1', () => {
  const st = new ExpansionState({ games, cap: 3 });
  st.advance(A);
  st.advance(A);
  assert.equal(st.collapse(A).to, 1);
  assert.equal(st.stageOf(A), 1);
  assert.equal(st.collapse(A).ok, false);
});

test('setStage respects eligibility and the cap', () => {
  const st = new ExpansionState({ games, cap: 2 });
  const pre = games.find((g) => g.status === 'scheduled').id;
  assert.equal(st.setStage(pre, 3).ok, false);
  st.setStage(A, 3);
  st.setStage(B, 3);
  const r = st.setStage(C, 2);
  assert.deepEqual(r.collapsed, [A]);
});

test('spreadPick is deterministic and evenly spaced', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `x${i}`);
  assert.deepEqual(spreadPick(ids, 0), []);
  assert.deepEqual(spreadPick(ids, 3), ['x0', 'x3', 'x6']);
  assert.deepEqual(spreadPick(ids, 6), ['x0', 'x1', 'x3', 'x5', 'x6', 'x8']);
  assert.deepEqual(spreadPick(ids, 20), ids);
  assert.deepEqual(spreadPick(ids, 5), spreadPick(ids, 5));
});
