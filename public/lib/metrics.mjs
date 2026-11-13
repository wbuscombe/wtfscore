// WTFScore - geometry validators and model metrics.
// Everything here is MODEL-COMPUTED from layout rectangles. None of it is a
// browser or device measurement; the browser panel (measure.mjs) does that.

import { computeLayout, CANDIDATE_IDS } from './layout.mjs';
import { buildNavGraph, reachability } from './nav.mjs';
import { sortGames, isExpandable, spreadPick } from './model.mjs';
import { SCALE_MIN, SCALE_MAX, TEXT_FLOOR_PX, TOTALS_FLOOR_PX, lowestScaleMeetingTextFloor, lowestScaleMeetingTotalsFloor } from './sizing.mjs';
import { CONTRACT_VIEWPORTS, defaultScaleFor } from './presets.mjs';

export const MODEL_LABEL = 'model-computed';
const EPS = 0.01;
const POS_EPS = 0.5;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- geometry primitives ----------

export function rectsOverlap(a, b, eps = EPS) {
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

export function findOverlaps(rects, eps = EPS) {
  const pairs = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j], eps)) pairs.push([rects[i].id ?? i, rects[j].id ?? j]);
    }
  }
  return pairs;
}

export function horizontalViolations(rects, left, right, eps = EPS) {
  return rects.filter((r) => r.x < left - eps || r.x + r.w > right + eps).map((r) => r.id);
}

