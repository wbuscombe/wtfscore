// WTFScore - pure layout engine for candidates LC1 to LC4.
// Input: game ids in display order with their stage. Output: model geometry
// (CSS px) for every card and every stage section. The browser applies these
// numbers as CSS geometry on stable, keyed DOM nodes; the metrics module checks
// them independently. Nothing here touches the DOM.

import { dims as dimsFor, SAFE_INSET_RATIO, ltrMinWidth } from './sizing.mjs';

export const CANDIDATES = Object.freeze([
  Object.freeze({ id: 'LC1', name: 'Sparse span-N grid', rule: 'Strict kickoff order. A stage-N card spans N columns; holes are allowed.' }),
  Object.freeze({ id: 'LC2', name: 'Bounded lookahead', rule: 'Computed placement. Only the next 1-2 compact cards may move up into a hole; order displacement at most 2.' }),
  Object.freeze({ id: 'LC3', name: 'Focus band + side rail', rule: 'Expanded cards stack in a focus band; all other games run as a compact rail at the side in kickoff order.' }),
  Object.freeze({ id: 'LC4', name: 'Full-row bands', rule: 'Each expanded card takes a full-width row, stages left to right inside it; compact cards after it may fill the row it left (displacement below the column count).' }),
]);

export const CANDIDATE_IDS = Object.freeze(CANDIDATES.map((c) => c.id));

const EPS = 0.01;
const r2 = (v) => Math.round(v * 100) / 100;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export function frameGeometry(viewport, d, headerHeight = null) {
  const insetX = r2(viewport.w * SAFE_INSET_RATIO);
  const insetY = r2(viewport.h * SAFE_INSET_RATIO);
  const contentW = r2(viewport.w - 2 * insetX);
  const cols = Math.max(1, Math.floor((contentW + d.gap + EPS) / (d.compactW + d.gap)));
  const colW = (contentW - (cols - 1) * d.gap) / cols;
  const header = Number.isFinite(headerHeight) && headerHeight >= 44 ? headerHeight : d.header;
  return {
    viewport: { w: viewport.w, h: viewport.h },
    insetX,
    insetY,
    contentW,
    cols,
    colW,
    gap: d.gap,
    header: { x: insetX, y: insetY, w: contentW, h: header },
    gridTop: r2(insetY + header + d.gap),
    safeBottom: r2(viewport.h - insetY),
    underMinWidth: contentW < d.compactW - EPS,
  };
}

export function spanWidth(k, g) {
  return k * g.colW + (k - 1) * g.gap;
}

function spanFor(stage, cols) {
  return stage <= 1 ? 1 : Math.min(stage, cols);
}

function rowsFit(mins, perRow, width, gap) {
  for (let i = 0; i < mins.length; i += perRow) {
    const row = mins.slice(i, i + perRow);
    if (sum(row) + (row.length - 1) * gap > width + EPS) return false;
  }
  return true;
}

// Arrange a card's stage sections inside `width`: left to right when the
// minimum widths fit, otherwise wrapped, otherwise stacked (narrow layouts).
export function arrangeStages(width, stage, d) {
  if (stage <= 1) {
    return { arrangement: 'compact', h: d.h[1], sections: [{ stage: 1, x: 0, y: 0, w: width, h: d.h[1] }] };
  }
  const mins = [];
  for (let s = 1; s <= stage; s++) mins.push(s === 1 ? d.compactW : d.stageW);
  let perRow = stage;
  while (perRow > 1 && !rowsFit(mins, perRow, width, d.gap)) perRow--;
  const sections = [];
  let y = 0;
  for (let start = 0; start < stage; start += perRow) {
    const rowMins = mins.slice(start, start + perRow);
    const n = rowMins.length;
    const minTotal = sum(rowMins);
    const avail = width - (n - 1) * d.gap;
    let rowH = 0;
    for (let i = 0; i < n; i++) rowH = Math.max(rowH, d.h[start + i + 1]);
    let x = 0;
    for (let i = 0; i < n; i++) {
      const w = n === 1 ? width : (avail * rowMins[i]) / minTotal;
      sections.push({ stage: start + i + 1, x, y, w, h: rowH });
      x += w + d.gap;
    }
    y += rowH;
  }
  const arrangement = perRow === stage ? 'ltr' : perRow === 1 ? 'stack' : 'wrap';
  return { arrangement, h: y, sections };
}

