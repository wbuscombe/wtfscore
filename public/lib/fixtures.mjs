// WTFScore DEL-0 - deterministic synthetic week generator.
// Every team, player, network and play here is invented. No provider data.
// The generator emits games in a seeded, shuffled order on purpose: the board
// must sort them itself (kickoff, then game id) and never trust input order.

export const DEFAULT_SEED = 11;
export const SIM_NOW = '2026-11-15T21:50:00Z'; // virtual clock: Sun 3:50 PM Central
export const DISPLAY_ZONE = 'America/Chicago';

// [abbr, city, nickname, color, record]
const TEAM_ROWS = [
  ['AVL', 'Ashvale', 'Anvils', '#c8553d', '7-3'],
  ['BRO', 'Brookridge', 'Otters', '#2f6690', '5-4'],
  ['CCQ', 'Cobalt City', 'Quasars', '#3a86ff', '6-3'],
  ['DPS', 'Duneport', 'Scorpions', '#d4a017', '4-5'],
  ['EMB', 'Emberlake', 'Blaze', '#e4572e', '8-1'],
  ['FHT', 'Fairhaven', 'Tidewater', '#17becf', '5-4'],
  ['GLD', 'Goldcrest', 'Lodestars', '#b8860b', '3-6'],
  ['HME', 'Highmoor', 'Elk', '#8a6a52', '6-4'],
  ['IVF', 'Ironvale', 'Foundry', '#7d8491', '2-7'],
  ['JBP', 'Juniper Basin', 'Pronghorns', '#5b8e7d', '4-5'],
  ['KFK', 'Kestrel Falls', 'Kites', '#9b5de5', '6-3'],
  ['LMB', 'Lowmarsh', 'Bogrunners', '#4f772d', '1-8'],
  ['MVM', 'Marrowvale', 'Moose', '#8d6e63', '5-5'],
  ['NGR', 'Northgate', 'Rovers', '#1d3557', '4-6'],
  ['OHO', 'Oakhollow', 'Owls', '#6d597a', '7-3'],
  ['PCH', 'Port Calder', 'Herons', '#0077b6', '3-7'],
  ['QFH', 'Quarry Flats', 'Hammers', '#a4161a', '5-4'],
  ['RMS', 'Redmesa', 'Sidewinders', '#bc4749', '6-3'],
  ['SBQ', 'Silverbay', 'Squall', '#8ecae6', '7-3'],
  ['TLB', 'Timberline', 'Bison', '#606c38', '2-8'],
  ['UPG', 'Ursa Point', 'Glaciers', '#90e0ef', '4-5'],
  ['VTV', 'Valtown', 'Voltage', '#ffd60a', '3-6'],
  ['WCW', 'Westcrook', 'Wranglers', '#bb3e03', '8-1'],
  ['SMC', 'Saltmarsh', 'Cranes', '#e9d8a6', '2-7'],
  ['YWK', 'Yarrow', 'Knights', '#495057', '5-4'],
  ['ZHG', 'Zephyr Hills', 'Gale', '#48cae4', '4-5'],
  ['CPL', 'Copperline', 'Prospectors', '#b5651d', '6-3'],
  ['MDP', 'Meridian', 'Pioneers', '#2a9d8f', '5-4'],
  ['SBS', 'Stonebridge', 'Sentinels', '#5c677d', '6-3'],
  ['HVA', 'Harborview', 'Anchors', '#023e8a', '3-6'],
  ['PCL', 'Pinecrest', 'Lumberjacks', '#2d6a4f', '7-2'],
  ['RBR', 'Riverbend', 'Raccoons', '#6c757d', '4-5'],
];

const L = (name, team, yards, line) => ({ name, team, yards, line });

const LONG_TD_TEXT =
  'M. Okonkwo-Vanderhoeven 47-yard catch-and-run from D. Ferreira-Lindqvist after a tipped ball & a broken tackle at the MDP 20 — ruling "<review: confirmed>" — TOUCHDOWN; K. Szymanski PAT good (7-3).';

