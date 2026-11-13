import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWeek } from '../public/lib/fixtures.mjs';
import { computeLayout } from '../public/lib/layout.mjs';
import {
  rectsOverlap, findOverlaps, unionArea, holeMetrics, layoutViolations, computeMetrics,
  scenarioItems, contractMatrix, MODEL_LABEL,
} from '../public/lib/metrics.mjs';
import { dims, factor, meetsTextFloor, meetsTotalsFloor, lowestScaleMeetingTextFloor, lowestScaleMeetingTotalsFloor } from '../public/lib/sizing.mjs';
import { presetById, effectiveScale, scaleFloorFor, CONTRACT_VIEWPORTS } from '../public/lib/presets.mjs';

const games = generateWeek().games;

// ---------- primitives against hand-made geometry ----------

test('overlap detection: overlapping, touching and disjoint rectangles', () => {
  const a = { id: 'a', x: 0, y: 0, w: 10, h: 10 };
  assert.equal(rectsOverlap(a, { x: 5, y: 5, w: 10, h: 10 }), true);
  assert.equal(rectsOverlap(a, { x: 10, y: 0, w: 10, h: 10 }), false, 'shared edge is not overlap');
  assert.equal(rectsOverlap(a, { x: 30, y: 30, w: 1, h: 1 }), false);
  assert.deepEqual(findOverlaps([a, { id: 'b', x: 9, y: 9, w: 2, h: 2 }, { id: 'c', x: 50, y: 0, w: 2, h: 2 }]), [['a', 'b']]);
});

test('union area: disjoint, overlapping and nested', () => {
  assert.equal(unionArea([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }]), 200);
  assert.equal(unionArea([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }]), 175);
  assert.equal(unionArea([{ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 2, h: 2 }]), 100);
  assert.equal(unionArea([]), 0);
});

// A 3-column grid: colW 100, gap 10, compact height 100.
function hand(placements, extra = {}) {
  const frame = {
    viewport: { w: 400, h: 600 }, insetX: 0, insetY: 0, contentW: 320, cols: 3, colW: 100, gap: 10,
    header: { x: 0, y: 0, w: 320, h: 0 }, gridTop: 0, safeBottom: 600, underMinWidth: false,
  };
  return { candidate: 'LC1', frame, dims: { h: [0, 100, 150, 140], compactW: 100, gap: 10, minText: 12, totalText: 28, scale: 5, f: 1 }, placements, meta: {}, totalHeight: 600, ...extra };
}
let seq = 0;
function card(x, y, w = 100, h = 100, stage = 1, sortedIndex = seq++) {
  const sections = [{ stage: 1, x: 0, y: 0, w: Math.min(w, 100), h: 100 }];
  if (stage > 1) {
    sections[0].w = 100;
    for (let s = 2; s <= stage; s++) sections.push({ stage: s, x: (s - 1) * 110, y: 0, w: 100, h: 100 });
  }
  return { id: `p${sortedIndex}`, x, y, w, h, stage, sortedIndex, arrangement: stage > 1 ? 'ltr' : 'compact', sections, region: 'grid' };
}

test('hole area counts one empty cell exactly', () => {
  seq = 0;
  const l = hand([card(0, 0), card(110, 0), card(0, 110), card(110, 110), card(220, 110)]);
  const h = holeMetrics(l);
  assert.equal(Math.round(h.holeArea), 110 * 110);
  assert.equal(Math.round(h.holeCells * 100) / 100, 1);
});

test('trailing vacancy after the last card is not a hole', () => {
  seq = 0;
  const l = hand([card(0, 0), card(110, 0)]);
  assert.equal(Math.round(holeMetrics(l).holeArea), 0);
});

test('vertical void beside a taller card counts toward hole area', () => {
  seq = 0;
  const l = hand([card(0, 0, 100, 150), card(110, 0), card(220, 0), card(0, 160), card(110, 160), card(220, 160)]);
  assert.equal(Math.round(holeMetrics(l).holeArea), 220 * 50);
});

// ---------- invariant checker must catch broken layouts ----------

test('violations: overlap, out of bounds, missing stage 1, misordered stages', () => {
  seq = 0;
  const kinds = (l) => new Set(layoutViolations(l).map((v) => v.kind));
  assert.ok(kinds(hand([card(0, 0), card(50, 50)])).has('overlap'));
  seq = 0;
  assert.ok(kinds(hand([card(0, 0), card(300, 0)])).has('bounds'));
  seq = 0;
  const broken = card(0, 0);
  broken.sections = [];
  const k1 = kinds(hand([broken]));
  assert.ok(k1.has('sections') && k1.has('compact-scores'));
  seq = 0;
  const wide = card(0, 0, 320, 100, 3);
  wide.sections.reverse();
  wide.sections[0].x = 0; // stage 3 drawn first on the left
  assert.ok(kinds(hand([wide])).has('sections'));
});

test('violations: candidate order rules fail when broken', () => {
  seq = 0;
  // LC1: reading order must equal sorted order.
  const a = card(110, 0, 100, 100, 1, 0);
  const b = card(0, 0, 100, 100, 1, 1);
  assert.ok(layoutViolations(hand([a, b])).some((v) => v.kind === 'order'));
  // LC2: displacement 3 is too much.
  const ps = [card(0, 0, 100, 100, 1, 3), card(110, 0, 100, 100, 1, 0), card(220, 0, 100, 100, 1, 1), card(0, 110, 100, 100, 1, 2)];
  assert.ok(layoutViolations(hand(ps, { candidate: 'LC2' })).some((v) => v.kind === 'order'));
  // LC4: an expanded card must be a full-width band.
  const e = card(0, 0, 210, 100, 2, 0);
  assert.ok(layoutViolations(hand([e], { candidate: 'LC4' })).some((v) => v.kind === 'order'));
});

