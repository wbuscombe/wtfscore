// WTFScore - the scoreboard's one layout.
// Every game is one connected card on a column grid, in strict display order.
// A closed card is its score. Opening a game makes that same card take one
// FULL ROW of its own, at its place in the chosen order (it is never promoted
// to the top and no later card fills a gap):
//  - games before it stay exactly where they were (the row it started in ends
//    early when it was not first in that row);
//  - it spans the whole content width, alone in its row;
//  - games after it continue in order on the rows below.
// Score, situation and, one step later, leaders sit side by side inside one
// border; only when the full row is too narrow for all three side by side do
// the parts stack inside the card. With situation open, the situation fills
// the room kept for leaders, so the step to leaders never moves anything and
// the card never shows an empty block. Pure module: ids and stages in, CSS px
// geometry out, no DOM.

import { dims as dimsFor, TEXT_FLOOR_PX, TOTALS_FLOOR_PX } from './sizing.mjs';
import { frameGeometry } from './layout.mjs';

const EPS = 0.01;
export const PART_NAMES = Object.freeze({ 1: 'score', 2: 'situation', 3: 'leaders' });

export function clampStage(stage) {
  const n = Math.round(Number(stage));
  if (!Number.isFinite(n)) return 1;
  return Math.min(3, Math.max(1, n));
}

export function spanWidth(k, g) {
  return k * g.colW + (k - 1) * g.gap;
}

// The width score, situation and leaders need side by side in one card.
export function connectedWidth(d) {
  return d.compactW + 2 * d.stageW;
}

// Fewest columns whose span holds all three parts side by side, or null when
// even a full row cannot.
export function columnsNeeded(g, d) {
  const need = connectedWidth(d);
  for (let k = 1; k <= g.cols; k++) if (spanWidth(k, g) + EPS >= need) return k;
  return null;
}

// The parts of one card of width `w`, relative to the card's top-left corner.
// Open cards keep the footprint of all three parts from the first step on.
export function arrangeParts(stage, w, g, d) {
  const s = clampStage(stage);
  if (s === 1) return { arrangement: 'compact', h: d.h[1], parts: [{ stage: 1, x: 0, y: 0, w, h: d.h[1] }] };
  if (w + EPS >= connectedWidth(d)) {
    const h = Math.max(d.h[1], d.h[2], d.h[3]);
    const sw = Math.max(d.compactW, Math.min(g.colW, w - 2 * d.stageW)); // the score keeps its column width
    const rest = w - sw;
    const parts = [{ stage: 1, x: 0, y: 0, w: sw, h }];
    if (s === 2) parts.push({ stage: 2, x: sw, y: 0, w: rest, h });
    else parts.push({ stage: 2, x: sw, y: 0, w: rest / 2, h }, { stage: 3, x: sw + rest / 2, y: 0, w: rest / 2, h });
    return { arrangement: 'ltr', h, parts };
  }
  const h = d.h[1] + d.h[2] + d.h[3];
  const parts = [{ stage: 1, x: 0, y: 0, w, h: d.h[1] }];
  if (s === 2) parts.push({ stage: 2, x: 0, y: d.h[1], w, h: h - d.h[1] });
  else parts.push({ stage: 2, x: 0, y: d.h[1], w, h: d.h[2] }, { stage: 3, x: 0, y: d.h[1] + d.h[2], w, h: d.h[3] });
  return { arrangement: 'stack', h, parts };
}

// Strict display-order flow. Returns rows of cells { item, col, span, full, place }.
// An open card always ends the row before it and takes a whole row.
function flowRows(items, g) {
  const rows = [];
  let row = [];
  let col = 0;
  const endRow = () => {
    if (row.length) rows.push(row);
    row = [];
    col = 0;
  };
  for (const item of items) {
    if (item.stage === 1) {
      if (col + 1 > g.cols) endRow();
      row.push({ item, col, span: 1, full: false, place: 'compact' });
      col += 1;
      continue;
    }
    if (col >= g.cols) endRow(); // its closed place would start the next row
    if (col === 0) {
      row.push({ item, col: 0, span: g.cols, full: true, place: 'kept' });
    } else {
      endRow(); // the rest of this row stays empty
      row.push({ item, col: 0, span: g.cols, full: true, place: 'next-row' });
    }
    endRow(); // nothing shares the open card's row
  }
  endRow();
  return rows;
}

