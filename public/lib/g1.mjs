// WTFScore - layout decision sheet (developer-only). PROPOSALS ONLY: the maintainer decides.
// Numbers are computed live from the layout model (model-computed). Anything a
// browser or a person must judge is marked UNVERIFIED here.

import { comparisonFor } from './metrics.mjs';
import { computeLayout, frameGeometry } from './layout.mjs';
import { dims, ltrMinWidth, lowestScaleMeetingTextFloor } from './sizing.mjs';
import { scenarioItems } from './metrics.mjs';

export const G1_VIEWPORT = Object.freeze({ w: 1920, h: 1080 });
export const PROPOSED = Object.freeze({ layout: 'LC4', desktopScale: 5, cap: 3, runnerUp: 'LC2' });

export function g1Numbers(games) {
  const d = dims(PROPOSED.desktopScale);
  const g = frameGeometry(G1_VIEWPORT, d);
  const fullRows = Math.floor((g.safeBottom - g.gridTop + d.gap + 0.01) / (d.h[1] + d.gap));
  const rows = comparisonFor(games, G1_VIEWPORT, PROPOSED.desktopScale, { ks: [0, 3, 6] });
  const vis = {};
  for (const m of rows) {
    vis[m.candidate] ??= {};
    vis[m.candidate][`k${m.expanded}`] = m.visibleCompact;
  }
  const lc4 = computeLayout({ items: scenarioItems(games, 3), viewport: G1_VIEWPORT, scale: PROPOSED.desktopScale, candidate: 'LC4' });
  const band = lc4.placements.find((p) => p.stage === 3);
  const stretchPct = band ? Math.round((100 * (band.w - ltrMinWidth(3, d))) / band.w) : null;
  return {
    label: 'model-computed',
    viewport: `${G1_VIEWPORT.w}x${G1_VIEWPORT.h}`,
    scale: PROPOSED.desktopScale,
    cols: g.cols,
    compactCapacity: g.cols * fullRows,
    fixtureGames: games.length,
    nDesktopModel: rows.find((m) => m.candidate === PROPOSED.layout && m.expanded === 0).visibleCompact,
    visibleCompactByCandidate: vis,
    lc4BandStretchPct: stretchPct,
    tvTextFloorScale: lowestScaleMeetingTextFloor(),
  };
}

const status = 'PROPOSAL · maintainer decides';

export const G1_PROPOSALS = Object.freeze([
  {
    entry: 'Layout',
    value: (n) => `${PROPOSED.layout} full-row bands (runner-up ${PROPOSED.runnerUp} bounded lookahead)`,
    basis: (n) => `Model: at max-expanded 3, LC4 matches the others on visible compact cards at 1920x1080 and leads at 1280x720; hole area at most 3% across all 350 LC4 matrix rows; in every standard-scenario row followers only move down (a hand-built case shows its fill rule can move one card up-right); stages stay left to right at the TV model size at the 14 px floor, where LC3 stacks. Against it: a band stretches stage sections across the whole row (${n.lc4BandStretchPct}% beyond their minimum width at 1920x1080), and with 5-6 open at 1920 LC2 and LC3 keep ${n.visibleCompactByCandidate.LC2.k6} compact cards visible versus ${n.visibleCompactByCandidate.LC4.k6} for LC4. Owner visual judgment UNVERIFIED.`,
    status,
  },
  {
    entry: 'Default scale',
    value: (n) => `Desktop ${PROPOSED.desktopScale}; TV ${n.tvTextFloorScale} (provisional until DV)`,
    basis: 'Model: step 5 is the CD-17 baseline (smallest text 12 CSS px, totals 28). The 14 px text floor first holds at step 7, so TV presets cannot go below 7.',
    status,
  },
  {
    entry: 'Default max expanded',
    value: () => `${PROPOSED.cap} (range 1-6)`,
    basis: 'Model: at 3 open, every candidate keeps 13 of 16 compact cards visible at 1920x1080; beyond 4 open, visibility drops sharply for LC4 (6 at 5-6 open).',
    status,
  },
  {
    entry: 'N_desktop at 1920x1080',
    value: (n) => `${n.nDesktopModel} (all fixture games, nothing expanded; capacity ${n.compactCapacity} compact cards in ${n.cols} columns)`,
    basis: 'Model-computed at scale 5 with the 5% inset. Unrendered: the browser-measured count at a real 1920x1080 window is UNVERIFIED.',
    status,
  },
  {
    entry: 'MD-6 mirroring',
    value: () => 'Confirm mirror: devices attached to the same named screen show identical state; a new device gets its own screen by default',
    basis: 'Plan v3.1 MD-6 default and addendum DEL-1 scope. The default of one screen per new device preserves R-40 independence. Not exercised by DEL-0 (no server state).',
    status,
  },
]);
