import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWeek, prng } from '../public/lib/fixtures.mjs';
import { computeLayout, CANDIDATE_IDS, arrangeStages } from '../public/lib/layout.mjs';
import { layoutViolations, scenarioItems, displacements, readingOrder, holeMetrics } from '../public/lib/metrics.mjs';
import { CONTRACT_VIEWPORTS } from '../public/lib/presets.mjs';
import { dims, SCALE_MIN, SCALE_MAX } from '../public/lib/sizing.mjs';

const games = generateWeek().games;
const SCALES = Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, i) => SCALE_MIN + i);
const KS = [0, 1, 2, 3, 4, 5, 6];

function fmt(v) {
  return v.slice(0, 4).map((x) => `${x.kind}: ${x.detail}`).join(' | ');
}

test('every candidate x comparison viewport x 0-6 expanded x scale 1-10 holds all invariants', () => {
  let runs = 0;
  for (const vp of CONTRACT_VIEWPORTS) {
    for (const scale of SCALES) {
      for (const candidate of CANDIDATE_IDS) {
        for (const k of KS) {
          for (const stage of [2, 3]) {
            const items = scenarioItems(games, k, stage);
            const layout = computeLayout({ items, viewport: vp, scale, candidate });
            const v = layoutViolations(layout);
            assert.equal(v.length, 0, `${vp.id} s${scale} ${candidate} k${k} stage${stage}: ${fmt(v)}`);
            assert.deepEqual(layout.placements.map((p) => p.id).sort(), items.map((i) => i.id).sort(), 'every game placed once');
            assert.ok(layout.placements.every((p) => p.x + p.w <= vp.w + 0.01), 'no horizontal overflow of the model viewport');
            runs++;
          }
        }
      }
    }
  }
  assert.equal(runs, 5 * 10 * 4 * 7 * 2);
});

test('property check: random stages, widths and scales keep every invariant', () => {
  const rnd = prng(2026);
  for (let i = 0; i < 600; i++) {
    const w = 300 + Math.floor(rnd() * 2300);
    const h = 400 + Math.floor(rnd() * 1200);
    const scale = 1 + Math.floor(rnd() * 10);
    const candidate = CANDIDATE_IDS[Math.floor(rnd() * 4)];
    const items = games.map((g) => ({ id: g.id, stage: rnd() < 0.35 ? 2 + Math.floor(rnd() * 2) : 1 }));
    const layout = computeLayout({ items, viewport: { w, h }, scale, candidate });
    const v = layoutViolations(layout);
    assert.equal(v.length, 0, `${candidate} ${w}x${h} s${scale}: ${fmt(v)}`);
  }
});

test('stages run left to right on wide desktop at the default scale', () => {
  for (const vp of CONTRACT_VIEWPORTS.filter((v) => v.kind === 'desktop')) {
    for (const candidate of CANDIDATE_IDS) {
      for (const k of [1, 3, 6]) {
        const layout = computeLayout({ items: scenarioItems(games, k, 3), viewport: vp, scale: 5, candidate });
        for (const p of layout.placements.filter((x) => x.stage > 1)) {
          assert.equal(p.arrangement, 'ltr', `${vp.id} ${candidate} k${k} ${p.id}`);
          const xs = p.sections.map((s) => s.x);
          assert.ok(xs[0] < xs[1] && xs[1] < xs[2], 'section x strictly increases 1 -> 2 -> 3');
        }
      }
    }
  }
});

test('narrow phone width stacks stages explicitly and reports it', () => {
  const vp = CONTRACT_VIEWPORTS.find((v) => v.kind === 'phone');
  for (const candidate of CANDIDATE_IDS) {
    const layout = computeLayout({ items: scenarioItems(games, 3, 3), viewport: vp, scale: 5, candidate });
    const expanded = layout.placements.filter((p) => p.stage > 1);
    assert.ok(expanded.length > 0);
    for (const p of expanded) {
      assert.equal(p.arrangement, 'stack');
      const ys = p.sections.map((s) => s.y);
      assert.ok(ys[0] < ys[1] && ys[1] < ys[2]);
    }
  }
});

