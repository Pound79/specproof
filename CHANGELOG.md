# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  Flutter (`bdd_widget_test` + Patrol) adapters.
- Claude Code plugin with `bdd-*` skills (bootstrap / new-feature / sync /
  implement) driven by a single `bdd-kit.config.yaml`.
- Documentation: methodology, adapter contract, config schema, and ADRs
  0001–0007.
- Community health files (CONTRIBUTING, CODE_OF_CONDUCT, SECURITY), issue/PR
  templates, Dependabot, and CODEOWNERS.

[Unreleased]: https://github.com/Pound79/bdd-kit/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/Pound79/bdd-kit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Pound79/bdd-kit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Pound79/bdd-kit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Pound79/bdd-kit/releases/tag/v0.1.0