export function clipRect(r, box) {
  const x0 = Math.max(r.x, box.x);
  const y0 = Math.max(r.y, box.y);
  const x1 = Math.min(r.x + r.w, box.x + box.w);
  const y1 = Math.min(r.y + r.h, box.y + box.h);
  if (x1 - x0 <= EPS || y1 - y0 <= EPS) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Exact area of a union of axis-aligned rectangles (coordinate compression).
export function unionArea(rects) {
  const rs = rects.filter((r) => r && r.w > 0 && r.h > 0);
  if (!rs.length) return 0;
  const xs = [...new Set(rs.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    const dx = x1 - x0;
    if (dx <= 0) continue;
    const spans = rs
      .filter((r) => r.x <= x0 + 1e-9 && r.x + r.w >= x1 - 1e-9)
      .map((r) => [r.y, r.y + r.h])
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let cs = null;
    let ce = null;
    for (const [s, e] of spans) {
      if (cs === null) {
        cs = s;
        ce = e;
      } else if (s <= ce) {
        ce = Math.max(ce, e);
      } else {
        covered += ce - cs;
        cs = s;
        ce = e;
      }
    }
    if (cs !== null) covered += ce - cs;
    area += covered * dx;
  }
  return area;
}

// Reading order: top to bottom, then left to right.
export function readingOrder(placements) {
  return [...placements].sort((a, b) => {
    if (Math.abs(a.y - b.y) > POS_EPS) return a.y - b.y;
    if (Math.abs(a.x - b.x) > POS_EPS) return a.x - b.x;
    return a.sortedIndex - b.sortedIndex;
  });
}

export function displacements(placements) {
  const out = new Map();
  readingOrder(placements).forEach((p, i) => out.set(p.id, i - p.sortedIndex));
  return out;
}

// Hole area: empty cells plus vertical void beside taller cards, inside the
// occupied grid region. Each card is inflated by half a gutter so gutters
// between neighbours are not counted. The trailing vacancy after the last card
// in reading order is not a hole.
export function holeMetrics(layout) {
  const { placements, frame: g, dims: d } = layout;
  if (!placements.length) return { holeArea: 0, regionArea: 0, holePct: 0, holeCells: 0 };
  const h2 = g.gap / 2;
  const maxBottom = placements.reduce((m, p) => Math.max(m, p.y + p.h), g.gridTop);
  const region = { x: g.insetX - h2, y: g.gridTop - h2, w: g.contentW + g.gap, h: maxBottom - g.gridTop + g.gap };
  const inflated = placements
    .map((p) => clipRect({ x: p.x - h2, y: p.y - h2, w: p.w + g.gap, h: p.h + g.gap }, region))
    .filter(Boolean);
  const covered = unionArea(inflated);
  const order = readingOrder(placements);
  const last = order[order.length - 1];
  const tail = {
    x: last.x + last.w + h2,
    y: last.y - h2,
    w: region.x + region.w - (last.x + last.w + h2),
    h: region.y + region.h - (last.y - h2),
  };
  let tailArea = 0;
  let tailCovered = 0;
  if (tail.w > EPS && tail.h > EPS) {
    tailArea = tail.w * tail.h;
    tailCovered = unionArea(inflated.map((r) => clipRect(r, tail)).filter(Boolean));
  }
  const regionArea = region.w * region.h - tailArea;
  const holeArea = Math.max(0, region.w * region.h - covered - (tailArea - tailCovered));
  const cell = (g.colW + g.gap) * (d.h[1] + g.gap);
  return { holeArea, regionArea, holePct: regionArea > 0 ? (100 * holeArea) / regionArea : 0, holeCells: holeArea / cell };
}

// ---------- invariants ----------

function arrangementProblems(p) {
  const s = p.sections;
  const problems = [];
  if (!s.length || s[0].stage !== 1) problems.push('stage-1 section missing');
  if (s.length !== p.stage) problems.push(`expected ${p.stage} sections, got ${s.length}`);
  for (let i = 0; i < s.length; i++) {
    const a = s[i];
    if (a.x < -EPS || a.y < -EPS || a.x + a.w > p.w + EPS || a.y + a.h > p.h + EPS) problems.push(`section ${a.stage} outside card`);
    for (let j = i + 1; j < s.length; j++) if (rectsOverlap(a, s[j])) problems.push(`sections ${a.stage}/${s[j].stage} overlap`);
  }
  const byStage = [...s].sort((a, b) => a.stage - b.stage);
  const inc = (key) => byStage.every((x, i) => i === 0 || x[key] > byStage[i - 1][key] + EPS);
  const same = (key) => byStage.every((x) => Math.abs(x[key] - byStage[0][key]) <= EPS);
  if (p.arrangement === 'ltr' && !(same('y') && inc('x'))) problems.push('ltr sections not strictly left to right');
  if (p.arrangement === 'stack' && !(same('x') && inc('y'))) problems.push('stacked sections not strictly top to bottom');
  if (p.arrangement === 'wrap') {
    const read = [...s].sort((a, b) => (Math.abs(a.y - b.y) > EPS ? a.y - b.y : a.x - b.x)).map((x) => x.stage);
    if (read.join() !== byStage.map((x) => x.stage).join()) problems.push('wrapped sections out of stage order');
  }
  if (p.stage === 1 && p.arrangement !== 'compact') problems.push('compact card with non-compact arrangement');
  return problems;
}

export function orderRuleProblems(layout) {
  const { placements: ps, frame: g, candidate } = layout;
  const disp = displacements(ps);
  const problems = [];
  const maxAbs = Math.max(0, ...[...disp.values()].map(Math.abs));
  if (candidate === 'LC1') {
    if (maxAbs !== 0) problems.push(`LC1 reading order differs from sorted order (max displacement ${maxAbs})`);
  } else if (candidate === 'LC2') {
    if (maxAbs > 2) problems.push(`LC2 displacement ${maxAbs} > 2`);
    for (const p of ps) if (disp.get(p.id) < 0 && p.stage > 1) problems.push(`LC2 moved expanded card ${p.id} earlier`);
  } else if (candidate === 'LC3') {
    const rail = readingOrder(ps.filter((p) => p.region === 'rail'));
    for (let i = 1; i < rail.length; i++) if (rail[i].sortedIndex < rail[i - 1].sortedIndex) problems.push('LC3 rail order not stable');
    const focus = ps.filter((p) => p.region === 'focus');
    for (let i = 1; i < focus.length; i++) if (!(focus[i].y > focus[i - 1].y)) problems.push('LC3 focus band out of order');
    if (layout.meta.mode === 'side') {
      const focusRight = Math.max(...focus.map((p) => p.x + p.w));
      for (const p of focus) if (Math.abs(p.x - g.insetX) > EPS) problems.push(`LC3 focus card ${p.id} not at band edge`);
      for (const p of ps) {
        if (p.region === 'rail' && p.y < layout.meta.focusBottom - EPS && p.x < focusRight + g.gap - EPS) problems.push(`LC3 rail card ${p.id} intrudes on focus band`);
      }
    }
  } else if (candidate === 'LC4') {
    if (maxAbs >= Math.max(1, g.cols)) problems.push(`LC4 displacement ${maxAbs} >= ${g.cols} columns`);
    for (const p of ps) {
      if (p.stage > 1 && (Math.abs(p.x - g.insetX) > EPS || Math.abs(p.w - g.contentW) > EPS)) problems.push(`LC4 expanded card ${p.id} not a full-width band`);
    }
  }
  return problems;
}

// Returns [{ kind, detail }]; an empty list means every invariant holds.
export function layoutViolations(layout) {
  const { placements: ps, frame: g, dims: d } = layout;
  const out = [];
  const add = (kind, detail) => out.push({ kind, detail });
  const ids = ps.map((p) => p.id);
  if (new Set(ids).size !== ids.length) add('identity', 'duplicate card ids');
  for (const [a, b] of findOverlaps(ps)) add('overlap', `${a} overlaps ${b}`);
  const right = g.insetX + g.contentW;
  for (const id of horizontalViolations(ps, g.insetX, right)) add('bounds', `${id} outside the content width`);
  for (const p of ps) {
    if (p.y < g.gridTop - EPS) add('bounds', `${p.id} above the grid top`);
    if (p.w > g.viewport.w + EPS) add('bounds', `${p.id} wider than the viewport`);
  }
  const hd = g.header;
  if (hd.x < g.insetX - EPS || hd.y < g.insetY - EPS || hd.x + hd.w > g.viewport.w - g.insetX + EPS) add('safe-area', 'header outside the 5% safe area');
  const minS1W = Math.min(d.compactW, g.contentW);
  for (const p of ps) {
    for (const prob of arrangementProblems(p)) add('sections', `${p.id}: ${prob}`);
    const s1 = p.sections.find((s) => s.stage === 1);
    if (!s1 || s1.w < minS1W - EPS || s1.h < d.h[1] - EPS) add('compact-scores', `${p.id}: stage-1 scores smaller than the compact card`);
  }
  for (const prob of orderRuleProblems(layout)) add('order', prob);
  return out;
}

// ---------- metrics ----------

const ARRANGEMENT_RANK = { 'n/a': 0, ltr: 1, wrap: 2, stack: 3 };

export function computeMetrics(layout, baseline = null) {
  const { placements: ps, frame: g, dims: d } = layout;
  const holes = holeMetrics(layout);
  const disp = displacements(ps);
  const absDisp = [...disp.values()].map(Math.abs);
  const compact = ps.filter((p) => p.stage === 1);
  const visibleCompact = compact.filter((p) => p.y >= -EPS && p.y + p.h <= g.safeBottom + EPS).length;
  const visibleAll = ps.filter((p) => p.y >= -EPS && p.y + p.h <= g.safeBottom + EPS).length;
  const expanded = ps.filter((p) => p.stage > 1);

  let rowsMoved = 0;
  let selfJumps = 0;
  // Followers: cards after an expanded card should move down or right. Strict
  // reading: no follower moves up or left at all. Lenient (literal) reading of
  // "their y or x does not decrease": fails only when both y and x decrease.
  const following = { down: 0, right: 0, same: 0, left: 0, upRight: 0, up: 0, upLeft: 0 };
  if (baseline) {
    const base = new Map(baseline.placements.map((p) => [p.id, p]));
    const firstExpanded = expanded.length ? Math.min(...expanded.map((p) => p.sortedIndex)) : Infinity;
    for (const p of ps) {
      const b = base.get(p.id);
      if (!b) continue;
      const dy = p.y - b.y;
      const dx = p.x - b.x;
      if (Math.abs(dy) > POS_EPS) rowsMoved++;
      if (p.stage > 1 && Math.abs(dy) > POS_EPS) selfJumps++;
      if (p.stage === 1 && p.sortedIndex > firstExpanded) {
        if (dy > POS_EPS) following.down++;
        else if (dy >= -POS_EPS) {
          if (dx > POS_EPS) following.right++;
          else if (dx < -POS_EPS) following.left++;
          else following.same++;
        } else if (dx > POS_EPS) following.upRight++;
        else if (dx < -POS_EPS) following.upLeft++;
        else following.up++;
      }
    }
  }
  const strictMisses = following.left + following.upRight + following.up + following.upLeft;
  const da04Strict = strictMisses === 0;
  const da04Lenient = following.upLeft === 0;
  let followingSummary = 'n/a';
  if (expanded.length) {
    if (!da04Strict) {
      const parts = [['up-right', following.upRight], ['up', following.up], ['up-left', following.upLeft], ['left', following.left]].filter(([, n]) => n > 0);
      followingSummary = `not strictly down/right (${parts.map(([k, n]) => `${k} ${n}`).join(', ')})`;
    } else if (following.down && following.right) followingSummary = 'down and right';
    else if (following.down) followingSummary = 'down';
    else if (following.right) followingSummary = 'right';
    else followingSummary = 'unchanged';
  }

  const graph = buildNavGraph(ps);
  const reach = reachability(graph, ps.length ? ps[0].id : null);
  let stageArrangement = 'n/a';
  for (const p of expanded) if (ARRANGEMENT_RANK[p.arrangement] > ARRANGEMENT_RANK[stageArrangement]) stageArrangement = p.arrangement;

  const violations = layoutViolations(layout);
  const kinds = new Set(violations.map((v) => v.kind));
  return {
    label: MODEL_LABEL,
    candidate: layout.candidate,
    viewport: { w: g.viewport.w, h: g.viewport.h },
    scale: d.scale,
    f: d.f,
    cols: g.cols,
    colW: r1(g.colW),
    expanded: expanded.length,
    holeAreaPx2: Math.round(holes.holeArea),
    holePct: r1(holes.holePct),
    holeCells: r2(holes.holeCells),
    visibleCompact,
    visibleAll,
    compactTotal: compact.length,
    rowsMoved,
    selfJumps,
    orderDisplacementMax: absDisp.length ? Math.max(...absDisp) : 0,
    orderDisplacementSum: absDisp.reduce((a, b) => a + b, 0),
    following,
    followingSummary,
    da04Strict,
    da04Lenient,
    reachable: reach.reachableFromFirst,
    reachTotal: reach.total,
    stronglyConnected: reach.stronglyConnected,
    stageArrangement,
    textMinPx: d.minText,
    textFloor14: d.minText >= TEXT_FLOOR_PX,
    totalsPx: d.totalText,
    totals28: d.totalText >= TOTALS_FLOOR_PX,
    safeArea5: !kinds.has('safe-area') && !kinds.has('bounds'),
    noOverlap: !kinds.has('overlap'),
    boundedWidth: !kinds.has('bounds'),
    orderRuleOk: !kinds.has('order'),
    compactScoresIntact: !kinds.has('compact-scores'),
    violationCount: violations.length,
    violationSample: violations.slice(0, 3).map((v) => `${v.kind}: ${v.detail}`),
    underMinWidth: g.underMinWidth,
    contentHeight: r1(layout.totalHeight),
  };
}

// ---------- scenarios ----------

// Standard comparison scenario: kickoff order; k expandable games chosen evenly
// across the eligible list; each expanded to `stage`.
export function scenarioItems(games, k, stage = 3) {
  const ordered = sortGames(games, 'kickoff');
  const eligible = ordered.filter(isExpandable).map((g) => g.id);
  const picks = new Set(spreadPick(eligible, k));
  return ordered.map((g) => ({ id: g.id, stage: picks.has(g.id) ? stage : 1 }));
}

export function runScenario({ games, candidate, viewport, scale, k, stage = 3, baseline = null }) {
  const layout = computeLayout({ items: scenarioItems(games, k, stage), viewport, scale, candidate });
  const base = baseline || (k === 0 ? layout : computeLayout({ items: scenarioItems(games, 0, stage), viewport, scale, candidate }));
  return { layout, metrics: computeMetrics(layout, base) };
}

export function comparisonFor(games, viewport, scale, { ks = [0, 1, 2, 3, 4, 5, 6], stage = 3 } = {}) {
  const rows = [];
  for (const candidate of CANDIDATE_IDS) {
    const baseline = computeLayout({ items: scenarioItems(games, 0, stage), viewport, scale, candidate });
    for (const k of ks) rows.push(runScenario({ games, candidate, viewport, scale, k, stage, baseline }).metrics);
  }
  return rows;
}

const SCALES = Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, i) => SCALE_MIN + i);

