# Validation

The checkpoint app has 263 behavioral tests. Fresh GitHub CI must pass all 263 with no failures, cancellations or skips before publication. No passing CI badge is claimed until that run completes.

The test job uses Node 22.22.0, a 256 MiB Node heap, a 768 MiB kernel memory limit, zero swap, 64 tasks and a five-minute unit deadline. Files run serially. The capture job uses a separate bounded unit with 1.5 GiB memory, zero swap, 128 tasks and one CPU. It records the applied kernel limits before starting the app and verifies that the cgroup is empty afterward.

Phantom 0.4.0 and contract 1.x drive the browser. The capture wrapper aligns the browser's initial clock and Phantom's capture clock at Sunday, November 15, 2026, 3:50 PM Central. It changes no app source, fixture values or rendered scores. Every capture starts from a fresh page and selects its state through the UI.

The [image manifest](screenshots/manifest.json) records the source commit, CI run, public source-file hashes, browser version, viewport, selected controls, image hashes and OCR verification. The [CI workflow](https://github.com/wbuscombe/wtfscore/actions/workflows/ci.yml) runs the full suite and a checksum-pinned gitleaks scanner. A positive canary must be detected before a clean scan can pass.

The [Phantom workflow](https://github.com/wbuscombe/wtfscore/actions/workflows/phantom.yml) posts a verified artifact on relevant source pushes, version tags and manual runs. It has no Git write permission. Gallery updates are reviewed and promoted from that artifact through a normal commit, preserving the previous images in Git history.

This is simulated prototype validation. Physical TV boxes, phones, Safari, Brave and screen readers have not completed acceptance for this checkpoint.
