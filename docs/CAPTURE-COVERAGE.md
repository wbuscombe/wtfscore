# Feature coverage

The gallery shows built behavior, driven through the real controls. Each fresh browser context uses only the included synthetic fixtures. The capture manifest records the exact source commit, browser version, clock, state assertions, OCR checks and image hashes.

| Feature | Shots | Behavioral tests | Capture verification |
|---|---|---|---|
| Seven leagues and sport groups | 2, 9–13, 16 | header-controls, menu, catalog | Selected league and real board results; picker has all seven options |
| Football weeks and rounds | 3 | header-controls, calendar | Foreground period list and visible grouping |
| Conference and division filters | 4, 9, 12, 13 | menu, catalog, header-controls | Selected filters and nonempty board |
| Football team favorites and game override | 1, 5 | favorites, sort, nav | Pressed stars and favorites-first DOM order |
| Football priority frames | 1, 6 | football-cues, render | Fixture-reachable red-zone and overtime cues; late-game thresholds remain covered by tests |
| TV foreground detail carousel | 6–8 | popup, interaction | Selected game and Situation, Leaders, Team stats panel identity |
| College tournament and round | 11 | menu, catalog, header-controls | NCAA tournament and First Round selected through the header |
| Daily calendar | 10 | calendar, catalog | Selected date and month exposed; date/round control and selected day verified |
| Phone wrapping and inline details | 14–16 | fullrow, board-layout, interaction | Phone viewport, header visibility and inline expansion state |

All 16 frames require the visible SIMULATED marker, expected OCR text, nonblank image checks and the documented pixel dimensions. Visual review precedes publication. None of this establishes physical-device, Safari, Brave or screen-reader acceptance.