// Canonical games, deliberately NOT in kickoff or id order.
const GAME_ROWS = [
  {
    id: 'g11-104', away: 'HME', home: 'NGR', kickoff: '2026-11-13T01:15:00Z', status: 'final', overtime: true,
    linescore: { away: [3, 7, 7, 7, 3], home: [7, 10, 0, 7, 0] }, network: 'Gridcast',
    lastPlay: { type: 'field_goal', text: 'J. Varga 34-yard field goal is GOOD. Elk win in overtime.' },
    leaders: { passing: L('T. Halvorsen', 'HME', 251, '24/35, 1 TD'), rushing: L('D. Mbeki', 'NGR', 96, '19 car, 1 TD'), receiving: L('C. Ruiz-Albright', 'HME', 88, '7 rec') },
  },
  {
    id: 'g11-131', away: 'SBQ', home: 'TLB', kickoff: '2026-11-14T21:30:00Z', status: 'final',
    linescore: { away: [7, 3, 7, 3], home: [0, 10, 0, 3] }, network: 'Arcline',
    lastPlay: { type: 'run', text: 'P. Lindgren kneels at the TLB 31 to end the game.' },
    leaders: { passing: L('R. Akintola', 'SBQ', 214, '19/28, 2 TD'), rushing: L('M. Castellano', 'TLB', 71, '15 car'), receiving: L('E. Whitcombe', 'SBQ', 93, '6 rec, 1 TD') },
  },
  {
    id: 'g11-157', away: 'AVL', home: 'PCH', kickoff: '2026-11-15T18:00:00Z', status: 'final',
    linescore: { away: [7, 10, 7, 7], home: [3, 7, 0, 7] }, network: 'Kettle TV',
    lastPlay: { type: 'pass', text: 'B. Okafor pass short right to L. Petrakis for 6 yards; clock expires.' },
    leaders: { passing: L('B. Okafor', 'AVL', 288, '23/30, 3 TD'), rushing: L('G. Valdivia', 'AVL', 104, '21 car, 1 TD'), receiving: L('L. Petrakis', 'AVL', 117, '8 rec, 2 TD') },
  },
  {
    id: 'g11-149', away: 'CCQ', home: 'FHT', kickoff: '2026-11-15T18:00:00Z', status: 'live', period: 5, clock: '6:12', overtime: true,
    linescore: { away: [7, 7, 3, 7, 0], home: [0, 14, 7, 3, 0] }, network: 'Gridcast',
    possession: 'away', situation: { down: 2, distance: 6, yardsToEndzone: 38 }, timeouts: { away: 1, home: 2 },
    lastPlay: { type: 'pass', text: 'S. Navarro pass deep middle to K. Abernathy for 9 yards to the FHT 38.' },
    leaders: { passing: L('S. Navarro', 'CCQ', 302, '27/41, 2 TD'), rushing: L('A. Thorsby', 'FHT', 88, '18 car, 1 TD'), receiving: L('K. Abernathy', 'CCQ', 121, '9 rec') },
  },
  {
    id: 'g11-162', away: 'JBP', home: 'LMB', kickoff: '2026-11-15T18:00:00Z', status: 'postponed',
    statusDetail: 'Postponed: venue power outage. Makeup date TBD.', network: 'Kettle TV', linescore: null,
  },
  {
    id: 'g11-118', away: 'IVF', home: 'UPG', kickoff: '2026-11-15T18:00:00Z', status: 'unknown', statusRaw: 'STATUS_CODE_47',
    linescore: { away: [7, 0], home: [3, 7] }, network: 'Arcline',
  },
  {
    id: 'g11-171', away: 'MVM', home: 'OHO', kickoff: '2026-11-15T18:00:00Z', status: 'final',
    linescore: { away: [3, 10, 3, 7], home: [7, 3, 7, 3] }, network: 'Lumen5',
    corrected: { note: 'Home total revised from 27 to 20 after review; the drop persisted for 2 polls.' },
    lastPlay: { type: 'run', text: 'T. Brannigan kneels at the OHO 44; end of game.' },
    leaders: { passing: L('T. Brannigan', 'MVM', 233, '20/33, 1 TD'), rushing: L('O. Fairweather', 'OHO', 82, '16 car'), receiving: L('J. Lachance', 'MVM', 97, '6 rec, 1 TD') },
  },
  {
    id: 'g11-140', away: 'KFK', home: 'DPS', kickoff: '2026-11-15T18:00:00Z', status: 'delayed', statusDetail: 'Weather delay (lightning)',
    period: 4, clock: '9:03', linescore: { away: [7, 3, 0, 7], home: [3, 7, 7, 0] }, network: 'Northlight',
    possession: 'home', situation: { down: 3, distance: 4, yardsToEndzone: 61 }, timeouts: { away: 2, home: 3 },
    lastPlay: { type: 'delay', text: 'Play suspended for lightning in the area; both teams have left the field.' },
    leaders: { passing: L('V. Delacroix', 'KFK', 187, '16/27, 1 TD'), rushing: L('H. Oyelaran', 'DPS', 77, '14 car, 1 TD'), receiving: L('N. Szabo', 'KFK', 64, '5 rec') },
  },
  {
    id: 'g11-183', away: 'WCW', home: 'SMC', kickoff: '2026-11-15T21:05:00Z', status: 'live', period: 2, clock: '7:14',
    linescore: { away: [7, 0], home: [3, 0] }, network: 'Gridcast', possession: 'away', redZone: true,
    situation: { down: 1, distance: 8, yardsToEndzone: 8, goalToGo: true }, timeouts: { away: 3, home: 3 },
    lastPlay: { type: 'run', text: 'R. Castellanos up the middle for 12 yards to the SMC 8.' },
    leaders: { passing: L('E. Marchetti', 'WCW', 118, '10/14, 1 TD'), rushing: L('R. Castellanos', 'WCW', 61, '9 car'), receiving: L('Y. Achterberg', 'SMC', 47, '4 rec') },
  },
  {
    id: 'g11-126', away: 'QFH', home: 'RMS', kickoff: '2026-11-15T21:05:00Z', status: 'live', period: 2, clock: '3:58',
    linescore: { away: [7, 0], home: [0, 3] }, network: 'Arcline', possession: 'away',
    situation: { down: 1, distance: 10, yardsToEndzone: 75 }, timeouts: { away: 3, home: 2 },
    lastPlay: { type: 'field_goal', text: 'L. Ostrowski 41-yard field goal is GOOD.' },
    leaders: { passing: L('F. Quaresma', 'QFH', 97, '9/15'), rushing: L('I. Bergkamp', 'RMS', 44, '8 car'), receiving: L('U. Nakashima', 'QFH', 52, '3 rec, 1 TD') },
  },
  {
    id: 'g11-195', away: 'CPL', home: 'MDP', kickoff: '2026-11-15T21:25:00Z', status: 'live', period: 1, clock: '1:12',
    linescore: { away: [7], home: [3] }, network: 'Northlight', possession: 'away', scoringCue: 'TD',
    situation: { phase: 'kickoff', yardsToEndzone: 65 }, timeouts: { away: 3, home: 3 },
    lastPlay: { type: 'touchdown', text: LONG_TD_TEXT },
    leaders: { passing: L('D. Ferreira-Lindqvist', 'CPL', 112, '7/9, 1 TD'), rushing: L('W. Adeyemi-Holloway', 'MDP', 23, '5 car'), receiving: L('M. Okonkwo-Vanderhoeven', 'CPL', 71, '3 rec, 1 TD') },
  },
  {
    id: 'g11-112', away: 'YWK', home: 'ZHG', kickoff: '2026-11-15T21:25:00Z', status: 'live', period: 1, clock: '2:05',
    linescore: { away: [3], home: [0] }, network: null, possession: null, situation: null, timeouts: null, lastPlay: null,
    leaders: { passing: L('C. Brightwater', 'YWK', 64, '6/8'), rushing: L('P. Moravec', 'ZHG', 19, '4 car'), receiving: null },
    missing: ['network', 'possession', 'situation', 'timeouts', 'lastPlay', 'leaders.receiving'],
  },
  { id: 'g11-108', away: 'EMB', home: 'BRO', kickoff: '2026-11-16T01:20:00Z', status: 'scheduled', network: 'Northlight' },
  { id: 'g11-199', away: 'GLD', home: 'SBS', kickoff: '2026-11-17T01:15:00Z', status: 'scheduled', network: 'Lumen5' },
  {
    id: 'g11-166', away: 'HVA', home: 'PCL', kickoff: '2026-11-17T05:15:00Z', status: 'scheduled',
    network: 'Tallgrass+ Alternate Feed Extra', crossMidnight: { zone: 'America/New_York', note: 'Mon 11:15 PM Central is Tue 12:15 AM Eastern' },
  },
  {
    id: 'g11-121', away: 'RBR', home: 'VTV', kickoff: '2026-11-16T18:00:00Z', timeValid: false, status: 'scheduled',
    statusDetail: 'Kickoff time TBD', network: 'Arcline',
  },
];

