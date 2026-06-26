# @pound79/bdd-kit

[![npm](https://img.shields.io/npm/v/@pound79/bdd-kit.svg)](https://www.npmjs.com/package/@pound79/bdd-kit) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Scaffolder CLI for [**bdd-kit**](https://github.com/Pound79/bdd-kit): drops a
config-driven BDD behavior-test scaffold into your repository, wired to a single
`bdd-kit.config.yaml`.

## Usage

> **Recommended**: if you use [Claude Code](https://www.anthropic.com/claude-code),
> install the [bdd-kit plugin](https://github.com/Pound79/bdd-kit) and run
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

### `init` options

| Option | Description |
|---|---|
| `--adapter <playwright\|flutter\|auto>` | Test framework adapter. **Required.** |
| `--dir <e2e-dir>` | Target directory for the e2e package. |
| `--force` | Overwrite existing files instead of skipping them. |

### `detect` options

| Option | Description |
|---|---|
| `--json` | Output the detection result as JSON. |

## Documentation

See the [bdd-kit repository](https://github.com/Pound79/bdd-kit) for the
methodology, the Claude Code plugin, and the traceability engine
([`@pound79/bdd-traceability`](https://www.npmjs.com/package/@pound79/bdd-traceability)).

## License

[MIT](./LICENSE) © Pound79

