import { uiChoose, uiControl, uiOptions, uiRow, uiValue } from './fake-dom.mjs';
// Football favorites, fixed football order, the star's D-pad mapping and
// isolation, focus and scroll after a reorder, and the shared scorecards with
// no More/Leaders button, driven through the real board handlers on the fake
// DOM. Model tests: not browser, Safari, TV-remote or device evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWindow, FakeEvent } from './fake-dom.mjs';
import { mountBoard } from '../public/lib/board.mjs';
import { Favorites, supportsFavorites, FAVORITE_LEAGUES } from '../public/lib/favorites.mjs';
import { sortFootball, isExpandable } from '../public/lib/model.mjs';
import { buildNavGraph, DIRECTIONS } from '../public/lib/nav.mjs';
import { optionsOf } from '../public/lib/menu.mjs';
import { LEAGUES } from '../public/lib/catalog.mjs';
import { prng } from '../public/lib/fixtures.mjs';

function setup({ width = 1440, height = 900, presentation = 'phone', blurOnMove = true } = {}) {
  const win = new FakeWindow({ width, height, blurOnMove });
  const doc = win.document;
  const root = doc.createElement('div');
  root.id = 'app';
  doc.body.appendChild(root);
  const app = mountBoard({ win, doc, root, presentation });
  return { win, doc, root, app };
}
const click = (el, init = {}) => el.dispatchEvent(new FakeEvent('click', init));
const press = (el, key, init = {}) => el.dispatchEvent(new FakeEvent('keydown', { key, ...init }));
const same = (a, b, msg) => assert.ok(a === b, msg); // never ask assert to diff two DOM nodes
function choose(app, key, value) { return uiChoose(app, key, value); }
const gameOf = (app, id) => app.view.games.find((g) => g.id === id);
const scoreBox = (app, id) => app.cards.get(id).sections[1].byClass('status')[0];
const pressed = (app, id) => app.cards.get(id).fav.getAttribute('aria-pressed') === 'true';
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const wantOrder = (app) => sortFootball(app.view.games, (g) => app.favorites.isFavorite(g)).map((g) => g.id);
function toLeague(app, id) {
  if (app.view.league.id === id) return;
  const was = app.menuOpen;
  if (!was) app.openMenu();
  choose(app, 'league', id);
  if (!was) app.closeMenu();
}

// ---------- the store ----------
test('Favorites store: either team makes a game a favorite; include and exclude overrides; a matching star use clears the override; the exclude, unfavorite and refavorite sequence; ids per league', () => {
  const f = new Favorites();
  const g = { id: 'nfl-2026-g11-101', league: 'nfl', away: 'AAA', home: 'BBB' };
  const other = { id: 'nfl-2026-g11-102', league: 'nfl', away: 'CCC', home: 'DDD' };
  const college = { id: 'ncaaf-2026-w12-01', league: 'ncaaf', away: 'BBB', home: 'EEE' };
  assert.deepEqual(FAVORITE_LEAGUES, ['nfl', 'ncaaf']);
  same(f.isFavorite(g), false);
  same(f.setTeam('nfl', 'BBB', true), true);
  same(f.setTeam('nfl', 'BBB', true), false, 'no change when already a favorite');
  same(f.isFavorite(g), true, 'the home team is enough');
  same(f.override(g.id), null);
  same(f.isFavorite(other), false);
  same(f.isFavorite(college), false, 'the same abbreviation in another league is another team');
  f.setTeam('nfl', 'CCC', true);
  same(f.isFavorite(other), true, 'the away team is enough');
  f.setTeam('nfl', 'CCC', false);
  // exclude, unfavorite and refavorite the team: the exclusion holds; the star again restores inheritance
  assert.deepEqual(f.toggleGame(g), { on: false, override: false });
  same(f.setTeam('nfl', 'BBB', false), true);
  same(f.isFavorite(g), false);
  same(f.override(g.id), false, 'the exclusion is kept while the team is not a favorite');
  f.setTeam('nfl', 'BBB', true);
  same(f.isFavorite(g), false, 'the exclusion holds after the team is a favorite again');
  assert.deepEqual(f.toggleGame(g), { on: true, override: null }, 'the star again matches the team default: the override clears');
  f.setTeam('nfl', 'BBB', false);
  same(f.isFavorite(g), false, 'it follows its teams again');
  // include a game whose teams are not favorites; it survives team changes
  assert.deepEqual(f.toggleGame(other), { on: true, override: true });
  f.setTeam('nfl', 'DDD', true);
  same(f.isFavorite(other), true);
  same(f.override(other.id), true, 'an explicit include is kept when its team becomes a favorite');
  assert.deepEqual(f.toggleGame(other), { on: false, override: false }, 'now an exclusion against the team default');
  f.setTeam('nfl', 'DDD', false);
  assert.deepEqual(f.toggleGame(other), { on: true, override: true });
  same(f.teamCount('nfl'), 0);
  same(f.teamCount('ncaaf'), 0);
  // only football leagues
  same(supportsFavorites('nba'), false);
  same(f.setTeam('nba', 'AAA', true), false);
  same(f.toggleGame({ id: 'nba-1', league: 'nba', away: 'A', home: 'B' }), null);
  same(f.isFavorite({ id: 'nba-1', league: 'nba', away: 'A', home: 'B' }), false);
});

