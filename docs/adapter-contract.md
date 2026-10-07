# specproof アダプター契約

**バージョン**: 0.2.x（`@pound79/specproof` / `@pound79/specproof-traceability` 0.2 系に対応）  
**ステータス**: 現行（設定キーの正本は [config-schema](./config-schema.md)）。
実値は同梱 template、実行手順は各 template README を参照する。

---

## 1. 契約の目的と「コードの interface ではない」理由

specproof の skill（specproof オーケストレータ / specproof-bootstrap / specproof-new-feature / specproof-sync / specproof-implement。drift 検知は CLI）は Markdown プロンプトであり、TypeScript の `interface` を `implements` する手段を持たない。そのため、**フレームワークへの適合は「コード契約」ではなく「capability ベースの宣言型設定」**として表現する。

consumer リポジトリは `specproof.config.yaml` を 1 枚だけ配置する。skill 実行時にエージェントはこのファイルを読み、`{{placeholder}}` を実際の値に解決してから処理を進める。これにより:

- skill の SKILL.md 本体をリポごとに編集する必要がない（plugin として無改変配布できる）
- フレームワーク固有の差異（playwright vs Flutter）は config の `adapter:` フィールドと `commands:` ブロックに局所化される
- traceability エンジン（`@pound79/specproof-traceability`）は `layout:` から取得したパスだけを受け取るため playwright も Flutter も知らない

---

## 2. capability 一覧

フィールド型・要否・設定値・後方互換の正本は [config-schema](./config-schema.md)。
ここでは責務だけを示す。consumer の config 値を解決し、同梱例の値を他アプリへ固定しない。

### 2.1 commands（実行コマンド）

