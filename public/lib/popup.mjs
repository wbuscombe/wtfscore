// WTFScore - the TV game details: a floating window over the dimmed board.
// The score stays fixed in the top third; the lower part steps through
// Situation, Leaders and Team stats with Left and Right. Select, Enter and
// Space do nothing inside; Back, Escape or a click on the dimmed board closes
// it and puts focus back on the same game. Up and Down only scroll the lower
// part. Built with createElement and textContent only; the board decides when
// it opens and where focus goes when it closes.
// The window's frame shows the same football cue as the game's card (a
// priority colour, or a touchdown's green frame). It has no favorite control.

import { buildScorecard, buildSituationPanel, buildLeaders, buildTeamStats, matchup, frameCue } from './render.mjs';
import { dims, TEXT_FLOOR_PX, TOTALS_FLOOR_PX } from './sizing.mjs';

export const PRESENTATIONS = Object.freeze([
  Object.freeze({ value: 'auto', label: 'Auto' }),
  Object.freeze({ value: 'tv', label: 'TV' }),
  Object.freeze({ value: 'phone', label: 'Phone' }),
]);
export const TV_MIN_HEIGHT = 460; // CSS px
export const validPresentation = (v) => (PRESENTATIONS.some((p) => p.value === v) ? v : 'auto');

// Auto: TV when the window is wider than tall AND at least 460 CSS px tall;
// Phone otherwise. An explicit choice wins.
export function presentationFor(choice, viewport) {
  if (choice === 'tv' || choice === 'phone') return choice;
  const w = Math.floor(Number(viewport && viewport.w) || 0);
  const h = Math.floor(Number(viewport && viewport.h) || 0);
  return w > h && h >= TV_MIN_HEIGHT ? 'tv' : 'phone';
}

export const PANELS = Object.freeze([
  Object.freeze({ key: 'situation', label: 'Situation' }),
  Object.freeze({ key: 'leaders', label: 'Leaders' }),
  Object.freeze({ key: 'teamstats', label: 'Team stats' }),
]);
const BUILD = { situation: buildSituationPanel, leaders: buildLeaders, teamstats: buildTeamStats };
const BACK_KEYS = new Set(['Escape', 'Esc', 'GoBack', 'BrowserBack']);
const SELECT_KEYS = new Set(['Enter', ' ', 'Spacebar', 'Select']);
export const HINT = 'Back to close · Left or Right for more';

// Model geometry (CSS px) mirroring styles.css: the window sits 5% in from
// every edge (.pop); the score part (.pop-score) is at least a third of it and
// grows to fit its status line, linescore head and two team rows (.srow,
// .lhead, .trow, gaps of 4 base px) at the chosen text size; the lower part
// gets the rest after the hint line. Model numbers only, not browser pixels.
export function popupLayout(viewport, scale) {
  const d = dims(scale);
  const f = d.f;
  const x = viewport.w * 0.05;
  const y = viewport.h * 0.05;
  const w = viewport.w - 2 * x;
  const h = viewport.h - 2 * y;
  const pad = 12 * f;
  const score = { status: 18 * f, head: 14 * f, row: 36 * f, gap: 4 * f };
  const scoreNeed = 2 * pad + 1 + score.status + score.head + 2 * score.row + 3 * score.gap;
  const third = h / 3;
  const scoreH = Math.max(third, scoreNeed);
  const hint = 16 * f + 2 * 6 * f;
  const nav = 44;
  const lower = h - scoreH - hint;
  return {
    f, x, y, w, h, third, scoreNeed, scoreH, lower, nav, hint,
    lowerBody: lower - nav,
    minText: Math.min(d.minText, 13 * f),
    totalText: d.totalText,
    textOk: d.minText >= TEXT_FLOOR_PX,
    totalsOk: d.totalText >= TOTALS_FLOOR_PX,
  };
}

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

