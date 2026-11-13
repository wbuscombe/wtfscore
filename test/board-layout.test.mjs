// Model tests for the board's one layout. Geometry here is model-computed CSS
// px; the browser renders the same numbers as CSS, but these tests are not
// browser or device measurements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBoardLayout, boardViolations, boardRects, arrangeParts, connectedWidth, columnsNeeded, spanWidth, fullyVisibleScores, textCheck } from '../public/lib/board-layout.mjs';
import { generateWeek, prng } from '../public/lib/fixtures.mjs';
import { sortGames, isExpandable, spreadPick } from '../public/lib/model.mjs';
import { TEXT_SIZES } from '../public/lib/chrome.mjs';
import { buildNavGraph, reachability } from '../public/lib/nav.mjs';
import { dims, SCALE_MIN, SCALE_MAX } from '../public/lib/sizing.mjs';
import { frameGeometry } from '../public/lib/layout.mjs';

const games = generateWeek().games;
const ordered = sortGames(games, 'kickoff');
const eligible = ordered.filter(isExpandable).map((g) => g.id);
const WIDTHS = [320, 360, 390, 414, 600, 768, 960, 1024, 1280, 1440, 1512, 1728, 1920, 2560];
const HEIGHTS = { 320: 568, 360: 740, 390: 844, 414: 896, 600: 900, 768: 1024, 960: 540, 1024: 768, 1280: 720, 1440: 900, 1512: 982, 1728: 1117, 1920: 1080, 2560: 1440 };
const ALL_SCALES = Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, i) => SCALE_MIN + i);
const P1_WIDTHS = [1920, 1280, 960, 390];
const EPS = 0.01;

function items(open, stage) {
  const picks = new Set(spreadPick(eligible, open));
  return ordered.map((g) => ({ id: g.id, stage: picks.has(g.id) ? stage : 1 }));
}
const withStages = (stages) => ordered.map((g) => ({ id: g.id, stage: stages.get(g.id) ?? 1 }));
const layoutAt = (w, scale, it) => computeBoardLayout({ items: it, viewport: { w, h: HEIGHTS[w] ?? 900 }, scale });
const fmt = (v) => v.slice(0, 4).map((x) => `${x.kind}: ${x.detail}`).join(' | ');
const box = (p) => [p.x, p.y, p.w, p.h];
const byId = (L) => new Map(L.placements.map((p) => [p.id, p]));
// A longer generic board so every column of every width and scale holds a card.
const GENERIC = Array.from({ length: 40 }, (_, i) => `x${i}`);
const generic = (open) => GENERIC.map((id) => ({ id, stage: open.get(id) ?? 1 }));
const genericAt = (w, scale, open) => computeBoardLayout({ items: generic(open), viewport: { w, h: HEIGHTS[w] ?? 900 }, scale });

test('every width x scale 1-10 x 0-6 open x situation/leaders holds every board invariant', () => {
  let runs = 0;
  for (const w of WIDTHS) {
    for (const scale of ALL_SCALES) {
      for (let open = 0; open <= 6; open++) {
        for (const stage of [2, 3]) {
          const it = items(open, stage);
          const L = layoutAt(w, scale, it);
          const v = boardViolations(L);
          assert.equal(v.length, 0, `${w} s${scale} open${open} stage${stage}: ${fmt(v)}`);
          assert.deepEqual(L.placements.map((p) => p.id), it.map((x) => x.id), 'every game placed once, in display order');
          for (const r of boardRects(L)) assert.ok(r.x >= 0 && r.x + r.w <= w + EPS, `${w}: ${r.id}/${r.part} inside the page width`);
          runs++;
        }
      }
    }
  }
  assert.equal(runs, WIDTHS.length * ALL_SCALES.length * 7 * 2);
});

test('property check: random stages, widths and sizes keep every invariant', () => {
  const rnd = prng(2027);
  for (let i = 0; i < 800; i++) {
    const w = 280 + Math.floor(rnd() * 2400);
    const h = 400 + Math.floor(rnd() * 1200);
    const scale = ALL_SCALES[Math.floor(rnd() * ALL_SCALES.length)];
    const it = ordered.map((g) => ({ id: g.id, stage: isExpandable(g) && rnd() < 0.4 ? 2 + Math.floor(rnd() * 2) : 1 }));
    const L = computeBoardLayout({ items: it, viewport: { w, h }, scale });
    assert.equal(boardViolations(L).length, 0, `${w}x${h} s${scale}: ${fmt(boardViolations(L))}`);
  }
});

