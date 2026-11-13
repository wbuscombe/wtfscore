// WTFScore DEL-0 - scale ladder and model dimensions.
// Pure module shared by the browser and the Node tests. All values are CSS px.
// These are MODEL numbers. The browser panel measures what actually renders.

export const SCALE_MIN = 1;
export const SCALE_MAX = 10;
export const SCALE_BASELINE = 5; // CD-17: step 5 is the baseline
export const TEXT_FLOOR_PX = 14; // plan 4.7: no text below 14 CSS px at the TV viewport
export const TOTALS_FLOOR_PX = 28; // plan 4.7 / D-12: team totals at least 28 CSS px
export const SAFE_INSET_RATIO = 0.05; // 5% safe area on every edge

// Base sizes at scale factor 1.0 (scale step 5). The stylesheet uses the same
// numbers multiplied by --f, so model and CSS share one source of truth.
export const BASE = Object.freeze({
  compactW: 256, // stage-1 minimum width
  stageW: 210, // stage-2 and stage-3 minimum width
  h: Object.freeze([0, 120, 150, 140]), // section height per stage (index = stage)
  gap: 12,
  header: 36, // board header (wordmark, SIMULATED badge, week label)
  text: Object.freeze({
    label: 12, // linescore labels, section labels, records, tags, network
    status: 13,
    play: 13,
    body: 14, // quarter scores, down and distance, leader names
    abbr: 18,
    wordmark: 18,
    total: 28,
  }),
});

export function clampScale(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return SCALE_BASELINE;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, n));
}

// Linear ladder: step 1 = 0.6, step 5 = 1.0, step 10 = 1.5.
export function factor(scale) {
  const s = clampScale(scale);
  return Math.round((0.6 + 0.1 * (s - 1)) * 1000) / 1000;
}

const r2 = (v) => Math.round(v * 100) / 100;

export function dims(scale) {
  const f = factor(scale);
  const text = {};
  for (const [k, v] of Object.entries(BASE.text)) text[k] = r2(v * f);
  return Object.freeze({
    scale: clampScale(scale),
    f,
    compactW: r2(BASE.compactW * f),
    stageW: r2(BASE.stageW * f),
    h: BASE.h.map((v) => r2(v * f)),
    gap: r2(BASE.gap * f),
    header: r2(BASE.header * f),
    text: Object.freeze(text),
    minText: Math.min(...Object.values(text)),
    totalText: text.total,
  });
}

export function meetsTextFloor(scale) {
  return dims(scale).minText >= TEXT_FLOOR_PX;
}

export function meetsTotalsFloor(scale) {
  return dims(scale).totalText >= TOTALS_FLOOR_PX;
}

export function lowestScaleMeetingTextFloor() {
  for (let s = SCALE_MIN; s <= SCALE_MAX; s++) if (meetsTextFloor(s)) return s;
  return null;
}

export function lowestScaleMeetingTotalsFloor() {
  for (let s = SCALE_MIN; s <= SCALE_MAX; s++) if (meetsTotalsFloor(s)) return s;
  return null;
}

// Minimum width for a card whose `stage` sections sit side by side.
export function ltrMinWidth(stage, d) {
  if (stage <= 1) return d.compactW;
  return r2(d.compactW + (stage - 1) * (d.stageW + d.gap));
}
