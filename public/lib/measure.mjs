// WTFScore DEL-0 - BROWSER-MEASURED checks.
// Reads actual getBoundingClientRect() and computed styles in the running page.
// Only meaningful inside a real browser; the result names the actual viewport
// and DPR it was taken at. It never substitutes for device evidence.

import { TEXT_FLOOR_PX, TOTALS_FLOOR_PX, SAFE_INSET_RATIO } from './sizing.mjs';

const r1 = (v) => Math.round(v * 10) / 10;
const EPS = 1; // CSS px tolerance for sub-pixel rounding

function overlaps(a, b) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

function visible(el) {
  for (let e = el; e; e = e.parentElement) {
    if (e.hidden) return false;
  }
  return el.getClientRects().length > 0;
}

export function measureBrowser({ win, doc, frame, cards, layout, zoom, presetLabel }) {
  const fr = frame.getBoundingClientRect();
  const toFrame = (r) => ({
    x: (r.left - fr.left) / zoom + frame.scrollLeft,
    y: (r.top - fr.top) / zoom + frame.scrollTop,
    w: r.width / zoom,
    h: r.height / zoom,
  });
  const frameW = frame.clientWidth;
  const frameH = frame.clientHeight;
  const insetX = frameW * SAFE_INSET_RATIO;
  const insetY = frameH * SAFE_INSET_RATIO;

  const rects = [];
  const modelById = new Map(layout.placements.map((p) => [p.id, p]));
  let maxModelDelta = 0;
  for (const [id, ref] of cards) {
    const r = toFrame(ref.root.getBoundingClientRect());
    rects.push({ id, ...r });
    const m = modelById.get(id);
    if (m) maxModelDelta = Math.max(maxModelDelta, Math.abs(m.x - r.x), Math.abs(m.y - r.y), Math.abs(m.w - r.w), Math.abs(m.h - r.h));
  }

  const overlapPairs = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) if (overlaps(rects[i], rects[j])) overlapPairs.push(`${rects[i].id}/${rects[j].id}`);
  }

  const overflow = [];
  let intendedClips = 0;
  for (const [id, ref] of cards) {
    const parts = [ref.root, ...Object.values(ref.sections).filter((s) => !s.hidden)];
    for (const el of parts) {
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        overflow.push({ id, part: el === ref.root ? 'card' : `stage${el.getAttribute('data-stage')}`, scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight, clientH: el.clientHeight });
      }
    }
    for (const el of ref.root.querySelectorAll('[data-clip-ok]')) if (visible(el) && el.scrollHeight > el.clientHeight + 1) intendedClips++;
  }

  let minFont = Infinity;
  let minFontSample = '';
  let below = 0;
  let textEls = 0;
  const walker = doc.createTreeWalker(frame, 4 /* NodeFilter.SHOW_TEXT */);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    textEls++;
    const fs = parseFloat(win.getComputedStyle(el).fontSize);
    if (fs < minFont) {
      minFont = fs;
      minFontSample = `${el.className || el.tagName}: "${n.nodeValue.trim().slice(0, 24)}"`;
    }
    if (fs < TEXT_FLOOR_PX - 0.01) below++;
  }

  let minTotals = Infinity;
  for (const [, ref] of cards) {
    for (const el of ref.root.querySelectorAll('.trow .tot')) minTotals = Math.min(minTotals, parseFloat(win.getComputedStyle(el).fontSize));
  }

  const stageOrder = [];
  for (const [id, ref] of cards) {
    const shown = Object.values(ref.sections).filter((s) => !s.hidden);
    if (shown.length < 2) continue;
    const rs = shown.map((s) => ({ stage: Number(s.getAttribute('data-stage')), ...toFrame(s.getBoundingClientRect()) })).sort((a, b) => a.stage - b.stage);
    const sameTop = rs.every((r) => Math.abs(r.y - rs[0].y) <= EPS);
    const incX = rs.every((r, i) => i === 0 || r.x > rs[i - 1].x + EPS);
    const incY = rs.every((r, i) => i === 0 || r.y > rs[i - 1].y + EPS);
    const observed = sameTop && incX ? 'ltr' : incY && rs.every((r) => Math.abs(r.x - rs[0].x) <= EPS) ? 'stack' : incY ? 'wrap' : 'unordered';
    const model = modelById.get(id)?.arrangement ?? 'unknown';
    stageOrder.push({ id, observed, model, agrees: observed === model });
  }

  const safe = [];
  const head = doc.getElementById('board-head');
  const checkSafe = (name, r) => {
    if (r.x < insetX - EPS || r.x + r.w > frameW - insetX + EPS || r.y < insetY - EPS) safe.push(name);
  };
  if (head) checkSafe('board-head', toFrame(head.getBoundingClientRect()));
  const badge = doc.getElementById('sim-badge');
  if (badge) checkSafe('SIMULATED badge', toFrame(badge.getBoundingClientRect()));
  for (const r of rects) checkSafe(r.id, r);

  const de = doc.documentElement;
  return {
    label: 'browser-measured',
    measuredAt: new Date().toISOString(),
    actualViewport: {
      innerWidth: win.innerWidth,
      innerHeight: win.innerHeight,
      devicePixelRatio: win.devicePixelRatio,
      visualViewportScale: win.visualViewport ? win.visualViewport.scale : null,
      documentClientWidth: de.clientWidth,
      documentScrollWidth: de.scrollWidth,
    },
    pageHorizontalOverflowPx: Math.max(0, de.scrollWidth - de.clientWidth),
    modelFrame: { preset: presetLabel, cssWidth: frameW, cssHeight: frameH, displayZoom: r1(zoom * 1000) / 1000 },
    note: 'Rects are converted to frame CSS px by dividing by the display zoom. Text sizes are computed CSS px; on-screen size is CSS px x zoom x DPR.',
    cards: rects.length,
    overlapCount: overlapPairs.length,
    overlapPairs: overlapPairs.slice(0, 10),
    unintendedOverflowCount: overflow.length,
    unintendedOverflow: overflow.slice(0, 10),
    intendedLineClamps: intendedClips,
    textFloor: {
      floorPx: TEXT_FLOOR_PX,
      minComputedPx: Number.isFinite(minFont) ? minFont : null,
      minOnScreenCssPx: Number.isFinite(minFont) ? r1(minFont * zoom) : null,
      elementsBelowFloor: below,
      textElements: textEls,
      smallestSample: minFontSample,
    },
    totals: { floorPx: TOTALS_FLOOR_PX, minComputedPx: Number.isFinite(minTotals) ? minTotals : null },
    stageOrder,
    stageOrderDisagreements: stageOrder.filter((s) => !s.agrees).length,
    safeInset: { ratio: SAFE_INSET_RATIO, insetX: r1(insetX), insetY: r1(insetY), violations: safe.slice(0, 10), violationCount: safe.length },
    modelVsBrowserMaxDeltaPx: r1(maxModelDelta),
  };
}
