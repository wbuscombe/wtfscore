// WTFScore - scoreboard controller for the SIMULATED seven-league demo.
// One league board at a time. Each game has one card element, built when its
// game first appears on the board and kept while it stays there: an input
// changes state, then the same elements get new CSS geometry. A change of
// league, season, period or screen replaces the board's cards (their ids are
// namespaced by league and season) and closes every open game; a filter or
// time zone change keeps the cards and open games that remain. The normal
// input path computes no comparison, summary or table, schedules no timer,
// writes no URL and stores nothing. Developer diagnostics exist only when the
// page address carries devdiag=1; they are created at mount in that case and
// called only from guarded branches.
//
// Presentation: Phone opens a game in place on the board (one full row, as
// before). TV opens the game's details in a floating window over the dimmed
// board instead (popup.mjs). Auto picks TV when the window is wider than tall
// and at least 460 CSS px tall. Each Demo screen keeps its own choice in
// memory only; a reload starts on Auto. Daily leagues are anchored to the
// device clock, so their current slate is today (catalog.mjs).
//
// Daily leagues: the Period dropdown holds one Regular season choice and the
// named postseason or tournament rounds, never a list of dates. In the regular
// season the one Date control (a button styled like the dropdowns) shows the
// chosen date and opens the calendar; a round hides it. Each screen keeps its
// last regular-season date per league and season, so choosing Regular season
// again returns to it; a fresh daily view starts on today.
//
// Football (NFL and NCAAF): each Demo screen keeps its own favorites in
// memory (favorites.mjs); a reload clears them. Favorite teams are chosen in
// the Menu; each football card has a star that includes or excludes that one
// game. The football board always shows favorite games first, then the others
// in progress, upcoming and final; its Order choice is hidden. On a card,
// Right reaches the card's own star; from the star, Left returns to the card
// and Right, Up and Down move as they would from the card; every other move
// lands on cards. A star never opens a game, and a reorder keeps focus on the
// same card or star, scrolling only enough to keep it in view.

import { buildCatalog, DEFAULT_ZONE, ZONES, validZone, zoneLabel, ALL_CONTROL_KEYS, localDateKey, dateKeyLabel, SPORT_GROUPS, sportOfLeague } from './catalog.mjs';
import { sortGames, sortFootball, ExpansionState, clampCap, notExpandableReason, isExpandable } from './model.mjs';
import { computeBoardLayout, fullyVisibleScores } from './board-layout.mjs';
import { buildNavGraph } from './nav.mjs';
import { buildCard, setCardStage, retimeCard, setCardBadges, setCardFavorite, matchup, formatKickoff } from './render.mjs';
import { buildHeader, TEXT_SIZES, ORDERS, OPEN_LIMITS, BADGE_CHOICES } from './chrome.mjs';
import { buildMenu, setOptions, sanitizeScreenName } from './menu.mjs';
import { developerMode, createDiagnostics, measureDom } from './diag.mjs';
import { createPopup, presentationFor, validPresentation, PRESENTATIONS } from './popup.mjs';
import { renderCalendar, moveKey, partsOf, dayWords } from './calendar.mjs';
import { Favorites, supportsFavorites } from './favorites.mjs';

