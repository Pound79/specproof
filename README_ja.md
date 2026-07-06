<div align="center">

# specproof

[![CI](https://github.com/Pound79/specproof/actions/workflows/ci.yml/badge.svg)](https://github.com/Pound79/specproof/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![npm](https://img.shields.io/npm/v/@pound79/specproof-traceability.svg)](https://www.npmjs.com/package/@pound79/specproof-traceability) ![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)

**AI が書いたテストは、AI が書いたコードの写しになりがちだ。
specproof はそれを構造的に防ぐ。**

[English](./README.md) | 日本語

</div>

同じ AI エージェントが実装と E2E テストの両方を書くと、テストは「コードから独立した
証拠」であることをやめ、いま動いているコードの鏡になる。バグが入っても green のまま、
カバレッジは静かにハッピーパスへ縮んでいく。変更のたびにテストを再生成すれば、それは
もう同語反復 — コードに決して反論できない仕様書だ。

specproof はこのループを三権分立で断ち切る:

- **生成は AI。** 仕様(または既存コード — ただし一度きり)から Gherkin feature を起こし、
  step 定義を実装し、変更後の追従を行う skill 群。
- **検知は決定論。** トレーサビリティ・エンジンが仕様セクション ↔ 実装ファイル ↔
  feature ファイルを SHA-256 で結び、PR 毎に数秒で drift を検出する。AI 不使用 —
  同じ入力には必ず同じ判定。
- **裁定は人間。** ドラフトの査読、仕様と実装が食い違ったときにどちらを正とするかの
  決定、新しいベースラインの bless はあなたに残る。

**AI が提案し、SHA-256 が検証し、人間が決める。**

## 30 秒で始める

**Claude Code:**
```text
/plugin marketplace add Pound79/specproof
/plugin install specproof@specproof
/specproof
```

**Codex:**
```text
npx @pound79/specproof setup-agent codex
# エージェントに「specproof スキルを実行して」と依頼
```

config を書く必要も、scaffold を実行する必要も、フラグを覚える必要もありません。

## `/specproof` がやってくれること

```
/specproof
  |
  |-- 1. 検出      フレームワーク（Playwright / Flutter）とモード
  |                （brownfield: 既存アプリ / greenfield: 新規アプリ）
  |
  |-- 2. Scaffold  e2e パッケージ、page object、step スタブ、config
  |
  |-- 3. 調整      specproof.config.yaml をリポの実態に合わせて最適化
  |
  |-- 4. 駆動      BDD フロー（以下のどちらかのパス）
  |      |
  |      |-- Brownfield: 実装を読む -> .feature ドラフト -> 人間レビュー -> 実装
  |      |-- Greenfield: spec を書く -> .feature を作成 -> 実装 -> green
  |      |
  |      '-- (判断が要る箇所でハンドオフレポートを出して停止)
  |
  |-- 5. 追跡      spec <-> impl <-> feature の drift を SHA-256 で検知
  |
  '-- 6. Guard     PR drift-check ワークフロー（.github/workflows/）を scaffold し、
                   spec/impl/feature の drift がマージ前に CI で落ちるようにする
```

重要な判断はすべてあなたのもの。AI は提案し、あなたが裁定します。

## specproof が効く場面

- **AI エージェント主導の開発。** blessed な `.feature` は、エージェントが満たすべき
  「実装から独立した契約」。実装より先に書かれ、draft マーカーのファイアウォールで
  再生成から守られ、アンチゲーミングのレビューガードで骨抜きを防ぐ。
- **レガシー刷新・リプレイス。** bootstrap を一度だけ実行し、現行システムの観測可能な
  振る舞いを characterization test として写し取る。feature は実装非依存なので、
  移行先のスタックでも同じスイートが green であり続けることを要求できる。
- **受託・検収のエビデンス。** `traceability.yaml` は仕様網羅の機械検証可能な証跡。
  `@skip` の sign-off は「意図的に自動化対象外とした合意」の記録。シナリオ集計
  (`specproof-stats --strict`)は検収チェックリストに載せられる done gate になる。

## 2 つの導入モード

| モード | 前提 | 入口 | 何が起きるか |
|--------|------|------|-------------|
| **Brownfield** | E2E がない（または薄い）既存アプリ | `/specproof` | コードを読み、観測可能な振る舞いの `.feature` ドラフトを生成。あなたがレビュー・bless した後、ステップを実装して green にする。 |
| **Greenfield** | 新規アプリ、または spec-first ワークフロー | `/specproof` | spec 見出しを書くと `.feature` を作成し、本番コード+テストコードを実装して green にする。 |

## 対応フレームワーク

| フレームワーク | アダプター | ランナー |
|---------------|-----------|---------|
| **Web**（React, Vue, Next, Svelte, ...） | `playwright` | [playwright-bdd](https://github.com/vitalets/playwright-bdd) |
| **Flutter** | `flutter` | [flutter_gherkin](https://github.com/nickmeinhold/flutter_gherkin) |

アダプターは `package.json` または `pubspec.yaml` から自動検出されます。

specproof の方法論の中身は BDD（Gherkin）。feature は観測可能な振る舞いだけを
書く黒箱仕様であり、LLM の入出力スキーマを兼ねる。

## 個別スキル

`/specproof` はすべてをオーケストレートする単一入口です。内部で以下のスキルを駆動しており、
それぞれ単体でも起動できます:

| スキル | 方向 | 使うタイミング |
|--------|------|---------------|
| `/specproof-bootstrap` | impl -> feature ドラフト | 既存コードから `.feature` ドラフトを生成したい |
| `/specproof-new-feature` | spec -> feature | 新しい spec セクションがあり、RED な `.feature` を作りたい |
| `/specproof-implement` | feature -> impl | bless 済みの `.feature` があり、GREEN なテストコードが欲しい |
| `/specproof-sync` | drift -> feature | spec や impl が変わり、`.feature` を追従させたい |

## Drift 検知（AI 不使用の CLI）

spec・実装・feature ファイルが変わった？ トレーサビリティ・エンジンが SHA-256 ハッシュで
決定論的に検知します -- AI は一切使いません:

```bash
npx -y -p @pound79/specproof-traceability specproof-check   # drift 検知
npx -y -p @pound79/specproof-traceability specproof-update  # ハッシュを bless
npx -y -p @pound79/specproof-traceability specproof-stats   # シナリオ census
```

devDependency にインストールすればコマンドが短くなります:

```bash
npm i -D @pound79/specproof-traceability
npx specproof-check --json
```

## CLI scaffold（エージェント skill なしで使う場合）

AI コーディングエージェントを使わない場合は CLI で直接 scaffold できます:

```bash
npx @pound79/specproof init --adapter playwright   # または flutter | auto
```

実行後に次のステップが表示されます。リポルートの `specproof.config.yaml` をプロジェクト構成に
合わせて編集してください。

## 仕組み（アーキテクチャ）

specproof は関心事を 3 層に分離しています:

1. **方法論（エージェント skill）** -- BDD フローを駆動する `specproof-*` スキル群。
   フレームワーク非依存で、固有値はすべて `specproof.config.yaml` から読み取る。
2. **トレーサビリティ・エンジン** --
   [`@pound79/specproof-traceability`](https://www.npmjs.com/package/@pound79/specproof-traceability):
   SHA-256 ハッシュで spec / impl / feature の drift を検知する依存最小の Node CLI。
3. **足場テンプレート** -- フレームワーク別のスターターパッケージ
   （`templates/playwright/`、`templates/flutter/`）。`specproof init` が展開する。

## 主要な概念

| 用語 | 意味 |
|------|------|
| **Spec** | リポ内 markdown の `##` 見出しセクション。振る舞いの権威的記述。 |
| **Feature** | ユーザーが*観測可能な振る舞い*だけを記述した黒箱の Gherkin `.feature`。 |
| **Drift** | bless 済みベースラインと現在の状態の SHA-256 差分。決定論的・AI 不使用。 |
| **Bless** | 現在の spec/impl/feature の状態を「既知の正」としてマークする行為。 |
| **ドラフトマーカー** | `.feature` 内の `# specproof: draft`。「未レビュー」を意味し、削除するまで実装がブロックされる。旧マーカー `# bdd-kit: draft` も後方互換で検出される。 |

用語集の全体は [`CONTEXT.md`](./CONTEXT.md) を参照。

## 前提

- [SKILL.md](https://github.com/openai/skills) 標準対応の AI コーディングエージェント:
  [Claude Code](https://www.anthropic.com/claude-code)、
  [Codex](https://openai.com/index/introducing-codex/) 等。
- Node.js **>= 24**（`.nvmrc` 参照）。
- spec はリポ内 markdown の `##` 見出しに置く。外部ツール（Notion / Confluence）のみに
  ある spec は drift 追跡できない。

## コントリビュート & ライセンス

- コントリビュート歓迎 -- [CONTRIBUTING.md](./CONTRIBUTING.md) /
  [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) を参照。
- セキュリティポリシー: [SECURITY.md](./SECURITY.md)。
- ライセンス: [MIT License](./LICENSE)。
