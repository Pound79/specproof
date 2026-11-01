# Security Policy

## Supported versions

specproof is pre-1.0. Security fixes are applied to the latest released version
of each package (`@pound79/specproof-traceability`, `@pound79/specproof`).

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately via GitHub's
[Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (Security tab → "Report a vulnerability"), or email
**kma9879@gmail.com**.

Please include:

- a description of the issue and its impact,
- steps to reproduce (a minimal proof-of-concept if possible),
- affected package and version.

## Disclosure process

- We aim to acknowledge reports within **7 days**.
- We follow coordinated disclosure: a fix is prepared privately, then released,
  and details are published after users have had a reasonable window to upgrade
  (target: within **90 days** of the initial report).

## Vulnerable dependencies

Known vulnerabilities in the packages' npm dependencies (locked by
`package-lock.json`), the dependency constraints written in the scaffold
templates (npm for Playwright, pub for Flutter), and the GitHub Actions used by
this repository's own workflows (`.github/workflows/`) and by the scaffolded
`specproof-drift-check.yml` workflows are fixed in a release within these
windows, counted from when the advisory is published or reported to us.

Limits of that promise:

- The templates ship no lockfile, so only the constraints they write are
  watched; transitive dependencies are resolved when you install the scaffold.
- A fix reaches the templates in the next release. Repositories that already
  ran `specproof init` keep their copies and need to update them by hand.
- `flutter_gherkin` is pinned to `3.0.0-rc.17`, its last release, because no
  other Flutter BDD runner supports the Japanese Gherkin dialect. If it gets a
  vulnerability with no upstream fix, we document the impact and any workaround
  within the window instead of a fixed version.
- The scaffolded workflows pin the same action versions as this repository's own
  workflows, which a test enforces. `actions/github-script`, used only by the
  scaffolded workflows, is not watched automatically; it is checked by hand
  before each release.

| Severity (GitHub advisory / CVSS) | Fixed within |
|---|---|
| Critical | 7 days |
| High | 14 days |
| Moderate | 30 days |
| Low | the next release |

A vulnerability listed in the CISA Known Exploited Vulnerabilities catalog is
fixed within **7 days** regardless of its severity. When a fix is not available
upstream, we document a workaround or the reason the vulnerable code path is not
reachable from specproof within the same window.

How dependencies are watched:

- Dependabot alerts and security updates are enabled for this repository.
- Pull requests fail when they add or upgrade into a dependency with a
  moderate-or-higher vulnerability (dependency review).
- Dependabot version updates run weekly, with a 7-day cooldown before a newly
  published version is proposed.

## Security model

What specproof trusts, which files it reads and writes, where it connects, its
use of cryptography, and what the drift gate does not guarantee are described in
[docs/security-model.md](docs/security-model.md) (Japanese).

Thank you for helping keep specproof and its users safe.
