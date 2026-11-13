// WTFScore - SIMULATED seven-league demo catalog.
// Every league here is a demo: teams, players, schedules, group memberships
// and ranks are invented, and each league is frozen at one fixed simulated
// moment. Nothing is live, nothing is fetched and nothing claims real
// membership. Pure module: deterministic plain objects, no DOM.
//
// Game times are stored in UTC. Week and postseason periods hold games by
// their own tag; a calendar-date period holds the regular-season games whose
// start falls on that date in the screen's time zone, so changing the zone
// moves a late game to the date it really falls on there.
//
// Daily leagues (every league except football) can be anchored to a clock:
// buildCatalog({ now }) moves a daily league's whole schedule by whole
// calendar days so its original current slate falls on today's date in the
// screen's time zone. Every other date keeps the same signed day distance from
// that slate and the same wall-clock start time; the invented games, scores,
// plays and statuses do not change (statuses stay frozen at the original
// simulated moment and are never recomputed from elapsed time). Without a
// clock (Node tools and older tests) the authored dates are used; the page
// always passes the device clock. Football weeks never move.
//
// Derived, also invented: every in-progress football game carries a drive
// (start, plays, yards, direction), and every started game carries team stats
// whose arithmetic agrees with its score. The canonical NFL Week 11 game
// g11-112 keeps its deliberately incomplete raw fixture (fixtures.mjs, for the
// missing-data tests), but here it gets an invented current drive.

import { generateWeek, prng, SIM_NOW as NFL_SIM_NOW } from './fixtures.mjs';

export const DEFAULT_ZONE = 'America/Chicago';
export const ZONES = Object.freeze([
  Object.freeze({ value: 'America/New_York', label: 'Eastern' }),
  Object.freeze({ value: 'America/Chicago', label: 'Central' }),
  Object.freeze({ value: 'America/Denver', label: 'Mountain' }),
  Object.freeze({ value: 'America/Los_Angeles', label: 'Pacific' }),
  Object.freeze({ value: 'UTC', label: 'UTC' }),
]);
const ZONE_SET = new Set(ZONES.map((z) => z.value));
export const validZone = (z) => (ZONE_SET.has(z) ? z : DEFAULT_ZONE);
export const zoneLabel = (z) => (ZONES.find((x) => x.value === z) || ZONES[1]).label;

// ---------- dates ----------
const PARTS = new Map();
function zoneParts(ms, zone) {
  let f = PARTS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    PARTS.set(zone, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}

// The calendar date (YYYY-MM-DD) an instant falls on in `zone`.
export function localDateKey(iso, zone) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const p = zoneParts(t, validZone(zone));
  return `${p.year}-${p.month}-${p.day}`;
}

const DAY_LABEL = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
export function dateKeyLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return DAY_LABEL.format(new Date(Date.UTC(y, m - 1, d, 12))).replace(',', '');
}

// A wall-clock time in `zone` as a UTC ISO string (handles daylight time).
export function zonedToUtc(dateKey, hhmm, zone = DEFAULT_ZONE) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let t = want;
  for (let i = 0; i < 4; i++) {
    const p = zoneParts(t, zone);
    const seen = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    if (seen === want) break;
    t += want - seen;
  }
  return new Date(t).toISOString().replace('.000Z', 'Z');
}

export function shiftKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Whole calendar days from date key a to date key b (b - a).
export function dayDiff(a, b) {
  const t = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86400000);
}

// A real calendar date written YYYY-MM-DD (no Feb 30, no month 13).
export function validDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

// The same Central wall-clock time `days` calendar days later (daylight-time safe).
function shiftWallClock(iso, days) {
  if (!days) return iso;
  const p = zoneParts(Date.parse(iso), DEFAULT_ZONE);
  return zonedToUtc(shiftKey(`${p.year}-${p.month}-${p.day}`, days), `${p.hour}:${p.minute}`, DEFAULT_ZONE);
}

// Demo season labels name their years; a schedule moved by whole years says so.
const yearsOf = (days) => Math.round(days / 365.2425);
function shiftSeasonLabel(label, years) {
  if (!years) return label;
  return label.replace(/(\d{4})(?:–(\d{2}))?/, (_, y, yy) => `${Number(y) + years}${yy === undefined ? '' : `–${String((Number(yy) + years + 100) % 100).padStart(2, '0')}`}`);
}

// ---------- deterministic randomness ----------
function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(key) {
  const r = prng(seedOf(key));
  const R = {
    f: r,
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    pick: (xs) => xs[Math.floor(r() * xs.length)],
    chance: (p) => r() < p,
  };
  return R;
}
function shuffle(list, R) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(R.f() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);
const pad2 = (n) => String(n).padStart(2, '0');

// ---------- invented names ----------
const CITIES = [
  'Amberly', 'Ashford Bay', 'Bellmont', 'Birchview', 'Blackwater', 'Bramblecourt', 'Brightmoor', 'Calder Falls', 'Cedarholm', 'Clearbrook',
  'Coldspring', 'Coralport', 'Crestwood', 'Dalebrook', 'Dawnridge', 'Deepwell', 'Eastmere', 'Elmstead', 'Fallowmere', 'Fernhill',
  'Flintrock', 'Foxhaven', 'Glenwick', 'Granite Bay', 'Greystone', 'Hallowell', 'Harrowgate', 'Hollins Point', 'Ivybridge', 'Juniper Flats',
  'Kingsmere', 'Lakeview Ridge', 'Larkspur', 'Lindenfield', 'Maplecross', 'Marlow Heights', 'Millbrook', 'Moonvale', 'Northwick', 'Oakmont Springs',
  'Orchard Hill', 'Pebble Creek', 'Pinehurst Bend', 'Quillfield', 'Ravenmoor', 'Redwater', 'Ridgecrest', 'Rosemont', 'Saltcliff', 'Sandhaven',
  'Shadeport', 'Silverbrook', 'Southmere', 'Starling Bay', 'Stillwater Cross', 'Thornbury', 'Tidewell', 'Umberfield', 'Vale Crossing', 'Westbury Glen',
  'Whitlow', 'Willowmere', 'Wrenfield', 'Yarborough', 'Zinnia Point', 'Quarrytown',
];
const NICKS = {
  nba: ['Lanterns', 'Quills', 'Harriers', 'Tumblers', 'Embers', 'Wardens', 'Drifters', 'Fireflies', 'Monsoons', 'Tempos', 'Riveters', 'Alloys', 'Zephyrs', 'Kestrels', 'Beacons', 'Voyagers', 'Prowlers', 'Torrents'],
  nhl: ['Narwhals', 'Walruses', 'Sturgeons', 'Muskoxen', 'Caribou', 'Icebreakers', 'Ironclads', 'Galleons', 'Schooners', 'Harpoons', 'Tridents', 'Stokers', 'Sleet', 'Blizzards', 'Northerlies', 'Hailstones'],
  mlb: ['Millers', 'Masons', 'Sawyers', 'Coopers', 'Weavers', 'Thatchers', 'Chandlers', 'Drovers', 'Foragers', 'Trappers', 'Sentries', 'Heralds', 'Lamplighters', 'Wayfarers', 'Ferrymen', 'Tinkers', 'Clockworks', 'Pendulums'],
  college: [
    'Grackles', 'Curlews', 'Plovers', 'Bitterns', 'Waxwings', 'Nuthatches', 'Shrikes', 'Kingfishers', 'Petrels', 'Gannets', 'Egrets', 'Swifts',
    'Marmots', 'Stoats', 'Wombats', 'Tapirs', 'Okapis', 'Pangolins', 'Mongooses', 'Armadillos', 'Ibexes', 'Lynxes', 'Manatees', 'Muskies',
    'Thistles', 'Ironwoods', 'Sumacs', 'Briars', 'Foxgloves', 'Saguaros', 'Tumbleweeds', 'Cattails', 'Keystones', 'Sprockets', 'Bellows', 'Lodestones',
  ],
};
const PALETTE = ['#c8553d', '#2f6690', '#3a86ff', '#d4a017', '#e4572e', '#17becf', '#b8860b', '#8a6a52', '#7d8491', '#5b8e7d', '#9b5de5', '#4f772d', '#8d6e63', '#1d3557', '#6d597a', '#0077b6', '#a4161a', '#bc4749', '#8ecae6', '#606c38', '#90e0ef', '#ffd60a', '#bb3e03', '#e9d8a6', '#495057', '#48cae4', '#b5651d', '#2a9d8f', '#5c677d', '#023e8a', '#2d6a4f', '#6c757d', '#f4a261', '#e76f51', '#264653', '#9c6644'];
const SURNAMES = [
  'Achterberg', 'Adebayo', 'Albrecht', 'Amundsen', 'Arceneaux', 'Babatunde', 'Balogun', 'Barrientos', 'Bellweather', 'Brannigan', 'Castellano', 'Cervantes',
  'Dalgaard', 'Delacroix', 'Duchamp', 'Eberhardt', 'Ekwueme', 'Esposito', 'Fairweather', 'Fennimore', 'Galloway', 'Gudmundsson', 'Halvorsen', 'Hargreaves',
  'Ilunga', 'Iversen', 'Jankowski', 'Juarez', 'Kallstrom', 'Kowalczyk', 'Lachance', 'Lindqvist', 'Mbeki', 'Moravec', 'Nakashima', 'Nwachukwu',
  'Oyelaran', 'Ostrowski', 'Petrakis', 'Quaresma', 'Rasmussen', 'Rautenberg', 'Saarinen', 'Szabo', 'Tavares', 'Thorsby', 'Umeh', 'Valdivia',
  'Vasquez-Hale', 'Whitcombe', 'Wojcik', 'Yamamura', 'Zielinski', 'Okonjo', 'Brightwater', 'Castellanos', 'Ferreira', 'Holloway', 'Marchetti', 'Navarro',
];
const NETWORKS = {
  football: ['Gridcast', 'Arcline', 'Kettle TV', 'Northlight', 'Lumen5'],
  basketball: ['Courtside One', 'Arcline', 'Hoopline', 'Northlight', 'Kettle TV'],
  hockey: ['Rinkline', 'Northlight', 'Arcline', 'Coldfront TV'],
  baseball: ['Diamond Eight', 'Kettle TV', 'Arcline', 'Sandlot+'],
  college: ['Campus North', 'Quad Sports', 'Varsity 3', 'Arcline'],
};

