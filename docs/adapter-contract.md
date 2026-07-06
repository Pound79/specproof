# specproof アダプター契約

**バージョン**: 0.1.0-draft  
**対象フェーズ**: Phase 0（抽象の確定）  
**ステータス**: レビュー待ち

---

## 1. 契約の目的と「コードの interface ではない」理由

specproof の skill（specproof オーケストレータ / specproof-bootstrap / specproof-new-feature / specproof-sync / specproof-implement。drift 検知は CLI）は Markdown プロンプトであり、TypeScript の `interface` を `implements` する手段を持たない。そのため、**フレームワークへの適合は「コード契約」ではなく「capability ベースの宣言型設定」**として表現する。

consumer リポジトリは `specproof.config.yaml` を 1 枚だけ配置する。skill 実行時にエージェントはこのファイルを読み、`{{placeholder}}` を実際の値に解決してから処理を進める。これにより:

- skill の SKILL.md 本体をリポごとに編集する必要がない（plugin として無改変配布できる）
- フレームワーク固有の差異（playwright vs Flutter）は config の `adapter:` フィールドと `commands:` ブロックに局所化される
- traceability エンジン（`@pound79/specproof-traceability`）は `layout:` から取得したパスだけを受け取るため playwright も Flutter も知らない

---

## 2. capability 一覧

### 2.1 commands（実行コマンド）

skill が呼び出す 4 つの標準コマンド。アダプターは各エントリに対してリポジトリで実際に動くシェルコマンド文字列を供給する。

| capability key | 役割 | playwright v1 | Flutter（段階 2） |
|---|---|---|---|
| `commands.generate` | `.feature` → glue コード生成 | `cd packages/e2e && npm run bddgen` | `cd bdd_tests && dart run build_runner build --delete-conflicting-outputs` |
| `commands.typecheck` | 型検査 | `cd packages/e2e && npm run typecheck` | `cd bdd_tests && flutter analyze` |
| `commands.lint` | フォーマット + 静的解析 | `cd packages/e2e && npm run lint` | `cd bdd_tests && dart format --set-exit-if-changed . && flutter analyze` |
| `commands.smoke` | 高速サブセット実行（CI 必須パス） | `cd packages/e2e && npm run test:smoke` | `cd bdd_tests && flutter test integration_test/gherkin_suite_test.dart -d macos` |

追加の補助コマンドとして `commands.traceabilityUpdate` / `commands.traceabilityCheck` / `commands.traceabilityList` を定義できる（任意）。これらは traceability エンジンの CLI を呼び出す。**設定キー名の正準は `docs/config-schema.md`（camelCase）** に従う。

### 2.2 layout（ディレクトリ / ファイルレイアウト）

skill がファイルを読み書きする際の基点パス。すべてリポルートからの相対パス。

| フィールド | 役割 | playwright v1 | Flutter（段階 2） |
|---|---|---|---|
| `layout.e2eRoot` | E2E パッケージのルート | `packages/e2e` | `bdd_tests` |
| `layout.featuresDir` | `.feature` ファイルを置くディレクトリ | `packages/e2e/features` | `bdd_tests/integration_test/features`（build.yaml の sources に要追加） |
| `layout.stepsDir` | ステップ定義ファイルのディレクトリ | `packages/e2e/steps` | `bdd_tests/integration_test/steps`（Dart: build_runner が step/ フォルダを生成） |
| `layout.pagesDir` | ページオブジェクト（POM）のディレクトリ | `packages/e2e/src/pages` | `bdd_tests/integration_test/app` |
| `layout.textConstants` | UI 表示文字列定数ファイル | `packages/e2e/src/config/text.ts` | `lib/l10n/app_ja.arb` |
| `layout.implGlobs` | 実装ファイルの glob リスト（traceability に登録） | `["packages/web/src/pages/exampleApp/*.tsx", "packages/cdk/lambda/exampleApp/*.ts"]` | `["lib/**/*.dart"]` |
| `layout.specDir` | 設計根拠 doc のディレクトリ | `docs/example-app` | 同左（方法論非依存） |
| `layout.manifest` | traceability マニフェストのパス | `packages/e2e/traceability.yaml` | 同左 |
| `layout.scratchDir` | feature ドラフトの一時出力先 | `/tmp/specproof-draft` | `/tmp/specproof-draft` |
| `layout.testRunnerConfig` | テストランナー設定ファイル | `playwright.config.ts` | `pubspec.yaml`（Patrol: patrol セクション） |
| `layout.stepFileExt` | ステップ定義ファイルの拡張子 | `.ts` | `.dart` |
| `layout.e2eReadme` | E2E README（skill がリンク先として参照） | `packages/e2e/README.md` | `bdd_tests/README.md` |