// ---------- the football order ----------
test('sortFootball: favorites first (in progress, upcoming, final inside), then in progress, upcoming, final, other; kickoff then id; unknown or TBD starts last; any input order', () => {
  const mk = (id, status, kickoff, extra = {}) => ({ id, status, kickoff, ...extra });
  const games = [
    mk('f1', 'final', '2026-11-15T18:00:00Z'),
    mk('fa', 'live', '2026-11-15T22:00:00Z'),
    mk('fu', 'scheduled', '2026-11-15T23:30:00Z'),
    mk('fv', 'scheduled', '2026-11-15T12:00:00Z', { timeValid: false }),
    mk('a1', 'live', '2026-11-15T21:00:00Z'),
    mk('a2', 'live', '2026-11-15T18:00:00Z'),
    mk('a3', 'halftime', '2026-11-15T18:00:00Z'),
    mk('a4', 'delayed', '2026-11-15T19:00:00Z'),
    mk('a5', 'end_period', '2026-11-15T17:00:00Z'),
    mk('a6', 'suspended', '2026-11-15T20:00:00Z'),
    mk('u1', 'scheduled', '2026-11-16T01:00:00Z'),
    mk('u2', 'scheduled', '2026-11-15T23:00:00Z', { timeValid: false }),
    mk('u3', 'postponed', '2026-11-15T22:00:00Z'),
    mk('u4', 'scheduled', 'not a date'),
    mk('z2', 'final', '2026-11-15T17:00:00Z'),
    mk('z1', 'final', '2026-11-15T17:00:00Z'),
    mk('x1', 'canceled', '2026-11-15T16:00:00Z'),
    mk('x2', 'unknown', '2026-11-15T15:00:00Z'),
  ];
  const favs = new Set(['f1', 'fa', 'fu', 'fv']);
  const want = ['fa', 'fu', 'fv', 'f1', 'a5', 'a2', 'a3', 'a4', 'a6', 'a1', 'u3', 'u1', 'u2', 'u4', 'z1', 'z2', 'x2', 'x1'];
  const rnd = prng(10);
  for (let i = 0; i < 25; i++) {
    const shuffled = [...games].sort(() => rnd() - 0.5);
    assert.deepEqual(sortFootball(shuffled, (g) => favs.has(g.id)).map((g) => g.id), want, `shuffle ${i}`);
  }
  assert.ok(want.indexOf('f1') < want.indexOf('a1'), 'a favorite final ahead of every other game in progress');
  assert.deepEqual(sortFootball(games).map((g) => g.id), ['a5', 'a2', 'a3', 'a4', 'a6', 'a1', 'fa', 'u3', 'fu', 'u1', 'fv', 'u2', 'u4', 'z1', 'z2', 'f1', 'x2', 'x1'], 'no favorites: in progress, upcoming, final, other');
  assert.deepEqual(sortFootball(games).map((g) => g.id).filter((x) => x.startsWith('a')), ['a5', 'a2', 'a3', 'a4', 'a6', 'a1'], 'every game in progress by kickoff, ties by id');
});

