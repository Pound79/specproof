# @pound79/specproof

[![npm](https://img.shields.io/npm/v/@pound79/specproof.svg)](https://www.npmjs.com/package/@pound79/specproof) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Scaffolder CLI for [**specproof**](https://github.com/Pound79/specproof): drops a
config-driven BDD behavior-test scaffold into your repository, wired to a single
`specproof.config.yaml`.

## Usage

> **Recommended**: if you use an AI coding agent
> ([Claude Code](https://www.anthropic.com/claude-code),
> [Codex](https://openai.com/index/introducing-codex/), etc.),
> install the [specproof skills](https://github.com/Pound79/specproof) and run
> `/specproof` — it calls this CLI internally and drives the full BDD flow for you.

No install required — run it with `npx`:

```bash
# Scaffold a Playwright (web) e2e package
npx @pound79/specproof init --adapter playwright

# Scaffold a Flutter (flutter_gherkin + Patrol) package
npx @pound79/specproof init --adapter flutter

# Let the CLI detect the framework and pick an adapter
npx @pound79/specproof init --adapter auto

# Detect the framework without writing anything (read-only)
npx @pound79/specproof detect --json
```

Requires Node.js **>= 24**.

## Commands

| Command | Description |
|---|---|
| `init` | Scaffold a BDD test package into the repo. |
| `detect` | Detect the framework and suggest an adapter (read-only). |
| `setup-agent` | Install specproof skills for a specific AI coding agent. |

### `init` options

| Option | Description |
|---|---|
| `--adapter <playwright\|flutter\|auto>` | Test framework adapter. **Required.** `auto` also accepts a lone medium-confidence match (e.g. a plain React app) — multiple or low-confidence-only candidates still require an explicit `--adapter`. |
| `--dir <e2e-dir>` | Target directory for the e2e package. When it differs from the template default, the hardcoded paths inside the scaffolded `specproof.config.yaml` are rewritten to match. |
| `--force` | Overwrite existing files instead of skipping them. CI workflow files under `.github/workflows/` are never overwritten this way — merge those by hand. |
| `--agent <claude\|codex>` | Tailor next-steps output to a specific agent. Omit for both. |

### `detect` options

| Option | Description |
|---|---|
| `--json` | Output the detection result as JSON. |

### `setup-agent` usage

```bash
# Install skills for Codex (creates .agents/skills/)
npx @pound79/specproof setup-agent codex

# Show Claude Code install instructions
npx @pound79/specproof setup-agent claude

# Overwrite existing skill files
npx @pound79/specproof setup-agent codex --force
```

## Documentation

See the [specproof repository](https://github.com/Pound79/specproof) for the
methodology, the agent skills, and the traceability engine
([`@pound79/specproof-traceability`](https://www.npmjs.com/package/@pound79/specproof-traceability)).

## License

[MIT](./LICENSE) © Pound79
