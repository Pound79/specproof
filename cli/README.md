# @pound79/bdd-kit

[![npm](https://img.shields.io/npm/v/@pound79/bdd-kit.svg)](https://www.npmjs.com/package/@pound79/bdd-kit) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Scaffolder CLI for [**bdd-kit**](https://github.com/Pound79/bdd-kit): drops a
config-driven BDD behavior-test scaffold into your repository, wired to a single
`bdd-kit.config.yaml`.

## Usage

> **Recommended**: if you use an AI coding agent
> ([Claude Code](https://www.anthropic.com/claude-code),
> [Codex](https://openai.com/index/introducing-codex/), etc.),
> install the [bdd-kit skills](https://github.com/Pound79/bdd-kit) and run
> `/bdd-kit` — it calls this CLI internally and drives the full BDD flow for you.

No install required — run it with `npx`:

```bash
# Scaffold a Playwright (web) e2e package
npx @pound79/bdd-kit init --adapter playwright

# Scaffold a Flutter (bdd_widget_test + Patrol) package
npx @pound79/bdd-kit init --adapter flutter

# Let the CLI detect the framework and pick an adapter
npx @pound79/bdd-kit init --adapter auto

# Detect the framework without writing anything (read-only)
npx @pound79/bdd-kit detect --json
```

Requires Node.js **>= 24**.

## Commands

| Command | Description |
|---|---|
| `init` | Scaffold a BDD test package into the repo. |
| `detect` | Detect the framework and suggest an adapter (read-only). |
| `setup-agent` | Install bdd-kit skills for a specific AI coding agent. |

### `init` options

| Option | Description |
|---|---|
| `--adapter <playwright\|flutter\|auto>` | Test framework adapter. **Required.** |
| `--dir <e2e-dir>` | Target directory for the e2e package. |
| `--force` | Overwrite existing files instead of skipping them. |
| `--agent <claude\|codex>` | Tailor next-steps output to a specific agent. Omit for both. |

### `detect` options

| Option | Description |
|---|---|
| `--json` | Output the detection result as JSON. |

### `setup-agent` usage

```bash
# Install skills for Codex (creates .agents/skills/)
npx @pound79/bdd-kit setup-agent codex

# Show Claude Code install instructions
npx @pound79/bdd-kit setup-agent claude

# Overwrite existing skill files
npx @pound79/bdd-kit setup-agent codex --force
```

## Documentation

See the [bdd-kit repository](https://github.com/Pound79/bdd-kit) for the
methodology, the agent skills, and the traceability engine
([`@pound79/bdd-traceability`](https://www.npmjs.com/package/@pound79/bdd-traceability)).

## License

[MIT](./LICENSE) © Pound79