// items: [{ id, stage }] in display order. viewport: { w, h } in CSS px.
export function computeBoardLayout({ items, viewport, scale, headerHeight = null }) {
  const d = dimsFor(scale);
  const g = frameGeometry(viewport, d, headerHeight);
  const norm = items.map((it, i) => ({ id: it.id, stage: clampStage(it.stage), sortedIndex: i }));
  const rows = flowRows(norm, g);
  const placements = [];
  let y = g.gridTop;
  rows.forEach((cells, row) => {
    let rowH = 0;
    for (const c of cells) {
      const w = c.full ? g.contentW : spanWidth(c.span, g);
      const a = arrangeParts(c.item.stage, w, g, d);
      rowH = Math.max(rowH, a.h);
      placements.push({
        id: c.item.id,
        sortedIndex: c.item.sortedIndex,
        stage: c.item.stage,
        row,
        col: c.col,
        span: c.span,
        place: c.place,
        x: g.insetX + c.col * (g.colW + g.gap),
        y,
        w,
        h: a.h,
        arrangement: a.arrangement,
        parts: a.parts,
      });
    }
    y += rowH + g.gap;
  });
  const contentBottom = placements.length ? y - g.gap : g.gridTop;
  return {
    kind: 'score-board',
    viewport: { w: viewport.w, h: viewport.h },
    scale: d.scale,
    dims: d,
    frame: g,
    connectedW: connectedWidth(d),
    placements,
    contentBottom,
    totalHeight: contentBottom + g.insetY,
  };
}

// Every painted part in page coordinates: each card's score, and its open parts.
export function boardRects(layout) {
  const rects = [];
  for (const p of layout.placements) {
    for (const s of p.parts) rects.push({ id: p.id, part: PART_NAMES[s.stage], x: p.x + s.x, y: p.y + s.y, w: s.w, h: s.h });
  }
  return rects;
}

function overlaps(a, b) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

const near = (a, b) => Math.abs(a - b) <= EPS;

