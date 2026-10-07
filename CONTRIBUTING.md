# Contributing to specproof

Thanks for your interest in contributing! This document covers the essentials.

## Development setup

```bash
# Requires Node.js >= 24 (see .nvmrc)
npm ci            # install all workspace dependencies
npm run typecheck # tsc --noEmit across all workspaces
npm test          # vitest across workspaces + node:test for scripts/
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

## 品質チェック

`npm ci` の後、`npm run typecheck`、`npm run build`、`npm run lint`、
`npm run format:check`、`npm test`、`npm run test:coverage` を実行する。
整形は `npm run format`。CLI診断は英語、会話・新規説明文書は日本語とする。
カバレッジ対象・閾値は [品質基準](docs/quality-gates.md) を参照。
Playwright scaffold の lint も no-op ではなく Biome を実行する。

## 公開内容の検査

このリポジトリは公開 OSS なので、私的な名前・手元の検証記録・マシン固有のパスを
追跡しない（方針は [AGENTS.md](./AGENTS.md#公開リポジトリとしての規則)）。

- `npm test` の `scripts/public-content.test.mjs` が、マシン固有のパス、許可していない
  メールアドレス、`docs/evidence/`・`*.local.md`・見本以外の dotenv を検出する。CI でも走る。
- 私的な名前はリポジトリに書くと公開されるため、clone ごとに次のフックを有効にし、
  語彙をリポジトリの外に置く。

```bash
git config core.hooksPath scripts/githooks
mkdir -p ~/.config/git
$EDITOR ~/.config/git/private-terms.txt   # 1 行 1 語。空行と # で始まる行は無視
```

語彙の置き場所は環境変数 `SPECPROOF_PRIVATE_TERMS` でも指定できる。pre-commit は
ステージした各ファイルの内容・パス・名義、commit-msg はメッセージ、pre-push は送る全コミットと
注釈付きタグを検査する。語彙ファイルが無いときは、省略した旨を表示して通す。

フックはチェックアウト中のブランチにある `scripts/githooks` を実行する。`npm test` と同じく、
信頼できないブランチでは中身を確認してから commit や push をする。