### 2.3 language（Gherkin 方言）

| フィールド | 説明 |
|---|---|
| `language` | Cucumber i18n ロケールコード。`ja` で日本語キーワードを使用。playwright-bdd は `# language: ja` ディレクティブを feature ファイル先頭行で読む。**重要**: 日本語 Gherkin は `flutter_gherkin` を使う（`bdd_widget_test` は英語キーワード専用パーサーで日本語不可のため**不採用**。`docs/flutter-readiness.md` で確定済み）。|

### 2.4 tags taxonomy（タグ分類体系）

skill が feature ファイル内でタグを参照するときの正準名称。各エントリの value が実際の Gherkin タグ文字列。

| フィールド | 役割 |
|---|---|
| `tags.slow` | 実 AI 呼び出し等、時間がかかるシナリオ。smoke 実行では除外する |
| `tags.generate` | ロングリスト生成等のドメイン重操作。常に `tags.slow` と併用 |
| `tags.admin` | 管理者ロールが必要なシナリオ（対応 project: `authed-admin`） |
| `tags.user` | 一般ユーザーロール（省略時は `not @admin` と解釈） |
| `tags.sf` | 外部 SaaS fixture 依存シナリオ（任意。外部依存フラグ） |
| `tags.fixme` | 自動化困難・既知不具合。CI では除外するが feature には残す |
| `tags.skip` | 意図的に除外。rationale doc へのリンクを必ずコメントで添える |

### 2.5 roles / projects（ランナープロファイル）

テストランナーが認証状態ごとにセッションを分けるプロファイル名。

| フィールド | 説明 |
|---|---|
| `projects` | オブジェクトのリスト。各エントリは `name`（プロファイル名）と `tags`（対象タグ式）を持つ |
| `projects[].name` | ランナーが識別するプロジェクト名（playwright: `name:` フィールド） |
| `projects[].tags` | このプロジェクトが実行するシナリオのタグ式 |

playwright v1 の実値: `[{name: "authed", tags: "not @admin"}, {name: "authed-admin", tags: "@admin"}, {name: "guest", tags: ""}]`

### 2.6 step + POM idiom guide（参照先）

skill が新規ステップ定義やページオブジェクトを生成するときに従うイディオムガイドへのパス。

| フィールド | 説明 |
|---|---|
| `idiomGuide` | step / POM の書き方ガイドへのリポ相対パス（playwright: `specproof-sync/prompts/system.md`） |

### 2.7 環境変数

skill が参照できる環境変数の論理名称。実値は consumer のシェル/CI が供給する。

| フィールド | 説明 |
|---|---|
| `env.baseUrl` | E2E テストが接続するアプリの URL 環境変数名（例: `E2E_BASE_URL`） |
| `env.username` | テストユーザーのメールアドレス環境変数名（例: `E2E_USERNAME`）（任意） |

### 2.8 meta（アダプター識別）

| フィールド | 説明 |
|---|---|
| `adapter` | アダプター種別。`playwright` または `flutter`（将来拡張可能） |
| `bddRunner` | BDD フレームワーク識別子。`playwright-bdd`、`flutter_gherkin` など（日本語 Gherkin は `flutter_gherkin`。`bdd_widget_test` は日本語不可で**不採用**＝`docs/flutter-readiness.md` で確定） |
| `bddGenTool` | `commands.generate` で使われるツール名（ログ・エラー表示用）。例: `bddgen`、`build_runner` |

