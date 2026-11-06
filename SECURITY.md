# Security policy

## Reporting a vulnerability

Please report it privately through GitHub's private vulnerability reporting:
<https://github.com/angular-ink/angular-ink/security/advisories/new>.

Do not open a public issue or pull request for a vulnerability. Include the version of
`@angular-ink/core` (or `angular-ink`), what you did, what you expected and what happened. A minimal reproduction helps.

We aim to acknowledge a report within 3 working days. A fixed vulnerability gets a GitHub Security
Advisory, and we request a CVE through GitHub.

## Supported versions

The latest minor version gets security fixes. Older minors are not supported.

| Version | Supported         |
| ------- | ----------------- |
| 0.x     | Latest minor only |

## Response times for dependency vulnerabilities

Fix and release times, by CVSS v3.1/v4 base score, for runtime dependencies or anything shipped in
the package:

| Severity | CVSS     | Fix and release within |
| -------- | -------- | ---------------------- |
| Critical | 9.0–10.0 | 72 hours               |
| High     | 7.0–8.9  | 7 days                 |
| Medium   | 4.0–6.9  | 30 days                |
| Low      | 0.1–3.9  | next planned release   |

A dev-only dependency (build, test, lint) is fixed within 30 days whatever its score, unless it
runs in CI with secrets. In that case the table applies.

## What angular-ink does about security

- Text, file names and server responses that an app shows are untrusted. Only SGR (color and
  style) sequences pass to the terminal. Cursor movement, screen clearing, OSC and control
  characters in data are removed before they reach the grid, and a test checks it.
- Bytes on stdin are untrusted too. The key parser runs in linear time, an incomplete sequence is
  limited to 256 bytes and a paste to 10 MiB, and the excess is dropped without throwing.
- Text over 1 MiB and nesting deeper than 256 elements throw an `angular-ink:` error.
- The terminal comes back (cursor, raw mode, bracketed paste) on a signal, an uncaught error or a
  closed stdout.
- CI runs `npm audit`, OSV-Scanner, CodeQL and OpenSSF Scorecard, and Dependabot keeps
  dependencies and workflows up to date.
- Releases are published from GitHub Actions with npm trusted publishing and provenance. Each
  GitHub release attaches a CycloneDX SBOM.
