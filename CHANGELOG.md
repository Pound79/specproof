# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-07-07

### Changed

- Playwright template ships its dotenv sample as `env.example` (no leading dot)
  instead of `.env.example`; `specproof init` restores the dot on scaffold, so
  consumers still get `.env.example`. The dotless name keeps the file
  committable and packable in environments where `**/.env.*` deny rules (secret
  scanners, sandboxes, some CI) would otherwise block reading or publishing it —
  the same reason templates already ship `gitignore` rather than `.gitignore`.

### Fixed

- Playwright template dotenv sample referenced the pre-rename
  `bdd-kit.config.yaml` in a comment; corrected to `specproof.config.yaml`
  (missed by the 0.2.0 rename because the sandbox blocked writing `.env.example`).

## [0.2.0] - 2026-07-06

### Changed

- **BREAKING**: Project renamed from `bdd-kit` to `specproof` (see
  [`docs/adr/0000-rename-note.md`](./docs/adr/0000-rename-note.md)). Package,
  binary, config, and skill names all move to the new prefix:
  - npm: `@pound79/bdd-kit` → `@pound79/specproof`, `@pound79/bdd-traceability`
    → `@pound79/specproof-traceability`.
  - bins: `bdd-traceability-check` → `specproof-check`,
    `bdd-traceability-update` → `specproof-update`,
    `bdd-traceability-list` → `specproof-list`,
    `bdd-traceability-stats` → `specproof-stats`.
  - Claude Code plugin: marketplace/plugin id `bdd-kit` → `specproof`
    (`/plugin marketplace add Pound79/specproof` then
    `/plugin install specproof@specproof`).
  - Skills: single entry point `/bdd-kit` → `/specproof`; internal movements
    `bdd-setup` → `specproof-setup`, `bdd-bootstrap` → `specproof-bootstrap`,
    `bdd-new-feature` → `specproof-new-feature`, `bdd-implement` →
    `specproof-implement`, `bdd-sync` → `specproof-sync`.
  - Config file: `bdd-kit.config.yaml` → `specproof.config.yaml`.
  - Draft marker: `# bdd-kit: draft` → `# specproof: draft`.
  - Env var: `BDD_KIT_ENV` → `SPECPROOF_ENV`.

  **Migration** — old and new names interoperate, so there is no forced flag
  day:
  - Config discovery prefers `specproof.config.yaml` and falls back to
    `bdd-kit.config.yaml` with a one-line stderr deprecation warning
    (`bdd-kit.config.yaml is deprecated; rename it to specproof.config.yaml`);
    rename the file at your convenience.
  - The draft-marker detector recognizes both `# specproof: draft` and the
    legacy `# bdd-kit: draft`; only the new marker is ever generated going
    forward.
  - `SPECPROOF_ENV` takes priority; `BDD_KIT_ENV` is still read as a fallback
    where it applied before.
  - The old packages (`@pound79/bdd-kit`, `@pound79/bdd-traceability`) are
    `npm deprecate`d pointing at their replacements and keep working for
    existing installs. Upgrade at your own pace by installing the new package
    names and switching to the new bin names — no aliases are provided for the
    old bins.
- **BREAKING**: file content is now normalized before hashing, heading
  parsing, and draft-marker detection — a leading UTF-8 BOM is stripped and
  `\r\n` is normalized to `\n`. A manifest whose blessed hashes were computed
  against CRLF or BOM-prefixed content will show those refs as drifted on the
  next `specproof-check`. Migration: run `specproof-check`, review the
  reported diffs (they should be no-op content changes), then
  `specproof-update` to re-bless.

### Added