// ---------- team favorites from the Menu ----------
test('Favorite teams in the Menu (NFL and NCAAF): a labelled native dropdown filled before it shows; choosing a team makes its games favorites, first on the board; choosing it again removes it; no row or star in other sports', () => {
  for (const lg of ['nfl', 'ncaaf']) {
    const { app } = setup();
    app.openMenu();
    toLeague(app, lg);
    const row = app.menu.rows.get('favorites');
    const s = app.menu.selects.get('favorites');
    same(row.hidden, false, lg);
    same(app.menu.labels.get('favorites').textContent, 'Favorite teams');
    same(app.menu.labels.get('favorites').getAttribute('for'), s.id);
    same(s.tagName, 'SELECT');
    same(s.tabIndex, 0);
    const teams = Object.keys(app.view.teams);
    same(optionsOf(s).length, teams.length + 1);
    same(optionsOf(s)[0].value, 'none');
    same(optionsOf(s)[0].textContent, 'Add or remove a team (none chosen)');
    assert.deepEqual(optionsOf(s).slice(1).map((o) => o.value).sort(), teams.sort());
    same(s.value, 'none');
    const g = app.view.games.find((x) => x.status === 'final');
    choose(app, 'favorites', g.home);
    same(app.favorites.isTeam(lg, g.home), true);
    same(s.value, 'none', 'the dropdown rests on its prompt again');
    same(optionsOf(s)[0].textContent, 'Add or remove a team (1 chosen)');
    const opt = optionsOf(s).find((o) => o.value === g.home);
    same(opt.textContent, `★ ${app.view.teams[g.home].name} (${g.home}), favorite`);
    assert.match(app.live.textContent, new RegExp(`^Favorite teams: added ${app.view.teams[g.home].name}\\. 1 favorite team$`));
    const favIds = app.view.games.filter((x) => x.home === g.home || x.away === g.home).map((x) => x.id);
    assert.ok(favIds.length >= 1);
    for (const id of app.cards.keys()) {
      same(pressed(app, id), favIds.includes(id), `${lg} ${id} star`);
      same(/ Favorite game\./.test(app.cards.get(id).root.getAttribute('aria-label')), favIds.includes(id));
    }
    assert.deepEqual(app.order, wantOrder(app));
    assert.deepEqual(app.order.slice(0, favIds.length).sort(), [...favIds].sort(), 'favorite games first');
    choose(app, 'favorites', g.home);
    same(app.favorites.isTeam(lg, g.home), false);
    assert.match(app.live.textContent, /removed .*\. No favorite teams$/);
    for (const id of app.cards.keys()) same(pressed(app, id), false);
    choose(app, 'favorites', 'none');
    same(app.stats.teamFavoriteChanges, 2, 'the prompt is not a change');
  }
  const { app } = setup();
  app.openMenu();
  for (const l of LEAGUES.filter((x) => x.sport !== 'football')) {
    choose(app, 'league', l.id);
    same(app.menu.rows.get('favorites').hidden, true, `${l.id}: no Favorite teams`);
    assert.ok([...app.cards.values()].every((r) => r.fav === null && r.favorite === null), `${l.id}: no star`);
    same(app.board.all((e) => e.hasClass('fav')).length, 0);
  }
});

