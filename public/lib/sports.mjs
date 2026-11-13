// WTFScore - per-sport rules for the score card: linescore columns, period
// and clock words, scoring-threat and scoring-event cues, situation lines and
// leader categories. Pure module. A game without a sport is pro football, so
// the original NFL fixtures keep their behaviour.
//
// Cues (all SIMULATED and static; nothing here is timed or polled):
//  - subtle: football red zone; baseball runner on second or third; the last
//    two minutes of a HALF in basketball (quarters: Q2 and Q4 only; halves:
//    either half; never overtime); the last two minutes of a hockey period
//    (overtime is a period);
//  - strong: a fixture-marked fresh touchdown, run scored or goal only. A field
//    goal, safety, extra point or basketball basket gets no cue at all.
// Every cue is a text tag and a card class; no colour-only signal, no motion.
//
// Football priority border (footballPriority): only an active football
// game (live, end of a period, delayed or suspended; never halftime, final,
// pregame, postponed, canceled or unknown) gets a current cue, highest first:
// a valid red zone (red, any quarter or overtime), overtime (orange, any score
// or clock), fourth quarter with 2:00 or less left and the score within 8
// (orange), fourth quarter with 5:00 or less left and the score within 10
// (yellow). A missing or invalid clock or score never invents a late cue.

export const SPORTS = Object.freeze(['football', 'basketball', 'hockey', 'baseball']);
export const sportOf = (g) => (g && SPORTS.includes(g.sport) ? g.sport : 'football');
export const formatOf = (g) => {
  const s = sportOf(g);
  if (s === 'basketball') return g.format === 'halves' ? 'halves' : 'quarters';
  return { football: 'quarters', hockey: 'periods', baseball: 'innings' }[s];
};

// Regulation periods per format.
export const REGULATION = Object.freeze({ quarters: 4, halves: 2, periods: 3, innings: 9 });

const ORD = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
};

export function periodLabel(g) {
  const f = formatOf(g);
  if (f === 'innings') return Number.isInteger(g.inning) ? `${g.half === 'bottom' ? 'Bot' : 'Top'} ${ORD(g.inning)}` : '';
  const n = g.period;
  if (!n) return '';
  if (n > REGULATION[f]) return n - REGULATION[f] > 1 ? `OT${n - REGULATION[f]}` : 'OT';
  return `${{ quarters: 'Q', halves: 'H', periods: 'P' }[f]}${n}`;
}

// Text for an in-progress game's status line.
export function liveText(g) {
  if (formatOf(g) === 'innings') return periodLabel(g) || 'In progress';
  return `${periodLabel(g)} · ${g.clock ?? '--:--'}`;
}

// The small linescore columns, the OT column and the total, by format.
export function scoreColumns(g) {
  const f = formatOf(g);
  if (f === 'innings') return { layout: 'bb', small: ['H', 'E'], ot: false, total: 'R', totalFirst: true };
  const n = REGULATION[f];
  return { layout: { quarters: 'q4', halves: 'q2', periods: 'q3' }[f], small: Array.from({ length: n }, (_, i) => String(i + 1)), ot: true, otLabel: g.overtime ? 'OT' : '', total: 'T', totalFirst: false };
}

export function scoreCells(g, side) {
  const f = formatOf(g);
  const ls = g.linescore ? g.linescore[side] : null;
  let total;
  if (g.status === 'postponed' || g.status === 'canceled') total = '–';
  else if (g.status === 'scheduled') total = '0';
  else total = g.total ? String(g.total[side]) : '–';
  if (f === 'innings') {
    const pre = g.status === 'scheduled' || !g.hits;
    return { total, small: pre ? ['', ''] : [String(g.hits[side]), String(g.errors ? g.errors[side] : '')], ot: null };
  }
  const n = REGULATION[f];
  const small = Array.from({ length: n }, (_, i) => (ls && ls[i] !== undefined && ls[i] !== null ? String(ls[i]) : ''));
  const ot = g.overtime && ls && ls.length > n ? String(ls.slice(n).reduce((a, b) => a + (b ?? 0), 0)) : '';
  return { total, small, ot };
}

