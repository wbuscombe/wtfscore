# Security practices

The frontend is a simulated, static demo. It makes no provider requests and stores no credentials. No authentication, payments or account service is implemented.

The included preview server binds only to loopback. It permits read-only methods, checks the Host header, rejects path traversal and hidden paths, assigns JavaScript MIME types to modules, and sends a restrictive content security policy. Camera, microphone and geolocation access are disabled by policy.

Deployment topology, host allowlists and private operational records are not published. A production deployment needs its own network and access review. This repository does not expose a public service.

Documentation captures use synthetic fixtures and a disposable browser profile. The repository tracks source, tests, documentation, capture configuration and the showcase images; it commits no build output, logs or local state. Automated secret scanning must demonstrate detection of its canary before it can pass.

Six publication hygiene tests in `test/publication-hygiene.test.mjs` scan every tracked text file and fail the suite on a local user path, a private IPv4 address, an email address outside reserved example domains, a planning label in a code comment or test title, or an em dash in Markdown. Each test first checks that Git resolved this checkout, that the full tracked list is nonempty and holds known anchor files, and that the check detects a planted sample. `test/hygiene.test.mjs` uses `tools/hygiene-scan.mjs` to reject unobfuscated expletives and source-site branding.

The code and test results do not establish physical-device or screen-reader acceptance. See the scope and validation notes in the README.