// Full-row placement (it replaced an earlier keep-place-if-it-fits rule),
// checked against the closed board rather than the layout's own labels: an
// open card always spans the whole content width alone in its row. A card
// that was first in its row keeps its place; any other moves once to the
// start of the next row and the rest of the row it left stays empty. Earlier
// cards never move, later cards follow below in order, the second step moves
// nothing, and closing restores the board.
test('Full-row placement: first, middle and last columns at 1920/1280/960/390 and scales 1-10', () => {
  const report = [];
  for (const w of P1_WIDTHS) {
    for (const scale of ALL_SCALES) {
      const closed = genericAt(w, scale, new Map());
      const g = closed.frame;
      const need = connectedWidth(closed.dims);
      const cols = [...new Set([0, Math.floor((g.cols - 1) / 2), g.cols - 1])];
      for (const col of cols) {
        const id = GENERIC.find((x) => byId(closed).get(x).col === col && byId(closed).get(x).row === 1);
        assert.ok(id, `${w} s${scale}: a game in column ${col} of the second row`);
        const base = byId(closed).get(id);
        const s2 = genericAt(w, scale, new Map([[id, 2]]));
        const s3 = genericAt(w, scale, new Map([[id, 3]]));
        const back = genericAt(w, scale, new Map([[id, 1]]));
        for (const L of [s2, s3]) assert.equal(boardViolations(L).length, 0, `${w} s${scale} ${id}: ${fmt(boardViolations(L))}`);
        const p2 = byId(s2).get(id);
        const p3 = byId(s3).get(id);
        const kept = p2.x === base.x && p2.y === base.y;
        const moved = p2.x === g.insetX && p2.w === g.contentW && p2.y > base.y;
        assert.ok(kept !== moved, `${w} s${scale} col${col}: exactly one of kept / next row`);
        assert.ok(p2.x === g.insetX && p2.w === g.contentW, `${w} s${scale} col${col}: the open card spans the whole row`);
        if (col === 0) assert.ok(kept, `${w} s${scale} col${col}: first in its row, so it keeps its place`);
        else assert.ok(moved, `${w} s${scale} col${col}: not first in its row, so it moves once to the start of the next row`);
        for (const p of s2.placements) {
          if (p.sortedIndex > base.sortedIndex) assert.ok(p.y >= p2.y + p2.h - EPS, `${p.id} after ${id} continues below it`);
          if (p.id !== id) assert.ok(p.y + p.h <= p2.y + EPS || p.y >= p2.y + p2.h - EPS, `${p.id} shares the open card's row`);
        }
        if (moved) {
          const vacatedY = base.y;
          for (const p of s2.placements) {
            if (p.sortedIndex > base.sortedIndex) assert.ok(p.y > vacatedY, `${p.id} must not fill the row ${id} left`);
            if (p.sortedIndex < base.sortedIndex) assert.deepEqual(box(p), box(byId(closed).get(p.id)), `${p.id} before ${id} stays`);
          }
        }
        for (const p of s2.placements) if (p.sortedIndex < base.sortedIndex) assert.deepEqual(box(p), box(byId(closed).get(p.id)), `${p.id} before ${id} never moves`);
        // situation -> leaders: nothing on the board moves, the card keeps its width
        assert.deepEqual(s3.placements.map(box), s2.placements.map(box), `${w} s${scale} ${id}: second step moved something`);
        const origins = new Set([base, p2, p3].map((p) => `${p.x},${p.y}`));
        assert.ok(origins.size <= 2, `${w} s${scale} ${id}: at most one move per open`);
        assert.deepEqual(back.placements.map(box), closed.placements.map(box), 'closing restores the board');
        // the three parts sit side by side when a full row holds them, else stack in the card
        assert.equal(p3.arrangement, g.contentW + EPS >= need ? 'ltr' : 'stack', `${w} s${scale}`);
        assert.equal(p2.arrangement, p3.arrangement, 'stage two already has the three-part shape');
        report.push({ w, scale, col, place: kept ? 'kept' : 'next-row', arrangement: p3.arrangement });
      }
    }
  }
  const tally = {};
  for (const r of report) tally[`${r.w} ${r.place} ${r.arrangement}`] = (tally[`${r.w} ${r.place} ${r.arrangement}`] ?? 0) + 1;
  console.log(`P1 model placement (${report.length} opens): ${JSON.stringify(tally)}`);
  assert.ok(report.some((r) => r.place === 'kept') && report.some((r) => r.place === 'next-row'), 'both outcomes exercised');
});

