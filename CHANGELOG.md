# Changelog

All notable changes to this project are documented here. This file follows Keep a Changelog.

## [Unreleased]

### Added

- Bounded Chromium checks and separate review artifacts for five hover-frame cases and four calendar viewport sizes at the largest text setting. The behavioral and hygiene suite remains 269 tests; calendar focus regression assertions now target the date grid.

### Changed

- Validation notes distinguish the unchanged historical v0.1.1 gallery from current UI regression evidence.

### Fixed

- The calendar keeps more of the month in view on smaller screens, and reopens at the top of the month whenever the chosen day fits.

- Pointer hover preserves football priority borders and green scoring-event frames, including keyboard focus and text cues.
- The calendar date grid scrolls independently so Today stays visible and usable without scrolling the outer panel.
- The calendar panel is no longer cut off when the board is shorter than the screen.

## [0.1.1] - 2026-11-14

### Added

- Publication hygiene checks in `tools/publication-hygiene.mjs`, with six tests for local user paths, private IPv4 addresses, email addresses, planning labels in code comments and test titles, and em dashes in Markdown. The suite now has 269 tests.
- A module table and tooling list in ARCHITECTURE.md, a license line in the README and this file's version links.

### Changed

- Code comments and test titles describe behavior instead of internal planning labels. Test assertions and app behavior are unchanged.
- The CI test-count check expects 269 tests.
- README, VALIDATION, SHOWCASE and CAPTURE-COVERAGE describe where the gallery was captured and link CI at the workflow level. SECURITY-PRACTICES describes what the repository tracks and the publication hygiene tests.

### Removed

- An unused local tool entry from `.gitignore`.

## [0.1.0] - 2026-11-12

### Added

- Simulated scoreboards for NFL, NCAAF, NBA, NCAAB, NCAAW, MLB and NHL.
- Foreground league, week, date, round, conference and division controls.
- College subdivision, ranking and tournament filters.
- Football favorite teams, per-game overrides and favorites-first ordering.
- Football red-zone, overtime and late-game priority frames.
- TV foreground Situation, Leaders and Team stats panels.
- Phone layouts with inline game details.
- Reproducible Phantom documentation captures and bounded CI validation.

[Unreleased]: https://github.com/wbuscombe/wtfscore/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/wbuscombe/wtfscore/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/wbuscombe/wtfscore/tree/v0.1.0