test('TV model at the text-floor scale: LC1, LC2, LC4 keep stages left to right; LC3 stacks (reported, not hidden)', () => {
  const vp = CONTRACT_VIEWPORTS.find((v) => v.kind === 'tv');
  for (const candidate of CANDIDATE_IDS) {
    const layout = computeLayout({ items: scenarioItems(games, 3, 3), viewport: vp, scale: 7, candidate });
    const arrs = new Set(layout.placements.filter((p) => p.stage > 1).map((p) => p.arrangement));
    if (candidate === 'LC3') assert.deepEqual([...arrs], ['stack']);
    else assert.deepEqual([...arrs], ['ltr']);
  }
});

test('compact scores never vanish: every card keeps a full stage-1 section', () => {
  for (const vp of CONTRACT_VIEWPORTS) {
    for (const candidate of CANDIDATE_IDS) {
      const layout = computeLayout({ items: scenarioItems(games, 6, 3), viewport: vp, scale: 5, candidate });
      const d = layout.dims;
      for (const p of layout.placements) {
        const s1 = p.sections.find((s) => s.stage === 1);
        assert.ok(s1, `${p.id} has stage 1`);
        assert.ok(s1.h >= d.h[1] - 0.01);
        assert.ok(s1.w >= Math.min(d.compactW, layout.frame.contentW) - 0.01);
      }
    }
  }
});

test('placement is driven by game id, not by input object identity or extra fields', () => {
  const items = scenarioItems(games, 3, 3);
  const a = computeLayout({ items, viewport: { w: 1920, h: 1080 }, scale: 5, candidate: 'LC2' });
  const b = computeLayout({ items: items.map((i) => ({ ...i, junk: Math.random() })), viewport: { w: 1920, h: 1080 }, scale: 5, candidate: 'LC2' });
  assert.deepEqual(a.placements, b.placements);
});

test('the four candidates are distinct algorithms', () => {
  const vp = { w: 1920, h: 1080 };
  const sig = (c) => JSON.stringify(computeLayout({ items: scenarioItems(games, 6, 3), viewport: vp, scale: 5, candidate: c }).placements.map((p) => [p.id, Math.round(p.x), Math.round(p.y), Math.round(p.w)]));
  const sigs = CANDIDATE_IDS.map(sig);
  assert.equal(new Set(sigs).size, 4);
});

// A hand-built case at 1280x720, scale 5 (4 columns): three compact cards, then a
// stage-3 card that cannot fit in the one remaining cell, then compact cards.
function holeCase() {
  return [
    { id: 'c1', stage: 1 },
    { id: 'c2', stage: 1 },
    { id: 'c3', stage: 1 },
    { id: 'E', stage: 3 },
    { id: 'c4', stage: 1 },
    { id: 'c5', stage: 1 },
    { id: 'c6', stage: 1 },
  ];
}
const VP1280 = { w: 1280, h: 720 };

test('LC1 leaves the hole and keeps strict order', () => {
  const l = computeLayout({ items: holeCase(), viewport: VP1280, scale: 5, candidate: 'LC1' });
  assert.equal(l.frame.cols, 4);
  assert.deepEqual(readingOrder(l.placements).map((p) => p.id), ['c1', 'c2', 'c3', 'E', 'c4', 'c5', 'c6']);
  assert.ok(holeMetrics(l).holeCells >= 1, 'one card-sized hole at the end of row 1');
});

test('LC2 fills the hole with the next compact card only, displacement <= 2', () => {
  const l = computeLayout({ items: holeCase(), viewport: VP1280, scale: 5, candidate: 'LC2' });
  const order = readingOrder(l.placements).map((p) => p.id);
  assert.deepEqual(order.slice(0, 4), ['c1', 'c2', 'c3', 'c4']);
  const disp = displacements(l.placements);
  assert.ok(Math.max(...[...disp.values()].map(Math.abs)) <= 2);
  assert.ok(holeMetrics(l).holeCells < holeMetrics(computeLayout({ items: holeCase(), viewport: VP1280, scale: 5, candidate: 'LC1' })).holeCells);
});