### 2.9 conventions（コーディング規約参照）

skill が生成コードに適用する規約へのリファレンス。

| フィールド | 説明 |
|---|---|
| `conventions.agentsDoc` | エージェント規約ドキュメントへのパス（任意）。例: `AGENTS.md` |
| `conventions.i18nLintPlugin` | i18n 静的解析プラグイン名（任意）。例: `eslint-plugin-i18next` |
| `conventions.stepFrameworkPattern` | ステップバインド関数の呼び出しパターン名（任意）。例: `createBdd`（playwright-bdd 固有） |
| `conventions.pendingStubBody` | 未実装ステップのスタブ本体（任意）。例: `throw new Error('pending: implement this step');` |

### 2.10 environments（実行環境プロファイル — required）

実行環境（local / dev / staging 等）ごとに認証プロバイダ・dotenv ファイル・除外タグを宣言的に定義する。**required（1 エントリ以上）。adapter-agnostic** — playwright / Flutter 両方に適用。

認証プロバイダ（`auth.provider` / `auth.description`）は `environments[]` 内にのみ定義する。トップレベル `auth` は存在しない。

| フィールド | 説明 |
|---|---|
| `environments[]` | 環境プロファイルのリスト。**1 エントリ以上必須。** |
| `environments[].name` | 環境名。`SPECPROOF_ENV` 環境変数の値と照合する。 |
| `environments[].default` | `SPECPROOF_ENV` 未設定時のフォールバック（`true` は 1 エントリだけ）。 |
| `environments[].dotenvFile` | この環境で読み込む dotenv ファイル（e2e パッケージルート相対）。省略時は `.env`。 |
| `environments[].auth.provider` | 認証プロバイダ識別子（この環境での認証方式）。 |
| `environments[].auth.description` | 認証方式の人間向け説明（スキルのステップ実装時に参照）。 |
| `environments[].excludeTags` | この環境で除外するタグのリスト。ランナーが grep/filter に合成する。 |
| `environments[].envOverrides` | dotenv 読み込み後に追加注入する key-value。shell 既設定値は上書きしない。 |

**選択ルール**: `SPECPROOF_ENV` 設定済み → 一致する `name` のエントリ（不一致時はエラー）。未設定 → `default: true` → 先頭エントリ。

**3 軸の直交性**:

| 軸 | capability | 選択メカニズム |
|---|---|---|
| 実行環境 | `environments[]` | `SPECPROOF_ENV` |
| 認証ロール | `projects[]` | `tags` + `conditional` |
| シナリオ属性 | `tags` | ランナーのタグフィルタ |

`excludeTags` は環境軸からタグ軸へのフィルタ（例: local 環境では `@google-auth` を除外）。3 軸は独立に評価され、すべて通過したシナリオだけが実行対象になる。

**Flutter adapter での適用**: Dart runtime は `process.env` を直接読めないため、`dotenvFile` の切り替えは CI スクリプト（`--dart-define=ENV=dev` 等）で行う。`environments` はスキルがシナリオ生成・実装時に参照する宣言として機能する。runtime の dotenv 切り替えは adapter の CI テンプレートが担当する。

---

## 3. playwright v1 vs Flutter の capability マッピング対照表