// Snapshot sequences. FIXTURE DATA ONLY: the monotonic, gap and correction
// guards that consume them belong to DEL-1 and are not implemented here.
const SNAPSHOT_ROWS = [
  { gameId: 'g11-149', seq: 1, at: '2026-11-15T21:40:10Z', period: 4, clock: '0:41', away: 24, home: 24, kind: 'normal' },
  { gameId: 'g11-149', seq: 2, at: '2026-11-15T21:40:40Z', period: 4, clock: '0:00', away: 24, home: 24, kind: 'normal' },
  { gameId: 'g11-149', seq: 3, at: '2026-11-15T21:41:10Z', period: 4, clock: '0:41', away: 24, home: 24, kind: 'non-monotonic' },
  { gameId: 'g11-149', seq: 4, at: '2026-11-15T21:47:40Z', period: 5, clock: '7:40', away: 24, home: 24, kind: 'gap' },
  { gameId: 'g11-149', seq: 5, at: '2026-11-15T21:49:50Z', period: 5, clock: '6:12', away: 24, home: 24, kind: 'normal' },
  { gameId: 'g11-171', seq: 1, at: '2026-11-15T21:12:00Z', period: 4, clock: '0:00', away: 23, home: 27, kind: 'pre-correction' },
  { gameId: 'g11-171', seq: 2, at: '2026-11-15T21:12:30Z', period: 4, clock: '0:00', away: 23, home: 20, kind: 'correction-drop' },
  { gameId: 'g11-171', seq: 3, at: '2026-11-15T21:13:00Z', period: 4, clock: '0:00', away: 23, home: 20, kind: 'correction-confirmed' },
];

