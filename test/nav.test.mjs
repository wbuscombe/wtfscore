import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWeek } from '../public/lib/fixtures.mjs';
import { buildNavGraph, reachability, reachableFrom } from '../public/lib/nav.mjs';
import { computeLayout, CANDIDATE_IDS } from '../public/lib/layout.mjs';
import { scenarioItems } from '../public/lib/metrics.mjs';
import { sortGames, isExpandable, ExpansionState } from '../public/lib/model.mjs';
import { CONTRACT_VIEWPORTS } from '../public/lib/presets.mjs';

const games = generateWeek().games;

function grid(cols, rows) {
  const rects = [];
  let i = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) rects.push({ id: `r${r}c${c}`, x: c * 110, y: r * 110, w: 100, h: 100, sortedIndex: i++ });
  return rects;
}

test('arrow edges are spatial on a plain grid', () => {
  const g = buildNavGraph(grid(3, 2));
  assert.deepEqual(g.get('r0c0'), { up: null, down: 'r1c0', left: null, right: 'r0c1' });
  assert.deepEqual(g.get('r1c2'), { up: 'r0c2', down: null, left: 'r1c1', right: null });
});

test('down from a wide card goes to the aligned card below, not a far one', () => {
  const rects = [
    { id: 'wide', x: 0, y: 0, w: 320, h: 150, sortedIndex: 0 },
    { id: 'a', x: 0, y: 160, w: 100, h: 100, sortedIndex: 1 },
    { id: 'b', x: 110, y: 160, w: 100, h: 100, sortedIndex: 2 },
  ];
  assert.equal(buildNavGraph(rects).get('wide').down, 'a');
  assert.equal(buildNavGraph(rects).get('b').up, 'wide');
});

test('up from below a short card prefers that card over a taller neighbour (engine proportions)', () => {
  // Scale 5: expanded row 150 px, compact 120 px, gutter 12 px.
  const rects = [
    { id: 'tall', x: 0, y: 0, w: 268, h: 150, sortedIndex: 0 },
    { id: 'short', x: 280, y: 0, w: 256, h: 120, sortedIndex: 1 },
    { id: 'below', x: 280, y: 162, w: 256, h: 120, sortedIndex: 2 },
  ];
  assert.equal(buildNavGraph(rects).get('below').up, 'short');
});

test('reachability reports a disconnected graph', () => {
  const g = new Map([
    ['a', { up: null, down: 'b', left: null, right: null }],
    ['b', { up: 'a', down: null, left: null, right: null }],
    ['c', { up: null, down: null, left: null, right: 'a' }],
  ]);
  const r = reachability(g, 'a');
  assert.deepEqual(r.unreachable, ['c']);
  assert.equal(r.stronglyConnected, false);
  assert.equal(reachableFrom(g, 'zzz').size, 0);
});

test('engine layouts: every card reachable from every card, pregame cards included', () => {
  const pregame = games.filter((g) => !isExpandable(g)).map((g) => g.id);
  for (const vp of CONTRACT_VIEWPORTS) {
    for (const candidate of CANDIDATE_IDS) {
      for (const k of [0, 3, 6]) {
        for (const scale of [1, 5, 7, 10]) {
          const l = computeLayout({ items: scenarioItems(games, k), viewport: vp, scale, candidate });
          const g = buildNavGraph(l.placements);
          const r = reachability(g, l.placements[0].id);
          assert.equal(r.stronglyConnected, true, `${vp.id} ${candidate} k${k} s${scale}: ${r.unreachable.join(',')}`);
          for (const id of pregame) assert.ok(g.has(id), `pregame ${id} is focusable`);
        }
      }
    }
  }
});

test('focus survives layout and sort changes: the focused id stays in the graph', () => {
  const focused = 'g11-183';
  const st = new ExpansionState({ games, cap: 3 });
  st.advance(focused);
  st.advance('g11-104');
  for (const sort of ['kickoff', 'status']) {
    const order = sortGames(games, sort, { pins: sort === 'status' ? new Map([[focused, 9]]) : null });
    for (const candidate of CANDIDATE_IDS) {
      const l = computeLayout({ items: order.map((g) => ({ id: g.id, stage: st.stageOf(g.id) })), viewport: { w: 1280, h: 720 }, scale: 5, candidate });
      const g = buildNavGraph(l.placements);
      assert.ok(g.has(focused));
      assert.equal(reachableFrom(g, focused).size, games.length, `${sort} ${candidate}`);
    }
  }
});
