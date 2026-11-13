// WTFScore DEL-0 - spatial navigation graph (arrow keys / D-pad).
// Built from card rectangles. The app builds it from the same layout output it
// applies to the DOM, so the tested graph is the graph the keyboard uses.

export const DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);
const EPS = 0.5;
const ORTHO_WEIGHT = 4;

function rangeGap(a0, a1, b0, b1) {
  return Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));
}

function candidateScore(a, b, dir) {
  let primary;
  let ortho;
  let align;
  switch (dir) {
    case 'right':
      if (b.x < a.x + a.w - EPS) return null;
      primary = b.x - (a.x + a.w);
      ortho = rangeGap(a.y, a.y + a.h, b.y, b.y + b.h);
      align = Math.abs(b.y - a.y);
      break;
    case 'left':
      if (b.x + b.w > a.x + EPS) return null;
      primary = a.x - (b.x + b.w);
      ortho = rangeGap(a.y, a.y + a.h, b.y, b.y + b.h);
      align = Math.abs(b.y - a.y);
      break;
    case 'down':
      if (b.y < a.y + a.h - EPS) return null;
      primary = b.y - (a.y + a.h);
      ortho = rangeGap(a.x, a.x + a.w, b.x, b.x + b.w);
      align = Math.abs(b.x - a.x);
      break;
    case 'up':
      if (b.y + b.h > a.y + EPS) return null;
      primary = a.y - (b.y + b.h);
      ortho = rangeGap(a.x, a.x + a.w, b.x, b.x + b.w);
      align = Math.abs(b.x - a.x);
      break;
    default:
      return null;
  }
  return Math.max(0, primary) + ORTHO_WEIGHT * ortho + align * 0.001;
}

// rects: [{ id, x, y, w, h, sortedIndex }] -> Map id -> { up, down, left, right }
export function buildNavGraph(rects) {
  const graph = new Map();
  for (const a of rects) {
    const edges = {};
    for (const dir of DIRECTIONS) {
      let best = null;
      let bestScore = Infinity;
      for (const b of rects) {
        if (b.id === a.id) continue;
        const s = candidateScore(a, b, dir);
        if (s === null) continue;
        if (s < bestScore - 1e-9 || (Math.abs(s - bestScore) <= 1e-9 && best && b.sortedIndex < best.sortedIndex)) {
          best = b;
          bestScore = s;
        }
      }
      edges[dir] = best ? best.id : null;
    }
    graph.set(a.id, edges);
  }
  return graph;
}

export function reachableFrom(graph, startId) {
  const seen = new Set();
  if (!graph.has(startId)) return seen;
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const edges = graph.get(id) || {};
    for (const dir of DIRECTIONS) {
      const next = edges[dir];
      if (next && !seen.has(next)) stack.push(next);
    }
  }
  return seen;
}

// Reachability summary: from the first card, and from every card.
export function reachability(graph, firstId) {
  const ids = [...graph.keys()];
  const fromFirst = reachableFrom(graph, firstId);
  const unreachable = ids.filter((id) => !fromFirst.has(id));
  let stronglyConnected = unreachable.length === 0;
  if (stronglyConnected) {
    for (const id of ids) {
      if (reachableFrom(graph, id).size !== ids.length) {
        stronglyConnected = false;
        break;
      }
    }
  }
  return { total: ids.length, reachableFromFirst: fromFirst.size, unreachable, stronglyConnected };
}
