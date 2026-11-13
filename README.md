# WTFScore

A scores-first board for seven leagues, built for a TV and a phone.

<img src="docs/screenshots/01-tv-scoreboard.png" width="960" alt="WTFScore simulated NFL week board">

**Prototype checkpoint. Every game, score, clock, player and statistic is simulated. There is no live feed.**

The gallery uses a fixed browser clock: Sunday, November 15, 2026, 3:50 PM Central.

## Pick the games

Choose NFL, NCAAF, NBA, NCAAB, NCAAW, MLB or NHL directly from the header. The adjacent control selects a football week, a calendar date or a postseason round. Conference, division and college filters follow the selected league.

<img src="docs/screenshots/02-league-picker.png" width="960" alt="League dropdown grouped by sport">

## Football first

Favorite teams lift their games to the top. A card's star includes or excludes one game independently. The rest follow in-progress, upcoming and final order, with earlier kickoffs first.

Football priority frames use red for the red zone, orange for overtime or a margin of eight points or fewer in the final two minutes, and yellow for ten points or fewer in the final five minutes. Red zone takes precedence. Text labels accompany color.

<img src="docs/screenshots/05-favorites-override.png" width="960" alt="Football favorites with a game override">

## Open a game

On TV, the scorecard opens a foreground detail view. Left and Right step through Situation, Leaders and Team stats. Back returns to the same game. On a phone, details expand inside the board.

<img src="docs/screenshots/06-tv-situation.png" width="960" alt="Football Situation panel">
<img src="docs/screenshots/07-tv-leaders.png" width="960" alt="Football Leaders panel">
<img src="docs/screenshots/08-tv-team-stats.png" width="960" alt="Football Team stats panel">

## Seven leagues, one board

Basketball, baseball and hockey use sport-specific linescores and fixture-backed situations. College basketball includes tournament and round controls. These shared-card renderings are prototypes, not final designs.

See the [16-state gallery](docs/SHOWCASE.md) and [feature coverage](docs/CAPTURE-COVERAGE.md).

## Built with browser standards

The app uses HTML, CSS and native JavaScript modules. It has no runtime package dependencies. The Node server serves the static frontend. The tests exercise the same modules and event handlers as the page. Phantom and Chromium are documentation tooling, separate from the app.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY-PRACTICES.md](SECURITY-PRACTICES.md).

## Run and test

Requires Node 22. No package installation is needed.

```sh
git clone https://github.com/wbuscombe/wtfscore.git
cd wtfscore
node server.mjs
```

Open the address printed by the server. There is no public hosted demo.

CI runs the test suite with:

```sh
node --max-old-space-size=256 --test --test-concurrency=1 --test-timeout=120000 test/*.test.mjs
```

[CI for the gallery source commit `50786a8`](https://github.com/wbuscombe/wtfscore/actions/runs/43344142841) passed all 263 tests and the secret scanner canary and history checks. Publication commits after that source commit change only documentation and images. See [validation details](docs/VALIDATION.md) for commit-labeled results and capture provenance.

## Current scope

- Games, teams, players, scores, clocks and stats are invented. League names describe the simulated boards. Conference and division memberships are fixture data.
- Known issues: [pointer hover masks priority colors, and the TV calendar footer requires scrolling](docs/VALIDATION.md#observed-prototype-limitations).
- Favorites are held in memory per demo screen and reset on reload.
- There are no logos, accounts, saved profiles or live data providers.
- The screenshots come from headless Chromium at documented TV and phone sizes. They are layout proxies, not physical device tests.
- This checkpoint has not completed acceptance on a physical TV box or phone, in Safari or Brave, or with a screen reader.
- WTFScore is not affiliated with any sports league. League and conference names are used descriptively.

Each published image adds a 24 CSS pixel SIMULATED caption strip outside the app viewport. The app viewport pixels below it are unchanged. The manifest records both the raw and framed image hashes.
