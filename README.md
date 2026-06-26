<div align="center">

# bdd-kit

[![CI](https://github.com/Pound79/bdd-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Pound79/bdd-kit/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![npm](https://img.shields.io/npm/v/@pound79/bdd-traceability.svg)](https://www.npmjs.com/package/@pound79/bdd-traceability) ![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)

**Run `/bdd-kit` in Claude Code. Get production-grade E2E tests.**

English | [日本語](./README_ja.md)

</div>

bdd-kit is a Claude Code plugin that **builds E2E behavior tests for you**.
Point it at any web (Playwright) or Flutter repository, and a single slash
command drives the entire flow: framework detection, scaffold, config, Gherkin
feature authoring, and step implementation -- stopping at every human gate so
you stay in control.

## Get started in 30 seconds

```text
/plugin marketplace add Pound79/bdd-kit
/plugin install bdd-kit@bdd-kit
/bdd-kit
```

That's it. No config file to write, no scaffold to run, no flags to remember.

## What `/bdd-kit` does for you

```
/bdd-kit
  |
  |-- 1. Detect    your framework (Playwright / Flutter) and mode
  |                (brownfield: existing app / greenfield: new app)
  |
  |-- 2. Scaffold  e2e package, page objects, step stubs, config
  |
  |-- 3. Tailor    bdd-kit.config.yaml to your repo layout
  |
  |-- 4. Drive     the BDD flow (one of the paths below)
  |      |
  |      |-- Brownfield: read impl -> draft .feature -> human review -> implement
  |      |-- Greenfield:  write spec -> author .feature -> implement -> green
  |      |
  |      '-- (stops at every human gate with a handoff report)
  |
  '-- 5. Track     spec <-> impl <-> feature drift with SHA-256 hashes
```

Every decision that matters is yours. The AI proposes; you approve.

## Two ways to work

| Mode | You have | Entry skill | What happens |
|------|----------|-------------|-------------|
| **Brownfield** | An existing app with no (or thin) E2E coverage | `/bdd-kit` | Reads your code, drafts `.feature` files for observable behavior, you review and bless, then it implements steps to make them green. |
| **Greenfield** | A new app or a spec-first workflow | `/bdd-kit` | You write a spec heading, it authors a `.feature`, then implements production + test code to make it green. |

## Supported frameworks

| Framework | Adapter | Runner |
|-----------|---------|--------|
| **Web** (React, Vue, Next, Svelte, ...) | `playwright` | [playwright-bdd](https://github.com/vitalets/playwright-bdd) |
| **Flutter** | `flutter` | [flutter_gherkin](https://github.com/nickmeinhold/flutter_gherkin) |

The adapter is auto-detected from your `package.json` or `pubspec.yaml`.

## Individual skills

`/bdd-kit` is the single entry-point that orchestrates everything. Under the
hood it drives these skills, each of which can also be invoked standalone:

| Skill | Direction | Use when |
|-------|-----------|----------|
| `/bdd-bootstrap` | impl -> feature draft | You want to generate `.feature` drafts from existing code |
| `/bdd-new-feature` | spec -> feature | You have a new spec section and want a RED `.feature` |
| `/bdd-implement` | feature -> impl | You have a blessed `.feature` and want GREEN test code |
| `/bdd-sync` | drift -> feature | Spec or impl changed and `.feature` needs to catch up |

## Drift detection (AI-free CLI)

Spec, implementation, or feature files changed? The traceability engine detects
it deterministically with SHA-256 hashes -- no AI involved:

```bash
npx -y -p @pound79/bdd-traceability bdd-traceability-check   # detect drift
npx -y -p @pound79/bdd-traceability bdd-traceability-update  # bless hashes
npx -y -p @pound79/bdd-traceability bdd-traceability-stats   # scenario census
```

Install it as a dev dependency for shorter commands:

```bash
npm i -D @pound79/bdd-traceability
npx bdd-traceability-check --json
```

## CLI scaffold (without the plugin)

If you're not using Claude Code, scaffold directly:

```bash
npx @pound79/bdd-kit init --adapter playwright   # or: flutter | auto
```

The CLI prints next steps on completion. Edit `bdd-kit.config.yaml` at your
repo root to match your project layout.

## How it works (architecture)

bdd-kit separates concerns into three layers:

1. **Methodology (Claude Code plugin)** -- the `bdd-*` skills that drive the
   BDD flow. Framework-agnostic; all framework-specific values come from
   `bdd-kit.config.yaml`.
2. **Traceability engine** --
   [`@pound79/bdd-traceability`](https://www.npmjs.com/package/@pound79/bdd-traceability):
   a minimal-dependency Node CLI that detects spec / impl / feature drift via
   SHA-256 hashes.
3. **Scaffold templates** -- per-framework starter packages
   (`templates/playwright/`, `templates/flutter/`), unpacked by `bdd-kit init`.

## Key concepts

| Term | Meaning |
|------|---------|
| **Spec** | An authoritative `##`-heading section in an in-repo markdown file. |
| **Feature** | A black-box Gherkin `.feature` describing *observable* behavior only. |
| **Drift** | A deterministic SHA-256 diff between the blessed baseline and the current state. |
| **Bless** | Marking the current spec/impl/feature state as the known-good baseline. |
| **Draft marker** | `# bdd-kit: draft` in a `.feature` -- means "not yet human-reviewed". Implementation is blocked until you remove it. |

See [`CONTEXT.md`](./CONTEXT.md) for the full glossary.

## Prerequisites

- [Claude Code](https://www.anthropic.com/claude-code) (for the plugin flow).
- Node.js **>= 24** (see `.nvmrc`).
- Specs live as in-repo markdown `##` headings. External tools (Notion,
  Confluence) are not supported for drift tracking.

## Contributing & license

- Contributions welcome -- see [CONTRIBUTING.md](./CONTRIBUTING.md) and
  [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- Security policy: [SECURITY.md](./SECURITY.md).
- Licensed under the [MIT License](./LICENSE).