| capability | フィールドパス | playwright v1（実値） | Flutter（段階 2・参考値） |
|---|---|---|---|
| glue コード生成 | `commands.generate` | `cd packages/e2e && npm run bddgen` | `cd bdd_tests && dart run build_runner build --delete-conflicting-outputs` |
| 型検査 | `commands.typecheck` | `cd packages/e2e && npm run typecheck` | `cd bdd_tests && flutter analyze` |
| lint | `commands.lint` | `cd packages/e2e && npm run lint` | `cd bdd_tests && dart format --set-exit-if-changed . && flutter analyze` |
| スモークテスト | `commands.smoke` | `cd packages/e2e && npm run test:smoke` | `cd bdd_tests && flutter test integration_test/gherkin_suite_test.dart -d macos` |
| feature ディレクトリ | `layout.featuresDir` | `packages/e2e/features` | `bdd_tests/integration_test/features` |
| ステップ定義 | `layout.stepsDir` | `packages/e2e/steps` | `bdd_tests/integration_test/steps`（generated: `step/`） |
| POM | `layout.pagesDir` | `packages/e2e/src/pages` | `bdd_tests/integration_test/app` |
| UI 文字列定数 | `layout.textConstants` | `packages/e2e/src/config/text.ts` | `lib/l10n/app_ja.arb` |
| マニフェスト | `layout.manifest` | `packages/e2e/traceability.yaml` | `traceability.yaml`（同一エンジン） |
| Gherkin 方言 | `language` | `ja` | `en`（または前処理 ja: 段階 2 確定） |
| slow タグ | `tags.slow` | `@slow` | `@slow`（patrol: `tags: ['slow']`） |
| 管理者タグ | `tags.admin` | `@admin` | アプリに応じて再定義 |
| ステップ拡張子 | `layout.stepFileExt` | `.ts` | `.dart` |
| ランナープロジェクト | `projects[].name` | `authed / authed-admin / guest` | Patrol flavor / 認証状態 |
| POM イディオム | `idiomGuide` | `specproof-sync/prompts/system.md` | Patrol PatrolTester ガイド（段階 2） |
| ステップバインド | `conventions.stepFrameworkPattern` | `createBdd` | 名前変換（関数名=ステップ文） |

### Flutter 固有 capability（`flutter:` セクション）

Flutter adapter は playwright には存在しない native 操作を必要とする。これらは `flutter:` セクションに隔離し、playwright adapter ではスキップされる。

| capability | 説明 |
|---|---|
| `flutter.deviceTarget` | テスト対象デバイス ID（`patrol test --device <id>`） |
| `flutter.flavor` | アプリフレーバー（`patrol test --flavor <name>`） |
| `flutter.nativePermissions` | 実機で付与する権限リスト（`grantPermissionWhenInUse` 等） |
| `flutter.buildMode` | `build_runner` のモード（`build` / `watch`） |
| `flutter.integrationTestDir` | Patrol 4.0: `patrol_test/`、旧: `integration_test/` |
| `flutter.patrolTagsFilter` | `patrol test --tags` に渡すタグ式 |

---

## 4. traceability エンジンとの接点

`@pound79/specproof-traceability` のパブリック API（`discoverConfig` / `checkDrift` / `updateManifestHashes` 等）は `specproof.config.yaml` から `BddTraceabilityConfig` を組み立てて動作する。config フィールドとエンジン API の対応:

| config フィールド | エンジン API パラメータ |
|---|---|
| `layout.manifest` | `manifestPath` |
| `layout.pagesDir` | `pagesDir`（`buildDomainList` の `options.pagesDir`） |
| `layout.specDir` | traceability link の `spec.path` の基点 |
| `layout.implGlobs` | traceability link の `impl.path` の基点 |

---

## 5. 設定解決ルール

1. skill は実行開始時に必ず `specproof.config.yaml` をリポルートから探索する（`discoverConfig()` 相当）。
2. 見つからない場合はエラーを返す（デフォルト値による自動補完はしない）。
3. Flutter `native:` / `flutter:` セクションは、`adapter: flutter` の場合のみ読む。
4. `commands.traceability_*` が省略された場合は `npm run traceability:*` をデフォルトとしてよい（v1 のみ）。
5. `{{config:auth.provider}}` / `{{config:auth.description}}` はアクティブ環境プロファイルの
   `auth` から解決する。`environments[]` は必須（1 エントリ以上）。

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
