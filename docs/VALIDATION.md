# Validation

The [CI workflow](https://github.com/wbuscombe/wtfscore/actions/workflows/ci.yml) runs all 269 behavioral and hygiene tests and requires every one to pass, with no failures, cancellations or skips. A separate job runs a checksum-pinned gitleaks scanner, which must detect a planted canary before its scan of the complete repository history can pass.

The test job uses Node 22.22.0, a 256 MiB Node heap, a 768 MiB kernel memory limit, zero swap, 64 tasks and a five-minute unit deadline. Files run serially. The capture job uses a separate bounded unit with 1.5 GiB memory, zero swap, 128 tasks and one CPU. It records the applied kernel limits before starting the app and verifies that the cgroup is empty afterward. Capture and verification processes have a 32 MiB file limit for renderer backing files; each published PNG is limited to 8 MiB and the complete artifact to 100 MiB.

Phantom 0.4.0 and contract 1.x drive the browser. The capture wrapper aligns the browser's initial clock and Phantom's capture clock at Sunday, November 15, 2026, 3:50 PM Central. It changes no app source, fixture values or rendered scores. Every capture starts from a fresh page and selects its state through the UI.

The [image manifest](screenshots/manifest.json) records the source commit, CI run, public source-file hashes, browser version, viewport, selected controls, image hashes and OCR verification for the published gallery.

The [Phantom workflow](https://github.com/wbuscombe/wtfscore/actions/workflows/phantom.yml) posts a verified artifact on relevant source pushes, version tags and manual runs. Each run captures fresh images and writes a fresh manifest inside its disposable checkout; it has no Git write permission and does not change the committed gallery. Gallery updates are reviewed and promoted from that artifact through a normal commit, preserving the previous images in Git history.

This is simulated prototype validation. Physical TV boxes, phones, Safari, Brave and screen readers have not completed acceptance for this checkpoint.

Each published image adds a 24 CSS pixel SIMULATED caption strip outside the app viewport. The app viewport pixels below it are unchanged. The manifest records both the raw and framed image hashes.

## Capture provenance

The gallery and its manifest were captured from pre-publication history that is kept privately. All 16 images came from one verified Phantom run there, and each committed image matches the hash recorded for it in the manifest. The manifest's source commit, CI run and source-file hash fields refer to that history and do not resolve in this repository.

The committed gallery preserves the historical v0.1.1 app. Current app code includes later rendering changes, so its source hashes and pixels are not expected to match that historical manifest. Changes are listed in the [changelog](../CHANGELOG.md). Fresh artifacts from the candidate commit provide current browser evidence.

## Observed prototype limitations

### Historical gallery limitations

In historical gallery shot 10, November 15 and the month title are visible while the Today footer sits below the visible area. Pointer hover replaces a football priority border with gray in shots 4 and 15. The text cue remains visible. These captures remain unchanged as a record of v0.1.1; current app code fixes those two behaviors.

Boards and long menus scroll, so an image can include part of the next card or list item. The phone inline view preserves the app's own ellipsis for long play text. No app UI pixels were retouched.

## Focused UI regressions

The Phantom workflow also runs `tools/check-ui-polish.py` in its bounded Linux sandbox. Five cases use the real card renderer with explicit simulated inputs: red, orange and yellow football priorities combined with a touchdown, a green touchdown without priority, and ordinary hover. Chromium checks border colors, text cues and keyboard focus, and captures each case.

Calendar checks use real controls at 960x540, 1280x720, 1920x1080 and 390x844, all at the largest text setting. They check Today bounds and pointer hit testing, keyboard movement within the scrolling grid, a stationary footer and outer panel, Tab/Enter activation, Escape and focus return. The `wtfscore-ui-regressions` artifact contains the screenshots and measured results. These supplement the 269 behavioral and hygiene tests; they are browser viewport proxies, not physical-device acceptance.
