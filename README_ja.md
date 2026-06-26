<div align="center">

# bdd-kit

[![CI](https://github.com/Pound79/bdd-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Pound79/bdd-kit/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![npm](https://img.shields.io/npm/v/@pound79/bdd-traceability.svg)](https://www.npmjs.com/package/@pound79/bdd-traceability) ![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)

[English](./README.md) | 日本語

</div>

Framework-agnostic な BDD 振る舞いテスト生成キット。実プロジェクトで実証された
「spec ↔ impl ↔ feature」のトレーサビリティ駆動 BDD フローを、他リポ（web / Flutter）でも
再利用できるよう 3 層に分離したもの。

## 3 層構成

1. **方法論（Claude Code plugin）** — `plugins/bdd-kit/skills/` の `bdd-*` skill 群
   （bootstrap / new-feature / sync / drift / implement）。framework 非依存・config 駆動。
2. **トレーサビリティ・エンジン** — `@pound79/bdd-traceability`(`packages/traceability/`)。
   spec/impl/feature のファイルハッシュで drift を検知する純 Node ツール。依存ゼロ。
3. **足場テンプレート** — `templates/playwright/`（v1, web）、`templates/flutter/`（段階 2,
   bdd_widget_test + Patrol）。`cli/`（`bdd-kit init`）が展開する。

これらを consumer リポ側の 1 枚の `bdd-kit.config.yaml` が束ねる。skill はその config を
実行時に読んでフレームワーク固有値（コマンド・パス・タグ・Gherkin 言語）を解決する。

## 前提（Prerequisites）

- Node.js **>= 24**（`.nvmrc` 参照）。
- plugin フローを使う場合: [Claude Code](https://www.anthropic.com/claude-code)。
- spec はリポ内 markdown の `##` 見出しを前提とする。外部ツール（Notion / Confluence 等）に
  のみ存在する spec は drift 追跡できない。

## 使い方（Claude Code plugin）

```text
# 1. marketplace を登録（GitHub から）
/plugin marketplace add Pound79/bdd-kit
# 2. plugin を導入
/plugin install bdd-kit@bdd-kit
# 3. consumer リポのルートに設定を置く（playwright 例は templates/playwright/ を参照）
#    bdd-kit.config.yaml
# 4. skill を実行（単一入口）
/bdd-kit            # 導入・継続の入口（adapter/モード検出 → 内部ムーブメント駆動）
/bdd-sync <link>    # drift 同期
/bdd-new-feature ... / /bdd-bootstrap ... / /bdd-implement ...   # 内部ムーブメント（単体起動も可）
# drift 検知（read-only）は CLI: npx -y -p @pound79/bdd-traceability bdd-traceability-check
```

トレーサビリティ CLI（plugin とは独立に利用可）:

```bash
npm i -D @pound79/bdd-traceability
npx bdd-traceability-check --json    # bdd-kit.config.yaml / traceability.yaml を自動探索
npx bdd-traceability-update          # ハッシュを bless（単一リンクは --link-id <id>）
npx bdd-traceability-list            # 登録ドメイン + bootstrap 候補
npx bdd-traceability-stats           # シナリオ census（automated/@fixme/@skip・完了レポート）
```

## コントリビュート & ライセンス

- コントリビュート歓迎 — [CONTRIBUTING.md](./CONTRIBUTING.md) / [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) を参照。
- セキュリティポリシー: [SECURITY.md](./SECURITY.md)。
- ライセンス: [MIT License](./LICENSE)。