// mulberry32: small deterministic PRNG.
export function prng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(list, seed) {
  const out = list.slice();
  const rnd = prng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function buildTeams() {
  const teams = {};
  for (const [abbr, city, nickname, color, record] of TEAM_ROWS) {
    teams[abbr] = { abbr, city, nickname, name: `${city} ${nickname}`, color, record };
  }
  return teams;
}

function normalizeGame(row) {
  const g = structuredClone(row);
  g.week = 11;
  g.timeValid = row.timeValid !== false;
  g.overtime = Boolean(row.overtime);
  g.redZone = Boolean(row.redZone);
  g.network = row.network ?? null;
  g.possession = row.possession ?? null;
  g.situation = row.situation ?? null;
  g.timeouts = row.timeouts ?? null;
  g.lastPlay = row.lastPlay ?? null;
  g.leaders = row.leaders ?? null;
  g.linescore = row.linescore ?? null;
  g.period = row.period ?? null;
  g.clock = row.clock ?? null;
  g.scoringCue = row.scoringCue ?? null;
  g.corrected = row.corrected ?? null;
  g.missing = row.missing ?? [];
  g.total = g.linescore ? { away: sum(g.linescore.away), home: sum(g.linescore.home) } : null;
  return g;
}

export function generateWeek({ seed = DEFAULT_SEED } = {}) {
  const teams = buildTeams();
  const canonical = GAME_ROWS.map(normalizeGame);
  return {
    meta: {
      simulated: true,
      label: 'Week 11 (invented)',
      league: 'Pro football (invented teams)',
      range: 'Thu Nov 12 to Mon Nov 16, 2026',
      simNow: SIM_NOW,
      zone: DISPLAY_ZONE,
      seed,
      snapshotPolicy: 'Fixture data only. Monotonic, gap and correction guards are DEL-1 scope and are not implemented in DEL-0.',
    },
    teams,
    games: shuffled(canonical, seed),
    snapshots: SNAPSHOT_ROWS.map((s) => ({ ...s, fixtureOnly: true, guardsBelongTo: 'DEL-1' })),
  };
}

// Catalog of the contract's fixture cases. Tests check each claim against the
// data itself rather than trusting this list.
export const FIXTURE_CASES = Object.freeze({
  thursday: ['g11-104'],
  saturday: ['g11-131'],
  sunday: ['g11-157', 'g11-149', 'g11-162', 'g11-118', 'g11-171', 'g11-140', 'g11-183', 'g11-126', 'g11-195', 'g11-112', 'g11-108'],
  monday: ['g11-199', 'g11-166', 'g11-121'],
  equalKickoff: ['g11-157', 'g11-149', 'g11-162', 'g11-118', 'g11-171', 'g11-140'],
  crossMidnight: ['g11-166'],
  overtime: ['g11-104', 'g11-149'],
  redZone: ['g11-183'],
  touchdown: ['g11-195'],
  fieldGoal: ['g11-126', 'g11-104'],
  correction: ['g11-171'],
  postponed: ['g11-162'],
  tbd: ['g11-121'],
  unknown: ['g11-118'],
  longText: ['g11-195', 'g11-166'],
  missingData: ['g11-112'],
  delayed: ['g11-140'],
});