function makeAbbr(city, used) {
  const letters = city.toUpperCase().replace(/[^A-Z]/g, '');
  const words = city.toUpperCase().split(/\s+/).filter(Boolean);
  const tries = [letters.slice(0, 3)];
  if (words.length > 1) tries.push(words[0][0] + words[1].slice(0, 2), words[0].slice(0, 2) + words[1][0]);
  for (let i = 1; i < letters.length - 1; i++) tries.push(letters[0] + letters[i] + letters[letters.length - 1]);
  for (const t of tries) if (t.length === 3 && !used.has(t)) return t;
  throw new Error(`no abbreviation for ${city}`);
}

// ---------- leagues, seasons, groups ----------
const LEAGUE_DEFS = [
  { id: 'nfl', short: 'NFL', option: 'NFL', name: 'Pro football', sport: 'football', format: 'quarters', periodKind: 'week', simNow: NFL_SIM_NOW, minutes: 195 },
  { id: 'nba', short: 'NBA', option: 'NBA', name: 'Pro basketball', sport: 'basketball', format: 'quarters', periodKind: 'date', simNow: NFL_SIM_NOW, minutes: 135, clockMin: 12 },
  { id: 'mlb', short: 'MLB', option: 'MLB', name: 'Pro baseball', sport: 'baseball', format: 'innings', periodKind: 'date', simNow: '2026-09-25T00:40:00Z', minutes: 180 },
  { id: 'nhl', short: 'NHL', option: 'NHL', name: 'Pro hockey', sport: 'hockey', format: 'periods', periodKind: 'date', simNow: NFL_SIM_NOW, minutes: 150, clockMin: 20 },
  { id: 'ncaaf', short: 'NCAAF', option: 'NCAAF', name: 'College football', sport: 'football', format: 'quarters', periodKind: 'week', simNow: '2026-11-14T21:40:00Z', minutes: 195 },
  { id: 'ncaab', short: 'NCAAB', option: 'NCAAB (men)', name: "Men's college basketball", sport: 'basketball', format: 'halves', periodKind: 'date', simNow: NFL_SIM_NOW, minutes: 120, clockMin: 20 },
  { id: 'ncaaw', short: 'NCAAW', option: 'NCAAW (women)', name: "Women's college basketball", sport: 'basketball', format: 'quarters', periodKind: 'date', simNow: NFL_SIM_NOW, minutes: 120, clockMin: 10 },
];
export const LEAGUES = Object.freeze(LEAGUE_DEFS.map((d) => Object.freeze({ id: d.id, short: d.short, option: d.option, name: d.name, sport: d.sport, format: d.format, periodKind: d.periodKind, simNow: d.simNow })));
export const LEAGUE_IDS = Object.freeze(LEAGUE_DEFS.map((d) => d.id));
const LEAGUE_BY_ID = new Map(LEAGUE_DEFS.map((d) => [d.id, d]));
export const DEFAULT_LEAGUE = 'nfl';

// Sport -> League in the Menu. Each league belongs to exactly one sport.
export const SPORT_GROUPS = Object.freeze([
  Object.freeze({ id: 'football', label: 'Football', leagues: Object.freeze(['nfl', 'ncaaf']) }),
  Object.freeze({ id: 'basketball', label: 'Basketball', leagues: Object.freeze(['nba', 'ncaab', 'ncaaw']) }),
  Object.freeze({ id: 'baseball', label: 'Baseball', leagues: Object.freeze(['mlb']) }),
  Object.freeze({ id: 'hockey', label: 'Hockey', leagues: Object.freeze(['nhl']) }),
]);
export const sportOfLeague = (id) => (SPORT_GROUPS.find((s) => s.leagues.includes(id)) || SPORT_GROUPS[0]).id;
export const DAILY_LEAGUES = Object.freeze(LEAGUE_DEFS.filter((d) => d.periodKind === 'date').map((d) => d.id));

const SEASON_DEFS = {
  nfl: [['2026', '2026 demo season', 0], ['2025', '2025 demo season', -364]],
  nba: [['2026-27', '2026–27 demo season', 0], ['2025-26', '2025–26 demo season', -364]],
  mlb: [['2026', '2026 demo season', 0], ['2025', '2025 demo season', -364]],
  nhl: [['2026-27', '2026–27 demo season', 0], ['2025-26', '2025–26 demo season', -364]],
  ncaaf: [['2026', '2026 demo season', 0], ['2025', '2025 demo season', -364]],
  ncaab: [['2026-27', '2026–27 demo season', 0], ['2025-26', '2025–26 demo season', -364]],
  ncaaw: [['2026-27', '2026–27 demo season', 0], ['2025-26', '2025–26 demo season', -364]],
};

const NFL_CONF = [['afc', 'AFC'], ['nfc', 'NFC']];
const NFL_DIV = [['east', 'East'], ['north', 'North'], ['south', 'South'], ['west', 'West']];
const PRO_GROUPS = {
  nba: { confs: [['east', 'Eastern'], ['west', 'Western']], divs: { east: [['harbor', 'Harbor'], ['ridge', 'Ridge'], ['lakes', 'Lakes']], west: [['canyon', 'Canyon'], ['summit', 'Summit'], ['coast', 'Coast']] } },
  nhl: { confs: [['east', 'Eastern'], ['west', 'Western']], divs: { east: [['shoreline', 'Shoreline'], ['midland', 'Midland']], west: [['frontier', 'Frontier'], ['highland', 'Highland']] } },
  mlb: { confs: [['al', 'American League'], ['nl', 'National League']], divs: { al: [['east', 'East'], ['central', 'Central'], ['west', 'West']], nl: [['east', 'East'], ['central', 'Central'], ['west', 'West']] } },
};
const COLLEGE_CONFS = {
  fbs: [['lakeshore', 'Lakeshore Conference'], ['prairie', 'Prairie Athletic'], ['coastal', 'Coastal Union'], ['highcountry', 'Highcountry Conference']],
  fcs: [['riverland', 'Riverland Conference'], ['piedmont', 'Piedmont League']],
};
const TOURNAMENT_NAMES = { ncaab: 'Riverlight Invitational', ncaaw: 'Summit Invitational' };

function buildProTeams(leagueId, cityOffset) {
  const g = PRO_GROUPS[leagueId];
  const nicks = NICKS[leagueId];
  const teams = [];
  const used = new Set();
  let i = 0;
  for (const [conf] of g.confs) {
    for (const [div] of g.divs[conf]) {
      const per = nicks.length / g.confs.length / g.divs[conf].length;
      for (let k = 0; k < per; k++) {
        const city = CITIES[(cityOffset + i * 7) % CITIES.length];
        const abbr = makeAbbr(city, used);
        used.add(abbr);
        teams.push({ abbr, city, nickname: nicks[i], name: `${city} ${nicks[i]}`, color: PALETTE[(i * 5 + cityOffset) % PALETTE.length], groups: { conference: conf, division: `${conf}-${div}`, subleague: conf } });
        i++;
      }
    }
  }
  return teams;
}

function buildCollegeTeams() {
  const teams = [];
  const used = new Set();
  let i = 0;
  for (const sub of ['fbs', 'fcs']) {
    for (const [conf] of COLLEGE_CONFS[sub]) {
      for (let k = 0; k < 6; k++) {
        const city = CITIES[(5 + i * 13) % CITIES.length];
        const abbr = makeAbbr(city, used);
        used.add(abbr);
        teams.push({ abbr, city, nickname: NICKS.college[i], name: `${city} ${NICKS.college[i]}`, color: PALETTE[(i * 7 + 3) % PALETTE.length], groups: { subdivision: sub, conference: conf } });
        i++;
      }
    }
  }
  return teams;
}

const TEAM_CACHE = new Map();
function leagueTeams(leagueId) {
  if (TEAM_CACHE.has(leagueId)) return TEAM_CACHE.get(leagueId);
  let list;
  if (leagueId === 'nfl') {
    const t = generateWeek().teams;
    list = Object.values(t).map((team, i) => ({ abbr: team.abbr, city: team.city, nickname: team.nickname, name: team.name, color: team.color, fixtureRecord: team.record, groups: { conference: i < 16 ? 'afc' : 'nfc', division: `${i < 16 ? 'afc' : 'nfc'}-${NFL_DIV[Math.floor((i % 16) / 4)][0]}` } }));
  } else if (leagueId === 'nba' || leagueId === 'nhl' || leagueId === 'mlb') {
    list = buildProTeams(leagueId, { nba: 0, nhl: 20, mlb: 40 }[leagueId]);
  } else {
    const all = buildCollegeTeams();
    list = leagueId === 'ncaaf' ? all : all.filter((t) => t.groups.subdivision === 'fbs').map((t) => ({ ...t, groups: { conference: t.groups.conference } }));
  }
  TEAM_CACHE.set(leagueId, list);
  return list;
}

// ---------- schedules (dates are Central calendar dates for the current season) ----------
const k = shiftKey;
const S = (date, time, count, scripts) => ({ date, time, count, scripts: scripts || null });
const reg = (id, label, slots, extra = {}) => ({ id, label, phase: 'regular', parts: [{ slots, ...extra }] });
const post = (id, label, slots, extra = {}) => ({ id, label, phase: 'post', parts: [{ slots, ...extra }] });

