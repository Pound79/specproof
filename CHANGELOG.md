# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

- `@pound79/bdd-traceability` — framework-agnostic, dependency-free spec ↔ impl
  ↔ feature traceability engine with SHA-256 drift detection, scenario census
  (`stats`), and configurable heading levels and tags.
- `@pound79/bdd-kit` — `bdd-kit init` scaffolder for Playwright (web) and
  Flutter (`bdd_widget_test` + Patrol) adapters.
- Claude Code plugin with `bdd-*` skills (bootstrap / new-feature / sync /
  implement) driven by a single `bdd-kit.config.yaml`.
- Documentation: methodology, adapter contract, config schema, and ADRs
  0001–0007.
- Community health files (CONTRIBUTING, CODE_OF_CONDUCT, SECURITY), issue/PR
  templates, Dependabot, and CODEOWNERS.

[Unreleased]: https://github.com/Pound79/bdd-kit/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/Pound79/bdd-kit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Pound79/bdd-kit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Pound79/bdd-kit/releases/tag/v0.1.0
