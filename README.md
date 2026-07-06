<div align="center">

# specproof

[![CI](https://github.com/Pound79/specproof/actions/workflows/ci.yml/badge.svg)](https://github.com/Pound79/specproof/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![npm](https://img.shields.io/npm/v/@pound79/specproof-traceability.svg)](https://www.npmjs.com/package/@pound79/specproof-traceability) ![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)

**AI-written tests tend to become copies of AI-written code.
specproof keeps them honest.**

English | [日本語](./README_ja.md)

</div>

When the same AI agent writes your implementation *and* your E2E tests, the
tests stop being independent evidence. They become a mirror of whatever the
code happens to do: bugs ship green, and coverage quietly shrinks to the happy
path. Regenerate the tests after every change and you have a tautology — a
spec that can never disagree with the code.

specproof breaks that loop with a separation of powers:

- **Generation is AI.** Skills draft Gherkin features from your spec (or from
  existing code — once, and only once), implement step definitions, and sync
  features after changes.
- **Detection is deterministic.** A traceability engine links every spec
  section ↔ implementation file ↔ feature file with SHA-256 hashes and flags
  drift on every PR in seconds. No AI involved — the same input always gives
  the same verdict.
- **Judgment is human.** Reviewing drafts, deciding which side is
  authoritative when spec and implementation disagree, and blessing the new
  baseline stay with you.

**The AI proposes. SHA-256 verifies. You decide.**

## Get started in 30 seconds

**Claude Code:**
```text
/plugin marketplace add Pound79/specproof
/plugin install specproof@specproof
/specproof
```

**Codex:**
```text
npx @pound79/specproof setup-agent codex
# then ask the agent: "run the specproof skill"
```

No config file to write, no scaffold to run, no flags to remember.

## What `/specproof` does for you

```
/specproof
  |
  |-- 1. Detect    your framework (Playwright / Flutter) and mode
  |                (brownfield: existing app / greenfield: new app)
  |
  |-- 2. Scaffold  e2e package, page objects, step stubs, config
  |
  |-- 3. Tailor    specproof.config.yaml to your repo layout
  |
  |-- 4. Drive     the BDD flow (one of the paths below)
  |      |
  |      |-- Brownfield: read impl -> draft .feature -> human review -> implement
  |      |-- Greenfield:  write spec -> author .feature -> implement -> green
  |      |
  |      '-- (stops at every human gate with a handoff report)
  |
  |-- 5. Track     spec <-> impl <-> feature drift with SHA-256 hashes
  |
  '-- 6. Guard     scaffold a PR drift-check workflow (.github/workflows/)
                   so spec/impl/feature drift fails CI before it merges
```

Every decision that matters is yours. The AI proposes; you approve.

## Where specproof fits

- **AI-agent-driven development.** The blessed `.feature` file is the contract
  your agent has to satisfy — written before the implementation, protected
  from regeneration by a draft-marker firewall, and enforced by anti-gaming
  review guards. Point your agent at it and let CI prove the result.
- **Legacy replacement and rewrites.** Bootstrap once to capture the current
  system's observable behavior as characterization tests. The features are
  implementation-independent, so the same suite must stay green on the new
  stack — before, during, and after the migration.
- **Contract and acceptance work.** `traceability.yaml` is machine-checkable
  evidence of spec coverage; `@skip` sign-offs document what is intentionally
  out of automation scope; the scenario census (`specproof-stats --strict`)
  is a done gate you can put in an acceptance checklist.

## Two ways to work

| Mode | You have | Entry skill | What happens |
|------|----------|-------------|-------------|
| **Brownfield** | An existing app with no (or thin) E2E coverage | `/specproof` | Reads your code, drafts `.feature` files for observable behavior, you review and bless, then it implements steps to make them green. |
| **Greenfield** | A new app or a spec-first workflow | `/specproof` | You write a spec heading, it authors a `.feature`, then implements production + test code to make it green. |

## Supported frameworks

| Framework | Adapter | Runner |
|-----------|---------|--------|
| **Web** (React, Vue, Next, Svelte, ...) | `playwright` | [playwright-bdd](https://github.com/vitalets/playwright-bdd) |
| **Flutter** | `flutter` | [flutter_gherkin](https://github.com/nickmeinhold/flutter_gherkin) |

The adapter is auto-detected from your `package.json` or `pubspec.yaml`.

specproof's methodology is BDD (Gherkin) under the hood — features are
black-box, observable-behavior specs that double as the LLM's I/O schema.

## Individual skills

`/specproof` is the single entry-point that orchestrates everything. Under the
hood it drives these skills, each of which can also be invoked standalone:

| Skill | Direction | Use when |
|-------|-----------|----------|
| `/specproof-bootstrap` | impl -> feature draft | You want to generate `.feature` drafts from existing code |
| `/specproof-new-feature` | spec -> feature | You have a new spec section and want a RED `.feature` |
| `/specproof-implement` | feature -> impl | You have a blessed `.feature` and want GREEN test code |
| `/specproof-sync` | drift -> feature | Spec or impl changed and `.feature` needs to catch up |

## Drift detection (AI-free CLI)

Spec, implementation, or feature files changed? The traceability engine detects
it deterministically with SHA-256 hashes -- no AI involved:

```bash
npx -y -p @pound79/specproof-traceability specproof-check   # detect drift
npx -y -p @pound79/specproof-traceability specproof-update  # bless hashes
npx -y -p @pound79/specproof-traceability specproof-stats   # scenario census
```

Install it as a dev dependency for shorter commands:

```bash
npm i -D @pound79/specproof-traceability
npx specproof-check --json
```

## CLI scaffold (without the agent skills)

If you're not using an AI coding agent, scaffold directly:

```bash
npx @pound79/specproof init --adapter playwright   # or: flutter | auto
```

The CLI prints next steps on completion. Edit `specproof.config.yaml` at your
repo root to match your project layout.

## How it works (architecture)

specproof separates concerns into three layers:

1. **Methodology (agent skills)** -- the `specproof-*` skills that drive the
   BDD flow. Framework-agnostic; all framework-specific values come from
   `specproof.config.yaml`.
2. **Traceability engine** --
   [`@pound79/specproof-traceability`](https://www.npmjs.com/package/@pound79/specproof-traceability):
   a minimal-dependency Node CLI that detects spec / impl / feature drift via
   SHA-256 hashes.
3. **Scaffold templates** -- per-framework starter packages
   (`templates/playwright/`, `templates/flutter/`), unpacked by `specproof init`.

## Key concepts

| Term | Meaning |
|------|---------|
| **Spec** | An authoritative `##`-heading section in an in-repo markdown file. |
| **Feature** | A black-box Gherkin `.feature` describing *observable* behavior only. |
| **Drift** | A deterministic SHA-256 diff between the blessed baseline and the current state. |
| **Bless** | Marking the current spec/impl/feature state as the known-good baseline. |
| **Draft marker** | `# specproof: draft` in a `.feature` -- means "not yet human-reviewed". Implementation is blocked until you remove it. The legacy `# bdd-kit: draft` marker is still detected for backward compatibility. |

See [`CONTEXT.md`](./CONTEXT.md) for the full glossary.

## Prerequisites

- An AI coding agent that supports the [SKILL.md](https://github.com/openai/skills)
  standard: [Claude Code](https://www.anthropic.com/claude-code),
  [Codex](https://openai.com/index/introducing-codex/), or others.
- Node.js **>= 24** (see `.nvmrc`).
- Specs live as in-repo markdown `##` headings. External tools (Notion,
  Confluence) are not supported for drift tracking.

## Contributing & license

- Contributions welcome -- see [CONTRIBUTING.md](./CONTRIBUTING.md) and
  [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- Security policy: [SECURITY.md](./SECURITY.md).
- Licensed under the [MIT License](./LICENSE).
