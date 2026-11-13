// WTFScore - developer-only diagnostics.
// The page creates this readout only when its address carries devdiag=1; no
// link leads there. It reports counts and timings taken inside the same
// handlers ordinary use runs, plus a few browser measurements, as plain text
// that accessibility tools can read. In normal use none of it is created and
// none of it runs.

import { buildDiagnostics } from './chrome.mjs';

export const DEV_PARAM = 'devdiag';
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const fmt = (v) => (v === null || v === undefined ? 'n/a' : String(v));

export function developerMode(search) {
  try {
    return new URLSearchParams(String(search || '')).get(DEV_PARAM) === '1';
  } catch {
    return false;
  }
}

export function countOverlaps(rects, eps = 1) {
  let n = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps) n++;
    }
  }
  return n;
}

function hiddenWithin(el, stop) {
  for (let e = el; e && e !== stop; e = e.parentElement) if (e.hidden) return true;
  return false;
}

// Browser only: actual rectangles and computed styles in the live page.
export function measureDom({ win, doc, cards, board }) {
  const rects = [];
  let visibleNow = 0;
  let minTotal = Infinity;
  const vh = win.innerHeight;
  for (const [id, ref] of cards) {
    for (const s of [ref.sections[1], ref.sections[2], ref.sections[3]]) {
      if (s.hidden) continue;
      const r = s.getBoundingClientRect();
      rects.push({ id, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    const c = ref.sections[1].getBoundingClientRect();
    if (c.top >= -0.5 && c.bottom <= vh + 0.5) visibleNow++;
    for (const t of ref.sections[1].querySelectorAll('.trow .tot')) minTotal = Math.min(minTotal, parseFloat(win.getComputedStyle(t).fontSize));
  }
  let minText = Infinity;
  const seen = new Set();
  const walker = doc.createTreeWalker(board, 4 /* text nodes */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || hiddenWithin(el, board)) continue;
    seen.add(el);
    minText = Math.min(minText, parseFloat(win.getComputedStyle(el).fontSize));
  }
  const de = doc.documentElement;
  return {
    overlaps: countOverlaps(rects),
    pageOverflowX: Math.max(0, de.scrollWidth - de.clientWidth),
    minTextPx: Number.isFinite(minText) ? r1(minText) : null,
    minTotalPx: Number.isFinite(minTotal) ? r1(minTotal) : null,
    visibleNow,
    viewport: `${win.innerWidth}x${win.innerHeight}`,
    scrollY: Math.round(Number(win.scrollY) || 0),
  };
}

export function createDiagnostics({ win, doc }) {
  const ui = buildDiagnostics(doc);
  const perf = win.performance;
  let last = null;
  const set = (key, text) => {
    const li = ui.lines.get(key);
    if (li) li.textContent = text;
  };
  set('mode', 'Developer diagnostics (devdiag=1). Not part of the scoreboard.');

  function begin(e, source, target) {
    const start = perf.now();
    let eventTs = e && Number.isFinite(e.timeStamp) && e.timeStamp > 0 ? e.timeStamp : null;
    if (eventTs !== null && (eventTs > start + 1 || eventTs < start - 60000)) eventTs = null; // not on the page clock
    if (typeof perf.mark === 'function') perf.mark('wtfscore-input');
    return { source, target, eventTs, start, state: null, dom: null, paint: null, summary: '' };
  }
  const stateDone = (tok) => {
    if (tok) tok.state = perf.now();
  };
  const domDone = (tok) => {
    if (tok) tok.dom = perf.now();
  };
  // Next paint is estimated as a timeout queued from the next animation frame.
  function end(tok, summary, refresh) {
    if (!tok) return;
    tok.summary = summary;
    if (tok.dom === null) tok.dom = perf.now();
    win.requestAnimationFrame(() => {
      win.setTimeout(() => {
        tok.paint = perf.now();
        if (typeof perf.mark === 'function' && typeof perf.measure === 'function') {
          perf.mark('wtfscore-painted');
          try {
            perf.measure('wtfscore-input-to-paint', 'wtfscore-input', 'wtfscore-painted');
          } catch {
            // marks were cleared by the page owner; the readout still has the numbers
          }
        }
        last = tok;
        refresh();
      }, 0);
    });
  }

  function render(s) {
    const st = s.stats;
    set('counts', `activations ${st.activations} (pointer ${st.pointer}, button ${st.button}, key ${st.key}) · state changes ${st.transitions} · no change ${st.noChange} · layout passes ${st.applies} · arrow moves ${st.arrowMoves}`);
    set('settings', `settings opened ${st.settingsOpened} · closed ${st.settingsClosed} · changes ${st.settingsChanges} · text size ${s.settings.textSize} · games open at once ${s.settings.openLimit} · order ${s.settings.order}`);
    if (last) {
      const ms = (a, b) => (a === null || b === null ? null : r1(b - a));
      const from = last.eventTs ?? last.start;
      set('last', `last input: ${last.source} · ${last.summary}`);
      set('timing', `input delay ${fmt(ms(last.eventTs, last.start))} ms · handler ${fmt(ms(last.start, last.dom))} ms (state ${fmt(ms(last.start, last.state))} ms) · input to next paint ${fmt(ms(from, last.paint))} ms${last.eventTs === null ? ' (from handler start)' : ''}`);
    } else {
      set('last', 'last input: none yet');
      set('timing', 'timing: no input yet');
    }
    set('focus', `focused game ${s.focusedId ?? 'none'} · active element ${s.active}`);
    const L = s.layout;
    set('layout', L ? `layout ${L.viewport.w}x${L.viewport.h} CSS px · ${L.frame.cols} columns · scale ${L.scale} (smallest text ${L.dims.minText} px, totals ${L.dims.totalText} px)` : 'layout: none');
    const m = s.measure;
    set('visible', m ? `compact games fully visible now ${m.visibleNow}/${s.total} at ${m.viewport} (scrollY ${m.scrollY})` : 'visible: not measured (no browser layout)');
    set('bounds', m ? `overlaps ${m.overlaps} · page horizontal overflow ${m.pageOverflowX} px · smallest text ${fmt(m.minTextPx)} px · smallest total ${fmt(m.minTotalPx)} px` : 'bounds: not measured (no browser layout)');
    set('model', `model 1920x1080 at this text size: ${s.model1920.visible}/${s.total} fully visible (${s.model1920.cols} columns; ${s.model1920.safeArea} inside the 5% safe area)`);
  }

  return { root: ui.root, begin, stateDone, domDone, end, render, lastTiming: () => last };
}