function clockSeconds(clock) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(clock ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
const late = (g) => {
  const s = clockSeconds(g.clock);
  return s !== null && s > 0 && s <= 120;
};

// True in the last two minutes of a half of basketball.
export function lateInHalf(g) {
  if (sportOf(g) !== 'basketball' || g.status !== 'live' || !late(g)) return false;
  return formatOf(g) === 'halves' ? g.period === 1 || g.period === 2 : g.period === 2 || g.period === 4;
}

export function lateInPeriod(g) {
  return sportOf(g) === 'hockey' && g.status === 'live' && Number.isInteger(g.period) && g.period >= 1 && late(g);
}

export function runnersInScoringPosition(g) {
  return sportOf(g) === 'baseball' && g.status === 'live' && Boolean(g.bases && (g.bases.second || g.bases.third));
}

const STRONG = Object.freeze({
  football: Object.freeze({ cue: 'TD', tag: 'TD', title: 'Touchdown', words: 'Touchdown.' }),
  baseball: Object.freeze({ cue: 'RUN', tag: 'RUN', title: 'Run scored', words: 'Run scored.' }),
  hockey: Object.freeze({ cue: 'GOAL', tag: 'GOAL', title: 'Goal', words: 'Goal.' }),
});

export const FOOTBALL_CUE_STATUSES = Object.freeze(['live', 'end_period', 'delayed', 'suspended']);
const footballCurrent = (g) => sportOf(g) === 'football' && FOOTBALL_CUE_STATUSES.includes(g.status);

// m:ss with seconds 00-59; anything else is not a usable clock.
export function footballClockSeconds(clock) {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(String(clock ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export const FOOTBALL_PRIORITY = Object.freeze({
  rz: Object.freeze({ key: 'rz', color: 'red', tag: 'RZ', title: 'Red zone: inside the opponent 20', words: 'Red zone.' }),
  ot: Object.freeze({ key: 'ot', color: 'orange', tag: 'OT', title: 'Overtime', words: 'Overtime.' }),
  late2: Object.freeze({ key: 'late-orange', color: 'orange', tag: 'Late 2:00', title: 'Fourth quarter, 2:00 or less left, score within 8', words: 'Late and close: 2:00 or less left, within 8 points.' }),
  late5: Object.freeze({ key: 'late-yellow', color: 'yellow', tag: 'Late 5:00', title: 'Fourth quarter, 5:00 or less left, score within 10', words: 'Late and close: 5:00 or less left, within 10 points.' }),
});

// The one football priority cue for a game, or null.
export function footballPriority(g) {
  if (!g || !footballCurrent(g)) return null;
  if (g.redZone === true) return FOOTBALL_PRIORITY.rz;
  const ot = (Number.isInteger(g.period) && g.period > REGULATION.quarters) || g.overtime === true;
  if (ot) return FOOTBALL_PRIORITY.ot;
  if (g.period !== REGULATION.quarters) return null;
  const s = footballClockSeconds(g.clock);
  const t = g.total;
  if (s === null || !t || !Number.isInteger(t.away) || !Number.isInteger(t.home) || t.away < 0 || t.home < 0) return null;
  const margin = Math.abs(t.away - t.home);
  if (s <= 120 && margin <= 8) return FOOTBALL_PRIORITY.late2;
  if (s <= 300 && margin <= 10) return FOOTBALL_PRIORITY.late5;
  return null;
}

export function cues(g) {
  const s = sportOf(g);
  let subtle = null;
  if (s === 'football' && g.redZone && footballCurrent(g)) subtle = { tag: 'RZ', title: 'Red zone', words: 'Red zone.', cls: 'rz' };
  else if (runnersInScoringPosition(g)) subtle = { tag: 'RISP', title: 'Runner in scoring position', words: 'Runner in scoring position.', cls: 'risp' };
  else if (lateInHalf(g)) subtle = { tag: 'Late half', title: 'Last two minutes of the half', words: 'Last two minutes of the half.', cls: 'late' };
  else if (lateInPeriod(g)) subtle = { tag: 'Late period', title: 'Last two minutes of the period', words: 'Last two minutes of the period.', cls: 'late' };
  const st = STRONG[s];
  const strong = st && g.scoringCue === st.cue ? { tag: st.tag, title: st.title, words: st.words, cls: s === 'football' ? 'td' : 'score' } : null;
  return { subtle, strong };
}

export const LEADER_CATS = Object.freeze({
  football: Object.freeze([['passing', 'PASS'], ['rushing', 'RUSH'], ['receiving', 'REC']]),
  basketball: Object.freeze([['points', 'PTS'], ['rebounds', 'REB'], ['assists', 'AST']]),
  hockey: Object.freeze([['goals', 'G'], ['assists', 'A'], ['saves', 'SV']]),
  baseball: Object.freeze([['batting', 'BAT'], ['rbi', 'RBI'], ['pitching', 'PITCH']]),
});

export function leaderLine(sport, l) {
  if (sport === 'football') return `${l.team} · ${l.yards} yds · ${l.line}`;
  if (sport === 'baseball') return `${l.team} · ${l.line}`;
  return `${l.team} · ${l.value} ${l.unit} · ${l.line}`;
}

const outsWord = (n) => `${n} out${n === 1 ? '' : 's'}`;

export function basesWords(b) {
  if (!b) return 'Bases not available';
  const on = [['first', b.first], ['second', b.second], ['third', b.third]].filter((x) => x[1]).map((x) => x[0]);
  if (!on.length) return 'Bases empty';
  if (on.length === 3) return 'Bases loaded';
  return `Runner${on.length > 1 ? 's' : ''} on ${on.join(' and ')}`;
}

// Situation lines for basketball, hockey and baseball (football keeps its
// field graphic in render.mjs). Each line: { cls, text, miss }.
export function situationLines(g, teams) {
  const s = sportOf(g);
  const ab = (side) => teams[g[side]].abbr;
  const out = [];
  const final = g.status === 'final';
  if (s === 'basketball') {
    if (final) return [{ cls: 'snote', text: 'Final · no live situation' }];
    if (g.status === 'halftime') out.push({ cls: 'snote', text: 'Halftime · no possession' });
    else out.push(g.possession ? { cls: 'sline strong-line', text: `Possession ${ab(g.possession)}` } : { cls: 'sline', text: 'Possession not available', miss: true });
    out.push(g.fouls ? { cls: 'sline', text: `Team fouls ${ab('away')} ${g.fouls.away} · ${ab('home')} ${g.fouls.home}${g.bonus ? ` · ${ab(g.bonus)} in the bonus` : ''}` } : { cls: 'sline', text: 'Fouls not available', miss: true });
    return out;
  }
  if (s === 'hockey') {
    if (final) out.push({ cls: 'snote', text: 'Final · no live situation' });
    out.push(g.shots ? { cls: final ? 'sline' : 'sline strong-line', text: `Shots on goal ${ab('away')} ${g.shots.away} · ${ab('home')} ${g.shots.home}` } : { cls: 'sline', text: 'Shots not available', miss: true });
    if (!final) out.push({ cls: 'sline', text: g.powerPlay ? `Power play ${ab(g.powerPlay.side)} · ${g.powerPlay.clock} left · ${g.powerPlay.strength}` : 'Even strength' });
    return out;
  }
  if (s === 'baseball') {
    if (final) return [{ cls: 'snote', text: 'Final · no live situation' }];
    const c = g.count;
    out.push({ cls: 'sline strong-line', text: c && Number.isInteger(g.outs) ? `${c.balls}-${c.strikes} count · ${outsWord(g.outs)}` : 'Count not available', miss: !c });
    out.push({ cls: 'sline', text: g.batter && g.pitcher ? `At bat ${g.batter} · Pitching ${g.pitcher}` : 'Batter and pitcher not available', miss: !(g.batter && g.pitcher) });
    return out;
  }
  return out;
}

// ---------- football drive (invented, derived in the catalog) ----------
// Positions are yards to the offense's goal line: 0 is the end zone it
// attacks, 100 its own goal line, 50 midfield.
export function spotWords(yte, offense, defense) {
  if (yte <= 0) return `the ${defense} end zone`;
  if (yte >= 100) return `the ${offense} end zone`;
  if (yte === 50) return 'midfield';
  return yte < 50 ? `the ${defense} ${yte}` : `the ${offense} ${100 - yte}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Plain lines for the TV Situation panel: the drive, where it started, where the ball is
// and which way it is going. Each line: { cls, text, miss }.
export function driveLines(g, teams) {
  const d = g.drive;
  if (!d) return [{ cls: 'sline', text: 'Drive not available', miss: true }];
  const off = teams[g[d.team]].abbr;
  const def = teams[g[d.team === 'away' ? 'home' : 'away']].abbr;
  const arrow = d.direction === 'right' ? '→' : '←';
  const toward = `going ${arrow} toward the ${def} end zone`;
  const size = `${plural(d.plays, 'play')}, ${plural(d.yards, 'yard')}`;
  if (d.inProgress) {
    return [
      { cls: 'sline strong-line', text: `Drive · ${off} · ${size}` },
      { cls: 'sline', text: `Started at ${spotWords(d.start, off, def)} · ball on ${spotWords(d.end, off, def)} · ${toward}` },
    ];
  }
  const out = [
    { cls: 'sline strong-line', text: `Last drive · ${off} ${d.result.toLowerCase()} · ${size}` },
    { cls: 'sline', text: `Started at ${spotWords(d.start, off, def)} · ended at ${spotWords(d.end, off, def)} · ${toward}` },
  ];
  const s = g.situation;
  if (s && s.phase === 'kickoff' && g.possession) {
    const kicker = teams[g[g.possession]].abbr;
    const other = teams[g[g.possession === 'away' ? 'home' : 'away']].abbr;
    out.push({ cls: 'sline', text: `Now: ${kicker} kicking off from ${spotWords(s.yardsToEndzone, kicker, other)} ${arrow}` });
  } else {
    out.push({ cls: 'sline', text: 'Current ball position not available', miss: true });
  }
  return out;
}

// Arithmetic a drive must satisfy; [] when it is consistent.
export function driveProblems(g) {
  const d = g.drive;
  const out = [];
  if (!d) return ['no drive'];
  if (![d.start, d.end, d.yards, d.plays].every(Number.isInteger)) out.push('non-integer field');
  if (d.start - d.yards !== d.end) out.push(`start ${d.start} - yards ${d.yards} != end ${d.end}`);
  if (d.start < 0 || d.start > 100 || d.end < 0 || d.end > 100) out.push('position off the field');
  if (d.plays < 0 || (d.yards !== 0 && d.plays < 1)) out.push('play count');
  if (d.direction !== (d.team === 'away' ? 'right' : 'left')) out.push('direction');
  if (d.inProgress) {
    if (d.team !== g.possession) out.push('drive team is not the team with the ball');
    if (!g.situation || d.end !== g.situation.yardsToEndzone) out.push('ball position differs from the situation');
  } else {
    if (d.result === 'Touchdown' && d.end !== 0) out.push('touchdown drive must end in the end zone');
    if (d.result === 'Safety' && (d.end !== 100 || d.yards >= 0)) out.push('safety drive must end in its own end zone');
    if (d.result === 'Field goal' && !(d.end > 0 && d.end < 50)) out.push('field goal range');
  }
  return out;
}

// ---------- team stats (invented, derived in the catalog) ----------
const fmtMade = (made, att) => `${made}-${att}`;
export const TEAM_STAT_ROWS = Object.freeze({
  football: Object.freeze([
    ['First downs', (s) => s.firstDowns],
    ['Total yards', (s) => s.totalYards],
    ['Passing yards', (s) => s.passingYards],
    ['Rushing yards', (s) => s.rushingYards],
    ['Turnovers', (s) => s.turnovers],
    ['Penalties', (s) => `${s.penalties}-${s.penaltyYards}`],
  ]),
  basketball: Object.freeze([
    ['Field goals', (s) => fmtMade(s.fgm, s.fga)],
    ['Three-pointers', (s) => fmtMade(s.threes, s.threeA)],
    ['Free throws', (s) => fmtMade(s.ftm, s.fta)],
    ['Rebounds', (s) => s.rebounds],
    ['Assists', (s) => s.assists],
    ['Turnovers', (s) => s.turnovers],
  ]),
  hockey: Object.freeze([
    ['Goals', (s) => s.goals],
    ['Shots on goal', (s) => s.shots],
    ['Power plays', (s) => `${s.powerPlayGoals} of ${s.powerPlays}`],
    ['Faceoffs won', (s) => s.faceoffsWon],
    ['Hits', (s) => s.hits],
    ['Penalty minutes', (s) => s.penaltyMinutes],
  ]),
  baseball: Object.freeze([
    ['Runs', (s) => s.runs],
    ['Hits', (s) => s.hits],
    ['Errors', (s) => s.errors],
    ['Home runs', (s) => s.homeRuns],
    ['Walks', (s) => s.walks],
    ['Strikeouts', (s) => s.strikeouts],
    ['Left on base', (s) => s.leftOnBase],
  ]),
});

// Rows of [label, away text, home text, missing]; a value the data does not
// have reads "not available".
export function teamStatRows(g) {
  const st = g.teamStats;
  if (!st) return [];
  return TEAM_STAT_ROWS[sportOf(g)].map(([label, get]) => {
    const a = get(st.away);
    const h = get(st.home);
    const gone = (v) => v === null || v === undefined;
    return { label, away: gone(a) ? 'not available' : String(a), home: gone(h) ? 'not available' : String(h), miss: gone(a) || gone(h) };
  });
}

// Arithmetic the team stats must satisfy against the shown score; [] when consistent.
export function teamStatProblems(g) {
  const st = g.teamStats;
  if (!st) return ['no team stats'];
  const out = [];
  for (const side of ['away', 'home']) {
    const s = st[side];
    const total = g.total[side];
    const say = (m) => out.push(`${side}: ${m}`);
    const sport = sportOf(g);
    if (sport === 'basketball') {
      if (2 * s.fgm + s.threes + s.ftm !== total) say(`2 x ${s.fgm} + ${s.threes} + ${s.ftm} != ${total} points`);
      if (s.fgm > s.fga) say('FGM > FGA');
      if (s.threes > s.fgm) say('3PM > FGM');
      if (s.threes > s.threeA) say('3PM > 3PA');
      if (s.threeA > s.fga) say('3PA > FGA');
      if (s.fga - s.threeA < s.fgm - s.threes) say('two-point makes exceed two-point tries');
      if (s.ftm > s.fta) say('FTM > FTA');
      if (s.assists > s.fgm) say('assists > made field goals');
    } else if (sport === 'hockey') {
      if (s.goals !== total) say('goals differ from the score');
      if (s.shots !== null && s.goals > s.shots) say('goals > shots');
      if (s.shots !== null && g.shots && s.shots !== g.shots[side]) say('shots differ from the situation');
      if (s.powerPlayGoals > s.goals || s.powerPlayGoals > s.powerPlays) say('power-play goals');
    } else if (sport === 'baseball') {
      if (s.runs !== total) say('runs differ from the linescore');
      if (!g.hits || s.hits !== g.hits[side]) say('hits differ from the card');
      if (!g.errors || s.errors !== g.errors[side]) say('errors differ from the card');
      if (s.homeRuns > s.hits || s.homeRuns > s.runs) say('home runs');
    } else {
      if (s.totalYards !== s.passingYards + s.rushingYards) say(`total yards ${s.totalYards} != ${s.passingYards} + ${s.rushingYards}`);
      if (s.points !== total) say('points differ from the score');
    }
    for (const [k, v] of Object.entries(s)) if (v !== null && (!Number.isInteger(v) || v < 0)) say(`${k} is ${v}`);
  }
  return out;
}

// Inning-by-inning runs for the baseball situation part.
export function inningRows(g, teams) {
  const n = Math.max(9, g.linescore ? Math.max(g.linescore.away.length, g.linescore.home.length) : 9);
  const head = Array.from({ length: n }, (_, i) => String(i + 1));
  const row = (side) => {
    const ls = g.linescore ? g.linescore[side] : [];
    return Array.from({ length: n }, (_, i) => {
      if (ls[i] === null && g.status === 'final') return 'X';
      return ls[i] === undefined || ls[i] === null ? '' : String(ls[i]);
    });
  };
  return { head, away: { abbr: teams[g.away].abbr, cells: row('away') }, home: { abbr: teams[g.home].abbr, cells: row('home') } };
}