function makePlacement(item, x, y, width, d, extra) {
  const arr = arrangeStages(width, item.stage, d);
  return {
    id: item.id,
    sortedIndex: item.sortedIndex,
    stage: item.stage,
    x,
    y,
    w: width,
    h: arr.h,
    arrangement: arr.arrangement,
    sections: arr.sections,
    ...extra,
  };
}

// Rows of cells -> placements. Cards in a row align to the top; the row is as
// tall as its tallest card.
function positionRows(rows, g, d, startY) {
  const placements = [];
  let y = startY;
  rows.forEach((row) => {
    const ps = [];
    let rowH = 0;
    for (const cell of row) {
      const x = cell.band ? g.insetX : g.insetX + cell.col * (g.colW + g.gap);
      const w = cell.band ? g.contentW : spanWidth(cell.span, g);
      const p = makePlacement(cell.item, x, 0, w, d, { region: cell.region, span: cell.band ? g.cols : cell.span });
      ps.push(p);
      rowH = Math.max(rowH, p.h);
    }
    for (const p of ps) p.y = y;
    placements.push(...ps);
    y += rowH + g.gap;
  });
  return { placements, nextY: y };
}

function sparseRows(items, g, region) {
  const rows = [];
  let row = [];
  let col = 0;
  for (const item of items) {
    const span = spanFor(item.stage, g.cols);
    if (col + span > g.cols) {
      rows.push(row);
      row = [];
      col = 0;
    }
    row.push({ item, col, span, region });
    col += span;
  }
  if (row.length) rows.push(row);
  return rows;
}

// LC2 helper: pulling queue[qi] forward delays every card ahead of it in the
// queue by one slot; refuse if any of them would end up more than 2 late.
function canPull(queue, qi, placedCount) {
  for (let p = 0; p < qi; p++) {
    if (placedCount + 1 + p - queue[p].sortedIndex > 2) return false;
  }
  return true;
}

function lookaheadRows(items, g) {
  const queue = items.slice();
  const rows = [];
  const pulls = [];
  let row = [];
  let col = 0;
  let placedCount = 0;
  const put = (item, span) => {
    row.push({ item, col, span, region: 'grid' });
    col += span;
    placedCount++;
  };
  const newRow = () => {
    rows.push(row);
    row = [];
    col = 0;
  };
  while (queue.length) {
    const head = queue[0];
    const span = spanFor(head.stage, g.cols);
    if (col + span <= g.cols) {
      queue.shift();
      put(head, span);
      if (col === g.cols) newRow();
      continue;
    }
    // A hole of (cols - col) cells: only the next 1-2 compact cards may fill it.
    const limit = head.sortedIndex + 2;
    let qi = 1;
    while (col < g.cols && qi < queue.length && queue[qi].sortedIndex <= limit) {
      const cand = queue[qi];
      if (cand.stage <= 1 && canPull(queue, qi, placedCount)) {
        queue.splice(qi, 1);
        pulls.push({ id: cand.id, ahead: head.id });
        put(cand, 1);
      } else {
        qi++;
      }
    }
    newRow();
  }
  if (row.length) rows.push(row);
  return { rows, pulls };
}

function bandRows(items, g) {
  const rows = [];
  let row = [];
  let pending = [];
  const flushRow = () => {
    if (row.length) rows.push(row.map((item, col) => ({ item, col, span: 1, region: 'row' })));
    row = [];
  };
  const band = (item) => rows.push([{ item, band: true, region: 'band' }]);
  const flushBands = () => {
    for (const item of pending) band(item);
    pending = [];
  };
  let fills = 0;
  for (const item of items) {
    if (item.stage > 1) {
      if (row.length === 0) {
        flushBands();
        band(item);
      } else if (row.length >= g.cols) {
        flushRow();
        flushBands();
        band(item);
      } else {
        pending.push(item); // its band follows the row it left
      }
    } else if (pending.length) {
      // Filling the vacated row moves this card ahead of `pending.length`
      // expanded cards; allowed only while that stays below the column count.
      if (row.length < g.cols && pending.length < g.cols) {
        row.push(item);
        fills++;
        if (row.length >= g.cols) {
          flushRow();
          flushBands();
        }
      } else {
        flushRow();
        flushBands();
        row.push(item);
        if (row.length >= g.cols) flushRow();
      }
    } else {
      row.push(item);
      if (row.length >= g.cols) flushRow();
    }
  }
  flushRow();
  flushBands();
  return { rows, fills };
}