test('several open games: cards push later games aside or down in strict display order, and stepping any of them to leaders moves nothing', () => {
  for (const w of P1_WIDTHS) {
    for (const scale of ALL_SCALES) {
      for (const open of [2, 3, 6]) {
        const picks = spreadPick(eligible, open);
        const s2 = layoutAt(w, scale, withStages(new Map(picks.map((id) => [id, 2]))));
        assert.equal(boardViolations(s2).length, 0, `${w} s${scale} open${open}: ${fmt(boardViolations(s2))}`);
        for (const id of picks) {
          const stages = new Map(picks.map((x) => [x, x === id ? 3 : 2]));
          const s3 = layoutAt(w, scale, withStages(stages));
          assert.deepEqual(s3.placements.map(box), s2.placements.map(box), `${w} s${scale} ${id}: leaders moved a card`);
          assert.equal(boardViolations(s3).length, 0);
        }
        const closed = layoutAt(w, scale, withStages(new Map()));
        const first = Math.min(...picks.map((id) => byId(s2).get(id).sortedIndex));
        for (const p of s2.placements) if (p.sortedIndex < first) assert.deepEqual(box(p), box(byId(closed).get(p.id)), 'cards before the first open game never move');
      }
    }
  }
});

test('one connected card: parts tile the card with no gap or empty block, side by side when they fit, stacked on a phone', () => {
  const at = (w, scale) => layoutAt(w, scale, items(3, 3));
  const phone = at(390, 7);
  assert.equal(phone.frame.cols, 1);
  assert.deepEqual([...new Set(phone.placements.filter((p) => p.stage > 1).map((p) => p.arrangement))], ['stack']);
  for (const w of [960, 1024, 1280, 1440, 1920, 2560]) {
    const L = at(w, 7);
    assert.ok(L.frame.contentW >= connectedWidth(L.dims), `${w} holds three parts in a row`);
    for (const p of L.placements.filter((x) => x.stage > 1)) {
      assert.equal(p.arrangement, 'ltr', `${w} ${p.id}`);
      const [a, b, c] = p.parts;
      assert.ok(a.x === 0 && Math.abs(b.x - (a.x + a.w)) <= EPS && Math.abs(c.x - (b.x + b.w)) <= EPS, 'score, situation, leaders adjacent left to right');
      assert.ok(Math.abs(c.x + c.w - p.w) <= EPS, 'leaders reach the card edge');
      assert.ok(a.w >= L.dims.compactW - EPS && b.w >= L.dims.stageW - EPS && c.w >= L.dims.stageW - EPS, 'minimum widths');
    }
  }
  const d = dims(7);
  const g = frameGeometry({ w: 1920, h: 1080 }, d);
  const w = spanWidth(columnsNeeded(g, d), g);
  const two = arrangeParts(2, w, g, d);
  const three = arrangeParts(3, w, g, d);
  assert.equal(two.h, three.h, 'same footprint at both steps');
  assert.equal(two.parts.length, 2);
  assert.ok(Math.abs(two.parts[1].x + two.parts[1].w - w) <= EPS, 'situation fills the room kept for leaders');
  assert.equal(two.parts[0].w, three.parts[0].w, 'the score part keeps its width');
  assert.equal(arrangeParts(1, g.colW, g, d).arrangement, 'compact');
  assert.equal(columnsNeeded(frameGeometry({ w: 390, h: 844 }, d), d), null, 'a phone row cannot hold three parts side by side');
});