test('star exclusion on the board, both football leagues and both Demo screens: a team favorite, a game excluded by its star, the team unfavorited and favorited again: the exclusion holds; the star again resumes inheritance; an included game stays', () => {
  for (const lg of ['nfl', 'ncaaf']) {
    const { app } = setup();
    app.openMenu();
    toLeague(app, lg);
    const g = app.view.games.find((x) => x.status === 'final');
    choose(app, 'favorites', g.home);
    app.closeMenu();
    const ref = app.cards.get(g.id);
    same(pressed(app, g.id), true);
    click(ref.fav);
    same(app.favorites.override(g.id), false, 'excluded');
    same(pressed(app, g.id), false);
    same(ref.fav.textContent, '☆');
    assert.match(app.live.textContent, /not a favorite game, excluded$/);
    app.openMenu();
    choose(app, 'favorites', g.home);
    same(app.favorites.isTeam(lg, g.home), false);
    choose(app, 'favorites', g.home);
    same(app.favorites.isTeam(lg, g.home), true);
    same(app.favorites.isFavorite(g), false, 'the exclusion holds');
    same(pressed(app, g.id), false);
    app.closeMenu();
    click(ref.fav);
    same(app.favorites.override(g.id), null, 'cleared: matches the team default');
    same(pressed(app, g.id), true);
    same(ref.fav.textContent, '★');
    assert.match(app.live.textContent, /favorite game, from a favorite team$/);
    const h = app.view.games.find((x) => ![x.home, x.away].includes(g.home));
    click(app.cards.get(h.id).fav);
    same(app.favorites.override(h.id), true, 'included on its own');
    assert.match(app.live.textContent, /favorite game, this game only$/);
    app.openMenu();
    choose(app, 'favorites', h.home);
    choose(app, 'favorites', h.home);
    same(app.favorites.override(h.id), true, 'the include survives team changes');
    assert.deepEqual(app.order, wantOrder(app));
    // Screen 2 has its own favorites; Screen 1's come back unchanged
    const one = app.favorites;
    choose(app, 'screen', '1');
    notSame(app.favorites, one);
    same(app.view.league.id, 'nfl', 'Screen 2 starts on its own default board');
    assert.ok([...app.cards.keys()].every((id) => !pressed(app, id)), 'nothing is a favorite on Screen 2');
    toLeague(app, lg);
    assert.ok([...app.cards.keys()].every((id) => !pressed(app, id)));
    choose(app, 'screen', '0');
    same(app.favorites, one);
    same(pressed(app, g.id), true);
    same(pressed(app, h.id), true);
  }
});

test('favorites stay through week, league, filter and time-zone changes; card ids are the stable game ids; a reload starts with none; nothing is stored', () => {
  const { app, win } = setup();
  app.openMenu();
  const g = app.view.games.find((x) => x.status === 'final');
  const team = g.home;
  choose(app, 'favorites', team);
  app.closeMenu();
  const ex = app.view.games.find((x) => ![x.home, x.away].includes(team));
  click(app.cards.get(ex.id).fav);
  const week = app.view.view.period;
  app.openMenu();
  const other = app.view.periods.find((p) => p.phase === 'regular' && p.id !== week);
  choose(app, 'period', other.id);
  const theirs = app.view.games.filter((x) => [x.home, x.away].includes(team));
  assert.ok(theirs.length >= 1, 'the team plays in the other week too');
  for (const x of theirs) same(pressed(app, x.id), true, `${x.id} inherits in another week`);
  assert.deepEqual(app.order, wantOrder(app));
  choose(app, 'period', week);
  same(pressed(app, g.id), true);
  same(pressed(app, ex.id), true, 'the per-game include is kept by its game id');
  const conf = app.view.teams[team].groups.conference;
  choose(app, 'conference', conf);
  same(pressed(app, g.id), true, 'after a filter change');
  choose(app, 'zone', 'UTC');
  same(pressed(app, g.id), true, 'after a time-zone change');
  assert.deepEqual(app.order, wantOrder(app));
  choose(app, 'league', 'nba');
  choose(app, 'league', 'nfl');
  same(app.favorites.isTeam('nfl', team), true, 'after another league');
  for (const [id, ref] of app.cards) same(ref.root.getAttribute('data-id'), id);
  same(win.historyCalls, 0);
  const again = setup().app;
  same(again.favorites.teamCount('nfl'), 0, 'a reload starts with no favorites');
  assert.ok([...again.cards.keys()].every((id) => !pressed(again, id)));
});