- `specproof-check` (formerly `bdd-traceability-check`) now detects four
  additional kinds of structural drift, surfaced as `warnings[]` entries and
  shown but not failing unless `--strict` is passed:
  - `unregistered-feature` — a `.feature` file under `featuresDir` that no
    link's `features[]` registers.
  - `unregistered-spec-heading` — a heading in an already-referenced spec file
    that no link's `spec[]` registers (file-limited: only markdown files with
    at least one registered spec ref are scanned). Does **not** escalate under
    `--strict` unless the new `strictUnregisteredSpecHeadings: true` config
    flag is also set — even file-limited, a real spec doc can mix several
    domains' headings with intentionally-unlinked sections (revision history,
    glossary) in one file.
  - `unregistered-impl` — a file matching the new `layout.implGlobs` config
    (self-implemented `*`/`**` glob matcher, no new dependency) that no link's
    `impl[]` registers. Opt-in: skipped entirely when `implGlobs` is unset.
    Does **not** escalate under `--strict` unless the new
    `strictUnregisteredImpl: true` config flag is also set.
  - `duplicate-heading` — a registered heading appears more than once in its
    spec file, making the section hash ambiguous.
- `specproof-check --json`'s `warnings[]` entries now include
  `failsUnderStrict: boolean` — the effective per-warning verdict (does this
  warning's `kind` fail under `--strict`, given the resolved
  `strictUnregisteredImpl` / `strictUnregisteredSpecHeadings` config),
  independent of whether the current run actually passed `--strict`. Non-JSON
  output labels each warning line to match: `[warning]` vs `[advisory]`.
  `checkDrift`/`DriftWarning` stay config-agnostic; the field is attached at
  the CLI output layer only. The Playwright/Flutter `specproof-drift-check.yml`
  workflow templates now split the PR comment accordingly — hard warnings are
  listed under "Warnings (fail under `--strict`)"; advisory warnings collapse
  into a `<details>` block so a large `unregistered-impl` count no longer
  visually equates to a blocking failure.
- `DriftReport.bothSidesChanged`: a list of link ids where both a spec ref and
  an impl ref drifted in the same `check` run — the case `specproof-sync` must
  never auto-resolve, now machine-checkable instead of requiring its own
  grouping logic.
- `specproof-update --dry-run` (formerly `bdd-traceability-update
  --dry-run`): previews the hash changes a bless would make (`<linkId> <side>
  <path>: <old 8 chars> -> <new 8 chars>`) without writing the manifest.
  `update`'s return value now also includes the list of changed refs for
  programmatic callers.

## [0.1.6] - 2026-07-01

### Fixed

- Bumped the Claude Code plugin manifests
  (`.claude-plugin/marketplace.json`, `plugins/bdd-kit/.claude-plugin/plugin.json`)
  to match the published npm version. They were stranded at `0.1.4` while npm was
  already `0.1.5`, so `/plugin install` reported the plugin was "already at the
  latest version" even though the code was current. (#13)

### Changed

