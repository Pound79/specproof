# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- First public release preparation: English README, community health files
  (CONTRIBUTING, CODE_OF_CONDUCT, SECURITY), issue/PR templates, Dependabot, and
  CODEOWNERS.

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

[Unreleased]: https://github.com/Pound79/bdd-kit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Pound79/bdd-kit/releases/tag/v0.1.0