// ---------- the star: isolation and the D-pad ----------
test('the star only changes favorites: click or tap, Enter, Space and remote Select never open a game; the whole card still opens in place on Phone and the details window on TV', () => {
  const { app, doc } = setup();
  const id = app.order.find((x) => isExpandable(gameOf(app, x)));
  const ref = app.cards.get(id);
  same(ref.fav.tabIndex, -1, 'the card stays the Tab stop');
  same(ref.fav.getAttribute('aria-label'), `Favorite game, ${app.view.teams[gameOf(app, id).away].abbr} at ${app.view.teams[gameOf(app, id).home].abbr}`);
  same(ref.fav.getAttribute('type') ?? ref.fav.type, 'button');
  click(ref.fav);
  same(app.expansion.count(), 0, 'a click on the star opens nothing');
  same(pressed(app, id), true);
  same(doc.activeElement, ref.fav);
  same(press(ref.fav, 'Enter'), true, 'Enter is left to the star button');
  same(press(ref.fav, ' '), true, 'Space is left to the star button');
  same(pressed(app, id), true, 'no change from the keydown itself');
  click(ref.fav, { detail: 0 }); // the click a keyboard Enter or Space produces
  same(pressed(app, id), false);
  same(press(ref.fav, 'Select'), false, 'remote Select is handled on the star');
  same(pressed(app, id), true);
  press(ref.fav, 'Select', { repeat: true });
  same(pressed(app, id), true, 'a held Select does not toggle again');
  same(app.expansion.count(), 0);
  same(app.stats.activations, 0, 'no game activation at all');
  click(scoreBox(app, id));
  same(app.expansion.stageOf(id), 2, 'the whole card still opens on Phone');
  ref.root.focus();
  press(ref.root, 'Enter');
  same(app.expansion.stageOf(id), 3);
  const tv = setup({ width: 1920, height: 1080, presentation: 'tv' });
  const t = tv.app;
  const tid = t.order.find((x) => isExpandable(gameOf(t, x)));
  const tref = t.cards.get(tid);
  click(tref.fav);
  press(tref.fav, 'Select');
  click(tref.fav, { detail: 0 });
  same(t.popup.open, false, 'the star never opens the details window');
  same(t.stats.details, 0);
  same(t.stats.favoriteToggles, 3);
  tref.root.focus();
  press(tref.root, 'Select');
  same(t.popup.open, true, 'Select on the card opens the details window');
  const box = t.popup.ui.box;
  same(box.all((e) => e.hasClass('fav')).length, 0, 'no favorite control in the details window');
  const favBefore = t.favorites.isFavorite(gameOf(t, tid));
  for (const k of ['Select', 'Enter', ' ']) press(box, k);
  same(t.popup.open, true, 'Select, Enter and Space do nothing inside');
  same(t.favorites.isFavorite(gameOf(t, tid)), favBefore);
  press(box, 'ArrowRight');
  same(t.popup.panel, 'leaders', 'Right steps the carousel');
  press(box, 'ArrowLeft');
  same(t.popup.panel, 'situation');
  press(box, 'GoBack');
  same(t.popup.open, false, 'Back closes');
  same(tv.doc.activeElement, tref.root, 'focus is back on the same game');
});

test('D-pad: Right on a game reaches its own star; from the star Left returns to the game and Right, Up and Down move as from the game; other geometry edges land on games and the upper edge reaches the foreground header', () => {
  for (const [w, h, pres] of [[1920, 1080, 'tv'], [1440, 900, 'phone'], [390, 844, 'phone']]) {
    for (const lg of ['nfl', 'ncaaf']) {
      const { app, doc } = setup({ width: w, height: h, presentation: pres });
      toLeague(app, lg);
      const graph = buildNavGraph(app.layout.placements);
      for (const [gid, edges] of graph) for (const d of DIRECTIONS) if (edges[d]) assert.ok(app.cards.get(edges[d]).root.hasClass('card'), `${gid} ${d} lands on a game`);
      let moves = 0;
      for (const id of app.order) {
        const ref = app.cards.get(id);
        const target = (d, stay) => (graph.get(id)[d] ? app.cards.get(graph.get(id)[d]).root : stay);
        for (const d of ['up', 'down', 'left']) {
          ref.root.focus();
          press(ref.root, KEY[d]);
          if (d === 'up' && !graph.get(id).up) assert.ok(app.header.root.contains(doc.activeElement), 'upper card edge reaches header');
          else same(doc.activeElement, target(d, ref.root), `${w} ${lg} ${id} card ${d}`);
        }
        ref.root.focus();
        press(ref.root, 'ArrowRight');
        same(doc.activeElement, ref.fav, `${w} ${lg} ${id}: Right reaches its own star`);
        press(ref.fav, 'ArrowLeft');
        same(doc.activeElement, ref.root, `${w} ${lg} ${id}: Left from the star returns to the game`);
        for (const d of ['right', 'up', 'down']) {
          ref.fav.focus();
          press(ref.fav, KEY[d]);
          if (d === 'up' && !graph.get(id).up) assert.ok(app.header.root.contains(doc.activeElement), 'upper star edge reaches header');
          else same(doc.activeElement, target(d, ref.fav), `${w} ${lg} ${id} star ${d}`);
        }
        moves++;
      }
      same(moves, app.order.length);
      same(app.expansion.count() + app.stats.favoriteToggles + app.stats.details, 0, 'arrows never change a game');
    }
  }
  // other sports: Right moves between games as before
  const { app, doc } = setup({ width: 1920, height: 1080, presentation: 'tv' });
  toLeague(app, 'nba');
  const graph = buildNavGraph(app.layout.placements);
  const id = app.order.find((x) => graph.get(x).right);
  app.cards.get(id).root.focus();
  press(doc.activeElement, 'ArrowRight');
  same(doc.activeElement, app.cards.get(graph.get(id).right).root);
});

