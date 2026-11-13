// WTFScore DEL-0 - ordering, eligibility and expansion state. Pure module.

// Status groups for the status sort: in progress, then upcoming, then final,
// then anything else. The group order is a proposal (plan 4.4 [P]).
export const STATUS_GROUP = Object.freeze({
  live: 0, halftime: 0, end_period: 0, delayed: 0, suspended: 0,
  scheduled: 1, postponed: 1,
  final: 2,
  canceled: 3, unknown: 3,
});

// Only games that have started (or finished) have a stage 2 and 3.
// Pregame, postponed, canceled and unknown games never expand.
const EXPANDABLE = new Set(['live', 'halftime', 'end_period', 'delayed', 'suspended', 'final']);

export function isExpandable(game) {
  return Boolean(game) && EXPANDABLE.has(game.status);
}

export function notExpandableReason(game) {
  if (!game) return 'missing game';
  switch (game.status) {
    case 'scheduled': return game.timeValid === false ? `pregame, ${game.sport && game.sport !== 'football' ? 'start' : 'kickoff'} time TBD` : 'pregame';
    case 'postponed': return 'postponed';
    case 'canceled': return 'canceled';
    case 'unknown': return 'status unknown, not treated as live';
    default: return isExpandable(game) ? '' : `status ${String(game.status)}`;
  }
}

export function kickoffKey(game) {
  if (game.timeValid === false) return Number.POSITIVE_INFINITY; // TBD sorts last (plan 4.4)
  const t = Date.parse(game.kickoff);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Kickoff ascending, then stable game id. Never the input array order.
export function compareKickoff(a, b) {
  const ka = kickoffKey(a);
  const kb = kickoffKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return byId(a, b);
}

export function compareStatus(a, b) {
  const ga = STATUS_GROUP[a.status] ?? 3;
  const gb = STATUS_GROUP[b.status] ?? 3;
  if (ga !== gb) return ga - gb;
  return compareKickoff(a, b);
}

// sortGames returns a new array. In status mode, `pins` (Map id -> index)
// holds expanded cards at their current position (CD-09): they do not move.
export function sortGames(games, mode = 'kickoff', { pins = null } = {}) {
  const byKick = [...games].sort(compareKickoff);
  if (mode !== 'status') return byKick;
  const natural = [...byKick].sort(compareStatus);
  if (!pins || pins.size === 0) return natural;
  const n = natural.length;
  const slots = new Array(n).fill(null);
  const placed = new Set();
  const ordered = [...pins.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  for (const [id, idx] of ordered) {
    const game = natural.find((g) => g.id === id);
    if (!game || !Number.isInteger(idx) || idx < 0 || idx >= n || slots[idx]) continue;
    slots[idx] = game;
    placed.add(id);
  }
  const rest = natural.filter((g) => !placed.has(g.id));
  let r = 0;
  for (let i = 0; i < n; i++) if (!slots[i]) slots[i] = rest[r++];
  return slots;
}

// 010 football week board (NFL and NCAAF): favorite games first, then the
// other games by status group (in progress, upcoming, final, other); inside
// every group kickoff ascending (an unknown or TBD start last), then the stable
// game id. Expanded cards hold no position here, and football has no Order
// choice: this order always applies.
export function sortFootball(games, isFavorite = () => false) {
  const rank = new Map(games.map((g) => [g.id, isFavorite(g) ? 0 : 1]));
  return [...games].sort((a, b) => rank.get(a.id) - rank.get(b.id) || compareStatus(a, b));
}

export const CAP_MIN = 1;
export const CAP_MAX = 6;

export function clampCap(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 3;
  return Math.min(CAP_MAX, Math.max(CAP_MIN, n));
}

// Evenly spread pick of k ids from an ordered list (deterministic).
export function spreadPick(ids, k) {
  const e = ids.length;
  const n = Math.max(0, Math.min(Math.floor(Number(k) || 0), e));
  const out = [];
  for (let i = 0; i < n; i++) out.push(ids[Math.floor((i * e) / n)]);
  return out;
}

// Expansion state with least-recently-expanded collapse (CD-18).
export class ExpansionState {
  constructor({ games, cap = 3 }) {
    this.cap = clampCap(cap);
    this.stages = new Map();
    this.recency = []; // oldest first
    this.eligible = new Map(games.map((g) => [g.id, isExpandable(g)]));
  }

  stageOf(id) {
    return this.stages.get(id) ?? 1;
  }

  isEligible(id) {
    return this.eligible.get(id) === true;
  }

  expandedIds() {
    return [...this.recency];
  }

  count() {
    return this.recency.length;
  }

  touch(id) {
    this.recency = this.recency.filter((x) => x !== id);
    this.recency.push(id);
  }

  drop(id) {
    this.recency = this.recency.filter((x) => x !== id);
    this.stages.delete(id);
  }

  enforceCap(keepId = null) {
    const collapsed = [];
    while (this.recency.length > this.cap) {
      const victim = this.recency.find((x) => x !== keepId);
      if (victim === undefined) break;
      this.drop(victim);
      collapsed.push(victim);
    }
    return collapsed;
  }

  // Select: stage 1 -> 2 -> 3 -> 1 (the wrap is plan 4.3 [P]).
  advance(id) {
    if (!this.isEligible(id)) return { ok: false, id, from: 1, to: 1, collapsed: [], reason: 'not-expandable' };
    const from = this.stageOf(id);
    if (from >= 3) {
      this.drop(id);
      return { ok: true, id, from, to: 1, collapsed: [] };
    }
    const to = from + 1;
    this.stages.set(id, to);
    this.touch(id);
    const collapsed = this.enforceCap(id);
    return { ok: true, id, from, to, collapsed };
  }

  stepDown(id) {
    const from = this.stageOf(id);
    if (from <= 1) return { ok: false, id, from, to: from };
    const to = from - 1;
    if (to === 1) this.drop(id);
    else this.stages.set(id, to);
    return { ok: true, id, from, to };
  }

  collapse(id) {
    const from = this.stageOf(id);
    if (from <= 1) return { ok: false, id, from, to: 1 };
    this.drop(id);
    return { ok: true, id, from, to: 1 };
  }

  // Escape: step the focused card down; on a stage-1 card while others are
  // expanded, step the most recently expanded card down (plan 4.3).
  escape(focusedId) {
    if (this.stageOf(focusedId) > 1) return this.stepDown(focusedId);
    const mru = this.recency[this.recency.length - 1];
    if (mru !== undefined) return this.stepDown(mru);
    return { ok: false, id: focusedId, from: 1, to: 1 };
  }

  setStage(id, stage) {
    if (!this.isEligible(id)) return { ok: false, id, collapsed: [], reason: 'not-expandable' };
    const s = Math.min(3, Math.max(1, Math.round(stage)));
    if (s === 1) {
      this.drop(id);
      return { ok: true, id, collapsed: [] };
    }
    this.stages.set(id, s);
    this.touch(id);
    return { ok: true, id, collapsed: this.enforceCap(id) };
  }

  setCap(cap) {
    this.cap = clampCap(cap);
    return this.enforceCap(null);
  }

  // Keep state only for games still on the board (a filter changed): open
  // games that stay keep their stage and recency; games that left are closed.
  retain(games) {
    const ids = new Set(games.map((g) => g.id));
    this.eligible = new Map(games.map((g) => [g.id, isExpandable(g)]));
    const dropped = this.recency.filter((id) => !ids.has(id));
    for (const id of dropped) this.drop(id);
    return dropped;
  }

  reset() {
    this.stages.clear();
    this.recency = [];
  }
}
