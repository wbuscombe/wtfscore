# Security practices

The frontend is a simulated, static demo. It makes no provider requests and stores no credentials. No authentication, payments or account service is implemented.

The included preview server binds only to loopback. It permits read-only methods, checks the Host header, rejects path traversal and hidden paths, assigns JavaScript MIME types to modules, and sends a restrictive content security policy. Camera, microphone and geolocation access are disabled by policy.

Deployment topology, host allowlists and private operational records are not published. A production deployment needs its own network and access review. This repository does not expose a public service.

Documentation captures use synthetic fixtures and a disposable browser profile. Only allowlisted source, documentation, capture configuration and fresh showcase images enter Git. Automated secret scanning must demonstrate detection of its canary before it can pass.

The code and test results do not establish physical-device or screen-reader acceptance. See the scope and validation notes in the README.