// ---------- reorder: focus, scrolling, open games and the details window ----------
test('reorder focus: a star use that reorders the board keeps focus on the same star and game, scrolls only enough to keep it visible, and scrolls nothing when it stays visible', () => {
  const { app, doc, win } = setup({ width: 390, height: 844, presentation: 'auto' });
  same(app.mode, 'phone');
  const H = 844;
  const cell = (id) => app.layout.placements.find((p) => p.id === id);
  const visible = (id) => cell(id).y >= win.scrollY - 0.01 && cell(id).y + cell(id).h <= win.scrollY + H + 0.01;
  const gap = app.layout.frame.gap;
  // no scroll when the game stays in view: the first game becomes a favorite and stays first
  const first = app.order[0];
  app.cards.get(first).root.focus();
  press(doc.activeElement, 'ArrowRight');
  press(doc.activeElement, 'Select');
  same(app.order[0], first);
  same(win.scrolls.length, 0, 'nothing scrolls');
  press(doc.activeElement, 'Select');
  same(win.scrolls.length, 0);
  // a game far down moves to the top when it becomes a favorite
  const id = app.order[app.order.length - 2];
  win.scrollY = Math.max(0, cell(id).y - 100);
  assert.ok(visible(id));
  const ref = app.cards.get(id);
  ref.root.focus();
  press(ref.root, 'ArrowRight');
  same(doc.activeElement, ref.fav);
  const n = win.scrolls.length;
  press(ref.fav, 'Select');
  same(app.order[0], id, 'the favorite moved to the top');
  same(doc.activeElement, ref.fav, 'focus stays on the same star');
  same(app.focusedId, id);
  same(win.scrolls.length, n + 1, 'one scroll');
  assert.ok(visible(id));
  assert.ok(Math.abs(win.scrollY - Math.max(0, cell(id).y - gap)) < 0.01, 'scrolled only until its top shows');
  press(ref.fav, 'Select');
  same(app.order.indexOf(id), app.order.length - 2, 'back to its place');
  same(doc.activeElement, ref.fav);
  assert.ok(visible(id));
  assert.ok(Math.abs(win.scrollY + H - (cell(id).y + cell(id).h + gap)) < 0.01, 'scrolled only until its bottom shows');
  assert.deepEqual(app.order, wantOrder(app));
  for (const [cid, r] of app.cards) same(r.root.getAttribute('data-id'), cid);
});