// Returns [{ kind, detail }]; an empty list means every invariant holds.
export function boardViolations(layout) {
  const { placements: ps, frame: g, dims: d } = layout;
  const need = connectedWidth(d);
  const out = [];
  const add = (kind, detail) => out.push({ kind, detail });
  const ids = ps.map((p) => p.id);
  if (new Set(ids).size !== ids.length) add('identity', 'duplicate game ids');

  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (overlaps(ps[i], ps[j])) add('overlap', `${ps[i].id} card overlaps ${ps[j].id} card`);
    }
  }

  const left = g.insetX;
  const right = g.insetX + g.contentW;
  for (const p of ps) {
    if (p.x < left - EPS || p.x + p.w > right + EPS) add('bounds', `${p.id} card outside the content width`);
    if (p.x + p.w > g.viewport.w + EPS) add('bounds', `${p.id} card wider than the viewport`);
    if (p.y < g.gridTop - EPS) add('bounds', `${p.id} card above the grid`);
  }
  const hd = g.header;
  if (hd.x < g.insetX - EPS || hd.y < g.insetY - EPS || hd.x + hd.w > g.viewport.w - g.insetX + EPS) add('safe-area', 'header outside the safe area');

  const read = [...ps].sort((a, b) => (Math.abs(a.y - b.y) > 0.5 ? a.y - b.y : a.x - b.x));
  read.forEach((p, i) => {
    if (p.sortedIndex !== i) add('order', `${p.id} reads at ${i} but sorts at ${p.sortedIndex}`);
  });

  const minW = Math.min(d.compactW, g.contentW);
  for (const p of ps) {
    const score = p.parts[0];
    if (!score || score.stage !== 1 || score.w < minW - EPS || score.h < d.h[1] - EPS) add('compact-scores', `${p.id} score smaller than the compact size`);
  }

  for (const p of ps) {
    const got = p.parts.map((s) => s.stage).join();
    const want = p.stage === 1 ? '1' : p.stage === 2 ? '1,2' : '1,2,3';
    if (got !== want) add('parts', `${p.id} shows parts ${got}, expected ${want}`);
    let area = 0;
    p.parts.forEach((s, i) => {
      area += s.w * s.h;
      if (s.x < -EPS || s.y < -EPS || s.x + s.w > p.w + EPS || s.y + s.h > p.h + EPS) add('containment', `${p.id} ${PART_NAMES[s.stage]} outside its card`);
      for (let j = i + 1; j < p.parts.length; j++) if (overlaps(s, p.parts[j])) add('overlap', `${p.id} parts overlap`);
      const next = p.parts[i + 1];
      if (!next) return;
      if (p.arrangement === 'ltr' && !(near(next.y, s.y) && near(next.x, s.x + s.w))) add('adjacent', `${p.id} parts not side by side`);
      if (p.arrangement === 'stack' && !(near(next.x, s.x) && near(next.y, s.y + s.h))) add('adjacent', `${p.id} parts not stacked in order`);
    });
    if (Math.abs(area - p.w * p.h) > 0.5) add('fill', `${p.id} parts leave an empty block in the card`);
    if (p.stage === 1) {
      if (p.arrangement !== 'compact' || !near(p.h, d.h[1])) add('parts', `${p.id} closed card is not compact`);
      continue;
    }
    if (p.arrangement === 'ltr') {
      if (p.w < need - EPS) add('connected', `${p.id} side by side without room for all three parts`);
      for (const s of p.parts) if (!near(s.h, p.h)) add('connected', `${p.id} parts not full height`);
      if (p.parts[0].w < d.compactW - EPS) add('connected', `${p.id} score narrower than its minimum`);
      for (const s of p.parts.slice(1)) if (s.w < d.stageW - EPS) add('connected', `${p.id} ${PART_NAMES[s.stage]} narrower than its minimum`);
    } else if (p.arrangement === 'stack') {
      if (g.contentW + EPS >= need) add('connected', `${p.id} stacked although a full row fits all three parts`);
      if (!near(p.x, g.insetX) || !near(p.w, g.contentW)) add('connected', `${p.id} stacked card is not full width`);
      for (const s of p.parts) if (!near(s.w, p.w)) add('connected', `${p.id} stacked part not full width`);
    } else {
      add('parts', `${p.id} open card has arrangement ${p.arrangement}`);
    }
    const fullRow = near(p.x, g.insetX) && near(p.w, g.contentW);
    if (!fullRow && p.w < need - EPS) add('connected', `${p.id} open card neither holds all three parts nor fills a row`);
    if (!fullRow) add('full-row', `${p.id} open card does not span the whole row`);
    for (const q of ps) {
      if (q === p) continue;
      if (q.y < p.y + p.h - EPS && p.y < q.y + q.h - EPS) add('full-row', `${q.id} shares a row with open ${p.id}`);
    }
  }
  return out;
}

// How many score parts are fully inside [top, bottom] (CSS px, page coordinates).
export function fullyVisibleScores(layout, { top = 0, bottom = layout.viewport.h } = {}) {
  return layout.placements.filter((p) => p.y >= top - EPS && p.y + p.parts[0].h <= bottom + EPS).length;
}

export function textCheck(scale) {
  const d = dimsFor(scale);
  return { scale: d.scale, minTextPx: d.minText, totalsPx: d.totalText, meetsText: d.minText >= TEXT_FLOOR_PX, meetsTotals: d.totalText >= TOTALS_FLOOR_PX };
}