test('every offered text size meets the 14 px text and 28 px totals floors; the default is the smallest offered', () => {
  for (const t of TEXT_SIZES) {
    const r = textCheck(t.scale);
    assert.ok(r.meetsText && r.meetsTotals, `scale ${t.scale}: ${r.minTextPx} / ${r.totalsPx}`);
  }
  const offered = TEXT_SIZES.map((t) => t.scale);
  assert.equal(TEXT_SIZES[0].scale, Math.min(...offered));
  assert.equal(textCheck(TEXT_SIZES[0].scale).minTextPx, 14.4);
  assert.equal(textCheck(TEXT_SIZES[0].scale).totalsPx, 33.6);
});

test('arrow-key graph reaches every game from every game at every width and open count', () => {
  for (const w of WIDTHS) {
    for (const open of [0, 3, 6]) {
      const L = layoutAt(w, 7, items(open, 3));
      const r = reachability(buildNavGraph(L.placements), L.placements[0].id);
      assert.ok(r.stronglyConnected, `${w} open${open}: unreachable ${r.unreachable.join(',')}`);
    }
  }
});

test('validator negative controls: overlap, bounds, order, detached or missing parts and empty blocks are all caught', () => {
  const ok = () => layoutAt(1440, 7, items(2, 3));
  const kinds = (L) => new Set(boardViolations(L).map((v) => v.kind));
  assert.equal(boardViolations(ok()).length, 0);
  let L = ok();
  // two cards that share a row (an open card has a row to itself)
  const pair = L.placements.flatMap((a) => L.placements.filter((b) => b !== a && b.y === a.y).map((b) => [a, b]))[0];
  pair[1].x = pair[0].x + 5;
  assert.ok(kinds(L).has('overlap'));
  L = ok();
  L.placements[0].x = -50;
  assert.ok(kinds(L).has('bounds'));
  L = ok();
  [L.placements[0].sortedIndex, L.placements[1].sortedIndex] = [1, 0];
  assert.ok(kinds(L).has('order'));
  L = ok();
  let open = L.placements.find((p) => p.stage === 3);
  open.parts[2].x += 30; // a leaders part pulled away from the situation
  assert.ok(kinds(L).has('adjacent') && kinds(L).has('containment'));
  L = ok();
  open = L.placements.find((p) => p.stage === 3);
  open.parts.pop(); // leaders missing: an empty block where they belong
  assert.ok(kinds(L).has('parts') && kinds(L).has('fill'));
  L = ok();
  open = L.placements.find((p) => p.stage === 3);
  open.parts[1].y += 400; // a detached band below the card
  assert.ok(kinds(L).has('containment'));
  L = ok();
  L.placements[2].parts[0].w = 40;
  assert.ok(kinds(L).has('compact-scores'));
  L = ok();
  open = L.placements.find((p) => p.stage === 3);
  open.arrangement = 'stack';
  assert.ok(kinds(L).has('connected') || kinds(L).has('adjacent'));
  L = ok();
  open = L.placements.find((p) => p.stage === 3);
  open.w -= L.frame.colW + L.frame.gap; // an open card that no longer fills its row
  assert.ok(kinds(L).has('full-row'));
  L = ok();
  open = L.placements.find((p) => p.stage === 3);
  const lone = L.placements.find((p) => p.stage === 1 && p.sortedIndex > open.sortedIndex);
  lone.y = open.y; // a compact card pulled up beside an open card
  lone.x = open.x + open.w + 1;
  assert.ok(kinds(L).has('full-row'));
});

test('report-only density: fully visible compact games at the default text size, model 1920x1080', () => {
  const s = TEXT_SIZES[0].scale;
  const rows = [];
  for (const open of [0, 3]) {
    const L = computeBoardLayout({ items: items(open, 3), viewport: { w: 1920, h: 1080 }, scale: s });
    rows.push({ open, cols: L.frame.cols, fullyVisible: fullyVisibleScores(L), insideSafeArea: fullyVisibleScores(L, { bottom: L.frame.safeBottom }), total: L.placements.length });
  }
  console.log(`K3 model density 1920x1080 scale ${s}: ${JSON.stringify(rows)}`);
  for (const r of rows) assert.ok(Number.isInteger(r.fullyVisible) && r.fullyVisible >= 0 && r.fullyVisible <= r.total);
});
