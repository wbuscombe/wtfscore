# Validation

The [checkpoint CI run](https://github.com/wbuscombe/wtfscore/actions/runs/43344142841) passed all 263 behavioral tests with no failures, cancellations or skips. Its secret scanner detected the positive canary and then passed a clean repository-history scan.

The test job uses Node 22.22.0, a 256 MiB Node heap, a 768 MiB kernel memory limit, zero swap, 64 tasks and a five-minute unit deadline. Files run serially. The capture job uses a separate bounded unit with 1.5 GiB memory, zero swap, 128 tasks and one CPU. It records the applied kernel limits before starting the app and verifies that the cgroup is empty afterward. Capture and verification processes have a 32 MiB file limit for renderer backing files; each published PNG is limited to 8 MiB and the complete artifact to 100 MiB.

Phantom 0.4.0 and contract 1.x drive the browser. The capture wrapper aligns the browser's initial clock and Phantom's capture clock at Sunday, November 15, 2026, 3:50 PM Central. It changes no app source, fixture values or rendered scores. Every capture starts from a fresh page and selects its state through the UI.

The [image manifest](screenshots/manifest.json) records the source commit, CI run, public source-file hashes, browser version, viewport, selected controls, image hashes and OCR verification. The [CI workflow](https://github.com/wbuscombe/wtfscore/actions/workflows/ci.yml) runs the full suite and a checksum-pinned gitleaks scanner. A positive canary must be detected before a clean scan can pass.

The [Phantom workflow](https://github.com/wbuscombe/wtfscore/actions/workflows/phantom.yml) posts a verified artifact on relevant source pushes, version tags and manual runs. It has no Git write permission. Gallery updates are reviewed and promoted from that artifact through a normal commit, preserving the previous images in Git history.

This is simulated prototype validation. Physical TV boxes, phones, Safari, Brave and screen readers have not completed acceptance for this checkpoint.

Each published image adds a 24 CSS pixel SIMULATED caption strip outside the app viewport. The app viewport pixels below it are unchanged. The manifest records both the raw and framed image hashes.

## Observed prototype limitations

The date picker scrolls. In gallery shot 10, November 15 and the month title are visible while the Today footer sits below the visible area. Pointer hover replaces a football priority border with gray, as shown in shots 4 and 15. The text cue remains visible. These existing app behaviors are preserved in the captures.

Boards and long menus scroll, so an image can include part of the next card or list item. The phone inline view preserves the app's own ellipsis for long play text. No app UI pixels were retouched.

The [verified Phantom run](https://github.com/wbuscombe/wtfscore/actions/runs/43344142838) produced all 16 images together from source commit `50786a8ca90f90e049bdaf3aca8296882da8fb48`. Each published image matches the verified artifact hash; the manifest adds the completed publication review.