[commands](./config-schema.md#commands) のコマンドを repo root から実行する。
生成→型検査→lint→smoke の具体値は adapter template が供給する。

### 2.2 layout（ディレクトリ / ファイルレイアウト）

[layout](./config-schema.md#layoutリポルート相対パス) は repo root 相対。
`.feature` ソースを hash し、生成物を feature の代わりに追跡しない。

### 2.3 language（Gherkin 方言）

`language` と feature 冒頭の `# language: ja` を一致させる。
日本語 Flutter は `flutter_gherkin` を使用する（[採用理由](./flutter-readiness.md)）。

### 2.4 tags taxonomy（タグ分類体系）

[tags の正本](./config-schema.md#tags--projects--env--environments--implement--git--agents--conventions--examples)。
`fixme` / `skip` の設定値は理由 lint と静的 done gate にも使う。

### 2.5 roles / projects（ランナープロファイル）

`projects[]` は認証ロール軸。環境・シナリオ属性とは
[直交して評価](./config-schema.md#直交性-environments--projects--tags) する。

### 2.6 step + POM idiom guide（参照先）

`idiomGuide` は consumer に存在するガイドの repo 相対パス。
Flutter 専用 guide は未整備であり、他 adapter の例を適用しない。

### 2.7 環境変数

`env` は論理名を定義する。実値は consumer の shell/CI の既存注入経路で供給し、
資格情報を config やログへ記載しない。

### 2.8 meta（アダプター識別）

`adapter` は `playwright` / `flutter`、`bddRunner` / `bddGenTool` は利用 tool の識別子。
第 3 adapter は §6 のソース変更を要する。

### 2.9 conventions（ステップ定義の慣例）

`stepFrameworkPattern`、`pendingStubBody` 等は
[config-schema](./config-schema.md) と consumer の実ファイルから解決する。

### 2.10 environments（実行環境プロファイル）

型・選択順序・旧 `BDD_KIT_ENV` の現役 fallback は
[environments の正本](./config-schema.md#environmentsrequired--1-エントリ以上)。
Flutter runtime の環境切替は consumer の CI/script が担当する。

---

## 3. playwright v1 vs Flutter の capability マッピング対照表

コマンド・配置の実値は [Playwright config](../templates/playwright/specproof.config.yaml) と
[Flutter config](../templates/flutter/specproof.config.yaml) が正本。
Flutter の SDK 前提・依存 pin・生成→実行・step の規約は
[Flutter README](../templates/flutter/README.md) に集約する。

### Flutter 固有 capability（`flutter:` セクション）

現行 template の宣言キーは次の 6 個。`adapter: flutter` の skill 向けであり、
traceability エンジンが Flutter runner を起動する設定ではない。

| キー | 用途 |
|---|---|
| `gherkinParser` | `flutter_gherkin`（日本語対応） |
| `testEntry` | suite エントリの repo 相対パス |
| `device` | 利用する desktop/device/emulator ID |
| `buildRunnerPin` | `>=2.4.0 <2.5.0` |
| `buildYamlSources` | `build.yaml` で列挙する sources |
| `traceabilityHashSource` | `feature`（生成 `*.g.dart` 等は除外） |

Patrol の native 操作・flavor・tag 伝播等のキーは未採択案。
現行 template/skill は読まない（[残件](./flutter-readiness.md#未完作業と未採択案)）。

---

## 4. traceability エンジンとの接点

`@pound79/specproof-traceability` のパブリック API（`discoverConfig` / `checkDrift` / `updateManifestHashes` 等）は `specproof.config.yaml` から `TraceabilityConfig` を組み立てて動作する。config フィールドとエンジン API の対応:

| config フィールド | エンジン API パラメータ |
|---|---|
| `layout.manifest` | `manifestPath` |
| `layout.pagesDir` | `pagesDir`（`buildDomainList` の `options.pagesDir`） |
| `layout.candidateSuffix` | `candidateSuffix`（`specproof-list` が未追跡ページを検出するファイル名 suffix。既定 `Page.tsx`） |
| `layout.featuresDir` | `featuresDir`（ドラフトマーカー残存・未登録 `.feature` の走査と、`specproof-stats` の集計対象） |
| `layout.implGlobs` | `implGlobs`（どのリンクの `impl` にも登録されていない実装ファイルの走査＝`unregistered-impl`。未設定なら走査しない） |

`layout.specDir` はエンジンが読まない（skill 向けの参照値）。マニフェストのリンクが持つ `spec` / `impl` / `features` の
パスはいずれもリポルート相対で解決される。

---

## 5. 設定解決ルール

1. skill は実行開始時に repo root の `specproof.config.yaml` を探索する。
2. 適用する adapter・手順の必須キーが未設定ならエラーとし、consumer 固有値を勝手に補完しない。
   任意キーは手順に明示した fallback だけを許可する（agents の自己レビュー等）。
   traceability CLI 自体の探索・fallback は `packages/traceability/src/config.ts` の契約。
3. `flutter:` セクションは `adapter: flutter` の場合だけ読む。
4. `commands.traceability*` の省略時は `npx -y -p @pound79/specproof-traceability specproof-*`
   （`specproof-check` 等）を利用できる。必須引数・flags は [CLI README](../packages/traceability/README.md#cli)。
5. `{{config:auth.provider}}` / `{{config:auth.description}}` は
   [選択ルール](./config-schema.md#選択ルール) で選んだ `environments[]` の `auth` から解決する。
   トップレベル `auth` は持たず、1 エントリ以上の環境宣言を要する。

---

## 6. 新しいアダプタの追加（現状の拡張手順）

`adapter` は宣言的 capability の束だが、scaffold CLI（`specproof init` / `detect`）は現状 playwright /
flutter の**閉じた union** を持つため、第 3 のアダプタ（Cypress / Maestro / Detox など）を足すには
TypeScript ソースの変更が要る（"framework 非依存" は方法論・エンジン層の性質で、同梱 CLI は現状 2
アダプタ）。追加に必要な変更点:

1. `cli/src/detect.ts` — `Adapter` union と検出シグナルに新アダプタを追加。
2. `cli/src/init.ts` — `SUPPORTED` 配列・既定 dir・next-steps 分岐に新アダプタを追加。
3. `templates/<adapter>/` — `specproof.config.yaml`（commands / layout / tags / environments）＋足場一式。
4. 必要なら `specproof.config.yaml` に adapter 固有セクション（flutter 例の `flutter:`）を追加。

エンジン層（`@pound79/specproof-traceability`）と方法論 skill は `layout` のパスと config の値しか見ないため
**無改変で新アダプタに対応する**。将来は `--adapter-dir <path>` でローカルのアダプタテンプレートを
指す軽量拡張を検討（閉じた union の回避）。