function nflWeek(thu) {
  const sun = k(thu, 3);
  return [S(thu, '19:15', 1), S(sun, '12:00', 9), S(sun, '15:05', 2), S(sun, '15:25', 2), S(sun, '19:20', 1), S(k(thu, 4), '19:15', 1)];
}
function ncaafWeek(sat, scripts) {
  return [S(k(sat, -2), '18:30', 1), S(k(sat, -1), '19:00', 1), S(sat, '11:00', 6), S(sat, '14:30', 6, scripts), S(sat, '18:30', 4)];
}

// Live states for each league's fixed simulated moment. Each one is chosen so a
// cue rule has a positive and a negative example on the current board.
const LIVE = {
  ncaaf: [
    { cue: 'TD', period: 2, clock: '11:32', possession: 'home', situation: { phase: 'kickoff', yardsToEndzone: 65 }, play: 'touchdown' },
    { cue: 'FG', period: 2, clock: '9:05', possession: 'away', situation: { phase: 'kickoff', yardsToEndzone: 65 }, play: 'field_goal' },
    { cue: 'SAFETY', period: 2, clock: '6:48', possession: 'home', situation: { phase: 'kickoff', yardsToEndzone: 80 }, play: 'safety' },
    { cue: 'PAT', period: 2, clock: '5:10', possession: 'away', situation: { phase: 'kickoff', yardsToEndzone: 65 }, play: 'pat' },
    { period: 2, clock: '3:22', possession: 'away', situation: { down: 2, distance: 4, yardsToEndzone: 12 }, play: 'run' },
    { period: 2, clock: '1:40', possession: 'home', situation: { down: 3, distance: 7, yardsToEndzone: 24 }, play: 'pass' },
  ],
  nba: [
    { period: 4, clock: '0:48' },
    { period: 3, clock: '1:35' },
    { period: 3, clock: '7:02', cue: 'BASKET' },
    { period: 2, clock: '1:24' },
    { period: 1, clock: '1:10' },
  ],
  ncaaw: [
    { period: 4, clock: '1:05' },
    { period: 3, clock: '0:45' },
    { period: 3, clock: '6:00', cue: 'BASKET' },
    { period: 2, clock: '1:50' },
    { period: 1, clock: '1:30' },
  ],
  ncaab: [
    { period: 2, clock: '0:55' },
    { period: 2, clock: '6:10' },
    { status: 'halftime', period: 1, clock: '0:00' },
    { period: 1, clock: '1:40' },
    { period: 1, clock: '9:00', cue: 'BASKET' },
  ],
  nhl: [
    { period: 3, clock: '0:40' },
    { period: 3, clock: '12:10', cue: 'GOAL' },
    { period: 2, clock: '8:00', missingShots: true },
    { period: 2, clock: '1:55', powerPlay: { side: 'home', clock: '1:12', strength: '5 on 4' } },
    { period: 1, clock: '1:30' },
  ],
  mlb: [
    { inning: 5, half: 'top', outs: 1, balls: 2, strikes: 1, bases: [false, true, false] },
    { inning: 5, half: 'bottom', outs: 2, balls: 0, strikes: 2, bases: [false, false, true] },
    { inning: 4, half: 'bottom', outs: 0, balls: 1, strikes: 0, bases: [true, false, false] },
    { inning: 6, half: 'top', outs: 2, balls: 3, strikes: 2, bases: [true, true, true] },
    { inning: 3, half: 'top', outs: 1, balls: 0, strikes: 0, bases: [false, false, false], cue: 'RUN' },
    { inning: 3, half: 'bottom', outs: 0, balls: 1, strikes: 1, bases: [false, false, false] },
  ],
};

function collegeBasketballSeason(leagueId) {
  const inv = TOURNAMENT_NAMES[leagueId];
  const live = LIVE[leagueId];
  const T = (tournament, round, roundLabel, roundTag, slots) => ({ tournament, round, roundLabel, roundTag, slots });
  return [
    reg('reg1', null, [S('2026-11-14', '11:00', 4), S('2026-11-14', '13:00', 4), S('2026-11-14', '17:00', 4)]),
    reg('reg2', null, [S('2026-11-15', '11:00', 3), S('2026-11-15', '13:00', 3), S('2026-11-15', '14:00', 1, [live[0]]), S('2026-11-15', '14:30', 2, [live[1], live[2]]), S('2026-11-15', '15:00', 1, [live[3]]), S('2026-11-15', '15:15', 1, [live[4]]), S('2026-11-15', '19:00', 1)]),
    reg('reg3', null, [S('2026-11-16', '18:00', 6), S('2026-11-16', '20:00', 6)]),
    { id: 'opening', label: 'Tournaments: opening week', phase: 'post', parts: [
      T('ncaa', 'first-four', 'First Four', 'NCAA First Four', [S('2027-03-16', '17:40', 2), S('2027-03-17', '17:40', 2)]),
      T('inv', 'inv-r1', 'First Round', `${inv.split(' ')[0]} First Round`, [S('2027-03-16', '18:00', 2), S('2027-03-17', '18:00', 2)]),
    ] },
    { id: 'weekend-1', label: 'Tournaments: first weekend', phase: 'post', parts: [
      T('ncaa', 'r64', 'First Round', 'NCAA First Round', [S('2027-03-18', '11:15', 4), S('2027-03-19', '11:15', 4)]),
      T('ncaa', 'r32', 'Second Round', 'NCAA Second Round', [S('2027-03-20', '11:00', 2), S('2027-03-21', '11:00', 2)]),
      T('inv', 'inv-r2', 'Second Round', `${inv.split(' ')[0]} Second Round`, [S('2027-03-20', '18:00', 2)]),
    ] },
    { id: 'weekend-2', label: 'Tournaments: second weekend', phase: 'post', parts: [
      T('ncaa', 's16', 'Sweet 16', 'NCAA Sweet 16', [S('2027-03-25', '18:00', 2), S('2027-03-26', '18:00', 2)]),
      T('ncaa', 'e8', 'Elite Eight', 'NCAA Elite Eight', [S('2027-03-27', '17:00', 1), S('2027-03-28', '16:00', 1)]),
      T('inv', 'inv-qf', 'Quarterfinals', `${inv.split(' ')[0]} Quarterfinal`, [S('2027-03-23', '18:00', 2)]),
    ] },
    { id: 'final-weekend', label: 'Tournaments: final weekend', phase: 'post', parts: [
      T('ncaa', 'f4', 'Final Four', 'NCAA Final Four', [S('2027-04-03', '17:00', 2)]),
      T('ncaa', 'title', 'Championship', 'NCAA Championship', [S('2027-04-05', '20:00', 1)]),
      T('inv', 'inv-sf', 'Semifinals', `${inv.split(' ')[0]} Semifinal`, [S('2027-03-30', '18:00', 2)]),
      T('inv', 'inv-final', 'Final', `${inv.split(' ')[0]} Final`, [S('2027-04-01', '18:00', 1)]),
    ] },
  ];
}

