# Architecture

WTFScore is a static frontend demo. `public/app.mjs` mounts `lib/board.mjs`. There is no API client, backend database, login or provider integration.

| Area | Modules | Responsibility |
|---|---|---|
| Entry | app | Mounts the board into the page |
| Board | board, board-layout, layout, sizing | Controller state, card placement, frame geometry, the scale ladder and model dimensions |
| Selection | header, calendar, menu, chrome | Foreground league and period pickers, the Date calendar, the Menu sheet with display and screen settings, and page chrome |
| Data | fixtures, catalog, sports | Invented schedules and game states, league structure, sport-specific presentation |
| Game view | render, popup | Scorecards, inline details and the TV foreground carousel |
| Interaction | nav, favorites, model | Directional focus, team defaults, per-game favorite overrides, ordering and expansion state |
| Diagnostics | diag | Developer readout, created only when the page address carries `devdiag=1` |
| Developer only | metrics, measure, presets, g1 | Layout comparison metrics, model viewport presets and the layout decision sheet (metrics, presets, g1), used by Node tests or tools; browser measurement helpers (measure) that nothing currently imports; the page loads none of them |
| Server | server.mjs | Read-only static files, loopback bind, host checks and security headers |

The entry module is `public/app.mjs`, the other page and developer modules are in `public/lib/`, and `server.mjs` is at the repository root. Two tests keep the developer-only modules out of the page: `test/static.test.mjs` follows the page's static imports, and `test/module-graph.test.mjs` records the modules the controller actually loads.

Tests use a small fake DOM to drive the same modules and handlers as the browser. The capture configuration (`.phantom.yml`) drives actual browser gestures in a fresh disposable context for each image. Captures do not alter application source or fixture values.

TV and Phone are presentation modes. Auto chooses TV for a sufficiently tall landscape viewport. Each demo screen holds its own choices in memory. The prototype has no persistent user profiles.

The daily leagues anchor their invented current slate to the browser's date and chosen time zone. Scores and game progress remain fixed. Football weeks remain fixed. The capture manifest records the fixed capture clock; screenshots are not evidence of live scores.

## Tooling

| File | Purpose |
|---|---|
| `tools/capture-showcase.py` | Runs the test suite, the Phantom captures or the capture verifier inside a bounded systemd unit on Linux CI |
| `tools/verify-showcase.py` | Checks each capture's hash, dimensions and nonblank content, adds the SIMULATED caption strip, then confirms the expected state text and the absence of private-looking text with OCR |
| `tools/hygiene-scan.mjs` | Rejects unobfuscated expletives and source-site branding in text files |
| `tools/publication-hygiene.mjs` | Rejects local user paths, private IPv4 addresses, email addresses, planning labels in comments and test titles, and Markdown em dashes in tracked files |
| `tools/model-report.mjs` | Exports the model-computed layout comparison matrix as JSON |
| `tools/plant-canary.mjs` | Writes hygiene canaries into a directory outside the source tree for a negative test |
| `tools/publication-scan.py` | Scans an explicit publication allowlist without echoing matches; run by hand, not part of CI |
