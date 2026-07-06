# Contributing to specproof

Thanks for your interest in contributing! This document covers the essentials.

## Development setup

```bash
# Requires Node.js >= 24 (see .nvmrc)
npm ci            # install all workspace dependencies
npm run typecheck # tsc --noEmit across all workspaces
npm test          # vitest run across all workspaces
npm run build     # build publishable packages
```

This is an npm-workspaces monorepo:

- `packages/traceability/` — `@pound79/specproof-traceability`, the minimal-dependency
  drift-detection engine.
- `cli/` — `@pound79/specproof`, the `specproof init` scaffolder.
- `plugins/specproof/` — the agent skills (Claude Code plugin / Codex / SKILL.md standard).
- `templates/` — per-framework scaffolds (playwright / flutter).
- `docs/` — methodology, ADRs, config schema, and the adapter contract.

## Workflow

1. Fork the repo and create a branch (`feat/...`, `fix/...`, `docs/...`).
2. Write tests first where it makes sense — the project ships with a substantial
   test suite and aims to keep coverage high.
3. Make sure `npm run typecheck`, `npm test`, and `npm run build` all pass.
4. Open a pull request that links any related issue and describes the change.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`.

## Releasing

Maintainers cut releases with `npm run release -- <version>` (e.g.
`npm run release -- 0.1.5`). See [`RELEASING.md`](./RELEASING.md) for the full
process and how npm publishing is wired up.

## Design docs

Substantive changes to behavior or architecture should reference (and, when
appropriate, add) an ADR under `docs/adr/`. Domain terminology lives in
[`CONTEXT.md`](./CONTEXT.md).

## Code of Conduct

By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).