test('a team change while a game is open (Phone) never pins it: the fixed order applies; with the TV details window open the same game, panel and focus stay', () => {
  const { app, doc } = setup();
  const open = app.order.filter((x) => gameOf(app, x).status === 'final').pop();
  click(scoreBox(app, open));
  same(app.expansion.stageOf(open), 2);
  const fav = app.view.games.find((g) => g.status === 'final' && g.id !== open && ![g.home, g.away].some((t) => [gameOf(app, open).home, gameOf(app, open).away].includes(t)));
  app.openMenu();
  choose(app, 'favorites', fav.home);
  app.closeMenu();
  assert.deepEqual(app.order, wantOrder(app), 'the open game holds no pinned position');
  const favCount = app.view.games.filter((g) => app.favorites.isFavorite(g)).length;
  assert.ok(favCount >= 1);
  assert.ok(app.order.slice(0, favCount).every((x) => app.favorites.isFavorite(gameOf(app, x))), 'the favorites come first');
  same(app.favorites.isFavorite(gameOf(app, open)), false);
  assert.ok(app.order.indexOf(open) >= favCount, 'the open game keeps its place in the fixed order, not a pinned one');
  same(app.expansion.stageOf(open), 2, 'still open');
  same(doc.activeElement, app.cards.get(open).root, 'focus back on the open game after the Menu');
  const tv = setup({ width: 1920, height: 1080, presentation: 'tv' });
  const t = tv.app;
  const id = t.order.filter((x) => gameOf(t, x).status === 'final').pop();
  const ref = t.cards.get(id);
  ref.root.focus();
  press(ref.root, 'Enter');
  same(t.popup.open, true);
  press(t.popup.ui.box, 'ArrowRight');
  same(t.popup.panel, 'leaders');
  const before = [...t.order];
  same(t.setTeamFavorite(gameOf(t, id).home, true), true);
  assert.notDeepEqual(t.order, before, 'the board behind reordered');
  same(t.order.indexOf(id) < before.indexOf(id), true, 'its game moved up');
  same(t.popup.open, true);
  same(t.popup.gameId, id, 'same game');
  same(t.popup.panel, 'leaders', 'same panel');
  same(tv.doc.activeElement, t.popup.ui.box, 'focus stays in the details window');
  t.toggleFavorite(t.order[t.order.length - 1]);
  same(t.popup.gameId, id);
  same(tv.doc.activeElement, t.popup.ui.box);
  press(t.popup.ui.box, 'Escape');
  same(tv.doc.activeElement, ref.root, 'closing returns focus to the same game element at its new place');
});

// ---------- shared scorecards: no More or Leaders button (all seven leagues) ----------
test('shared scorecards: no More or Leaders button in any of the seven leagues on Phone or TV; leaders stay reachable by the whole card (Phone) and the details carousel (TV)', () => {
  for (const pres of ['phone', 'tv']) {
    for (const l of LEAGUES) {
      const { app, doc } = setup({ width: pres === 'tv' ? 1920 : 1440, height: pres === 'tv' ? 1080 : 900, presentation: pres });
      toLeague(app, l.id);
      assert.ok(app.cards.size > 0, l.id);
      for (const [id, ref] of app.cards) {
        same(ref.act, null, `${pres} ${id}`);
        const buttons = ref.root.all((e) => e.tagName === 'BUTTON');
        assert.ok(buttons.every((b) => b.getAttribute('data-action') !== 'advance'), `${pres} ${id}: no advance button`);
        assert.ok(buttons.every((b) => !/^(more|leaders)$/i.test(b.textContent)), `${pres} ${id}: no More or Leaders text`);
        assert.deepEqual(buttons.map((b) => b.getAttribute('data-action')), l.sport === 'football' ? ['favorite', 'collapse'] : ['collapse'], `${pres} ${id}: only the star (football) and the situation close`);
      }
      const id = app.order.find((x) => isExpandable(gameOf(app, x)));
      if (!id) continue;
      const ref = app.cards.get(id);
      if (pres === 'phone') {
        click(scoreBox(app, id));
        click(scoreBox(app, id));
        same(ref.sections[3].hidden, false, `${l.id}: leaders shown in place`);
        same(ref.sections[3].byClass('ldr').length, 3);
        same(doc.activeElement, ref.root);
      } else {
        ref.root.focus();
        press(ref.root, 'Enter');
        same(app.popup.open, true, `${l.id}: details open`);
        press(app.popup.ui.box, 'ArrowRight');
        same(app.popup.panel, 'leaders');
        same(app.popup.ui.body.byClass('ldr').length, 3, `${l.id}: leaders in the details window`);
        press(app.popup.ui.box, 'Escape');
        same(doc.activeElement, ref.root);
      }
    }
  }
});

function notSame(a,b,msg) { assert.ok(a!==b,msg||'Expected different values or identities'); }
