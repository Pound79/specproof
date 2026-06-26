<div align="center">

# bdd-kit

[![CI](https://github.com/Pound79/bdd-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Pound79/bdd-kit/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![npm](https://img.shields.io/npm/v/@pound79/bdd-traceability.svg)](https://www.npmjs.com/package/@pound79/bdd-traceability) ![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)

**Claude Code で `/bdd-kit` を実行するだけ。本番品質の E2E テストが手に入る。**

[English](./README.md) | 日本語

</div>

bdd-kit は **E2E 振る舞いテストを自動構築する Claude Code plugin** です。
Web（Playwright）でも Flutter でも、スラッシュコマンド 1 つでフレームワーク検出から
scaffold、config 調整、Gherkin feature の作成、ステップ実装まで一気通貫で駆動します。
判断が要るポイントでは必ず止まるので、主導権は常にあなたにあります。

## 30 秒で始める

```text
/plugin marketplace add Pound79/bdd-kit
/plugin install bdd-kit@bdd-kit
/bdd-kit
```

以上です。config を書く必要も、scaffold を実行する必要も、フラグを覚える必要もありません。

## `/bdd-kit` がやってくれること

```
/bdd-kit
  |
  |-- 1. 検出      フレームワーク（Playwright / Flutter）とモード
  |                （brownfield: 既存アプリ / greenfield: 新規アプリ）
  |
  |-- 2. Scaffold  e2e パッケージ、page object、step スタブ、config
  |
  |-- 3. 調整      bdd-kit.config.yaml をリポの実態に合わせて最適化
  |
  |-- 4. 駆動      BDD フロー（以下のどちらかのパス）
  |      |
  |      |-- Brownfield: 実装を読む -> .feature ドラフト -> 人間レビュー -> 実装
  |      |-- Greenfield: spec を書く -> .feature を作成 -> 実装 -> green
  |      |
  |      '-- (判断が要る箇所でハンドオフレポートを出して停止)
  |
  '-- 5. 追跡      spec <-> impl <-> feature の drift を SHA-256 で検知
```

重要な判断はすべてあなたのもの。AI は提案し、あなたが裁定します。

## 2 つの導入モード

| モード | 前提 | 入口 | 何が起きるか |
|--------|------|------|-------------|
| **Brownfield** | E2E がない（または薄い）既存アプリ | `/bdd-kit` | コードを読み、観測可能な振る舞いの `.feature` ドラフトを生成。あなたがレビュー・bless した後、ステップを実装して green にする。 |
| **Greenfield** | 新規アプリ、または spec-first ワークフロー | `/bdd-kit` | spec 見出しを書くと `.feature` を作成し、本番コード+テストコードを実装して green にする。 |

## 対応フレームワーク

| フレームワーク | アダプター | ランナー |
|---------------|-----------|---------|
| **Web**（React, Vue, Next, Svelte, ...） | `playwright` | [playwright-bdd](https://github.com/vitalets/playwright-bdd) |
| **Flutter** | `flutter` | [flutter_gherkin](https://github.com/nickmeinhold/flutter_gherkin) |

アダプターは `package.json` または `pubspec.yaml` から自動検出されます。

## 個別スキル

`/bdd-kit` はすべてをオーケストレートする単一入口です。内部で以下のスキルを駆動しており、
それぞれ単体でも起動できます:

| スキル | 方向 | 使うタイミング |
|--------|------|---------------|
| `/bdd-bootstrap` | impl -> feature ドラフト | 既存コードから `.feature` ドラフトを生成したい |
| `/bdd-new-feature` | spec -> feature | 新しい spec セクションがあり、RED な `.feature` を作りたい |
| `/bdd-implement` | feature -> impl | bless 済みの `.feature` があり、GREEN なテストコードが欲しい |
| `/bdd-sync` | drift -> feature | spec や impl が変わり、`.feature` を追従させたい |

## Drift 検知（AI 不使用の CLI）

spec・実装・feature ファイルが変わった？ トレーサビリティ・エンジンが SHA-256 ハッシュで
決定論的に検知します -- AI は一切使いません:

```bash
npx -y -p @pound79/bdd-traceability bdd-traceability-check   # drift 検知
npx -y -p @pound79/bdd-traceability bdd-traceability-update  # ハッシュを bless
npx -y -p @pound79/bdd-traceability bdd-traceability-stats   # シナリオ census
```

devDependency にインストールすればコマンドが短くなります:

```bash
npm i -D @pound79/bdd-traceability
npx bdd-traceability-check --json
```

## CLI scaffold（plugin なしで使う場合）

Claude Code を使わない場合は CLI で直接 scaffold できます:

```bash
npx @pound79/bdd-kit init --adapter playwright   # または flutter | auto
```

実行後に次のステップが表示されます。リポルートの `bdd-kit.config.yaml` をプロジェクト構成に
合わせて編集してください。

## 仕組み（アーキテクチャ）

bdd-kit は関心事を 3 層に分離しています:

1. **方法論（Claude Code plugin）** -- BDD フローを駆動する `bdd-*` スキル群。
   フレームワーク非依存で、固有値はすべて `bdd-kit.config.yaml` から読み取る。
2. **トレーサビリティ・エンジン** --
   [`@pound79/bdd-traceability`](https://www.npmjs.com/package/@pound79/bdd-traceability):
   SHA-256 ハッシュで spec / impl / feature の drift を検知する依存最小の Node CLI。
3. **足場テンプレート** -- フレームワーク別のスターターパッケージ
   （`templates/playwright/`、`templates/flutter/`）。`bdd-kit init` が展開する。

## 主要な概念

| 用語 | 意味 |
|------|------|
| **Spec** | リポ内 markdown の `##` 見出しセクション。振る舞いの権威的記述。 |
| **Feature** | ユーザーが*観測可能な振る舞い*だけを記述した黒箱の Gherkin `.feature`。 |
| **Drift** | bless 済みベースラインと現在の状態の SHA-256 差分。決定論的・AI 不使用。 |
| **Bless** | 現在の spec/impl/feature の状態を「既知の正」としてマークする行為。 |
| **ドラフトマーカー** | `.feature` 内の `# bdd-kit: draft`。「未レビュー」を意味し、削除するまで実装がブロックされる。 |

用語集の全体は [`CONTEXT.md`](./CONTEXT.md) を参照。

## 前提

- [Claude Code](https://www.anthropic.com/claude-code)（plugin フローを使う場合）。
- Node.js **>= 24**（`.nvmrc` 参照）。
- spec はリポ内 markdown の `##` 見出しに置く。外部ツール（Notion / Confluence）のみに
  ある spec は drift 追跡できない。

## コントリビュート & ライセンス

- コントリビュート歓迎 -- [CONTRIBUTING.md](./CONTRIBUTING.md) /
  [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) を参照。
- セキュリティポリシー: [SECURITY.md](./SECURITY.md)。
- ライセンス: [MIT License](./LICENSE)。