function seasonSpec(leagueId) {
  switch (leagueId) {
    case 'nfl':
      return [
        reg('w10', 'Week 10', nflWeek('2026-11-05')),
        reg('w11', 'Week 11', [], { fixture: true }),
        reg('w12', 'Week 12', nflWeek('2026-11-19')),
        post('wild-card', 'Wild Card round', [S('2027-01-16', '15:30', 1), S('2027-01-16', '19:15', 1), S('2027-01-17', '12:00', 1), S('2027-01-17', '15:30', 1), S('2027-01-17', '19:15', 1), S('2027-01-18', '19:15', 1)], { pairing: 'within' }),
        post('divisional', 'Divisional round', [S('2027-01-23', '15:30', 1), S('2027-01-23', '19:15', 1), S('2027-01-24', '14:00', 1), S('2027-01-24', '17:30', 1)], { pairing: 'within' }),
        post('conference', 'Conference championships', [S('2027-01-31', '14:00', 1), S('2027-01-31', '17:30', 1)], { pairing: 'within' }),
        post('championship', 'Championship game', [S('2027-02-14', '17:30', 1)], { pairing: 'across' }),
      ];
    case 'ncaaf':
      return [
        reg('w11', 'Week 11', ncaafWeek('2026-11-07'), { pairing: 'subdivision' }),
        reg('w12', 'Week 12', ncaafWeek('2026-11-14', LIVE.ncaaf), { pairing: 'subdivision' }),
        reg('w13', 'Week 13', ncaafWeek('2026-11-21'), { pairing: 'subdivision' }),
        post('playoff-r1', 'Playoff first round', [S('2026-12-18', '19:00', 1), S('2026-12-19', '11:00', 1), S('2026-12-19', '15:00', 1), S('2026-12-19', '19:00', 1)], { pool: 'fbs' }),
        post('bowls', 'Bowl games', [S('2026-12-26', '11:00', 2), S('2026-12-26', '14:30', 2), S('2026-12-28', '13:00', 2), S('2026-12-28', '17:00', 2)], { pool: 'fbs' }),
        post('quarterfinals', 'Playoff quarterfinals', [S('2026-12-31', '18:30', 1), S('2027-01-01', '12:00', 1), S('2027-01-01', '15:30', 1), S('2027-01-01', '19:00', 1)], { pool: 'fbs' }),
        post('semifinals', 'Playoff semifinals', [S('2027-01-08', '18:30', 1), S('2027-01-09', '18:30', 1)], { pool: 'fbs' }),
        post('championship', 'National championship', [S('2027-01-18', '18:30', 1)], { pool: 'fbs' }),
      ];
    case 'nba':
      return [
        reg('reg1', null, [S('2026-11-14', '18:00', 3), S('2026-11-14', '19:00', 3), S('2026-11-14', '21:00', 2), S('2026-11-14', '23:00', 1)]),
        reg('reg2', null, [S('2026-11-15', '12:00', 2), S('2026-11-15', '14:00', 1, [LIVE.nba[0]]), S('2026-11-15', '14:30', 2, [LIVE.nba[1], LIVE.nba[2]]), S('2026-11-15', '15:00', 1, [LIVE.nba[3]]), S('2026-11-15', '15:30', 1, [LIVE.nba[4]]), S('2026-11-15', '18:00', 1), S('2026-11-15', '21:30', 1)]),
        reg('reg3', null, [S('2026-11-16', '18:00', 3), S('2026-11-16', '19:00', 3), S('2026-11-16', '21:00', 3)]),
        post('play-in', 'Play-in tournament', [S('2027-04-13', '18:00', 1), S('2027-04-13', '20:30', 1), S('2027-04-14', '18:00', 1), S('2027-04-14', '20:30', 1)]),
        post('r1', 'First round', [S('2027-04-17', '12:00', 1), S('2027-04-17', '14:30', 1), S('2027-04-17', '17:00', 1), S('2027-04-17', '19:30', 1), S('2027-04-18', '12:00', 1), S('2027-04-18', '14:30', 1), S('2027-04-18', '17:00', 1), S('2027-04-18', '19:30', 1)]),
        post('r2', 'Conference semifinals', [S('2027-05-02', '12:00', 1), S('2027-05-02', '14:30', 1), S('2027-05-03', '18:00', 1), S('2027-05-03', '20:30', 1)]),
        post('cf', 'Conference finals', [S('2027-05-18', '19:30', 1), S('2027-05-19', '19:30', 1)]),
        post('finals', 'Finals', [S('2027-06-03', '19:30', 1)]),
      ];
    case 'nhl':
      return [
        reg('reg1', null, [S('2026-11-14', '12:00', 2), S('2026-11-14', '18:00', 3), S('2026-11-14', '19:00', 2), S('2026-11-14', '21:00', 1)]),
        reg('reg2', null, [S('2026-11-15', '11:30', 2), S('2026-11-15', '14:00', 2, [LIVE.nhl[0], LIVE.nhl[1]]), S('2026-11-15', '14:30', 1, [LIVE.nhl[2]]), S('2026-11-15', '15:00', 1, [LIVE.nhl[3]]), S('2026-11-15', '15:30', 1, [LIVE.nhl[4]]), S('2026-11-15', '19:00', 1)]),
        reg('reg3', null, [S('2026-11-16', '18:00', 4), S('2026-11-16', '19:00', 2), S('2026-11-16', '21:00', 2)]),
        post('r1', 'First round', [S('2027-04-24', '12:00', 1), S('2027-04-24', '14:30', 1), S('2027-04-24', '18:00', 1), S('2027-04-24', '20:30', 1), S('2027-04-25', '12:00', 1), S('2027-04-25', '14:30', 1), S('2027-04-25', '18:00', 1), S('2027-04-25', '20:30', 1)]),
        post('r2', 'Second round', [S('2027-05-08', '14:00', 1), S('2027-05-08', '19:00', 1), S('2027-05-09', '14:00', 1), S('2027-05-09', '19:00', 1)]),
        post('cf', 'Conference finals', [S('2027-05-22', '19:00', 1), S('2027-05-23', '19:00', 1)]),
        post('final', 'Final', [S('2027-06-06', '19:00', 1)]),
      ];
    case 'mlb':
      return [
        reg('reg1', null, [S('2026-09-23', '12:10', 2), S('2026-09-23', '18:10', 4), S('2026-09-23', '19:10', 2), S('2026-09-23', '23:40', 1)]),
        reg('reg2', null, [S('2026-09-24', '12:10', 2), S('2026-09-24', '18:10', 4, LIVE.mlb.slice(0, 4)), S('2026-09-24', '18:40', 2, LIVE.mlb.slice(4)), S('2026-09-24', '21:10', 1)]),
        reg('reg3', null, [S('2026-09-25', '18:10', 5), S('2026-09-25', '19:10', 2), S('2026-09-25', '21:10', 2)]),
        post('wild-card', 'Wild Card series', [S('2026-09-29', '12:00', 1), S('2026-09-29', '15:00', 1), S('2026-09-29', '18:00', 1), S('2026-09-29', '20:00', 1)]),
        post('division-series', 'Division series', [S('2026-10-03', '12:00', 1), S('2026-10-03', '15:00', 1), S('2026-10-03', '18:00', 1), S('2026-10-03', '20:00', 1)]),
        post('lcs', 'League championship series', [S('2026-10-11', '15:00', 1), S('2026-10-11', '19:00', 1)]),
        post('world-series', 'World Series', [S('2026-10-23', '19:00', 1)]),
      ];
    default:
      return collegeBasketballSeason(leagueId);
  }
}

