// WTFScore - score card DOM builder for all four sport families.
// All fixture text is written with textContent. No HTML parsing sinks are used
// anywhere in the client. Colors are validated as 6-digit hex before use.
// `doc` is injected so Node tests can render against a minimal fake document.
// 010: no card carries a per-game More/Leaders button; the whole card opens a
// game (in place on Phone, the details window on TV). A football card carries
// one favorite star (a toggle button, never an opener), and an active football
// game shows its one priority cue as a thick outer frame plus a text tag.

import { isExpandable, notExpandableReason } from './model.mjs';
import { sportOf, formatOf, liveText, periodLabel as sportPeriodLabel, scoreColumns, scoreCells, cues, footballPriority, LEADER_CATS, leaderLine, situationLines, inningRows, basesWords, driveLines, spotWords, teamStatRows } from './sports.mjs';

export const HEX = /^#[0-9a-fA-F]{6}$/;
export const CARD_BG = '#0b0e12'; // page background behind the team color bar
const FALLBACK_CHIP = '#6b7280';

export function safeColor(value, fallback = FALLBACK_CHIP) {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback;
}

function channel(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const h = safeColor(hex).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// A locally generated team badge: two letters on the team colour, with
// whichever of black or white ink reads better (at least 4.5:1 for any
// colour). DOM and CSS only.
export function badgeFor(team) {
  const color = safeColor(team && team.color);
  const words = String((team && team.name) || '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  const letters = words.length >= 2 ? words[0][0] + words[words.length - 1][0] : String((team && team.abbr) || '?').slice(0, 2);
  const ink = contrastRatio(color, '#000000') >= contrastRatio(color, '#ffffff') ? '#000000' : '#ffffff';
  return { text: letters.toUpperCase(), color, ink };
}

function node(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function setClass(el, cls, on) {
  const list = String(el.className || '').split(/\s+/).filter((c) => c && c !== cls);
  if (on) list.push(cls);
  el.className = list.join(' ');
}

function button(doc, cls, text, action, label) {
  const b = node(doc, 'button', cls, text);
  b.type = 'button';
  b.tabIndex = -1; // the card is the keyboard stop: Enter, Space and Escape act on it
  b.setAttribute('data-action', action);
  b.setAttribute('aria-label', label);
  return b;
}

export function matchup(game, teams) {
  return `${teams[game.away].abbr} at ${teams[game.home].abbr}`;
}

// What one activation of an openable game does next, in plain words.
export function nextAction(stage) {
  if (stage <= 1) return { text: 'more', verb: 'Show situation' };
  if (stage === 2) return { text: 'leaders', verb: 'Show leaders' };
  return { text: 'close', verb: 'Close details' };
}

export function formatKickoff(iso, zone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { weekday: '?', time: 'time unknown' };
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: zone }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(d);
  return { weekday, time };
}

export const periodLabel = (g) => sportPeriodLabel(g);

export function statusInfo(game, zone) {
  const k = formatKickoff(game.kickoff, zone);
  const innings = formatOf(game) === 'innings';
  switch (game.status) {
    case 'live':
      return { text: liveText(game), tone: 'live' };
    case 'halftime':
      return { text: 'Halftime', tone: 'live' };
    case 'end_period':
      return { text: innings ? `End ${periodLabel(game).replace(/^(Top|Bot) /, '')}` : `End ${periodLabel(game)}`, tone: 'live' };
    case 'delayed':
      return { text: `Delayed · ${periodLabel(game)} ${innings ? '' : game.clock ?? ''}`.trim(), tone: 'warn' };
    case 'suspended':
      return { text: 'Suspended', tone: 'warn' };
    case 'final': {
      let tag = game.overtime ? 'Final/OT' : 'Final';
      if (innings && game.innings > 9) tag = `Final/${game.innings}`;
      return { text: `${tag} · ${k.weekday}`, tone: 'final' };
    }
    case 'scheduled':
      return { text: game.timeValid === false ? `${k.weekday} · time TBD` : `${k.weekday} ${k.time}`, tone: 'pre' };
    case 'postponed':
      return { text: 'Postponed', tone: 'warn' };
    case 'canceled':
      return { text: 'Canceled', tone: 'warn' };
    default:
      return { text: `Unknown status: ${game.statusRaw ?? String(game.status)}`, tone: 'unknown' };
  }
}

const ORD = ['', '1st', '2nd', '3rd', '4th'];

export function downDistance(s) {
  if (!s) return null;
  if (s.phase === 'kickoff') return 'Kickoff';
  if (!Number.isInteger(s.down)) return null;
  const ord = ORD[s.down] ?? `${s.down}th`;
  return s.goalToGo ? `${ord} & Goal` : `${ord} & ${s.distance}`;
}

export function yardLine(game) {
  const s = game.situation;
  if (!s || typeof s.yardsToEndzone !== 'number' || !game.possession) return null;
  const off = game[game.possession];
  const def = game[game.possession === 'away' ? 'home' : 'away'];
  const ytg = s.yardsToEndzone;
  if (ytg === 50) return 'midfield';
  return ytg < 50 ? `${def} ${ytg}` : `${off} ${100 - ytg}`;
}

// Field geometry in percent of a 120-yard field (end zones included). The away
// end zone is drawn on the left, the home end zone on the right.
export function fieldModel(game) {
  const s = game.situation;
  if (!s || typeof s.yardsToEndzone !== 'number' || !game.possession) return null;
  const right = game.possession === 'away';
  const pos = right ? 100 - s.yardsToEndzone : s.yardsToEndzone;
  const pct = (yd) => ((10 + yd) / 120) * 100;
  let fd = null;
  if (s.phase !== 'kickoff' && Number.isFinite(s.distance)) {
    const target = s.goalToGo ? (right ? 100 : 0) : right ? Math.min(100, pos + s.distance) : Math.max(0, pos - s.distance);
    fd = pct(target);
  }
  return { direction: right ? 'right' : 'left', ball: pct(pos), firstDown: fd, kickoff: s.phase === 'kickoff' };
}

// A drive on the same 120-yard field: where it started and where it is now.
export function driveModel(game) {
  const d = game.drive;
  if (!d) return null;
  const right = d.direction === 'right';
  const pct = (yte) => ((10 + (right ? 100 - yte : yte)) / 120) * 100;
  return { direction: d.direction, start: pct(d.start), end: pct(d.end) };
}

const LIVEISH = new Set(['live', 'halftime', 'end_period', 'delayed', 'suspended']);

function teamRow(doc, game, team, side, cols, badges) {
  const row = node(doc, 'div', cols.layout === 'q4' ? 'lrow trow' : `lrow trow g-${cols.layout}`);
  const chip = node(doc, 'span', 'chip');
  const color = safeColor(team.color);
  chip.style.setProperty('--chip', color);
  if (contrastRatio(color, CARD_BG) < 3) chip.className = 'chip chip-outline';
  chip.setAttribute('aria-hidden', 'true');
  row.appendChild(chip);
  const hasBall = game.possession === side && LIVEISH.has(game.status);
  const poss = node(doc, 'span', hasBall ? 'poss on' : 'poss', hasBall ? '▸' : '');
  if (hasBall) poss.setAttribute('aria-label', sportOf(game) === 'baseball' ? 'batting' : 'has possession');
  else poss.setAttribute('aria-hidden', 'true');
  row.appendChild(poss);
  const name = node(doc, 'span', 'tname');
  const b = badgeFor(team);
  const badge = node(doc, 'span', 'badge', b.text);
  badge.style.setProperty('--badge', b.color);
  badge.style.setProperty('--badge-ink', b.ink);
  badge.setAttribute('aria-hidden', 'true');
  badge.hidden = !badges;
  name.appendChild(badge);
  const words = node(doc, 'span', 'twords');
  const abbr = node(doc, 'span', 'abbr', team.abbr);
  abbr.title = team.name;
  words.appendChild(abbr);
  words.appendChild(node(doc, 'span', 'rec', Number.isInteger(team.rank) ? `#${team.rank} · ${team.record}` : team.record));
  name.appendChild(words);
  row.appendChild(name);
  const cells = scoreCells(game, side);
  if (cols.totalFirst) row.appendChild(node(doc, 'span', 'tot', cells.total));
  for (const v of cells.small) row.appendChild(node(doc, 'span', 'q', v));
  if (cols.ot) row.appendChild(node(doc, 'span', 'q ot', cells.ot));
  if (!cols.totalFirst) row.appendChild(node(doc, 'span', 'tot', cells.total));
  return { row, badge };
}

function sectionHead(doc, label, buttons) {
  const head = node(doc, 'div', 'shead');
  head.appendChild(node(doc, 'span', 'slabel', label));
  if (buttons.length) {
    const box = node(doc, 'span', 'sbtns');
    for (const b of buttons) box.appendChild(b);
    head.appendChild(box);
  }
  return head;
}

function fieldGraphic(doc, game, teams, withDrive = false) {
  const fm = fieldModel(game);
  const dm = withDrive && game.drive && game.drive.inProgress ? driveModel(game) : null;
  const field = node(doc, 'div', 'field');
  const away = teams[game.away];
  const home = teams[game.home];
  const ezL = node(doc, 'span', 'ez ez-l');
  ezL.style.setProperty('--ez', safeColor(away.color));
  const ezR = node(doc, 'span', 'ez ez-r');
  ezR.style.setProperty('--ez', safeColor(home.color));
  field.appendChild(ezL);
  field.appendChild(ezR);
  for (let yd = 10; yd <= 90; yd += 10) {
    const line = node(doc, 'span', yd === 50 ? 'yl yl-50' : 'yl');
    line.style.setProperty('left', `${((10 + yd) / 120) * 100}%`);
    field.appendChild(line);
  }
  if (fm) {
    if (fm.firstDown !== null) {
      const fd = node(doc, 'span', 'fd');
      fd.style.setProperty('left', `${fm.firstDown}%`);
      field.appendChild(fd);
    }
    if (dm) {
      const path = node(doc, 'span', 'dpath');
      path.style.setProperty('left', `${Math.min(dm.start, dm.end)}%`);
      path.style.setProperty('width', `${Math.abs(dm.end - dm.start)}%`);
      field.appendChild(path);
      const start = node(doc, 'span', 'dstart');
      start.style.setProperty('left', `${dm.start}%`);
      field.appendChild(start);
    }
    const los = node(doc, 'span', 'los');
    los.style.setProperty('left', `${fm.ball}%`);
    field.appendChild(los);
    const ball = node(doc, 'span', `ball dir-${fm.direction}`, fm.direction === 'right' ? '▶' : '◀');
    ball.style.setProperty('left', `${fm.ball}%`);
    field.appendChild(ball);
  }
  const offense = game.possession ? teams[game[game.possession]].abbr : null;
  const where = yardLine(game);
  field.setAttribute('role', 'img');
  field.setAttribute(
    'aria-label',
    fm ? `Field: ${offense} ${fm.kickoff ? 'kicking off' : 'driving'} ${fm.direction === 'right' ? 'toward the right end zone' : 'toward the left end zone'}, ball on ${where}${dm ? `, drive started at ${spotWords(game.drive.start, offense, teams[game[game.possession === 'away' ? 'home' : 'away']].abbr)}` : ''}` : 'Field position unavailable',
  );
  return field;
}

function lastPlayLine(doc, game) {
  if (game.lastPlay && game.lastPlay.text) {
    const play = node(doc, 'div', 'play', game.lastPlay.text);
    play.title = game.lastPlay.text;
    play.setAttribute('data-clip-ok', 'line-clamp');
    return play;
  }
  return node(doc, 'div', 'play miss', 'Last play not available');
}

function footballSituation(doc, sec, game, teams, { drive = false } = {}) {
  const final = game.status === 'final';
  if (final) {
    sec.appendChild(node(doc, 'div', 'snote', 'Final · no live field position'));
  } else if (!game.situation || !game.possession) {
    sec.appendChild(node(doc, 'div', 'snote miss', 'Situation not available'));
  } else {
    sec.appendChild(fieldGraphic(doc, game, teams, drive));
    const dd = downDistance(game.situation) ?? 'Down unknown';
    const offense = teams[game[game.possession]].abbr;
    const fm = fieldModel(game);
    const arrow = fm.direction === 'right' ? '→' : '←';
    const where = yardLine(game);
    const text = game.situation.phase === 'kickoff' ? `${dd} · ${offense} kicking from ${where} ${arrow}` : `${dd} · ${where} · ${offense} ball ${arrow}`;
    sec.appendChild(node(doc, 'div', 'dd', text));
  }
  if (drive && !final) for (const l of driveLines(game, teams)) sec.appendChild(node(doc, 'div', l.miss ? `${l.cls} miss` : l.cls, l.text));
  sec.appendChild(lastPlayLine(doc, game));
  if (!final) {
    const t = game.timeouts;
    const dots = (n) => '●'.repeat(n) + '○'.repeat(Math.max(0, 3 - n));
    const txt = t ? `Timeouts ${teams[game.away].abbr} ${dots(t.away)} · ${teams[game.home].abbr} ${dots(t.home)}` : 'Timeouts not available';
    sec.appendChild(node(doc, 'div', t ? 'tos' : 'tos miss', txt));
  }
}

function inningGrid(doc, game, teams) {
  const r = inningRows(game, teams);
  const grid = node(doc, 'div', 'inn');
  grid.setAttribute('role', 'table');
  grid.setAttribute('aria-label', 'Runs by inning');
  const line = (cls, label, cells) => {
    const row = node(doc, 'div', `inn-row ${cls}`);
    row.setAttribute('role', 'row');
    const lab = node(doc, 'span', 'inn-team', label);
    lab.setAttribute('role', 'rowheader');
    row.appendChild(lab);
    for (const c of cells) {
      const cell = node(doc, 'span', 'inn-cell', c);
      cell.setAttribute('role', 'cell');
      row.appendChild(cell);
    }
    grid.appendChild(row);
  };
  line('inn-head', 'Inn', r.head);
  line('inn-away', r.away.abbr, r.away.cells);
  line('inn-home', r.home.abbr, r.home.cells);
  return grid;
}

function diamond(doc, game) {
  const b = game.bases || {};
  const box = node(doc, 'div', 'diamond');
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', basesWords(game.bases));
  for (const [cls, on] of [['b2', b.second], ['b3', b.third], ['b1', b.first]]) box.appendChild(node(doc, 'span', on ? `base ${cls} on` : `base ${cls}`));
  return box;
}

function otherSituation(doc, sec, game, teams) {
  const sport = sportOf(game);
  const lines = situationLines(game, teams);
  if (sport === 'baseball') {
    sec.appendChild(inningGrid(doc, game, teams));
    if (game.status === 'final') {
      for (const l of lines) sec.appendChild(node(doc, 'div', l.miss ? `${l.cls} miss` : l.cls, l.text));
    } else {
      const row = node(doc, 'div', 'bbrow');
      row.appendChild(diamond(doc, game));
      const words = node(doc, 'div', 'bbwords');
      for (const l of lines) words.appendChild(node(doc, 'div', l.miss ? `${l.cls} miss` : l.cls, l.text));
      row.appendChild(words);
      sec.appendChild(row);
    }
    sec.appendChild(lastPlayLine(doc, game));
    return;
  }
  for (const l of lines) sec.appendChild(node(doc, 'div', l.miss ? `${l.cls} miss` : l.cls, l.text));
  sec.appendChild(lastPlayLine(doc, game));
  if (sport === 'basketball' && game.status !== 'final') {
    const t = game.timeouts;
    sec.appendChild(node(doc, 'div', t ? 'tos' : 'tos miss', t ? `Timeouts left ${teams[game.away].abbr} ${t.away} · ${teams[game.home].abbr} ${t.home}` : 'Timeouts not available'));
  }
}

function situationSection(doc, game, teams) {
  const sec = node(doc, 'div', 'sec sec2');
  sec.setAttribute('data-stage', '2');
  sec.hidden = true;
  const m = matchup(game, teams);
  sec.appendChild(sectionHead(doc, `Situation · ${m}`, [button(doc, 'sbtn', 'close', 'collapse', `Close details, ${m}`)]));
  if (sportOf(game) === 'football') footballSituation(doc, sec, game, teams);
  else otherSituation(doc, sec, game, teams);
  return sec;
}

function leadersSection(doc, game, teams) {
  const sec = node(doc, 'div', 'sec sec3');
  sec.setAttribute('data-stage', '3');
  sec.hidden = true;
  sec.appendChild(sectionHead(doc, `Leaders · ${matchup(game, teams)}`, []));
  appendLeaders(doc, sec, game);
  return sec;
}

function appendLeaders(doc, sec, game) {
  const sport = sportOf(game);
  for (const [key, label] of LEADER_CATS[sport]) {
    const l = game.leaders ? game.leaders[key] : null;
    const row = node(doc, 'div', l ? 'ldr' : 'ldr miss');
    const top = node(doc, 'div', 'lname');
    top.appendChild(node(doc, 'span', 'lcat', label));
    const who = node(doc, 'span', 'lplayer', l ? l.name : 'Not available');
    if (l) who.title = l.name;
    top.appendChild(who);
    row.appendChild(top);
    row.appendChild(node(doc, 'div', 'lline', l ? leaderLine(sport, l) : `${label.toLowerCase()} leader missing`));
    sec.appendChild(row);
  }
}

// ---------- TV details: the three lower panels ----------
export function buildSituationPanel(doc, game, teams) {
  const box = node(doc, 'div', 'pane');
  if (sportOf(game) === 'football') footballSituation(doc, box, game, teams, { drive: true });
  else otherSituation(doc, box, game, teams);
  return box;
}

export function buildLeaders(doc, game) {
  const box = node(doc, 'div', 'pane');
  appendLeaders(doc, box, game);
  return box;
}

export function buildTeamStats(doc, game, teams) {
  const box = node(doc, 'div', 'pane');
  const rows = teamStatRows(game);
  if (!rows.length) {
    box.appendChild(node(doc, 'div', 'snote miss', 'Team stats not available'));
    return box;
  }
  const table = node(doc, 'table', 'tstats');
  table.appendChild(node(doc, 'caption', 'sr-only', `Team stats, ${matchup(game, teams)}`));
  const head = node(doc, 'thead');
  const hr = node(doc, 'tr');
  const corner = node(doc, 'th', 'tst-label', 'Team');
  corner.setAttribute('scope', 'col');
  hr.appendChild(corner);
  for (const side of ['away', 'home']) {
    const th = node(doc, 'th', 'tst-val', teams[game[side]].abbr);
    th.setAttribute('scope', 'col');
    hr.appendChild(th);
  }
  head.appendChild(hr);
  table.appendChild(head);
  const body = node(doc, 'tbody');
  for (const r of rows) {
    const tr = node(doc, 'tr', r.miss ? 'miss' : null);
    const th = node(doc, 'th', 'tst-label', r.label);
    th.setAttribute('scope', 'row');
    tr.appendChild(th);
    tr.appendChild(node(doc, 'td', 'tst-val', r.away));
    tr.appendChild(node(doc, 'td', 'tst-val', r.home));
    body.appendChild(tr);
  }
  table.appendChild(body);
  box.appendChild(table);
  box.appendChild(node(doc, 'p', 'snote', 'Invented for this demo, like every score here. Not live statistics.'));
  return box;
}

// The frame a game shows on its card and in the TV details window: the one
// football priority cue, otherwise a football touchdown's green frame, else none.
export function frameCue(game) {
  const p = footballPriority(game);
  if (p) return { cls: `prio prio-${p.color}`, key: p.key, words: p.words };
  if (sportOf(game) === 'football' && cues(game).strong) return { cls: 'td-frame', key: 'td', words: 'Touchdown.' };
  return null;
}

export function cardLabel(game, teams, stage, zone, mode = 'phone', { favorite = null } = {}) {
  const a = teams[game.away];
  const h = teams[game.home];
  const st = statusInfo(game, zone).text;
  const scored = game.total && !['scheduled', 'postponed', 'canceled'].includes(game.status);
  const score = scored ? `${a.name} ${game.total.away}, ${h.name} ${game.total.home}` : `${a.name} at ${h.name}`;
  const net = game.network ? ` On ${game.network}.` : '';
  const round = game.roundTag ? ` ${game.roundTag}.` : '';
  const c = cues(game);
  const p = footballPriority(game);
  const fav = favorite === true ? ' Favorite game.' : '';
  const cueWords = `${fav}${c.subtle ? ` ${c.subtle.words}` : ''}${p && p.key !== 'rz' ? ` ${p.words}` : ''}${c.strong ? ` ${c.strong.words}` : ''}${game.corrected ? ' Score corrected.' : ''}`;
  let tail;
  if (!isExpandable(game)) tail = ` No details: ${notExpandableReason(game)}.`;
  else if (mode === 'tv') tail = ' Enter opens the game details.';
  else if (stage <= 1) tail = ' Details closed. Enter shows the situation.';
  else if (stage === 2) tail = ' Situation open. Enter shows leaders, Escape closes.';
  else tail = ' Situation and leaders open. Enter closes, Escape steps back.';
  return `${score}. ${st}.${round}${net}${cueWords}${tail}`;
}

// favorite: null for a card without a star (every league but NFL and NCAAF),
// otherwise the game's current favorite state.
export function buildCard(doc, game, teams, { zone, badges = false, mode = 'phone', favorite = null }) {
  const expandable = isExpandable(game);
  const c = cues(game);
  const fc = frameCue(game);
  const star = favorite !== null && sportOf(game) === 'football';
  const classes = ['card', expandable ? 'can-open' : 'noexp', `sport-${sportOf(game)}`];
  if (c.subtle) classes.push('cue-subtle', c.subtle.cls);
  if (c.strong) classes.push('cue-strong', c.strong.cls);
  if (fc) classes.push(...fc.cls.split(' '));
  if (star) classes.push('has-fav');
  if (star && favorite === true) classes.push('fav-on');
  const root = node(doc, 'article', classes.join(' '));
  root.setAttribute('data-id', game.id);
  root.setAttribute('data-status', game.status);
  root.setAttribute('data-stage', '1');
  if (fc) root.setAttribute('data-cue', fc.key);
  root.setAttribute('role', 'group');
  root.setAttribute('aria-roledescription', 'game');
  root.setAttribute('aria-label', cardLabel(game, teams, 1, zone, mode, { favorite: star ? favorite === true : null }));
  root.tabIndex = 0;
  const part = scorePart(doc, game, teams, { zone, badges, star: star ? { on: favorite === true } : null, cls: 'sec sec1' });
  root.appendChild(part.sec1);
  const sec2 = situationSection(doc, game, teams);
  const sec3 = leadersSection(doc, game, teams);
  root.appendChild(sec2);
  root.appendChild(sec3);
  // act: no card has a per-game More/Leaders button (010); kept null for callers.
  const ref = { root, sections: { 1: part.sec1, 2: sec2, 3: sec3 }, expandable, act: null, fav: part.fav, favorite: star ? favorite === true : null, status: part.status, badges: part.badges };
  if (mode === 'tv') setCardStage(ref, game, teams, zone, 1, mode);
  return ref;
}

// The TV details scorecard: the same score part, with no star (the details
// window has no favorite control: Select does nothing inside it).
export function buildScorecard(doc, game, teams, { zone, badges = false }) {
  const part = scorePart(doc, game, teams, { zone, badges, star: null, cls: 'pscore' });
  part.sec1.setAttribute('data-status', game.status);
  return part.sec1;
}

// The favorite star: a toggle whose pressed state, glyph and words say whether
// the game is a favorite. It never opens a game.
function paintStar(btn, game, teams, on) {
  btn.textContent = on ? '★' : '☆';
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-label', `Favorite game, ${matchup(game, teams)}`);
  btn.title = on ? 'Favorite game: select to remove it from favorites' : 'Not a favorite game: select to add it to favorites';
}

// The score part of a game: status, tags, the football star when asked for,
// the linescore head and the two team rows.
function scorePart(doc, game, teams, { zone, badges, star, cls }) {
  const away = teams[game.away];
  const home = teams[game.home];
  const info = statusInfo(game, zone);
  const c = cues(game);
  const p = footballPriority(game);
  const cols = scoreColumns(game);
  const sec1 = node(doc, 'div', cls);
  sec1.setAttribute('data-stage', '1');
  const srow = node(doc, 'div', 'srow');
  const status = node(doc, 'span', `status tone-${info.tone}`, info.text);
  status.title = game.statusDetail || info.text;
  srow.appendChild(status);
  const tags = node(doc, 'span', 'tags');
  if (c.subtle) {
    const t = node(doc, 'span', c.subtle.cls === 'rz' ? 'tag tag-subtle tag-rz' : 'tag tag-subtle', c.subtle.tag);
    t.title = c.subtle.title;
    tags.appendChild(t);
  }
  if (p && p.key !== 'rz') {
    const t = node(doc, 'span', 'tag tag-prio', p.tag);
    t.title = p.title;
    tags.appendChild(t);
  }
  if (c.strong) {
    const t = node(doc, 'span', c.strong.cls === 'td' ? 'tag tag-strong tag-td' : 'tag tag-strong', c.strong.tag);
    t.title = `${c.strong.title} (simulated scoring play)`;
    tags.appendChild(t);
  }
  if (game.corrected) {
    const t = node(doc, 'span', 'tag tag-corr', 'Corrected');
    t.title = game.corrected.note;
    tags.appendChild(t);
  }
  if (game.missing && game.missing.length) {
    const t = node(doc, 'span', 'tag tag-miss', 'Missing data');
    t.title = `Not in this simulated data: ${game.missing.join(', ')}`;
    tags.appendChild(t);
  }
  srow.appendChild(tags);
  let fav = null;
  if (star) {
    fav = node(doc, 'button', 'fav');
    fav.type = 'button';
    fav.tabIndex = -1; // the card stays the Tab stop; Right on the card reaches its star
    fav.setAttribute('data-action', 'favorite');
    paintStar(fav, game, teams, star.on === true);
    srow.appendChild(fav);
  }
  sec1.appendChild(srow);

  const head = node(doc, 'div', cols.layout === 'q4' ? 'lrow lhead' : `lrow lhead g-${cols.layout}`);
  const netText = game.network ? (game.roundTag ? `${game.roundTag} · ${game.network}` : game.network) : game.roundTag ? `${game.roundTag} · Network TBA` : 'Network TBA';
  const net = node(doc, 'span', game.network ? 'net' : 'net miss', netText);
  net.title = game.network ? netText : 'Network not in this simulated data';
  head.appendChild(net);
  const label = (cls, text) => {
    const e = node(doc, 'span', cls, text);
    e.setAttribute('aria-hidden', 'true');
    head.appendChild(e);
  };
  if (cols.totalFirst) label('tot', cols.total);
  for (const q of cols.small) label('q', q);
  if (cols.ot) label('q ot', cols.otLabel);
  if (!cols.totalFirst) label('tot', cols.total);
  sec1.appendChild(head);
  const ra = teamRow(doc, game, away, 'away', cols, badges);
  const rh = teamRow(doc, game, home, 'home', cols, badges);
  sec1.appendChild(ra.row);
  sec1.appendChild(rh.row);
  return { sec1, fav, status, badges: [ra.badge, rh.badge] };
}

// Show one stage on an existing card element: no element is created or removed.
// On TV a game never opens in place: the whole card opens the details popup.
export function setCardStage(ref, game, teams, zone, stage, mode = 'phone') {
  const s = ref.expandable && mode !== 'tv' ? Math.min(3, Math.max(1, Math.round(stage) || 1)) : 1;
  ref.root.setAttribute('data-stage', String(s));
  setClass(ref.root, 'open', s > 1);
  ref.sections[2].hidden = s < 2;
  ref.sections[3].hidden = s < 3;
  ref.root.setAttribute('aria-label', cardLabel(game, teams, s, zone, mode, { favorite: ref.favorite ?? null }));
  return s;
}

// A new favorite state on the same card element: star, class and words.
export function setCardFavorite(ref, game, teams, on, zone, stage, mode = 'phone') {
  if (!ref.fav) return false;
  ref.favorite = Boolean(on);
  paintStar(ref.fav, game, teams, ref.favorite);
  setClass(ref.root, 'fav-on', ref.favorite);
  const s = ref.expandable && mode !== 'tv' ? Math.min(3, Math.max(1, Math.round(stage) || 1)) : 1;
  ref.root.setAttribute('aria-label', cardLabel(game, teams, s, zone, mode, { favorite: ref.favorite }));
  return true;
}

// A new time zone rewrites the start-time words on the same elements.
export function retimeCard(ref, game, teams, zone, stage, mode = 'phone') {
  const info = statusInfo(game, zone);
  if (ref.status.textContent !== info.text) ref.status.textContent = info.text;
  ref.status.title = game.statusDetail || info.text;
  ref.root.setAttribute('aria-label', cardLabel(game, teams, stage, zone, mode, { favorite: ref.favorite ?? null }));
}

export function setCardBadges(ref, on) {
  for (const b of ref.badges) b.hidden = !on;
}