test('violations: header outside the safe area is reported', () => {
  seq = 0;
  const l = hand([card(0, 0)]);
  l.frame.insetX = 10;
  l.frame.header = { x: 0, y: 0, w: 320, h: 10 };
  assert.ok(layoutViolations(l).some((v) => v.kind === 'safe-area'));
});

// ---------- metrics on engine output ----------

test('follower metric distinguishes strict and lenient readings', () => {
  const items = [{ id: 'c1', stage: 1 }, { id: 'c2', stage: 1 }, { id: 'c3', stage: 1 }, { id: 'E', stage: 3 }, { id: 'c4', stage: 1 }, { id: 'c5', stage: 1 }];
  const vp = { w: 1280, h: 720 };
  const base = computeLayout({ items: items.map((i) => ({ ...i, stage: 1 })), viewport: vp, scale: 5, candidate: 'LC4' });
  const lc4 = computeLayout({ items, viewport: vp, scale: 5, candidate: 'LC4' });
  const m = computeMetrics(lc4, base);
  assert.equal(m.following.upRight, 1, 'c4 fills the vacated cell: up a row, to the right');
  assert.equal(m.da04Strict, false);
  assert.equal(m.da04Lenient, true);
  const lc1 = computeLayout({ items, viewport: vp, scale: 5, candidate: 'LC1' });
  const m1 = computeMetrics(lc1, computeLayout({ items: items.map((i) => ({ ...i, stage: 1 })), viewport: vp, scale: 5, candidate: 'LC1' }));
  assert.equal(m1.da04Strict, true, 'strict order: nothing moves up');
});

test('metrics are labeled model-computed and bounded', () => {
  for (const vp of CONTRACT_VIEWPORTS) {
    const l = computeLayout({ items: scenarioItems(games, 3), viewport: vp, scale: 5, candidate: 'LC2' });
    const m = computeMetrics(l, computeLayout({ items: scenarioItems(games, 0), viewport: vp, scale: 5, candidate: 'LC2' }));
    assert.equal(m.label, MODEL_LABEL);
    assert.ok(m.holePct >= 0 && m.holePct <= 100);
    assert.ok(m.visibleCompact <= m.compactTotal);
    assert.equal(m.reachable, m.reachTotal);
  }
});

test('visible compact count matches an independent count of fully visible rows', () => {
  const vp = { w: 960, h: 540 };
  const l = computeLayout({ items: scenarioItems(games, 0), viewport: vp, scale: 5, candidate: 'LC1' });
  const g = l.frame;
  const rowsFit = Math.floor((g.safeBottom - g.gridTop + g.gap + 0.01) / (l.dims.h[1] + g.gap));
  const m = computeMetrics(l, l);
  assert.ok(rowsFit * g.cols < games.length, 'the viewport cannot show every game');
  assert.equal(m.visibleCompact, rowsFit * g.cols);
  assert.equal(m.visibleCompact, 9);
});

test('contract matrix covers 5 viewports x 10 scales x 4 candidates x 0-6 expanded', () => {
  const mx = contractMatrix(games);
  assert.equal(mx.rows.length, 5 * 10 * 4 * 7);
  assert.ok(mx.rows.every((r) => r.label === MODEL_LABEL));
  assert.ok(mx.rows.every((r) => r.violationCount === 0), 'no invariant violations anywhere');
  assert.ok(mx.rows.every((r) => r.stronglyConnected), 'keyboard reaches every card from every card');
  const tv = mx.rows.filter((r) => r.viewportKind === 'tv');
  assert.deepEqual([...new Set(tv.map((r) => r.dprLabel))].sort(), [1.333, 2]);
  const strip = ({ viewportId, dprLabel, ...rest }) => rest;
  const a = tv.filter((r) => r.dprLabel === 2).map(strip);
  const b = tv.filter((r) => r.dprLabel === 1.333).map(strip);
  assert.deepEqual(a, b, 'DPR is a label only: model geometry is identical');
});

// ---------- scale ladder and legibility ----------

test('scale ladder: step 5 is 1.0; 14 px text floor first holds at 7; totals 28 px from 5', () => {
  assert.equal(factor(5), 1);
  assert.equal(factor(1), 0.6);
  assert.equal(factor(10), 1.5);
  assert.equal(meetsTextFloor(6), false);
  assert.equal(meetsTextFloor(7), true);
  assert.ok(dims(7).minText >= 14);
  assert.equal(lowestScaleMeetingTextFloor(), 7);
  assert.equal(meetsTotalsFloor(4), false);
  assert.equal(meetsTotalsFloor(5), true);
  assert.equal(lowestScaleMeetingTotalsFloor(), 5);
});

test('TV presets cannot go below the text floor; desktop can', () => {
  const tv = presetById('tv960d2');
  const desk = presetById('d1920');
  assert.equal(scaleFloorFor(tv), 7);
  assert.equal(effectiveScale(tv, 3), 7);
  assert.equal(effectiveScale(tv, 9), 9);
  assert.equal(effectiveScale(desk, 3), 3);
});

test('at 960x540 the floor scale gives text >= 14 px, totals >= 28 px and a 5% safe area', () => {
  for (const id of ['tv960d2', 'tv960d1333']) {
    const vp = presetById(id);
    for (const candidate of ['LC1', 'LC2', 'LC3', 'LC4']) {
      const l = computeLayout({ items: scenarioItems(games, 3), viewport: vp, scale: effectiveScale(vp, 1), candidate });
      const m = computeMetrics(l, l);
      assert.ok(m.textFloor14 && m.totals28 && m.safeArea5, `${id} ${candidate}`);
      assert.equal(l.frame.insetX, 48);
      assert.equal(l.frame.insetY, 27);
    }
  }
});