export function contractMatrix(games, { scales = SCALES, ks = [0, 1, 2, 3, 4, 5, 6], stage = 3 } = {}) {
  const rows = [];
  for (const vp of CONTRACT_VIEWPORTS) {
    for (const scale of scales) {
      for (const m of comparisonFor(games, vp, scale, { ks, stage })) {
        rows.push({ viewportId: vp.id, viewportKind: vp.kind, dprLabel: vp.dpr, ...m });
      }
    }
  }
  return {
    label: MODEL_LABEL,
    note: 'Model geometry in CSS px. DPR values are labels only and do not change model geometry. Not browser or device evidence.',
    scenario: `kickoff order; k of the expandable games picked evenly across the eligible list; expanded to stage ${stage}`,
    lowestScaleMeetingTextFloor: lowestScaleMeetingTextFloor(),
    lowestScaleMeetingTotalsFloor: lowestScaleMeetingTotalsFloor(),
    rows,
  };
}

// Per candidate and viewport at the proposed default scale (TV: text floor).
export function contractSummary(games, { ks = [0, 3, 6], stage = 3 } = {}) {
  const rows = [];
  for (const vp of CONTRACT_VIEWPORTS) {
    const scale = defaultScaleFor(vp);
    for (const m of comparisonFor(games, vp, scale, { ks, stage })) {
      rows.push({
        viewport: vp.id,
        dprLabel: vp.dpr,
        candidate: m.candidate,
        scale,
        k: m.expanded,
        cols: m.cols,
        holePct: m.holePct,
        holeCells: m.holeCells,
        visibleCompact: m.visibleCompact,
        rowsMoved: m.rowsMoved,
        selfJumps: m.selfJumps,
        dispMax: m.orderDisplacementMax,
        following: m.followingSummary,
        da04Strict: m.da04Strict,
        da04Lenient: m.da04Lenient,
        stages: m.stageArrangement,
        reach: `${m.reachable}/${m.reachTotal}${m.stronglyConnected ? ' sc' : ''}`,
        textMinPx: m.textMinPx,
        totals28: m.totals28,
        lowestFloorScale: lowestScaleMeetingTextFloor(),
        safeArea5: m.safeArea5,
        violations: m.violationCount,
      });
    }
  }
  return { label: MODEL_LABEL, rows };
}