- Release automation now bumps the two plugin manifests in lockstep with the npm
  workspaces (`scripts/release.sh`), and a new `npm run check:versions`
  (`scripts/check-versions.mjs`) asserts all four version sources agree. It runs
  on every PR (CI), in the release script, and as a pre-publish gate in the
  Release workflow, so plugin/npm version drift can neither merge nor publish. (#13)

## [0.1.5] - 2026-06-30

### Fixed

- bdd-kit orchestrator no longer treats a non-JS backend (PHP/Laravel, Go,
  Python, etc.) as a reason a repository is "unsupported". Adapter selection
  follows the observable surface (browser UI → Playwright, Flutter app →
  Flutter), not the server language; the orchestrator entry point now carries
  the same backend-agnostic guard `bdd-setup` documents, and `detect` flags
  `composer.json` / `artisan` as a web-backend signal that raises a Playwright
  candidate. (#6)
- Corrected `detect` failure guidance: `ENOVERSIONS` is now diagnosed as an npm
  `min-release-age` cooldown (versions newer than the cooldown window are
  filtered out) rather than a private/scoped-registry problem, with the in-place
  `npx -y --min-release-age=0 @pound79/bdd-kit ...` override documented. The
  public-registry override is kept as a separate branch for genuine `E404`
  cases. (#6)

### Changed

- Updated the bundled Playwright template dependencies: `playwright-bdd`
  8.5.1 → 9.2.0 (#10), `typescript` 5.9.3 → 6.0.3 (#8), and `@types/node`
  22.20.0 → 26.0.1 (#11).

## [0.1.4] - 2026-06-28

### Fixed

- `resolveRepoRoot` now correctly handles MSYS / Git Bash paths
  (`/c/Users/...`) on Windows by converting to native format (`C:/Users/...`)
  before `path.resolve()`. Guarded by `process.platform === "win32"` to avoid
  false positives on Unix systems.
- `buildDomainList` now normalises backslash `pagesDir` (`src\pages`) to
  forward slashes so manifest path matching works on Windows.
- Manifest-relative path operations in `list.ts` use `path.posix.join` /
  `path.posix.basename` to make the POSIX convention explicit.
- Build scripts use Node.js `fs.chmodSync` instead of shell `chmod` for
  cross-platform compatibility.
- Printed "Next steps" instructions use platform-neutral wording instead of
  Unix-only `cp` command.
- Added `.gitignore` rules for Flutter scaffold generated files (`.dart_tool/`,
  `.flutter-plugins*`, `pubspec.lock`).

## [0.1.3] - 2026-06-28

### Added

- OpenAI Codex support: bdd-kit is now multi-agent. The existing SKILL.md files
  work with any agent that supports the SKILL.md open standard (Claude Code,
  Codex, Gemini CLI, Cursor, etc.).
- `bdd-kit setup-agent <codex|claude>` subcommand to install skills for a
  specific AI coding agent. `setup-agent codex` copies skills to
  `.agents/skills/` for Codex discovery.
- `bdd-kit init --agent <claude|codex>` flag to tailor the "Next steps" output
  to a specific agent.
- `AGENTS.md` at the repo root — project instructions for Codex (equivalent to
  CLAUDE.md for Claude Code).
- `.agents/skills/` directory with full skill copies for Codex skill discovery.

### Changed

- SKILL.md files are now agent-neutral: Claude Code-specific tool references
  (`AskUserQuestion`) replaced with generic wording.
- `bdd-setup` skill install instructions now cover Claude Code, Codex, and
  manual copy.
- README, README_ja, cli README, CONTRIBUTING, and package.json descriptions
  updated from "Claude Code plugin" to "AI coding agent skills (SKILL.md
  standard)".
- npm tarball now includes `skills/` so `setup-agent codex` works from the
  published package.

## [0.1.2] - 2026-06-26

### Changed

- `bdd-kit init` now leads its "Next steps" with the recommended Claude Code
  plugin flow (`/plugin marketplace add` → `/bdd-kit`), with the manual setup
  steps shown as the alternative.
- Fixed the Flutter "Next steps" hint to reference the actual scaffold directory
  instead of a hard-coded `bdd_tests/` path.

- README quick start now leads with the plugin-only path — `/bdd-kit` scaffolds
  the config and e2e package itself, so no manual `npx ... init` or hand-placed
  config is needed. The CLI scaffold is documented as an optional standalone path.

## [0.1.1] - 2026-06-26

### Added

- Per-package READMEs for `@pound79/bdd-traceability` and `@pound79/bdd-kit` so
  the npm package pages render documentation.

## [0.1.0] - 2026-06-26

Initial public release.

### Added

- `@pound79/bdd-traceability` — framework-agnostic, minimal-dependency spec ↔ impl
  ↔ feature traceability engine with SHA-256 drift detection, scenario census
  (`stats`), and configurable heading levels and tags.
- `@pound79/bdd-kit` — `bdd-kit init` scaffolder for Playwright (web) and
  Flutter (`flutter_gherkin`) adapters.
- Claude Code plugin with `bdd-*` skills (bootstrap / new-feature / sync /
  implement) driven by a single `bdd-kit.config.yaml`.
- Documentation: methodology, adapter contract, config schema, and ADRs
  0001–0007.
- Community health files (CONTRIBUTING, CODE_OF_CONDUCT, SECURITY), issue/PR
  templates, Dependabot, and CODEOWNERS.

[Unreleased]: https://github.com/Pound79/specproof/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/Pound79/specproof/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Pound79/specproof/compare/v0.1.6...v0.2.0
[0.1.6]: https://github.com/Pound79/specproof/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Pound79/specproof/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Pound79/specproof/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Pound79/specproof/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Pound79/specproof/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Pound79/specproof/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Pound79/specproof/releases/tag/v0.1.0