// onClose(how, gameId) runs after the window is hidden; the board puts focus back.
export function createPopup({ doc, root, onClose }) {
  let ui = null;
  let open = false;
  let game = null;
  let teams = null;
  let panel = 0;
  let held = null; // an activation key held down inside: its synthetic click must not act
  let opener = null; // the key press that opened the window keeps bubbling to the document: not ours
  const stats = { opens: 0, closes: 0, panelChanges: 0, ignoredKeys: 0, ignoredClicks: 0, scrolls: 0 };

  function build() {
    const scrim = el(doc, 'div', 'pop-scrim');
    scrim.id = 'details-scrim';
    scrim.hidden = true;
    const box = el(doc, 'section', 'pop');
    box.id = 'details';
    box.hidden = true;
    box.tabIndex = -1;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-describedby', 'details-hint');
    const score = el(doc, 'div', 'pop-score');
    const lower = el(doc, 'div', 'pop-lower');
    const nav = el(doc, 'div', 'pop-nav');
    const prev = el(doc, 'button', 'pop-arrow', '◀');
    prev.type = 'button';
    prev.tabIndex = -1;
    prev.setAttribute('data-step', '-1');
    const title = el(doc, 'h2', 'pop-title');
    title.id = 'details-panel';
    const next = el(doc, 'button', 'pop-arrow', '▶');
    next.type = 'button';
    next.tabIndex = -1;
    next.setAttribute('data-step', '1');
    nav.appendChild(prev);
    nav.appendChild(title);
    nav.appendChild(next);
    const body = el(doc, 'div', 'pop-body');
    body.setAttribute('role', 'region');
    body.setAttribute('aria-labelledby', 'details-panel');
    body.scrollTop = 0;
    lower.appendChild(nav);
    lower.appendChild(body);
    const hint = el(doc, 'p', 'pop-hint', HINT);
    hint.id = 'details-hint';
    const live = el(doc, 'div', 'sr-only');
    live.setAttribute('aria-live', 'polite');
    box.appendChild(score);
    box.appendChild(lower);
    box.appendChild(hint);
    box.appendChild(live);
    root.appendChild(scrim);
    root.appendChild(box);
    scrim.addEventListener('click', () => close('outside click'));
    box.addEventListener('click', onClick);
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('keyup', onKeyUp);
    ui = { scrim, box, score, body, title, prev, next, hint, live };
  }

  function fill(i) {
    panel = (i + PANELS.length) % PANELS.length;
    const p = PANELS[panel];
    for (const c of [...ui.body.childNodes]) ui.body.removeChild(c);
    ui.body.appendChild(BUILD[p.key](doc, game, teams));
    ui.body.setAttribute('data-panel', p.key);
    ui.body.scrollTop = 0;
    ui.title.textContent = `${p.label} · ${panel + 1} of ${PANELS.length}`;
    const before = PANELS[(panel + PANELS.length - 1) % PANELS.length].label;
    const after = PANELS[(panel + 1) % PANELS.length].label;
    ui.prev.setAttribute('aria-label', `Previous: ${before}`);
    ui.next.setAttribute('aria-label', `Next: ${after}`);
  }

  function show({ game: g, teams: t, zone, badges, f, event = null }) {
    if (!ui) build();
    opener = event;
    game = g;
    teams = t;
    for (const c of [...ui.score.childNodes]) ui.score.removeChild(c);
    ui.score.appendChild(buildScorecard(doc, g, t, { zone, badges }));
    ui.box.setAttribute('aria-label', `Game details, ${matchup(g, t)}`);
    ui.box.setAttribute('data-id', g.id);
    const fc = frameCue(g);
    ui.box.className = fc ? `pop ${fc.cls}` : 'pop';
    if (fc) ui.box.setAttribute('data-cue', fc.key);
    else ui.box.removeAttribute('data-cue');
    ui.box.style.setProperty('--f', String(f));
    held = null;
    fill(0); // Situation first on every opening
    ui.scrim.hidden = false;
    ui.box.hidden = false;
    open = true;
    stats.opens++;
    ui.live.textContent = `${PANELS[0].label}, 1 of ${PANELS.length}`;
    ui.box.focus({ preventScroll: true });
  }

  function close(how) {
    if (!open) return false;
    open = false;
    held = null;
    ui.box.hidden = true;
    ui.scrim.hidden = true;
    stats.closes++;
    const id = game ? game.id : null;
    onClose(how, id);
    return true;
  }

  function step(dir) {
    if (!open) return;
    fill(panel + dir);
    stats.panelChanges++;
    ui.live.textContent = `${PANELS[panel].label}, ${panel + 1} of ${PANELS.length}`;
    if (doc.activeElement !== ui.box) ui.box.focus({ preventScroll: true });
  }

  function scroll(dir) {
    const lineStep = 40;
    ui.body.scrollTop = Math.max(0, Number(ui.body.scrollTop || 0) + dir * lineStep);
    stats.scrolls++;
  }

  function onKey(e) {
    if (!open) return;
    if (e === opener) {
      opener = null;
      return;
    }
    const k = e.key;
    if (BACK_KEYS.has(k)) {
      e.preventDefault();
      if (!e.repeat) close(k);
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      if (!e.repeat) step(k === 'ArrowLeft' ? -1 : 1);
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault(); // scroll the lower part only: never close, never change panels, never move the board
      scroll(k === 'ArrowUp' ? -1 : 1);
    } else if (SELECT_KEYS.has(k)) {
      e.preventDefault(); // Select does nothing here, even on an arrow
      held = k;
      stats.ignoredKeys++;
    } else if (k === 'Tab') {
      e.preventDefault(); // focus stays in the window
      if (doc.activeElement !== ui.box) ui.box.focus({ preventScroll: true });
    }
  }

  function onKeyUp(e) {
    if (!open) return;
    if (SELECT_KEYS.has(e.key)) {
      e.preventDefault();
      if (held === e.key) held = null;
    }
  }

  function onClick(e) {
    if (!open) return;
    const t = e.target;
    const arrow = t && typeof t.closest === 'function' ? t.closest('.pop-arrow') : null;
    if (arrow) {
      // A keyboard or remote Select turns into a click with no pointer
      // (detail 0) or arrives while the key is still down: ignore it.
      if (held || e.detail === 0) {
        e.preventDefault();
        stats.ignoredClicks++;
        return;
      }
      step(Number(arrow.getAttribute('data-step')) < 0 ? -1 : 1);
      return;
    }
    if (doc.activeElement !== ui.box) ui.box.focus({ preventScroll: true });
  }

  return {
    show,
    close,
    step,
    stats,
    get open() {
      return open;
    },
    get panel() {
      return PANELS[panel].key;
    },
    get gameId() {
      return open && game ? game.id : null;
    },
    get ui() {
      return ui;
    },
  };
}
