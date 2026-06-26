<div align="center">

# bdd-kit

[![CI](https://github.com/Pound79/bdd-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Pound79/bdd-kit/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![npm](https://img.shields.io/npm/v/@pound79/bdd-traceability.svg)](https://www.npmjs.com/package/@pound79/bdd-traceability) ![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)

English | [日本語](./README_ja.md)

</div>

A framework-agnostic BDD behavior-test generation kit. It separates a proven
"spec ↔ impl ↔ feature" traceability-driven BDD flow into three reusable layers
so the same workflow works across repositories (web / Flutter), wired together
by a single `bdd-kit.config.yaml` in the consumer repo.

## What's inside (3 layers)

1. **Methodology (Claude Code plugin)** — the `bdd-*` skills under
   `plugins/bdd-kit/skills/` (bootstrap / new-feature / sync / implement).
   Framework-agnostic and config-driven.
2. **Traceability engine** — `@pound79/bdd-traceability`
   (`packages/traceability/`): a dependency-free, pure-Node tool that detects
   drift via SHA-256 file hashes of spec / impl / feature.
3. **Scaffold templates** — `templates/playwright/` (web) and
   `templates/flutter/` (bdd_widget_test + Patrol), unpacked by the
   `bdd-kit init` CLI (`cli/`).

## Key concepts

- **Spec** — an authoritative `##`-heading section in an in-repo markdown file.
- **Feature** (`.feature`) — a black-box Gherkin description of *observable*
  behavior only (no selectors, URLs, or internal APIs).
- **Drift** — a deterministic, AI-free SHA-256 diff between a blessed baseline
  and the current spec / impl / feature.

See [`CONTEXT.md`](./CONTEXT.md) for the full glossary.

## Prerequisites

- Node.js **>= 24** (see `.nvmrc`).
- For the plugin flow: [Claude Code](https://www.anthropic.com/claude-code).
- Specs are expected to live as in-repo markdown `##` headings. Drift cannot
  track specs that live only in external tools (e.g. Notion / Confluence).

## Quick start (Claude Code plugin)

```text
# 1. Register the marketplace (from GitHub)
/plugin marketplace add Pound79/bdd-kit
# 2. Install the plugin
/plugin install bdd-kit@bdd-kit
# 3. Drop a bdd-kit.config.yaml at your repo root
#    (see templates/playwright/ for a worked example)
# 4. Run the single entry-point skill
/bdd-kit
```

## Traceability CLI (usable independently of the plugin)

```bash
npm i -D @pound79/bdd-traceability
npx bdd-traceability-check --json   # auto-discovers bdd-kit.config.yaml / traceability.yaml
npx bdd-traceability-update         # bless hashes (single link: --link-id <id>)
npx bdd-traceability-list           # registered domains + bootstrap candidates
npx bdd-traceability-stats          # scenario census (automated / @fixme / @skip)
```

## Contributing & license

- Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) and
  [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- Security policy: [SECURITY.md](./SECURITY.md).
- Licensed under the [MIT License](./LICENSE).