// ---------- game states ----------
const clockStr = (sec) => `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;
const player = (R) => `${R.pick('ABCDEFGHJKLMNPRSTVWY'.split(''))}. ${R.pick(SURNAMES)}`;
function playTeam(R) {
  return R.chance(0.5) ? 'away' : 'home';
}

function footballLeaders(R, g) {
  const t = () => g[playTeam(R, g)];
  return {
    passing: { name: player(R), team: t(), yards: R.int(150, 340), line: `${R.int(14, 28)}/${R.int(29, 40)}, ${R.int(0, 3)} TD` },
    rushing: { name: player(R), team: t(), yards: R.int(40, 130), line: `${R.int(9, 24)} car${R.chance(0.5) ? ', 1 TD' : ''}` },
    receiving: { name: player(R), team: t(), yards: R.int(45, 140), line: `${R.int(3, 9)} rec${R.chance(0.4) ? ', 1 TD' : ''}` },
  };
}
const FB_Q = [0, 0, 3, 3, 7, 7, 7, 10, 14];
const FB_PLAYS = {
  touchdown: (n, t) => `${n} 12-yard touchdown run up the middle; ${t} lead after the score.`,
  field_goal: (n) => `${n} 38-yard field goal is GOOD.`,
  safety: (n) => `${n} is tackled in his own end zone for a safety.`,
  pat: (n) => `${n} extra point is GOOD.`,
  run: (n) => `${n} up the middle for 7 yards.`,
  pass: (n) => `${n} pass short left complete for 9 yards.`,
};
function footballState(R, g, def, live) {
  const s = { linescore: { away: [], home: [] } };
  if (!live) {
    for (let q = 0; q < 4; q++) {
      s.linescore.away.push(R.pick(FB_Q));
      s.linescore.home.push(R.pick(FB_Q));
    }
    if (sum(s.linescore.away) === sum(s.linescore.home)) {
      s.overtime = true;
      const win = R.chance(0.5) ? 'away' : 'home';
      s.linescore.away.push(win === 'away' ? 3 : 0);
      s.linescore.home.push(win === 'home' ? 3 : 0);
    }
    s.lastPlay = { type: 'run', text: `${player(R)} kneels to end the game.` };
    s.leaders = footballLeaders(R, g);
    return s;
  }
  const p = live.period ?? R.int(1, 4);
  for (let q = 0; q < p; q++) {
    s.linescore.away.push(q < p - 1 ? R.pick(FB_Q) : R.pick([0, 3, 7]));
    s.linescore.home.push(q < p - 1 ? R.pick(FB_Q) : R.pick([0, 3, 7]));
  }
  s.period = p;
  s.clock = live.clock ?? clockStr(R.int(30, 880));
  s.possession = live.possession ?? (R.chance(0.5) ? 'away' : 'home');
  s.situation = live.situation ?? { down: R.int(1, 3), distance: R.int(2, 10), yardsToEndzone: R.int(25, 75) };
  s.timeouts = { away: R.int(1, 3), home: R.int(1, 3) };
  s.redZone = Boolean(s.situation && s.situation.phase !== 'kickoff' && s.situation.yardsToEndzone <= 20);
  const kind = live.play ?? 'run';
  s.lastPlay = { type: kind, text: (FB_PLAYS[kind] || FB_PLAYS.run)(player(R), g[s.possession === 'away' ? 'home' : 'away']) };
  s.scoringCue = live.cue ?? null;
  s.leaders = footballLeaders(R, g);
  return s;
}

function basketballLeaders(R, g) {
  const t = () => g[playTeam(R, g)];
  return {
    points: { name: player(R), team: t(), value: R.int(14, 38), unit: 'pts', line: `${R.int(5, 14)}-${R.int(15, 24)} FG` },
    rebounds: { name: player(R), team: t(), value: R.int(6, 16), unit: 'reb', line: `${R.int(1, 5)} off` },
    assists: { name: player(R), team: t(), value: R.int(4, 13), unit: 'ast', line: `${R.int(0, 4)} TO` },
  };
}
function basketballState(R, g, def, live) {
  const halves = def.format === 'halves';
  const n = halves ? 2 : 4;
  const per = def.id === 'nba' ? [22, 34] : halves ? [26, 42] : [12, 24];
  const s = { linescore: { away: [], home: [] } };
  if (!live) {
    for (let i = 0; i < n; i++) {
      s.linescore.away.push(R.int(per[0], per[1]));
      s.linescore.home.push(R.int(per[0], per[1]));
    }
    if (sum(s.linescore.away) === sum(s.linescore.home)) {
      s.overtime = true;
      s.linescore.away.push(R.int(6, 12));
      s.linescore.home.push(sum(s.linescore.away) - sum(s.linescore.home) + R.int(1, 4)); // the home side wins in overtime
    }
    s.lastPlay = { type: 'free_throw', text: `${player(R)} makes free throw 2 of 2 to finish the scoring.` };
    s.leaders = basketballLeaders(R, g);
    return s;
  }
  const p = live.period ?? R.int(1, n);
  const frac = 1 - (Number(String(live.clock ?? '6:00').split(':')[0]) / def.clockMin);
  for (let i = 0; i < p; i++) {
    const full = i < p - 1 || live.status === 'halftime';
    s.linescore.away.push(full ? R.int(per[0], per[1]) : Math.round(R.int(per[0], per[1]) * Math.max(0.1, frac)));
    s.linescore.home.push(full ? R.int(per[0], per[1]) : Math.round(R.int(per[0], per[1]) * Math.max(0.1, frac)));
  }
  s.period = p;
  s.clock = live.clock ?? '6:00';
  if (live.status) s.status = live.status;
  s.possession = live.status === 'halftime' ? null : R.chance(0.5) ? 'away' : 'home';
  s.fouls = { away: R.int(1, 6), home: R.int(1, 6) };
  const bonusAt = def.id === 'nba' ? 5 : halves ? 7 : 5;
  s.bonus = s.fouls.away >= bonusAt ? 'home' : s.fouls.home >= bonusAt ? 'away' : null;
  s.timeouts = { away: R.int(1, def.id === 'nba' ? 7 : 4), home: R.int(1, def.id === 'nba' ? 7 : 4) };
  const shooter = player(R);
  s.lastPlay = live.cue === 'BASKET'
    ? { type: 'basket', text: `${shooter} makes a driving layup.` }
    : { type: 'shot', text: `${shooter} misses a 24-foot three-point jumper; defensive rebound.` };
  s.scoringCue = live.cue ?? null;
  s.leaders = basketballLeaders(R, g);
  return s;
}

function hockeyLeaders(R, g, shots) {
  const goalieSide = R.chance(0.5) ? 'home' : 'away';
  const faced = shots ? shots[goalieSide === 'home' ? 'away' : 'home'] : R.int(22, 36);
  const saves = Math.max(0, faced - R.int(0, 3));
  return {
    goals: { name: player(R), team: g[R.chance(0.5) ? 'away' : 'home'], value: R.int(1, 3), unit: 'G', line: `${R.int(2, 6)} shots` },
    assists: { name: player(R), team: g[R.chance(0.5) ? 'away' : 'home'], value: R.int(1, 3), unit: 'A', line: `${R.int(14, 24)}:${pad2(R.int(0, 59))} TOI` },
    saves: { name: player(R), team: g[goalieSide], value: saves, unit: 'saves', line: `${faced ? (saves / faced).toFixed(3).replace(/^0/, '') : '.000'} SV%` },
  };
}
function hockeyState(R, g, def, live) {
  const s = { linescore: { away: [], home: [] } };
  const per = () => R.pick([0, 0, 1, 1, 1, 2, 3]);
  if (!live) {
    for (let i = 0; i < 3; i++) {
      s.linescore.away.push(per());
      s.linescore.home.push(per());
    }
    if (sum(s.linescore.away) === sum(s.linescore.home)) {
      s.overtime = true;
      const win = R.chance(0.5) ? 'away' : 'home';
      s.linescore.away.push(win === 'away' ? 1 : 0);
      s.linescore.home.push(win === 'home' ? 1 : 0);
    }
    s.shots = { away: R.int(22, 38), home: R.int(22, 38) };
    s.lastPlay = { type: 'end', text: `${player(R)} clears the puck as the final horn sounds.` };
    s.leaders = hockeyLeaders(R, g, s.shots);
    return s;
  }
  const p = live.period ?? R.int(1, 3);
  for (let i = 0; i < p; i++) {
    s.linescore.away.push(per());
    s.linescore.home.push(per());
  }
  if (live.cue === 'GOAL') s.linescore.home[p - 1] += 1;
  s.period = p;
  s.clock = live.clock;
  s.shots = live.missingShots ? null : { away: R.int(8, 14) * p, home: R.int(8, 14) * p };
  if (live.missingShots) s.missing = ['shots'];
  s.powerPlay = live.powerPlay ?? null;
  s.lastPlay = live.cue === 'GOAL'
    ? { type: 'goal', text: `${player(R)} scores on a wrist shot from the left circle; assisted by ${player(R)}.` }
    : { type: 'save', text: `${player(R)} stops a point shot and covers the puck; faceoff in the zone.` };
  s.scoringCue = live.cue ?? null;
  s.leaders = hockeyLeaders(R, g, s.shots);
  return s;
}

function baseballLeaders(R, g) {
  const t = () => g[R.chance(0.5) ? 'away' : 'home'];
  return {
    batting: { name: player(R), team: t(), line: `${R.int(2, 4)}-for-${R.int(4, 5)}, ${R.pick(['2B', 'HR', '2 2B', '3B', 'BB'])}` },
    rbi: { name: player(R), team: t(), line: `${R.int(2, 5)} RBI` },
    pitching: { name: player(R), team: t(), line: `${R.int(5, 7)}.${R.int(0, 2)} IP, ${R.int(0, 3)} ER, ${R.int(4, 11)} K` },
  };
}
function baseballState(R, g, def, live) {
  const s = { linescore: { away: [], home: [] } };
  const inn = () => R.pick([0, 0, 0, 0, 0, 0, 1, 1, 2, 3]);
  if (!live) {
    for (let i = 0; i < 9; i++) {
      s.linescore.away.push(inn());
      s.linescore.home.push(inn());
    }
    let extra = 0;
    while (sum(s.linescore.away) === sum(s.linescore.home)) {
      extra++;
      s.linescore.away.push(extra >= 3 ? 1 : inn());
      s.linescore.home.push(extra >= 3 ? 0 : inn());
    }
    if (extra === 0 && sum(s.linescore.home.slice(0, 8)) > sum(s.linescore.away)) s.linescore.home[8] = null; // home led: bottom of the 9th not played
    s.innings = s.linescore.away.length;
    s.hits = { away: sum(s.linescore.away) + R.int(2, 6), home: sum(s.linescore.home) + R.int(2, 6) };
    s.errors = { away: R.int(0, 2), home: R.int(0, 2) };
    s.lastPlay = { type: 'out', text: `${player(R)} grounds out to shortstop to end the game.` };
    s.leaders = baseballLeaders(R, g);
    return s;
  }
  const top = live.half === 'top';
  for (let i = 0; i < live.inning; i++) s.linescore.away.push(i === live.inning - 1 && top ? (live.cue === 'RUN' ? 1 : 0) : inn());
  for (let i = 0; i < (top ? live.inning - 1 : live.inning); i++) s.linescore.home.push(i === live.inning - 1 ? (live.cue === 'RUN' ? 1 : 0) : inn());
  s.inning = live.inning;
  s.half = live.half;
  s.outs = live.outs;
  s.count = { balls: live.balls, strikes: live.strikes };
  s.bases = { first: live.bases[0], second: live.bases[1], third: live.bases[2] };
  s.batter = player(R);
  s.pitcher = player(R);
  s.possession = top ? 'away' : 'home'; // the batting team
  s.hits = { away: sum(s.linescore.away) + R.int(1, 4), home: sum(s.linescore.home) + R.int(1, 4) };
  s.errors = { away: R.int(0, 1), home: R.int(0, 1) };
  s.lastPlay = live.cue === 'RUN'
    ? { type: 'run', text: `${player(R)} doubles to left-center; ${player(R)} scores from second.` }
    : { type: 'pitch', text: `${s.batter} fouls off a fastball, ${live.balls}-${live.strikes} count.` };
  s.scoringCue = live.cue ?? null;
  s.leaders = baseballLeaders(R, g);
  return s;
}

const STATE = { football: footballState, basketball: basketballState, hockey: hockeyState, baseball: baseballState };

function makeGame({ def, season, period, part, slot, kickoff, away, home, id, script, R }) {
  const startMs = Date.parse(kickoff);
  const now = Date.parse(def.simNow);
  let status = 'scheduled';
  if (script) status = 'live';
  else if (startMs + def.minutes * 60000 <= now) status = 'final';
  else if (startMs <= now) status = 'live';
  const g = {
    id, league: def.id, sport: def.sport, format: def.format, season: season.id, periodId: period.id, phase: period.phase,
    tournament: part.tournament ?? null, round: part.round ?? null, roundLabel: part.roundLabel ?? null, roundTag: part.roundTag ?? null,
    away, home, kickoff, timeValid: true, status, network: R.pick(NETWORKS[def.id.startsWith('ncaa') ? 'college' : def.sport]),
    overtime: false, redZone: false, possession: null, situation: null, timeouts: null, lastPlay: null, leaders: null, linescore: null,
    period: null, clock: null, scoringCue: null, corrected: null, missing: [], simulated: true,
  };
  if (status !== 'scheduled') {
    const live = status === 'live' ? (script ?? {}) : null;
    Object.assign(g, STATE[def.sport](R, g, def, live));
    if (g.status === 'halftime') g.possession = null;
  }
  g.total = g.linescore ? { away: sum(g.linescore.away), home: sum(g.linescore.home) } : null;
  return g;
}

function pairTeams(teams, part, R, need) {
  const kind = part.pairing || (part.pool ? 'pool' : 'any');
  let pairs = [];
  if (kind === 'subdivision') {
    for (const sub of ['fbs', 'fcs']) {
      const pool = shuffle(teams.filter((t) => t.groups.subdivision === sub), R);
      for (let i = 0; i + 1 < pool.length; i += 2) pairs.push([pool[i], pool[i + 1]]);
    }
    pairs = shuffle(pairs, R);
  } else if (kind === 'within' || kind === 'across') {
    const confs = [...new Set(teams.map((t) => t.groups.conference))];
    const pools = confs.map((c) => shuffle(teams.filter((t) => t.groups.conference === c), R));
    if (kind === 'across') pairs.push([pools[0][0], pools[1][0]]);
    else for (let i = 0; pairs.length < need; i++) for (const pool of pools) if (pairs.length < need) pairs.push([pool[2 * i], pool[2 * i + 1]]);
  } else {
    const pool = shuffle(kind === 'pool' ? teams.filter((t) => t.groups.subdivision === part.pool) : teams, R);
    for (let i = 0; i + 1 < pool.length; i += 2) pairs.push([pool[i], pool[i + 1]]);
  }
  if (pairs.length < need) throw new Error(`not enough teams for ${need} games`);
  return pairs.slice(0, need);
}

function recordFor(def, R) {
  switch (def.id) {
    case 'nfl':
    case 'ncaaf': {
      const w = R.int(1, 9);
      return `${w}-${10 - w}`;
    }
    case 'nba': {
      const w = R.int(2, 10);
      return `${w}-${12 - w}`;
    }
    case 'nhl': {
      const w = R.int(4, 11);
      const o = R.int(0, 3);
      return `${w}-${16 - w - o}-${o}`;
    }
    case 'mlb': {
      const w = R.int(66, 97);
      return `${w}-${155 - w}`;
    }
    default: {
      const w = R.int(0, 3);
      return `${w}-${3 - w}`;
    }
  }
}

// ---------- derived drive and team stats (invented, deterministic) ----------
// A separate seeded stream per game, so the original games stay byte-for-byte
// what they were.
const IN_PROGRESS = new Set(['live', 'halftime', 'end_period', 'delayed', 'suspended']);
const HAS_STATS = new Set([...IN_PROGRESS, 'final']);
const towards = (side) => (side === 'away' ? 'right' : 'left'); // the away end zone is drawn on the left

// Field positions are yards to the offense's goal line (0 = in the end zone it
// attacks, 100 = its own goal line). start - yards = end for every drive.
function footballDrive(g, R) {
  const s = g.situation;
  if (s && g.possession && s.phase !== 'kickoff' && Number.isFinite(s.yardsToEndzone)) {
    const end = s.yardsToEndzone;
    const room = 99 - end;
    const series = !s.goalToGo && Number.isInteger(s.down) && s.down >= 2 && Number.isFinite(s.distance) ? Math.max(0, 10 - s.distance) : 0;
    const least = Math.max(series, s.down === 1 && !s.goalToGo && s.distance === 10 ? 10 : 1);
    const yards = room < least ? Math.max(0, Math.min(room, series)) : R.int(least, Math.min(room, 75));
    const downs = Number.isInteger(s.down) ? s.down - 1 : 0;
    const plays = Math.max(yards > 0 ? 1 : 0, downs + Math.ceil(Math.max(0, yards - series) / 6));
    return { team: g.possession, direction: towards(g.possession), start: end + yards, end, yards, plays, inProgress: true, result: null };
  }
  if (s && g.possession && s.phase === 'kickoff') {
    // The kicking team's drive that just ended.
    const team = g.possession;
    const type = g.lastPlay ? g.lastPlay.type : null;
    if (type === 'safety') {
      const start = R.int(88, 97);
      return { team, direction: towards(team), start, end: 100, yards: start - 100, plays: R.int(1, 3), inProgress: false, result: 'Safety' };
    }
    const fg = type === 'field_goal';
    const end = fg ? R.int(4, 30) : 0;
    const yards = R.int(35, Math.min(85, 99 - end));
    return { team, direction: towards(team), start: end + yards, end, yards, plays: Math.max(1, Math.round(yards / 7)) + R.int(0, 3), inProgress: false, result: fg ? 'Field goal' : 'Touchdown' };
  }
  // No live field position in the data: the last completed drive, read from the score.
  const ls = g.linescore || { away: [], home: [] };
  const last = (side) => {
    for (let i = ls[side].length - 1; i >= 0; i--) if (ls[side][i]) return [i, ls[side][i]];
    return [-1, 0];
  };
  const [ia, pa] = last('away');
  const [ih, ph] = last('home');
  const team = !pa && !ph ? 'away' : !ph || (pa && ia >= ih) ? 'away' : 'home';
  const pts = team === 'away' ? pa : ph;
  if (!pts) {
    const start = R.int(70, 85);
    const end = R.int(45, start - 5);
    return { team, direction: towards(team), start, end, yards: start - end, plays: R.int(3, 6), inProgress: false, result: 'Punt' };
  }
  const fg = pts % 3 === 0 && pts % 7 !== 0;
  const end = fg ? R.int(4, 30) : 0;
  const yards = R.int(35, Math.min(85, 99 - end));
  return { team, direction: towards(team), start: end + yards, end, yards, plays: Math.max(1, Math.round(yards / 7)) + R.int(0, 3), inProgress: false, result: fg ? 'Field goal' : 'Touchdown' };
}

function clockMinutes(clock) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(clock ?? ''));
  return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
}

// How much of a regulation game has been played (1 for a final).
function playedShare(g) {
  if (g.status === 'final') return 1;
  if (g.sport === 'baseball') return Math.min(1, Math.max(0.1, ((g.inning ?? 1) - (g.half === 'top' ? 0.75 : 0.25)) / 9));
  const periods = { quarters: 4, halves: 2, periods: 3 }[g.format] || 4;
  const length = g.sport === 'football' ? 15 : g.sport === 'hockey' ? 20 : g.format === 'halves' ? 20 : g.league === 'nba' ? 12 : 10;
  const into = g.status === 'halftime' ? 1 : Math.min(1, Math.max(0, 1 - clockMinutes(g.clock) / length));
  return Math.min(1.25, Math.max(0.05, ((g.period ?? 1) - 1 + into) / periods));
}

function basketballStats(points, R, share) {
  // points = 2 x FGM + 3PM + FTM (FGM counts the threes)
  const t0 = R.int(0, Math.floor(points / 8));
  const f0 = R.int(0, Math.floor(points / 5));
  let pick = null;
  for (let t = t0; t >= 0 && !pick; t--) {
    for (let f = f0; f >= 0; f--) {
      const rest = points - t - f;
      if (rest >= 2 * t && rest % 2 === 0) {
        pick = [t, f];
        break;
      }
    }
  }
  const [threes, ftm] = pick || [0, points % 2];
  const fgm = (points - threes - ftm) / 2;
  const threeA = threes + R.int(Math.ceil(threes * 0.8), threes * 2 + 3);
  const fga = Math.max(fgm + R.int(Math.ceil(fgm * 0.5), fgm + 4), threeA + (fgm - threes));
  const fta = ftm + R.int(Math.ceil(ftm * 0.15), Math.ceil(ftm * 0.4) + 1);
  return {
    points, fgm, fga, threes, threeA, ftm, fta,
    rebounds: Math.round(R.int(34, 50) * Math.min(1, share)),
    assists: Math.min(fgm, Math.round(R.int(16, 30) * Math.min(1, share))),
    turnovers: Math.round(R.int(8, 16) * Math.min(1, share)),
  };
}

function teamStatsFor(g, R) {
  const share = playedShare(g);
  const sides = ['away', 'home'];
  const out = { simulated: true, away: null, home: null };
  if (g.sport === 'football') {
    for (const side of sides) {
      const passingYards = Math.round(R.int(150, 330) * share);
      const rushingYards = Math.round(R.int(50, 170) * share);
      const totalYards = passingYards + rushingYards;
      const penalties = R.int(0, Math.max(1, Math.round(9 * share)));
      out[side] = { points: g.total[side], totalYards, passingYards, rushingYards, firstDowns: Math.round(totalYards / R.int(13, 17)), turnovers: R.int(0, share < 0.5 ? 1 : 3), penalties, penaltyYards: penalties * R.int(5, 9) };
    }
  } else if (g.sport === 'basketball') {
    for (const side of sides) out[side] = basketballStats(g.total[side], R, share);
  } else if (g.sport === 'hockey') {
    const opp = { away: R.int(0, 5), home: R.int(0, 5) };
    const faceoffs = Math.max(4, Math.round(R.int(48, 64) * Math.min(1, share)));
    const awayWins = R.int(Math.floor(faceoffs * 0.35), Math.ceil(faceoffs * 0.65));
    for (const side of sides) {
      const other = side === 'away' ? 'home' : 'away';
      const goals = g.total[side];
      out[side] = {
        goals,
        shots: g.shots ? g.shots[side] : null,
        powerPlayGoals: Math.min(goals, opp[side], R.int(0, 2)),
        powerPlays: opp[side],
        faceoffsWon: side === 'away' ? awayWins : faceoffs - awayWins,
        hits: Math.round(R.int(14, 32) * Math.min(1, share)),
        penaltyMinutes: 2 * (opp[other] + R.int(0, 2)), // every power play the other side had came from a minor here
      };
    }
  } else if (g.sport === 'baseball') {
    for (const side of sides) {
      const runs = g.total[side];
      const hits = g.hits ? g.hits[side] : null;
      out[side] = {
        runs, hits, errors: g.errors ? g.errors[side] : null,
        homeRuns: hits === null ? 0 : R.int(0, Math.min(hits, runs, 3)),
        walks: Math.round(R.int(1, 6) * share),
        strikeouts: Math.round(R.int(4, 12) * share),
        leftOnBase: Math.round(R.int(2, 10) * share),
      };
    }
  }
  return out;
}

function withDerived(g) {
  const R = rng(`${g.id}|derived`);
  g.drive = g.sport === 'football' && IN_PROGRESS.has(g.status) ? footballDrive(g, R) : null;
  g.teamStats = HAS_STATS.has(g.status) && g.linescore && g.total ? teamStatsFor(g, R) : null;
  return g;
}

// The canonical g11-112 (YWK 3, ZHG 0, Q1 2:05, live) has no position, situation
// or last play in its raw fixture. Invented current state, after YWK's field
// goal and kickoff: ZHG has the ball, 2nd & 6 at its own 41, 16 yards in 2 plays
// from its own 25. No score is added; score, clock, status, linescore, network,
// timeouts and leaders stay as they are, and only the supplied fields leave the
// missing list. Applied after withDerived, so the seeded team stats are unchanged.
const CANONICAL_CURRENT = Object.freeze({
  'g11-112': Object.freeze({
    possession: 'home',
    situation: Object.freeze({ down: 2, distance: 6, yardsToEndzone: 59 }),
    lastPlay: Object.freeze({ type: 'run', text: 'P. Moravec runs off right tackle for 4 yards to the ZHG 41.' }),
    drive: Object.freeze({ team: 'home', direction: 'left', start: 75, end: 59, yards: 16, plays: 2, inProgress: true, result: null }),
  }),
});

function withCurrent(g, current) {
  if (!current) return g;
  g.possession = current.possession;
  g.situation = { ...current.situation };
  g.lastPlay = { ...current.lastPlay };
  g.drive = { ...current.drive };
  g.missing = g.missing.filter((k) => !['possession', 'situation', 'lastPlay'].includes(k));
  return g;
}

function buildSeason(leagueId, seasonId, injectedWeek, dayShift = 0) {
  const def = LEAGUE_BY_ID.get(leagueId);
  const sdef = SEASON_DEFS[leagueId].find((s) => s[0] === seasonId);
  const season = { id: sdef[0], label: shiftSeasonLabel(sdef[1], yearsOf(dayShift)), shift: sdef[2], current: sdef[2] === 0 };
  const base = leagueTeams(leagueId);
  const R0 = rng(`${leagueId}|${seasonId}|records`);
  const teams = {};
  const useFixture = leagueId === 'nfl' && season.current;
  for (const t of base) teams[t.abbr] = { abbr: t.abbr, city: t.city, nickname: t.nickname, name: t.name, color: t.color, groups: t.groups, record: useFixture ? t.fixtureRecord : recordFor(def, R0), rank: null };
  if (leagueId.startsWith('ncaa')) {
    const rankable = shuffle(base.filter((t) => leagueId !== 'ncaaf' || t.groups.subdivision === 'fbs'), R0);
    rankable.slice(0, 16).forEach((t, i) => {
      teams[t.abbr].rank = i + 1;
    });
  }
  const specs = seasonSpec(leagueId);
  const periods = [];
  const games = [];
  for (const spec of specs) {
    const period = { id: spec.id, label: spec.label, phase: spec.phase, kind: spec.phase === 'post' ? 'round' : def.periodKind, tournaments: [] };
    periods.push(period);
    if (spec.parts[0].fixture) {
      const week = injectedWeek || generateWeek();
      const fx = useFixture ? week.games : null;
      if (fx) {
        for (const fg of fx) games.push(withCurrent(withDerived({ ...structuredClone(fg), id: `nfl-${seasonId}-${fg.id}`, localId: fg.id, league: 'nfl', sport: 'football', format: 'quarters', season: seasonId, periodId: spec.id, phase: 'regular', tournament: null, round: null, roundLabel: null, roundTag: null, simulated: true }), injectedWeek ? null : CANONICAL_CURRENT[fg.id]));
        period.start = Math.min(...fx.map((g) => Date.parse(g.kickoff)).filter(Number.isFinite));
        period.end = Math.max(...fx.map((g) => Date.parse(g.kickoff)).filter(Number.isFinite));
        continue;
      }
      spec.parts[0].slots = nflWeek('2026-11-12');
    }
    let idx = 0;
    const R = rng(`${leagueId}|${seasonId}|${spec.id}`);
    for (const part of spec.parts) {
      const need = part.slots.reduce((a, s) => a + s.count, 0);
      const pairs = pairTeams(base, part, R, need);
      if (part.tournament && !period.tournaments.includes(part.tournament)) period.tournaments.push(part.tournament);
      let p = 0;
      for (const slot of part.slots) {
        const date = season.shift ? shiftKey(slot.date, season.shift) : slot.date;
        for (let n = 0; n < slot.count; n++) {
          const [a, h] = pairs[p++];
          idx++;
          const kickoff = zonedToUtc(date, slot.time, DEFAULT_ZONE);
          const script = season.current && slot.scripts ? slot.scripts[n] ?? null : null;
          const id = `${leagueId}-${seasonId}-${spec.id}-${part.round ? `${part.round}-` : ''}${pad2(idx)}`;
          const game = makeGame({ def, season, period, part, slot, kickoff, away: a.abbr, home: h.abbr, id, script, R });
          // Status, scores and plays come from the authored moment above; an
          // anchored schedule only moves the start to the same wall-clock time
          // on the moved calendar date.
          if (dayShift) game.kickoff = zonedToUtc(shiftKey(date, dayShift), slot.time, DEFAULT_ZONE);
          games.push(withDerived(game));
        }
      }
    }
    const times = games.filter((g) => g.periodId === spec.id).map((g) => Date.parse(g.kickoff));
    period.start = Math.min(...times);
    period.end = Math.max(...times);
  }
  return { def, season, teams, periods, games, dayShift };
}

// ---------- the catalog ----------
const clockMs = (now) => (now instanceof Date ? now.getTime() : Number.isFinite(now) ? Number(now) : null);

export function buildCatalog({ nflWeek = null, now = null } = {}) {
  const clock = clockMs(now);
  const cache = new Map();
  const leagueDef = (id) => LEAGUE_BY_ID.get(id) || LEAGUE_BY_ID.get(DEFAULT_LEAGUE);
  // Whole days a daily league's schedule moves so its original current slate
  // falls on today in `zone`; 0 for football and for a catalog without a clock.
  function anchorDays(leagueId, zone = DEFAULT_ZONE) {
    const def = leagueDef(leagueId);
    if (clock === null || def.periodKind !== 'date') return 0;
    const z = validZone(zone);
    return dayDiff(localDateKey(def.simNow, z), localDateKey(new Date(clock).toISOString(), z));
  }
  function data(leagueId, seasonId, zone = DEFAULT_ZONE) {
    const days = anchorDays(leagueId, zone);
    const key = `${leagueId}|${seasonId}|${days}`;
    if (!cache.has(key)) cache.set(key, buildSeason(leagueId, seasonId, nflWeek, days));
    return cache.get(key);
  }
  const seasons = (leagueId, zone = DEFAULT_ZONE) => {
    const id = leagueDef(leagueId).id;
    const years = yearsOf(anchorDays(id, zone));
    return SEASON_DEFS[id].map(([sid, label, shift]) => ({ id: sid, label: shiftSeasonLabel(label, years), current: shift === 0 }));
  };
  // A season's simulated moment: the league's authored moment, moved with its
  // season and with the anchor (same Central wall-clock time).
  const simNowOf = (d) => shiftWallClock(new Date(Date.parse(d.def.simNow) + d.season.shift * 86400000).toISOString(), d.dayShift);

  // Today's date in `zone`: the clock's date, or without a clock the league's
  // simulated current date.
  function todayKey(leagueId, zone = DEFAULT_ZONE) {
    const z = validZone(zone);
    if (clock !== null) return localDateKey(new Date(clock).toISOString(), z);
    const def = leagueDef(leagueId);
    return localDateKey(simNowOf(data(def.id, SEASON_DEFS[def.id][0][0], z)), z);
  }

  // Periods in the screen's zone: date periods are the calendar dates the
  // regular-season games fall on there; weeks and rounds are fixed.
  function periods(leagueId, seasonId, zone) {
    const z = validZone(zone);
    const d = data(leagueId, seasonId, z);
    if (d.def.periodKind !== 'date') return d.periods.map((p) => ({ id: p.id, label: p.label, phase: p.phase, kind: p.kind, tournaments: p.tournaments }));
    const keys = [...new Set(d.games.filter((g) => g.phase === 'regular').map((g) => localDateKey(g.kickoff, z)))].sort();
    const out = keys.map((key) => ({ id: `d${key}`, label: dateKeyLabel(key), phase: 'regular', kind: 'date', dateKey: key, tournaments: [] }));
    for (const p of d.periods) if (p.phase === 'post') out.push({ id: p.id, label: p.label, phase: p.phase, kind: p.kind, tournaments: p.tournaments });
    return out;
  }

  function defaultPeriod(leagueId, seasonId, zone) {
    const z = validZone(zone);
    const d = data(leagueId, seasonId, z);
    const list = periods(leagueId, seasonId, z);
    const now = Date.parse(simNowOf(d));
    if (d.def.periodKind === 'date') {
      // The season's simulated current date (today for an anchored current
      // season). A date without games stays that date: never another day's games.
      const key = localDateKey(new Date(now).toISOString(), z);
      const hit = list.find((p) => p.dateKey === key);
      return hit ? hit.id : `d${key}`;
    }
    const hit = d.periods.find((p) => p.phase === 'regular' && now >= p.start - 3 * 86400000 && now <= p.end + 86400000);
    return (hit || d.periods[0]).id;
  }

  // The same place in another season: same week or round id, or the same
  // position among the regular-season dates.
  function equivalentPeriod(leagueId, fromSeason, toSeason, periodId, zone) {
    const to = periods(leagueId, toSeason, zone);
    if (to.some((p) => p.id === periodId)) return periodId;
    const def = leagueDef(leagueId);
    const day = /^d(\d{4}-\d{2}-\d{2})$/.exec(String(periodId));
    if (def.periodKind === 'date' && day && validDateKey(day[1])) {
      // The same day of the other demo season: the seasons are a fixed number of days apart.
      const shift = (id) => (SEASON_DEFS[def.id].find((s) => s[0] === id) || [0, 0, 0])[2];
      return `d${shiftKey(day[1], shift(toSeason) - shift(fromSeason))}`;
    }
    const from = periods(leagueId, fromSeason, zone).filter((p) => p.phase === 'regular');
    const i = from.findIndex((p) => p.id === periodId);
    const regs = to.filter((p) => p.phase === 'regular');
    if (i >= 0 && regs.length) return regs[Math.min(i, regs.length - 1)].id;
    return defaultPeriod(leagueId, toSeason, zone);
  }

  const teamOf = (d, abbr) => d.teams[abbr];
  const either = (d, g, fn) => fn(teamOf(d, g.away)) || fn(teamOf(d, g.home));

  // Filter controls for a league, in cascade order. A later control's options
  // depend only on the earlier ones; hidden controls hold their default.
  function controlDefs(leagueId) {
    const def = leagueDef(leagueId);
    const id = def.id;
    if (id === 'nfl' || id === 'nba' || id === 'nhl' || id === 'mlb') {
      const g = id === 'nfl' ? { confs: NFL_CONF, divs: { afc: NFL_DIV, nfc: NFL_DIV } } : PRO_GROUPS[id];
      const confKey = id === 'mlb' ? 'subleague' : 'conference';
      const confShort = (c) => (id === 'mlb' ? { al: 'AL', nl: 'NL' }[c] : id === 'nfl' ? c.toUpperCase() : null);
      return [
        {
          key: confKey, label: id === 'mlb' ? 'AL / NL' : 'Conference', all: id === 'mlb' ? 'Both leagues' : 'All conferences',
          options: () => g.confs.map(([v, l]) => ({ value: v, label: l })),
          match: (d, game, v) => either(d, game, (t) => t.groups[confKey] === v),
        },
        {
          key: 'division', label: 'Division', all: 'All divisions', parent: confKey,
          options: (ctx) => g.confs.filter(([c]) => ctx.values[confKey] === 'all' || ctx.values[confKey] === c).flatMap(([c, cl]) => g.divs[c].map(([v, l]) => ({ value: `${c}-${v}`, label: confShort(c) ? `${confShort(c)} ${l}` : `${l} (${cl})` }))),
          match: (d, game, v) => either(d, game, (t) => t.groups.division === v),
        },
      ];
    }
    if (id === 'ncaaf') {
      return [
        { key: 'subdivision', label: 'Subdivision', all: 'FBS and FCS', options: () => [{ value: 'fbs', label: 'FBS' }, { value: 'fcs', label: 'FCS' }], match: (d, game, v) => either(d, game, (t) => t.groups.subdivision === v) },
        {
          key: 'conference', label: 'Conference', all: 'All conferences', parent: 'subdivision',
          options: (ctx) => ['fbs', 'fcs'].filter((s) => ctx.values.subdivision === 'all' || ctx.values.subdivision === s).flatMap((s) => COLLEGE_CONFS[s].map(([v, l]) => ({ value: v, label: l }))),
          match: (d, game, v) => either(d, game, (t) => t.groups.conference === v),
        },
        rankingControl((ctx) => ctx.values.subdivision !== 'fcs'),
      ];
    }
    const inv = TOURNAMENT_NAMES[id];
    return [
      {
        key: 'conference', label: 'Conference', all: 'All conferences', visible: (ctx) => ctx.period.phase === 'regular',
        options: () => COLLEGE_CONFS.fbs.map(([v, l]) => ({ value: v, label: l })), match: (d, game, v) => either(d, game, (t) => t.groups.conference === v),
      },
      rankingControl((ctx) => ctx.period.phase === 'regular'),
      {
        key: 'tournament', label: 'Tournament', all: null, defaultValue: 'ncaa', visible: (ctx) => ctx.period.phase === 'post',
        options: (ctx) => [...(ctx.period.tournaments.includes('ncaa') ? [{ value: 'ncaa', label: 'NCAA tournament' }] : []), ...(ctx.period.tournaments.includes('inv') ? [{ value: 'inv', label: inv }] : []), { value: 'all', label: 'All tournaments' }],
        match: (d, game, v) => v === 'all' || game.tournament === v,
      },
      {
        key: 'round', label: 'Round', all: 'All rounds', parent: 'tournament', visible: (ctx) => ctx.period.phase === 'post' && ctx.values.tournament !== 'all',
        options: (ctx) => {
          const seen = new Map();
          for (const game of ctx.periodGames) if (game.tournament === ctx.values.tournament && !seen.has(game.round)) seen.set(game.round, game.roundLabel);
          return [...seen].map(([v, l]) => ({ value: v, label: l }));
        },
        match: (d, game, v) => game.round === v,
      },
    ];
  }

  function rankingControl(visible) {
    return {
      key: 'ranking', label: 'Ranking', all: 'All teams', visible,
      options: () => [{ value: 'top25', label: 'Top 25' }, { value: 'top10', label: 'Top 10' }],
      match: (d, game, v) => either(d, game, (t) => t.rank !== null && t.rank <= (v === 'top10' ? 10 : 25)),
    };
  }

  function periodGames(d, period, zone) {
    if (period.kind === 'date') return d.games.filter((g) => g.phase === 'regular' && localDateKey(g.kickoff, zone) === period.dateKey);
    return d.games.filter((g) => g.periodId === period.id);
  }

  // Regular-season games per calendar date in `zone` (the calendar's marks).
  const dayCache = new Map();
  function dayCounts(d, zone) {
    const key = `${d.def.id}|${d.season.id}|${d.dayShift}|${zone}`;
    if (!dayCache.has(key)) {
      const m = new Map();
      for (const g of d.games) if (g.phase === 'regular') m.set(localDateKey(g.kickoff, zone), (m.get(localDateKey(g.kickoff, zone)) ?? 0) + 1);
      dayCache.set(key, m);
    }
    return dayCache.get(key);
  }

  // A chosen calendar date without games still gets its own period, so the
  // board says "No games" for that date instead of showing another date.
  function withDate(list, key) {
    const day = { id: `d${key}`, label: dateKeyLabel(key), phase: 'regular', kind: 'date', dateKey: key, tournaments: [] };
    const regular = [...list.filter((p) => p.phase === 'regular'), day].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
    return [...regular, ...list.filter((p) => p.phase !== 'regular')];
  }

  // Validate a requested view and cascade its filters. Unknown or no longer
  // valid values fall back to the default; a control that does not apply in
  // this context is hidden and holds its default.
  function resolve(input = {}, zone = DEFAULT_ZONE) {
    const z = validZone(zone);
    const def = leagueDef(input.league);
    const seasonList = seasons(def.id, z);
    const season = seasonList.find((s) => s.id === input.season) || seasonList[0];
    const d = data(def.id, season.id, z);
    const daily = def.periodKind === 'date';
    let plist = periods(def.id, season.id, z);
    const asked = daily ? /^d(\d{4}-\d{2}-\d{2})$/.exec(String(input.period ?? '')) : null;
    if (asked && validDateKey(asked[1]) && !plist.some((p) => p.id === input.period)) plist = withDate(plist, asked[1]);
    let period = plist.find((p) => p.id === input.period);
    if (!period) {
      const id = defaultPeriod(def.id, season.id, z);
      if (!plist.some((p) => p.id === id)) plist = withDate(plist, id.slice(1));
      period = plist.find((p) => p.id === id);
    }
    const pgames = periodGames(d, period, z);
    const values = {};
    const controls = [];
    for (const c of controlDefs(def.id)) {
      const ctx = { values, period, periodGames: pgames };
      const visible = c.visible ? c.visible(ctx) : true;
      const opts = visible ? [...(c.all ? [{ value: 'all', label: c.all }] : []), ...c.options(ctx)] : [];
      const fallback = c.defaultValue ?? 'all';
      let v = input.filters ? input.filters[c.key] : undefined;
      if (!visible || !opts.some((o) => o.value === v)) v = visible && !opts.some((o) => o.value === fallback) ? opts[0].value : fallback;
      values[c.key] = v;
      controls.push({ key: c.key, label: c.label, visible, options: opts, value: v, isDefault: v === fallback, parent: c.parent ?? null, def: c });
    }
    let games = pgames;
    for (const c of controls) if (c.visible && c.value !== 'all') games = games.filter((g) => c.def.match(d, g, c.value));
    const active = [];
    for (const c of controls) {
      if (!c.visible || c.value === 'all') continue;
      const child = controls.find((x) => x.parent === c.key && x.visible && x.value !== 'all');
      if (child && c.key !== 'tournament') continue; // the more specific group says it
      active.push(c.options.find((o) => o.value === c.value).label);
    }
    const view = { league: def.id, season: season.id, period: period.id, filters: { ...values } };
    return {
      view, zone: z, league: LEAGUES.find((l) => l.id === def.id), season, seasons: seasonList, period, periods: plist,
      controls: controls.map(({ def: _d, ...rest }) => rest), games, periodGames: pgames, teams: d.teams, active,
      filtersActive: controls.some((c) => c.visible && !c.isDefault), simNow: simNowOf(d),
      daily, today: daily ? todayKey(def.id, z) : null, gameDays: daily ? dayCounts(d, z) : null,
    };
  }

  function defaultView(zone = DEFAULT_ZONE) {
    return resolve({ league: DEFAULT_LEAGUE }, zone).view;
  }

  // Every game of a league season (all periods), for coverage checks.
  const allGames = (leagueId, seasonId, zone = DEFAULT_ZONE) => data(leagueId, seasonId, zone).games;

  return { leagues: LEAGUES, seasons, periods, defaultPeriod, equivalentPeriod, resolve, defaultView, allGames, todayKey, anchorDays, anchored: clock !== null, controlKeys: (id) => controlDefs(id).map((c) => c.key) };
}

export const ALL_CONTROL_KEYS = Object.freeze(['conference', 'subleague', 'subdivision', 'division', 'ranking', 'tournament', 'round']);
