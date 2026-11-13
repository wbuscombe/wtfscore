# Architecture

WTFScore is a static frontend demo. `public/app.mjs` mounts `lib/board.mjs`. There is no API client, backend database, login or provider integration.

| Area | Modules | Responsibility |
|---|---|---|
| Board | board, board-layout, layout, sizing | State, measured header height, card placement and responsive presentation |
| Selection | header, calendar, menu | Foreground league and period controls; applicable filters; display and screen settings |
| Data | fixtures, catalog, sports | Invented schedules and game states, league structure, sport-specific presentation |
| Game view | render, popup | Scorecards, inline details and TV foreground carousel |
| Interaction | nav, favorites | Directional focus, team defaults, per-game favorite overrides and ordering |
| Server | server.mjs | Read-only static files, loopback bind, host checks and security headers |

Tests use a small fake DOM to drive the same modules and handlers as the browser. The published capture manifest drives actual browser gestures in a fresh disposable context for each image. Captures do not alter application source or fixture values.

TV and Phone are presentation modes. Auto chooses TV for a sufficiently tall landscape viewport. Each demo screen holds its own choices in memory. The prototype has no persistent user profiles.

The daily leagues anchor their invented current slate to the browser's date and chosen time zone. Scores and game progress remain fixed. Football weeks remain fixed. Reproduction records the capture date and source commit; screenshots are not evidence of live scores.