test('LC2 never pulls an expanded card or a card beyond the 1-2 lookahead', () => {
  // Row 1 ends in a hole before E1; the next two cards are expanded, so nothing
  // may fill it (c4 is 3 places away). c4 may only fill the later hole before E2.
  const items = [
    { id: 'c1', stage: 1 },
    { id: 'c2', stage: 1 },
    { id: 'c3', stage: 1 },
    { id: 'E1', stage: 3 },
    { id: 'E2', stage: 3 },
    { id: 'E3', stage: 3 },
    { id: 'c4', stage: 1 },
  ];
  const l = computeLayout({ items, viewport: VP1280, scale: 5, candidate: 'LC2' });
  const at = (id) => l.placements.find((p) => p.id === id);
  const row1 = l.placements.filter((p) => Math.abs(p.y - at('c1').y) < 0.5).map((p) => p.id).sort();
  assert.deepEqual(row1, ['c1', 'c2', 'c3'], 'the first hole stays empty');
  const disp = displacements(l.placements);
  assert.ok(Math.max(...[...disp.values()].map(Math.abs)) <= 2);
  const sortedIndex = new Map(items.map((it, i) => [it.id, i]));
  for (const pull of l.meta.pulls) {
    assert.equal(at(pull.id).stage, 1, 'only compact cards are pulled');
    assert.ok(sortedIndex.get(pull.id) - sortedIndex.get(pull.ahead) <= 2, 'pulled card is within 2 of the hole');
  }
});

test('LC3 puts expanded cards in a focus band and keeps the rail in kickoff order', () => {
  const l = computeLayout({ items: holeCase(), viewport: { w: 1920, h: 1080 }, scale: 5, candidate: 'LC3' });
  const E = l.placements.find((p) => p.id === 'E');
  assert.equal(E.region, 'focus');
  assert.equal(E.x, l.frame.insetX);
  const rail = readingOrder(l.placements.filter((p) => p.region === 'rail')).map((p) => p.id);
  assert.deepEqual(rail, ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  for (const p of l.placements.filter((x) => x.region === 'rail' && x.y < E.y + E.h)) assert.ok(p.x >= E.x + E.w, 'rail sits beside the band');
});

test('LC4 gives the expanded card a full row; compact cards fill the row it left', () => {
  const l = computeLayout({ items: holeCase(), viewport: VP1280, scale: 5, candidate: 'LC4' });
  const E = l.placements.find((p) => p.id === 'E');
  const c4 = l.placements.find((p) => p.id === 'c4');
  assert.equal(E.w, l.frame.contentW);
  assert.equal(E.arrangement, 'ltr');
  assert.ok(c4.y < E.y, 'c4 filled the vacated row');
  const disp = displacements(l.placements);
  assert.ok(Math.max(...[...disp.values()].map(Math.abs)) < l.frame.cols);
});

test('arrangeStages: ltr when minimum widths fit, wrap next, stack last', () => {
  const d = dims(5);
  assert.equal(arrangeStages(1000, 3, d).arrangement, 'ltr');
  assert.equal(arrangeStages(500, 3, d).arrangement, 'wrap');
  assert.equal(arrangeStages(300, 3, d).arrangement, 'stack');
  const a = arrangeStages(1000, 3, d);
  const right = a.sections[2].x + a.sections[2].w;
  assert.ok(Math.abs(right - 1000) < 0.01, 'sections fill the card width exactly');
});

test('unknown candidate is rejected', () => {
  assert.throws(() => computeLayout({ items: [], viewport: { w: 800, h: 600 }, scale: 5, candidate: 'LC9' }));
});