function focusRailLayout(items, g, d) {
  const expanded = items.filter((i) => i.stage > 1);
  if (expanded.length === 0) {
    const { placements } = positionRows(sparseRows(items, g, 'rail'), g, d, g.gridTop);
    return { placements, meta: { mode: 'grid', focusCols: 0, railCols: g.cols } };
  }
  const rail = items.filter((i) => i.stage <= 1);
  const maxStage = Math.max(...expanded.map((i) => i.stage));
  let mode = 'top';
  let focusCols = g.cols;
  if (g.cols >= 2) {
    mode = 'side';
    const need = ltrMinWidth(maxStage, d);
    focusCols = 1;
    while (focusCols < g.cols - 1 && spanWidth(focusCols, g) < need - EPS) focusCols++;
  }
  const focusW = mode === 'side' ? spanWidth(focusCols, g) : g.contentW;
  const placements = [];
  let y = g.gridTop;
  for (const item of expanded) {
    const p = makePlacement(item, g.insetX, y, focusW, d, { region: 'focus', span: mode === 'side' ? focusCols : g.cols });
    placements.push(p);
    y += p.h + g.gap;
  }
  const focusBottom = y - g.gap;
  let idx = 0;
  let railY;
  const railCols = mode === 'side' ? g.cols - focusCols : g.cols;
  if (mode === 'side') {
    const railX0 = g.insetX + focusW + g.gap;
    railY = g.gridTop;
    while (idx < rail.length && railY < focusBottom - EPS) {
      for (let c = 0; c < railCols && idx < rail.length; c++, idx++) {
        placements.push(makePlacement(rail[idx], railX0 + c * (g.colW + g.gap), railY, g.colW, d, { region: 'rail', span: 1 }));
      }
      railY += d.h[1] + g.gap;
    }
    railY = Math.max(railY, focusBottom + g.gap);
  } else {
    railY = focusBottom + g.gap;
  }
  const below = positionRows(sparseRows(rail.slice(idx), g, 'rail'), g, d, railY);
  placements.push(...below.placements);
  return { placements, meta: { mode, focusCols: mode === 'side' ? focusCols : g.cols, railCols, focusBottom } };
}

export function computeLayout({ items, viewport, scale, candidate }) {
  const d = dimsFor(scale);
  const g = frameGeometry(viewport, d);
  const norm = items.map((it, i) => ({ id: it.id, stage: Math.min(3, Math.max(1, Math.round(it.stage || 1))), sortedIndex: i }));
  let placements;
  let meta = {};
  switch (candidate) {
    case 'LC1':
      ({ placements } = positionRows(sparseRows(norm, g, 'grid'), g, d, g.gridTop));
      break;
    case 'LC2': {
      const { rows, pulls } = lookaheadRows(norm, g);
      ({ placements } = positionRows(rows, g, d, g.gridTop));
      meta = { pulls };
      break;
    }
    case 'LC3':
      ({ placements, meta } = focusRailLayout(norm, g, d));
      break;
    case 'LC4': {
      const { rows, fills } = bandRows(norm, g);
      ({ placements } = positionRows(rows, g, d, g.gridTop));
      meta = { fills };
      break;
    }
    default:
      throw new Error(`unknown layout candidate: ${String(candidate)}`);
  }
  placements.sort((a, b) => a.sortedIndex - b.sortedIndex);
  const contentBottom = placements.reduce((m, p) => Math.max(m, p.y + p.h), g.gridTop);
  return {
    candidate,
    viewport: { w: viewport.w, h: viewport.h },
    scale: d.scale,
    dims: d,
    frame: g,
    placements,
    contentBottom,
    totalHeight: contentBottom + g.insetY,
    meta,
  };
}
