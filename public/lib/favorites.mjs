// WTFScore 010 - football favorites for one Demo screen. Pure module, kept in
// memory only: a page reload starts with no favorites, like every other demo
// setting. Team favorites are kept per league by stable team id (league and
// abbreviation); a game can be explicitly included or excluded by its stable
// game id. A game without an override inherits from its teams: it is a
// favorite when either team is. A star toggle flips what the game shows: the
// override is cleared when the new state equals the team default and stored
// otherwise, so an override survives later team changes until the game's own
// star is used again. Nothing here is saved, sent or shared.

export const FAVORITE_LEAGUES = Object.freeze(['nfl', 'ncaaf']);
export const supportsFavorites = (leagueId) => FAVORITE_LEAGUES.includes(leagueId);
const teamKey = (league, abbr) => `${league}:${abbr}`;

export class Favorites {
  constructor() {
    this.teams = new Set();
    this.overrides = new Map();
  }

  isTeam(league, abbr) {
    return this.teams.has(teamKey(league, abbr));
  }

  // Returns true when the team's favorite state changed.
  setTeam(league, abbr, on) {
    if (!supportsFavorites(league) || typeof abbr !== 'string' || !abbr) return false;
    const k = teamKey(league, abbr);
    if (Boolean(on) === this.teams.has(k)) return false;
    if (on) this.teams.add(k);
    else this.teams.delete(k);
    return true;
  }

  teamCount(league) {
    let n = 0;
    for (const k of this.teams) if (k.startsWith(`${league}:`)) n++;
    return n;
  }

  // What the game shows without an override of its own.
  teamDefault(game) {
    if (!game || !supportsFavorites(game.league)) return false;
    return this.isTeam(game.league, game.away) || this.isTeam(game.league, game.home);
  }

  // true (included), false (excluded) or null (inherits from its teams).
  override(gameId) {
    return this.overrides.has(gameId) ? this.overrides.get(gameId) : null;
  }

  isFavorite(game) {
    if (!game || !supportsFavorites(game.league)) return false;
    const o = this.override(game.id);
    return o === null ? this.teamDefault(game) : o;
  }

  // One star use: flip what the game shows; keep an override only when it
  // differs from the current team default.
  toggleGame(game) {
    if (!game || !supportsFavorites(game.league)) return null;
    const on = !this.isFavorite(game);
    if (on === this.teamDefault(game)) this.overrides.delete(game.id);
    else this.overrides.set(game.id, on);
    return { on, override: this.override(game.id) };
  }
}