export const DEFAULT_SETTINGS = Object.freeze({ textSize: 'standard', openLimit: 3, order: 'kickoff', zone: DEFAULT_ZONE, badges: 'off' });
export const SCREEN_COUNT = 2;
export const defaultScreenName = (i) => `Demo screen ${i + 1}`;
const ARROWS = Object.freeze({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' });
const BACK_KEYS = new Set(['Escape', 'Esc', 'GoBack', 'BrowserBack']);
const r2 = (v) => Math.round(v * 100) / 100;
// The one Regular season choice in a daily league's Period dropdown. The view's
// period stays the chosen calendar date (an internal date id), never this value.
export const REGULAR_CHOICE = 'regular';

export function scaleFor(textSize) {
  const t = TEXT_SIZES.find((x) => x.value === textSize) || TEXT_SIZES[0];
  return t.scale;
}

const labelOf = (list, value) => (list.find((x) => x.value === value) || { label: value }).label;
export const countText = (n) => (n === 0 ? 'No games' : n === 1 ? '1 game' : `${n} games`);

// The device clock that anchors daily schedules; a test window may have none.
function readClock(win) {
  return win && win.Date && typeof win.Date.now === 'function' ? win.Date.now() : null;
}

export function mountBoard({ win, doc, root, week = null, now = readClock(win), presentation = 'auto', catalog = buildCatalog({ nflWeek: week, now }), search = win && win.location ? win.location.search : '' }) {
  const dev = developerMode(search);
  const screens = Array.from({ length: SCREEN_COUNT }, (_, i) => ({ index: i, name: defaultScreenName(i), view: catalog.defaultView(DEFAULT_ZONE), settings: { ...DEFAULT_SETTINGS }, presentation: validPresentation(presentation), favorites: new Favorites() }));
  let screen = screens[0];
  let current = null;
  let teams = {};
  let gameById = new Map();
  let expansion = new ExpansionState({ games: [], cap: DEFAULT_SETTINGS.openLimit });
  const cards = new Map();
  const stats = {
    activations: 0,
    pointer: 0,
    button: 0,
    key: 0,
    transitions: 0,
    noChange: 0,
    applies: 0,
    arrowMoves: 0,
    settingsOpened: 0,
    settingsClosed: 0,
    settingsChanges: 0,
    boardRebuilds: 0,
    cardsBuilt: 0,
    details: 0,
    detailsClosed: 0,
    modeChanges: 0,
    calendarOpens: 0,
    favoriteToggles: 0,
    teamFavoriteChanges: 0,
  };
  const lastStyle = new WeakMap();
  let order = [];
  let layout = null;
  let nav = null;
  let focusedId = null;
  let menuOpen = false;
  let returnFocus = null;
  let resizeQueued = false;
  let viewport = readViewport();
  let mode = modeNow();
  let calOpen = false;
  let cal = { month: null, focus: null };
  // Per screen: the last regular-season date shown, with its league and season.
  const regularDates = new Map();
  const zone = () => screen.settings.zone;
  const badgesOn = () => screen.settings.badges === 'on';
  const footballBoard = () => Boolean(current) && supportsFavorites(current.view.league);
  const favoriteOf = (g) => (supportsFavorites(g.league) ? screen.favorites.isFavorite(g) : null);

  // ---------- elements ----------
  const board = doc.createElement('main');
  board.className = 'board';
  board.id = 'board';
  board.setAttribute('aria-label', 'Scores');
  const header = buildHeader(doc, { title: '', simulatedNote: '' });
  board.appendChild(header.root);
  const empty = doc.createElement('div');
  empty.className = 'empty';
  empty.id = 'empty';
  empty.hidden = true;
  const emptyText = doc.createElement('p');
  emptyText.className = 'empty-text';
  const emptyClear = doc.createElement('button');
  emptyClear.className = 'mbtn empty-clear';
  emptyClear.type = 'button';
  emptyClear.tabIndex = 0;
  emptyClear.textContent = 'Clear filters';
  const emptyToday = doc.createElement('button');
  emptyToday.className = 'mbtn empty-today';
  emptyToday.type = 'button';
  emptyToday.tabIndex = 0;
  emptyToday.hidden = true;
  empty.appendChild(emptyText);
  empty.appendChild(emptyClear);
  empty.appendChild(emptyToday);
  board.appendChild(empty);
  const menu = buildMenu(doc);
  const sel = (key) => menu.selects.get(key);
  const live = doc.createElement('div');
  live.className = 'sr-only';
  live.id = 'live';
  live.setAttribute('aria-live', 'polite');
  root.appendChild(board);
  root.appendChild(menu.scrim);
  root.appendChild(menu.sheet);
  root.appendChild(live);
  const diag = dev ? createDiagnostics({ win, doc }) : null;
  if (diag) root.appendChild(diag.root);
  const popup = createPopup({ doc, root, onClose: detailsClosed });

  // ---------- geometry ----------
  function readViewport() {
    const de = doc.documentElement;
    const w = Math.floor((de && de.clientWidth) || win.innerWidth || 1024);
    const h = Math.floor(win.innerHeight || 768);
    return { w: Math.max(240, w), h: Math.max(240, h) };
  }

  // The window size the presentation rule reads (CSS px, scrollbar included).
  function windowSize() {
    const de = doc.documentElement;
    return { w: Math.floor(win.innerWidth || (de && de.clientWidth) || 0), h: Math.floor(win.innerHeight || 0) };
  }

  function modeNow() {
    return presentationFor(screen.presentation, windowSize());
  }

  const currentScale = () => scaleFor(screen.settings.textSize);

  function setStyle(el, prop, value) {
    let m = lastStyle.get(el);
    if (!m) {
      m = new Map();
      lastStyle.set(el, m);
    }
    if (m.get(prop) === value) return;
    m.set(prop, value);
    el.style.setProperty(prop, value);
  }

  function place(el, r) {
    setStyle(el, 'transform', `translate(${r2(r.x)}px, ${r2(r.y)}px)`);
    setStyle(el, 'width', `${r2(r.w)}px`);
    setStyle(el, 'height', `${r2(r.h)}px`);
  }

  // One card, one border: the score, situation and leaders parts are placed
  // inside the card's own box, side by side or stacked.
  function applyCard(p) {
    const ref = cards.get(p.id);
    place(ref.root, p);
    if (ref.stage !== p.stage) {
      setCardStage(ref, gameById.get(p.id), teams, zone(), p.stage, mode);
      ref.stage = p.stage;
    }
    if (ref.root.getAttribute('data-arrangement') !== p.arrangement) ref.root.setAttribute('data-arrangement', p.arrangement);
    for (const s of p.parts) place(ref.sections[s.stage], s);
  }

  function apply() {
    stats.applies++;
    const items = order.map((g) => ({ id: g.id, stage: expansion.stageOf(g.id) }));
    layout = computeBoardLayout({ items, viewport, scale: currentScale() });
    setStyle(board, '--f', String(layout.dims.f));
    place(header.root, layout.frame.header);
    setStyle(header.root, 'height', 'auto');
    let headerHeight;
    if (header.root.getBoundingClientRect) headerHeight = Math.ceil(header.root.getBoundingClientRect().height);
    else {
      // Geometry model fallback: the browser always measures its own pixels.
      const gap = 12 * layout.dims.f;
      const widths = [...header.pickers.values()].filter(p => !p.row.hidden).map(p => Math.max(44, p.button.textContent.length * 9.6 + 22)).concat(86, 62);
      let rows = 1, used = 0;
      for (const w of widths) { if (used && used + gap + w > layout.frame.contentW) { rows++; used = 0; } used += (used ? gap : 0) + w; }
      headerHeight = rows * 44 + (rows - 1) * gap;
    }
    layout = computeBoardLayout({ items, viewport, scale: currentScale(), headerHeight: Math.max(44, headerHeight) });
    nav = null;
    const g = layout.frame;
    setStyle(board, '--f', String(layout.dims.f));
    let h = layout.totalHeight;
    if (!order.length) {
      place(empty, { x: g.insetX, y: g.gridTop, w: g.contentW, h: layout.dims.h[1] });
      h = g.gridTop + layout.dims.h[1] + g.insetY;
    }
    setStyle(board, 'height', `${r2(h)}px`);
    place(header.root, g.header);
    header.layout();
    for (const p of layout.placements) applyCard(p);
  }

  // ---------- the board's games ----------
  function makeCard(g) {
    const ref = buildCard(doc, g, teams, { zone: zone(), badges: badgesOn(), mode, favorite: favoriteOf(g) });
    ref.stage = 1;
    stats.cardsBuilt++;
    return ref;
  }

  // 'rebuild': a new league, season, period or screen: new cards, nothing open.
  // 'keep': a filter or time zone change: cards and open games that remain stay.
  function refresh(kind) {
    const r = catalog.resolve(screen.view, zone());
    screen.view = r.view;
    current = r;
    if (r.daily && r.period.kind === 'date') regularDates.set(screen.index, { league: r.view.league, season: r.view.season, period: r.view.period });
    teams = r.teams;
    gameById = new Map(r.games.map((g) => [g.id, g]));
    if (kind === 'rebuild') {
      stats.boardRebuilds++;
      for (const ref of cards.values()) board.removeChild(ref.root);
      cards.clear();
      expansion = new ExpansionState({ games: r.games, cap: screen.settings.openLimit });
    } else {
      for (const [id, ref] of [...cards]) {
        if (gameById.has(id)) continue;
        board.removeChild(ref.root);
        cards.delete(id);
      }
      expansion.retain(r.games);
      for (const [id, ref] of cards) retimeCard(ref, gameById.get(id), teams, zone(), expansion.stageOf(id), mode);
    }
    for (const g of r.games) if (!cards.has(g.id)) cards.set(g.id, makeCard(g));
    order = sortedGames(r.games);
    placeCards();
    if (focusedId && !cards.has(focusedId)) focusedId = null;
    updateChrome();
    apply();
  }

  // Football: the fixed favorites-first order. Other sports: the Order choice.
  function sortedGames(games) {
    if (footballBoard()) return sortFootball(games, (g) => screen.favorites.isFavorite(g));
    return sortGames(games, screen.settings.order);
  }

  // Same elements, new document order. Moving a focused element out of and
  // back into the document drops its focus in a browser, so the element that
  // had focus (a card or its star) gets it back, without scrolling.
  function placeCards() {
    const a = doc.activeElement;
    const had = a && a !== board && board.contains(a) ? a : null;
    for (const g of order) board.appendChild(cards.get(g.id).root);
    if (had && had.isConnected && board.contains(had) && doc.activeElement !== had) had.focus({ preventScroll: true });
  }

  // Every football card shows its game's current favorite state; the board
  // re-sorts. Focus stays on the same element; an open details window stays open.
  function syncFavorites() {
    for (const [id, ref] of cards) {
      if (!ref.fav) continue;
      const g = gameById.get(id);
      const on = screen.favorites.isFavorite(g);
      if (on !== ref.favorite) setCardFavorite(ref, g, teams, on, zone(), expansion.stageOf(id), mode);
    }
    if (!footballBoard()) return;
    order = sortedGames(current.games);
    placeCards();
    apply();
  }

  // One star use on one game. Returns { on, override } or null.
  function toggleFavorite(id, source = 'pointer', e = null) {
    const g = gameById.get(id);
    const ref = cards.get(id);
    if (!g || !ref || !ref.fav) return null;
    const tok = diag ? diag.begin(e, source, id) : null;
    const res = screen.favorites.toggleGame(g);
    stats.favoriteToggles++;
    syncFavorites();
    if (!popup.open && !menuOpen) {
      focusedId = id;
      if (doc.activeElement !== ref.fav) ref.fav.focus({ preventScroll: true });
      reveal(id, 'cell');
    }
    const how = res.override === null ? (res.on ? ', from a favorite team' : '') : res.on ? ', this game only' : ', excluded';
    say(`${matchup(g, teams)}: ${res.on ? 'favorite game' : 'not a favorite game'}${how}`);
    finish(tok, `${id} favorite ${res.on}`);
    return res;
  }

  // A team's favorite state on this screen's football league.
  function setTeamFavorite(abbr, on) {
    if (!footballBoard() || !teams[abbr]) return false;
    if (!screen.favorites.setTeam(current.view.league, abbr, on)) return false;
    stats.teamFavoriteChanges++;
    syncFavorites();
    if (menuOpen) syncMenu();
    return true;
  }

  function simMoment() {
    const k = formatKickoff(current.simNow, zone());
    return `${dateKeyLabel(localDateKey(current.simNow, zone()))}, ${k.time} ${zoneLabel(zone())}`;
  }

  function selectionWords() {
    return [current.league.short, current.season.label, current.period.label, ...current.active].join(' · ');
  }

  function updateChrome() {
    header.title.textContent = [current.league.short, current.period.label, ...current.active].join(' · ');
    header.sim.title = `${current.league.name}: invented teams, players, schedules, groups and ranks at a fixed simulated time (${simMoment()}). Not live data.`;
    doc.title = `${screen.name} · WTFScore · SIMULATED`;
    empty.hidden = current.games.length > 0;
    const p = current.period;
    emptyText.textContent = current.filtersActive ? `No games match these filters (${selectionWords()}).` : p.kind === 'date' ? `No games on ${dayWords(p.dateKey)}.` : `No games in ${p.label}.`;
    emptyClear.hidden = !current.filtersActive;
    // Today only where it can help: a daily league that is not already on today.
    const onToday = p.kind === 'date' && p.dateKey === current.today && current.season.current;
    emptyToday.hidden = !current.daily || onToday;
    emptyToday.textContent = emptyToday.hidden ? '' : 'Today';
    syncMenu();
  }

  function syncMenu() {
    const r = current;
    const s = screen.settings;
    syncHeader();
    syncFavoriteTeams();
    setOptions(doc, sel('textSize'), [{ label: null, options: TEXT_SIZES.map((t) => ({ value: t.value, label: t.label })) }], s.textSize);
    // Football's order is fixed (favorites, in progress, upcoming, final): no Order choice there.
    setOptions(doc, sel('order'), [{ label: null, options: ORDERS.map((o) => ({ value: o.value, label: o.label })) }], s.order);
    menu.rows.get('order').hidden = footballBoard();
    setOptions(doc, sel('openLimit'), [{ label: null, options: OPEN_LIMITS.map((n) => ({ value: String(n), label: String(n) })) }], String(s.openLimit));
    setOptions(doc, sel('zone'), [{ label: null, options: ZONES.map((z) => ({ value: z.value, label: z.label })) }], s.zone);
    setOptions(doc, sel('badges'), [{ label: null, options: BADGE_CHOICES.map((b) => ({ value: b.value, label: b.label })) }], s.badges);
    setOptions(doc, sel('presentation'), [{ label: null, options: PRESENTATIONS.map((x) => ({ value: x.value, label: x.label })) }], screen.presentation);
    setOptions(doc, sel('screen'), [{ label: null, options: screens.map((x) => ({ value: String(x.index), label: x.name })) }], String(screen.index));
    if (doc.activeElement !== menu.nameInput) menu.nameInput.value = screen.name;
    menu.context.textContent = `${screen.name} · ${countText(r.games.length)}`;
    menu.summary.textContent = `Showing ${countText(r.games.length).toLowerCase()}: ${selectionWords()}.`;
  }

  // Favorite teams: football only. The options (every team of the league, its
  // state in words) are filled first, then the row is shown. Choosing a team
  // adds or removes it; the dropdown then rests on its prompt again.
  function syncFavoriteTeams() {
    const row = menu.rows.get('favorites');
    if (!footballBoard()) {
      row.hidden = true;
      return;
    }
    const lg = current.view.league;
    const list = Object.values(current.teams).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const n = screen.favorites.teamCount(lg);
    const prompt = { value: 'none', label: `Add or remove a team (${n === 0 ? 'none chosen' : n === 1 ? '1 chosen' : `${n} chosen`})` };
    const opts = list.map((t) => (screen.favorites.isTeam(lg, t.abbr) ? { value: t.abbr, label: `★ ${t.name} (${t.abbr}), favorite` } : { value: t.abbr, label: `${t.name} (${t.abbr})` }));
    setOptions(doc, sel('favorites'), [{ label: null, options: [prompt, ...opts] }], 'none');
    row.hidden = false;
  }

  function syncHeader() {
    const r = current;
    header.setPicker('league', { label: 'League', groups: SPORT_GROUPS.map(sp => ({ label: sp.label, options: sp.leagues.map(id => catalog.leagues.find(l => l.id === id)).map(l => ({ value: l.id, label: l.option })) })), value: r.view.league });
    const seasons = [...r.seasons].sort((a,b) => Number(Boolean(b.current)) - Number(Boolean(a.current)));
    const groups = [];
    if (!r.daily) for (const season of seasons) {
      const periods = catalog.periods(r.view.league, season.id, zone());
      for (const phase of ['regular', 'post']) groups.push({ label: `${season.label} · ${phase === 'regular' ? 'Regular season' : 'Postseason'}`, options: periods.filter(p => p.phase === phase).map(p => ({ value: `${season.id}|${p.id}`, label: p.label })) });
    }
    header.setPicker('period', { label: r.daily ? 'Date or round' : 'Week or round', groups, value: r.daily ? r.view.period : `${r.view.season}|${r.view.period}`, text: r.period.label });
    header.pickers.get('period').button.setAttribute('aria-label', `${r.daily ? 'Date or round' : 'Week or round'}, ${r.period.kind === 'date' ? dayWords(r.period.dateKey) : r.period.label}, ${r.season.label}`);
    header.setDaily(r.daily, seasons, r.periods, r.view.season, r.view.period);
    for (const key of ALL_CONTROL_KEYS) {
      const c = r.controls.find(c => c.key === key);
      header.setPicker(key, { label: c ? c.label : key, groups: c ? [{ label: null, options: c.options }] : [], value: c ? c.value : '', visible: Boolean(c && c.visible) });
    }
    if (calOpen) {
      if (!r.daily) closeCalendar(false);
      else drawCalendar();
    }
  }

  // ---------- focus and feedback ----------
  function say(text) {
    live.textContent = text;
  }

  function focusCard(id) {
    const ref = cards.get(id);
    if (!ref) return;
    focusedId = id;
    if (doc.activeElement !== ref.root) ref.root.focus({ preventScroll: true });
  }

  // Scroll only when the card would otherwise be off screen. A pointer
  // activation never scrolls up, and scrolls down only to show an open card,
  // never past the card's own top.
  function reveal(id, mode) {
    if (!layout || typeof win.scrollBy !== 'function') return;
    const p = layout.placements.find((x) => x.id === id);
    if (!p) return;
    const top = Number(win.scrollY) || 0;
    const bottom = top + viewport.h;
    const m = layout.frame.gap;
    const need = p.y + p.h + m;
    let dy = 0;
    if (mode === 'pointer') {
      if (p.stage === 1) return;
      if (need > bottom) dy = Math.min(need - bottom, Math.max(0, p.y - m - top));
    } else if (p.y - m < top) dy = p.y - m - top;
    else if (need > bottom) dy = Math.min(need - bottom, p.y - m - top);
    if (Math.abs(dy) >= 1) win.scrollBy(0, dy);
  }

  function finish(tok, summary) {
    if (diag) diag.end(tok, summary, refreshDiag);
  }

  function stageWords(res) {
    if (res.to === 1) return 'details closed';
    return res.to === 2 ? 'situation open' : 'leaders open';
  }

  function closedNote(collapsed) {
    if (!collapsed || !collapsed.length) return '';
    return `; closed ${collapsed.map((c) => matchup(gameById.get(c), teams)).join(', ')} (games open at once: ${expansion.cap})`;
  }

  // ---------- the one game-state path ----------
  function changeStage(id, source, e, op) {
    const tok = diag ? diag.begin(e, source, id) : null;
    stats.activations++;
    stats[source]++;
    const g = gameById.get(id);
    const res = op(id);
    if (diag) diag.stateDone(tok);
    if (!res.ok) {
      stats.noChange++;
      focusCard(id);
      say(res.reason === 'not-expandable' ? `${matchup(g, teams)}: no details, ${notExpandableReason(g)}` : `${matchup(g, teams)}: nothing to close`);
      finish(tok, `${id} unchanged`);
      return res;
    }
    stats.transitions++;
    apply();
    if (diag) diag.domDone(tok);
    focusCard(id);
    reveal(id, res.id === id ? (source === 'key' ? 'key' : 'pointer') : 'cell');
    say(`${matchup(gameById.get(res.id), teams)}: ${stageWords(res)}${closedNote(res.collapsed)}`);
    const closed = res.collapsed && res.collapsed.length ? `, closed ${res.collapsed.join(' ')}` : '';
    finish(tok, `${res.id} ${res.from} to ${res.to}${closed}`);
    return res;
  }

  const activate = (id, source = 'pointer', e = null) => changeStage(id, source, e, (x) => expansion.advance(x));
  const collapse = (id, source = 'button', e = null) => changeStage(id, source, e, (x) => expansion.collapse(x));
  const stepBack = (id, source = 'key', e = null) => changeStage(id, source, e, (x) => expansion.escape(x));

  function cardOf(target) {
    const el = target && typeof target.closest === 'function' ? target.closest('.card') : null;
    return el && cards.has(el.getAttribute('data-id')) ? el : null;
  }

  function moveFocus(id, dir) {
    if (!nav) nav = buildNavGraph(layout.placements);
    const edges = nav.get(id);
    const next = edges ? edges[dir] : null;
    if (!next) {
      if (dir === 'up') { const p = layout.placements.find(p => p.id === id); if (p) header.focusNearest(p.x + p.w / 2); }
      return;
    }
    stats.arrowMoves++;
    focusCard(next);
    reveal(next, 'cell');
    if (diag) refreshDiag();
  }

  // ---------- TV details ----------
  function openDetails(id, source = 'pointer', e = null) {
    const g = gameById.get(id);
    stats.activations++;
    stats[source]++;
    if (!isExpandable(g)) {
      stats.noChange++;
      focusCard(id);
      say(`${matchup(g, teams)}: no details, ${notExpandableReason(g)}`);
      return { ok: false, id, reason: 'not-expandable' };
    }
    focusedId = id;
    board.setAttribute('inert', '');
    popup.show({ game: g, teams, zone: zone(), badges: badgesOn(), f: layout ? layout.dims.f : 1, event: e });
    stats.details++;
    say(`${matchup(g, teams)}: details open`);
    return { ok: true, id };
  }

  function detailsClosed(how, id) {
    board.removeAttribute('inert');
    stats.detailsClosed++;
    if (id && cards.has(id)) focusCard(id);
    else header.menuBtn.focus({ preventScroll: true });
    const g = id ? gameById.get(id) : null;
    say(g ? `${matchup(g, teams)}: details closed` : `Details closed (${how})`);
  }

  // A new presentation: whatever is open closes, focus stays on its game, and
  // every card gets the labels of the new way to open it.
  function syncMode(doApply = true) {
    const next = modeNow();
    if (next === mode) return false;
    mode = next;
    stats.modeChanges++;
    if (popup.open) popup.close('layout change');
    expansion.reset();
    for (const [id, ref] of cards) {
      setCardStage(ref, gameById.get(id), teams, zone(), 1, mode);
      ref.stage = 1;
    }
    const a = doc.activeElement;
    const c = cardOf(a);
    if (c && a !== c) focusCard(c.getAttribute('data-id')); // never leave focus inside a part that just closed
    if (doApply) apply();
    if (!menuOpen) say(mode === 'tv' ? 'TV layout: a game opens in a details window' : 'Phone layout: a game opens in place');
    return true;
  }

  board.addEventListener('click', (e) => {
    if (menuOpen || popup.open) return; // the board is inert behind the open Menu or details
    if (header.anyOpen && !header.root.contains(e.target)) { header.closeAll(true); return; }
    if (e.target === emptyClear || (e.target && typeof e.target.closest === 'function' && e.target.closest('.empty-clear'))) {
      if (clearFilters(e)) {
        const first = order[0];
        if (first) focusCard(first.id);
      }
      return;
    }
    if (e.target === emptyToday || (e.target && typeof e.target.closest === 'function' && e.target.closest('.empty-today'))) {
      if (goToday(e)) {
        const first = order[0];
        if (first) focusCard(first.id);
      }
      return;
    }
    const cardEl = cardOf(e.target);
    if (!cardEl) return;
    const id = cardEl.getAttribute('data-id');
    const btn = e.target.closest('button[data-action]');
    if (btn) {
      // The star only changes favorites; it never opens the game.
      const action = btn.getAttribute('data-action');
      if (action === 'favorite') toggleFavorite(id, e.detail === 0 ? 'key' : 'pointer', e);
      else if (action === 'collapse') collapse(id, 'button', e);
      return;
    }
    if (e.target.closest('.sec1') && mode === 'tv') openDetails(id, 'pointer', e);
    else if (e.target.closest('.sec1')) activate(id, 'pointer', e);
    else focusCard(id); // a click inside an open situation or leaders part only focuses the game
  });

  board.addEventListener('keydown', (e) => {
    if (menuOpen || popup.open) return;
    const cardEl = cardOf(e.target);
    if (!cardEl) return;
    const id = cardEl.getAttribute('data-id');
    const ref = cards.get(id);
    const onStar = Boolean(ref.fav) && e.target === ref.fav;
    const dir = ARROWS[e.key];
    if (dir) {
      e.preventDefault();
      if (onStar && dir === 'left') {
        stats.arrowMoves++;
        focusCard(id); // star Left: back to its own card
      } else if (!onStar && dir === 'right' && ref.fav && e.target === cardEl) {
        stats.arrowMoves++;
        ref.fav.focus({ preventScroll: true }); // card Right: its own star
      } else moveFocus(id, dir); // star Right, Up, Down: the card's own move; geometry lands on cards only
      return;
    }
    const isActivate = e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'Select'; // Select: a TV remote's centre button
    if (onStar && isActivate) {
      // Enter and Space: the star's own click follows. Select: no click follows, so act here.
      if (e.key === 'Select') {
        e.preventDefault();
        if (!e.repeat) toggleFavorite(id, 'key', e);
      }
      return;
    }
    if (e.target.tagName === 'BUTTON' && isActivate && e.key !== 'Select') return; // the button's own click follows
    if (isActivate) {
      e.preventDefault();
      if (!e.repeat && mode === 'tv') openDetails(id, 'key', e);
      else if (!e.repeat) activate(id, 'key', e);
    } else if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      if (!e.repeat) stepBack(id, 'key', e);
    }
  });

  board.addEventListener('focusin', (e) => {
    const cardEl = cardOf(e.target);
    if (cardEl) focusedId = cardEl.getAttribute('data-id');
  });

  // ---------- Menu ----------
  function openMenu(e = null) {
    if (menuOpen) return false;
    header.closeAll(true);
    const tok = diag ? diag.begin(e, 'menu', 'open') : null;
    menuOpen = true;
    stats.settingsOpened++;
    const active = doc.activeElement;
    returnFocus = active && active !== header.menuBtn && board.contains(active) ? active : null;
    syncMenu();
    menu.scrim.hidden = false;
    menu.sheet.hidden = false;
    board.setAttribute('inert', '');
    header.menuBtn.setAttribute('aria-expanded', 'true');
    const first = [...menu.selects.keys()].find(key => !menu.rows.get(key).hidden);
    sel(first).focus({ preventScroll: true });
    finish(tok, 'menu opened');
    return true;
  }

  function closeMenu(how = 'close', e = null) {
    if (!menuOpen) return false;
    const tok = diag ? diag.begin(e, 'menu', 'close') : null;
    closeCalendar(false);
    menuOpen = false;
    stats.settingsClosed++;
    menu.sheet.hidden = true;
    menu.scrim.hidden = true;
    board.removeAttribute('inert');
    header.menuBtn.setAttribute('aria-expanded', 'false');
    const target = returnFocus && board.contains(returnFocus) ? returnFocus : header.menuBtn;
    returnFocus = null;
    target.focus({ preventScroll: true });
    finish(tok, `menu closed by ${how}`);
    return true;
  }

  function setOrder(mode) {
    screen.settings.order = mode === 'status' ? 'status' : 'kickoff';
    let pins = null;
    if (screen.settings.order === 'status') {
      // Open games hold their current place; the rest sort around them.
      const index = new Map(order.map((g, i) => [g.id, i]));
      pins = new Map(expansion.expandedIds().map((id) => [id, index.get(id)]));
    }
    order = sortGames(current.games, screen.settings.order, { pins });
    placeCards(); // same elements, new document order
    apply();
  }

  function clearFilters(e = null) {
    if (!current.filtersActive) {
      say('No filters to clear');
      return false;
    }
    const tok = diag ? diag.begin(e, 'menu', 'clear') : null;
    screen.view = { ...screen.view, filters: {} };
    refresh('keep');
    stats.settingsChanges++;
    say(`Filters cleared. ${countText(current.games.length)}: ${selectionWords()}`);
    if (diag) diag.domDone(tok);
    finish(tok, 'filters cleared');
    return true;
  }

  const views = new Set(['league', 'season', 'period']);

  // ---------- Date calendar ----------
  function drawCalendar() {
    const r = current;
    renderCalendar(header.calendar, { month: cal.month, focus: cal.focus, selected: r.period.kind === 'date' ? r.period.dateKey : null, today: r.today, counts: r.gameDays });
  }

  function focusCalendarDay() {
    const c = header.calendar.cells.find((x) => x.button.getAttribute('data-key') === cal.focus);
    if (c) { c.button.focus({ preventScroll: true }); header.revealInPanel(c.button); }
  }

  // Opens on the chosen day (today unless another day was picked).
  function openCalendar() {
    if (calOpen) return closeCalendar(true);
    if (menuOpen || popup.open || !current.daily) return false;
    header.closeAll(false);
    const last = regularDates.get(screen.index);
    const saved = last && last.league === current.view.league && last.season === current.view.season ? last.period : catalog.defaultPeriod(current.view.league, current.view.season, zone());
    const start = current.period.kind === 'date' ? current.period.dateKey : saved.slice(1);
    const { y, m } = partsOf(start);
    cal = { month: { y, m }, focus: start };
    calOpen = true;
    stats.calendarOpens++;
    drawCalendar();
    header.calendar.root.hidden = false;
    header.showDaily();
    focusCalendarDay();
    return true;
  }

  function closeCalendar(refocus = true) {
    if (!calOpen) return false;
    calOpen = false;
    header.calendar.root.hidden = true;
    header.hideDaily(refocus);
    return true;
  }

  function moveCalendar(key, keepFocus = false) {
    cal.focus = key;
    const { y, m } = partsOf(key);
    cal.month = { y, m };
    drawCalendar();
    if (!keepFocus) focusCalendarDay();
  }

  // A chosen day replaces the board even when it has no games: the board then
  // says so, with Today, and never shows another day instead.
  function pickDate(key, e = null) {
    const r = current;
    const id = `d${key}`;
    closeCalendar(true);
    if (r.view.period === id) {
      say(`Date: ${dayWords(key)}, already showing`);
      return false;
    }
    const tok = diag ? diag.begin(e, 'menu', 'date') : null;
    screen.view = { ...r.view, period: id };
    refresh('rebuild');
    stats.settingsChanges++;
    say(`Date: ${dayWords(key)}. ${current.games.length ? `${countText(current.games.length)}: ${selectionWords()}` : 'No games on this date'}`);
    if (diag) diag.domDone(tok);
    finish(tok, `date ${key}`);
    return true;
  }

  // Today: the current demo season on today's date, filters kept where they apply.
  function goToday(e = null) {
    const r = current;
    if (!r.daily) return false;
    const season = r.seasons.find((x) => x.current) || r.seasons[0];
    const id = `d${r.today}`;
    closeCalendar(true);
    if (r.view.period === id && r.view.season === season.id) {
      say(`Today: ${dayWords(r.today)}, already showing`);
      return false;
    }
    const tok = diag ? diag.begin(e, 'menu', 'today') : null;
    screen.view = { ...r.view, season: season.id, period: id };
    refresh('rebuild');
    stats.settingsChanges++;
    say(`Today: ${dayWords(r.today)}. ${countText(current.games.length)}`);
    if (diag) diag.domDone(tok);
    finish(tok, 'today');
    return true;
  }

  header.calendar.root.addEventListener('click', (e) => {
    const b = e.target && typeof e.target.closest === 'function' ? e.target.closest('button') : null;
    if (!b || !calOpen) return;
    const action = b.getAttribute('data-cal');
    if (action === 'prev' || action === 'next') moveCalendar(moveKey(cal.focus, action === 'prev' ? 'PageUp' : 'PageDown'), true);
    else if (action === 'today') goToday(e);
    else if (action === 'close') closeCalendar(true);
    else if (b.getAttribute('data-key')) pickDate(b.getAttribute('data-key'), e);
  });

  header.calendar.root.addEventListener('keydown', (e) => {
    if (!calOpen) return;
    if (BACK_KEYS.has(e.key)) {
      e.preventDefault();
      e.stopPropagation(); // Back closes the calendar only, not the Menu
      closeCalendar(true);
      return;
    }
    const day = e.target && typeof e.target.closest === 'function' ? e.target.closest('.cal-day') : null;
    if (e.key === 'Select') { e.preventDefault(); if (!e.repeat && e.target.click) e.target.click(); return; }
    const next = day ? moveKey(cal.focus, e.key) : null;
    if (next) {
      e.preventDefault();
      moveCalendar(next);
    }
  });

  // One chosen value; returns words for the live region, or null for no change.
  function choose(key, value) {
    const v = String(value);
    const s = screen.settings;
    const r = current;
    if (key === 'period' && !r.daily && v.includes('|')) {
      const [season, period] = v.split('|');
      if (!r.seasons.some(x => x.id === season) || !catalog.periods(r.view.league, season, zone()).some(p => p.id === period)) return null;
      if (season === r.view.season && period === r.view.period) return null;
      screen.view = { ...r.view, season, period };
      refresh('rebuild');
      return `Period: ${current.period.label}. ${countText(current.games.length)}`;
    }
    if (key === 'sport') {
      const sp = SPORT_GROUPS.find((x) => x.id === v);
      if (!sp || v === sportOfLeague(r.view.league)) return null;
      screen.view = { league: sp.leagues[0] };
      refresh('rebuild');
      return `Sport: ${sp.label}. League: ${current.league.short}. ${countText(current.games.length)}: ${selectionWords()}`;
    }
    if (key === 'presentation') {
      if (validPresentation(v) !== v || v === screen.presentation) return null;
      screen.presentation = v;
      syncMode();
      return `Presentation: ${labelOf(PRESENTATIONS, v)}${v === 'auto' ? `, ${mode === 'tv' ? 'TV' : 'Phone'} for this window` : ''}`;
    }
    if (key === 'league') {
      if (v === r.view.league || !catalog.leagues.some((l) => l.id === v)) return null;
      screen.view = { league: v };
    } else if (key === 'season') {
      if (v === r.view.season || !r.seasons.some((x) => x.id === v)) return null;
      screen.view = { ...r.view, season: v, period: catalog.equivalentPeriod(r.view.league, r.view.season, v, r.view.period, zone()) };
    } else if (key === 'period') {
      if (r.daily && v === REGULAR_CHOICE) {
        // Back to the regular season: this screen's last date in this league and
        // season, otherwise the season's current date (today when anchored).
        if (r.period.kind === 'date') return null;
        const last = regularDates.get(screen.index);
        const kept = last && last.league === r.view.league && last.season === r.view.season ? last.period : null;
        screen.view = { ...r.view, period: kept ?? catalog.defaultPeriod(r.view.league, r.view.season, zone()) };
      } else {
        // A daily league's dates are chosen with the Date control, never here.
        if (v === r.view.period || !r.periods.some((p) => p.id === v && !(r.daily && p.kind === 'date'))) return null;
        screen.view = { ...r.view, period: v };
      }
    } else if (key === 'favorites') {
      if (!footballBoard() || !r.teams[v]) return null;
      const on = !screen.favorites.isTeam(r.view.league, v);
      if (!setTeamFavorite(v, on)) return null;
      syncMenu();
      const n = screen.favorites.teamCount(r.view.league);
      return `Favorite teams: ${on ? 'added' : 'removed'} ${r.teams[v].name}. ${n === 0 ? 'No favorite teams' : n === 1 ? '1 favorite team' : `${n} favorite teams`}`;
    } else if (ALL_CONTROL_KEYS.includes(key)) {
      const c = r.controls.find((x) => x.key === key && x.visible);
      if (!c || v === c.value || !c.options.some((o) => o.value === v)) return null;
      screen.view = { ...r.view, filters: { ...r.view.filters, [key]: v } };
      refresh('keep');
      return `${c.label}: ${c.options.find((o) => o.value === v).label}. ${countText(current.games.length)}`;
    } else if (key === 'textSize') {
      if (v === s.textSize || !TEXT_SIZES.some((t) => t.value === v)) return null;
      s.textSize = v;
      apply();
      return `Text size: ${labelOf(TEXT_SIZES, v)}`;
    } else if (key === 'openLimit') {
      const n = clampCap(v);
      if (n === s.openLimit || !OPEN_LIMITS.includes(Number(v))) return null;
      s.openLimit = n;
      const collapsed = expansion.setCap(n);
      apply();
      return `Games open at once: ${n}${closedNote(collapsed)}`;
    } else if (key === 'order') {
      if (footballBoard() || v === s.order || !ORDERS.some((o) => o.value === v)) return null;
      setOrder(v);
      return `Order: ${labelOf(ORDERS, v)}`;
    } else if (key === 'zone') {
      if (v === s.zone || validZone(v) !== v) return null;
      s.zone = v;
      refresh('keep');
      return `Time zone: ${zoneLabel(v)}. ${countText(current.games.length)} on ${current.period.label}`;
    } else if (key === 'badges') {
      if (v === s.badges || !BADGE_CHOICES.some((b) => b.value === v)) return null;
      s.badges = v;
      for (const ref of cards.values()) setCardBadges(ref, v === 'on');
      apply();
      return `Team badges: ${labelOf(BADGE_CHOICES, v)}`;
    } else if (key === 'screen') {
      const i = Number(v);
      if (!Number.isInteger(i) || i === screen.index || !screens[i]) return null;
      screen = screens[i];
      mode = modeNow(); // each screen keeps its own presentation; its cards are built for it
      refresh('rebuild');
      return `${screen.name}: ${countText(current.games.length)}, ${selectionWords()}`;
    } else {
      return null;
    }
    // league, season or period: a new board
    refresh('rebuild');
    return `${views.has(key) ? `${{ league: 'League', season: 'Season', period: 'Period' }[key]} changed. ` : ''}${countText(current.games.length)}: ${selectionWords()}`;
  }

  function onHeaderChoose(key, value) {
    closeCalendar(false);
    const words = choose(key, value);
    if (words === null) { syncMenu(); return; }
    stats.settingsChanges++;
    say(words);
    finish(null, `${key} ${value}`);
  }

  function onMenuChange(e) {
    const t = e.target;
    const key = t && typeof t.getAttribute === 'function' ? t.getAttribute('data-key') : null;
    if (!key) return;
    if (key === 'screenName') {
      rename(t.value, true);
      return;
    }
    if (t.tagName !== 'SELECT') return;
    const tok = diag ? diag.begin(e, 'menu', key) : null;
    const words = choose(key, t.value);
    if (words === null) {
      if (t.value !== undefined && menu.selects.get(key)) syncMenu(); // put the control back on the real value
      return;
    }
    stats.settingsChanges++;
    say(words);
    if (diag) diag.domDone(tok);
    finish(tok, `${key} ${t.value}`);
  }

  function rename(raw, done) {
    const name = sanitizeScreenName(raw, defaultScreenName(screen.index));
    screen.name = name;
    if (done && menu.nameInput.value !== name) menu.nameInput.value = name;
    doc.title = `${name} · WTFScore · SIMULATED`;
    setOptions(doc, sel('screen'), [{ label: null, options: screens.map((x) => ({ value: String(x.index), label: x.name })) }], String(screen.index));
    menu.context.textContent = `${name} · ${countText(current.games.length)}`;
  }

  header.menuBtn.addEventListener('click', (e) => openMenu(e));
  header.menuBtn.addEventListener('keydown', e => {
    if (e.key === 'Select') { e.preventDefault(); if (!e.repeat) openMenu(e); }
  });
  menu.closeBtn.addEventListener('click', (e) => closeMenu('close button', e));
  menu.scrim.addEventListener('click', (e) => closeMenu('outside click', e));
  menu.clearBtn.addEventListener('click', (e) => clearFilters(e));
  menu.sheet.addEventListener('change', onMenuChange);
  menu.sheet.addEventListener('input', (e) => {
    if (e.target === menu.nameInput) rename(e.target.value, false);
  });
  doc.addEventListener('keydown', (e) => {
    if (!menuOpen || !BACK_KEYS.has(e.key)) return;
    e.preventDefault();
    closeMenu(e.key, e);
  });

  // ---------- window size ----------
  function onResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    win.requestAnimationFrame(() => {
      resizeQueued = false;
      const v = readViewport();
      const resized = v.w !== viewport.w || v.h !== viewport.h;
      viewport = v;
      const switched = syncMode(false); // crossing the TV rule closes what was open, safely
      if (!resized && !switched) return;
      apply();
      if (diag) refreshDiag();
    });
  }
  if (typeof win.addEventListener === 'function') win.addEventListener('resize', onResize);

  // ---------- developer diagnostics (devdiag=1 only) ----------
  function describeActive() {
    const a = doc.activeElement;
    if (!a || a === doc.body || a === doc.documentElement) return 'page (nothing focused)';
    const card = cardOf(a);
    const tag = String(a.tagName || '').toLowerCase();
    if (card) return `game ${card.getAttribute('data-id')} (${tag === 'article' ? 'card' : tag})`;
    return `${tag}${a.id ? `#${a.id}` : ''}`;
  }

  function refreshDiag() {
    if (!diag) return;
    const model = computeBoardLayout({ items: order.map((g) => ({ id: g.id, stage: 1 })), viewport: { w: 1920, h: 1080 }, scale: currentScale() });
    const snapshot = {
      stats,
      settings: screen.settings,
      focusedId,
      active: describeActive(),
      layout,
      total: current.games.length,
      measure: typeof doc.createTreeWalker === 'function' ? measureDom({ win, doc, cards, board }) : null,
      model1920: { visible: fullyVisibleScores(model), safeArea: fullyVisibleScores(model, { bottom: model.frame.safeBottom }), cols: model.frame.cols },
    };
    if (diag) diag.render(snapshot);
  }

  header.configure({ choose: onHeaderChoose, openCalendar, closeCalendar, down(button) {
    if (focusedId && cards.has(focusedId)) { focusCard(focusedId); reveal(focusedId, 'cell'); return; }
    const first = layout.placements[0];
    if (first) { focusCard(first.id); reveal(first.id, 'cell'); }
  } });

  // ---------- start ----------
  refresh('rebuild');
  if (diag) win.requestAnimationFrame(() => win.setTimeout(refreshDiag, 0));

  return {
    board,
    header,
    menu,
    empty,
    live,
    diag,
    dev,
    stats,
    catalog,
    get cards() {
      return cards;
    },
    get settings() {
      return screen.settings;
    },
    get expansion() {
      return expansion;
    },
    get layout() {
      return layout;
    },
    get order() {
      return order.map((g) => g.id);
    },
    get focusedId() {
      return focusedId;
    },
    get menuOpen() {
      return menuOpen;
    },
    get view() {
      return current;
    },
    get screen() {
      return { index: screen.index, name: screen.name };
    },
    get mode() {
      return mode;
    },
    get presentation() {
      return screen.presentation;
    },
    get calendarOpen() {
      return calOpen;
    },
    get calendarState() {
      return { month: cal.month ? { ...cal.month } : null, focus: cal.focus };
    },
    popup,
    openDetails,
    toggleFavorite,
    setTeamFavorite,
    get favorites() {
      return screen.favorites;
    },
    openCalendar,
    closeCalendar,
    pickDate,
    goToday,
    activate,
    collapse,
    stepBack,
    openMenu,
    closeMenu,
    clearFilters,
    refreshDiag,
  };
}
