// WTFScore - reproducible MODEL measurement export.
// Writes the full contract matrix (4 candidates x 5 viewports x scales 1-10 x
// 0-6 expanded) as JSON to a NEW file (exclusive create) and prints a summary.
// Model-computed only; never browser or device evidence.
//
// Usage: node tools/model-report.mjs <out.json>

import { writeFile } from 'node:fs/promises';
import { generateWeek } from '../public/lib/fixtures.mjs';
import { contractMatrix, contractSummary } from '../public/lib/metrics.mjs';
import { g1Numbers } from '../public/lib/g1.mjs';

const out = process.argv[2];
if (!out) {
  console.error('usage: node tools/model-report.mjs <out.json>');
  process.exit(2);
}
const week = generateWeek();
const matrix = contractMatrix(week.games);
const summary = contractSummary(week.games);
const g1 = g1Numbers(week.games);
const payload = {
  label: 'model-computed',
  generatedBy: 'tools/model-report.mjs',
  node: process.version,
  fixture: { seed: week.meta.seed, games: week.games.length, simNow: week.meta.simNow },
  matrix,
  summary,
  g1,
};
await writeFile(out, `${JSON.stringify(payload, null, 1)}\n`, { flag: 'wx' });

const bad = matrix.rows.filter((r) => r.violationCount > 0 || !r.stronglyConnected);
console.log(`matrix rows: ${matrix.rows.length}; rows with invariant violations or unreachable cards: ${bad.length}`);
console.log(`lowest scale meeting 14 px text floor: ${matrix.lowestScaleMeetingTextFloor}; lowest meeting 28 px totals: ${matrix.lowestScaleMeetingTotalsFloor}`);
console.log('viewport dpr cand scale k | cols hole% holeCells visCompact rowsMoved selfJumps dispMax | followers | stages | reach | text totals28 safe5 viol');
for (const r of summary.rows) {
  console.log(`${r.viewport} ${r.dprLabel} ${r.candidate} s${r.scale} k${r.k} | ${r.cols} ${r.holePct} ${r.holeCells} ${r.visibleCompact} ${r.rowsMoved} ${r.selfJumps} ${r.dispMax} | ${r.following} | ${r.stages} | ${r.reach} | ${r.textMinPx} ${r.totals28} ${r.safeArea5} ${r.violations}`);
}
console.log(`G1 numbers: ${JSON.stringify(g1)}`);
console.log(`wrote ${out}`);
