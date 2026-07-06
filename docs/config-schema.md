# specproof.config.yaml スキーマリファレンス

consumer リポのルートに置く 1 枚の設定ファイル。specproof-* skill は実行時にこれを読み、
プロンプト内の `{{placeholder}}` を実値へ解決する。これにより skill 本体（SKILL.md）は
リポ非依存になり、Claude Code plugin として無改変配布できる。

正準の worked example は `templates/playwright/specproof.config.yaml`。

## 設計原則

- adapter は「コードの interface」ではなく「config が供給する capability の束」。
  skill は Markdown プロンプトで `implements` できないため、宣言的設定で適合する。
- framework 固有差（playwright vs flutter）は `adapter` と `commands` / `flutter` に局所化。
- traceability エンジン（`@pound79/specproof-traceability`）は `layout` のパスのみを受け取り、
  framework を一切知らない。

## トップレベルフィールド

| フィールド | 要否 | 説明 |
|---|---|---|
| `adapter` | required | `playwright` \| `flutter`。framework 分岐キー。 |
| `bddRunner` | required | BDD フレームワーク識別子（例 `playwright-bdd`）。 |
| `bddGenTool` | required | 生成ツール名（ログ表示用、例 `bddgen`）。 |
| `language` | required | Gherkin 方言（Cucumber i18n ロケール、例 `ja`）。キーワード集合はここから導出。 |
| `strictUnregisteredImpl` | optional（既定 `false`） | `true` のとき、`unregistered-impl` 警告も他の warning と同様に `--strict` で失敗扱いになる。既定では `--strict` を付けても `unregistered-impl` は失敗させない（`layout.implGlobs` の粒度次第でノイズになりやすいための opt-in）。 |
| `strictUnregisteredSpecHeadings` | optional（既定 `false`） | `true` のとき、`unregistered-spec-heading` 警告も他の warning と同様に `--strict` で失敗扱いになる。既定では `--strict` を付けても失敗させない（登録済み spec ファイルに限定しても、改訂履歴・用語集などリンク対象外の見出しが同居する実運用でノイズになりやすいための opt-in）。 |

## commands

skill / CLI はこれらのコマンドをリポ**ルートから** `cwd` を変えずに spawn する。
`e2eRoot` がリポ直下でない場合（playwright の既定 `packages/e2e` 等）、コマンド文字列
自体に `cd <e2eRoot> && ...` を含めること — `specproof init` は repo root の
package.json に workspaces を注入しないため、`npm run <script>` を裸で書くと
`Missing script` で失敗する。

| キー | 要否 | playwright 例 |
|---|---|---|
| `generate` | required | `cd packages/e2e && npm run bddgen` |
| `typecheck` | required | `cd packages/e2e && npm run typecheck` |
| `lint` | required | `cd packages/e2e && npm run lint` |
| `smoke` | required | `cd packages/e2e && npm run test:smoke` |
| `install` | optional<sup>+</sup> | `npm ci` |
| `traceabilityUpdate` / `traceabilityCheck` / `traceabilityList` / `traceabilityStats` | optional | `npx -y -p @pound79/specproof-traceability specproof-*` |

## layout（リポルート相対パス）

| フィールド | 要否 | 説明 |
|---|---|---|
| `e2eRoot` | required | E2E パッケージ root |
| `featuresDir` | required | `.feature` 置き場 |
| `stepsDir` | required | step 定義 dir |
| `stepFileSuffix` | optional<sup>+</sup> | step ファイル命名規約（`.steps.ts`）。glob 誤爆防止。 |
| `stepFileExt` | required | step ファイル言語拡張子（`.ts`） |
| `pagesDir` | required | page object dir |
| `candidateSuffix` | optional | `specproof-list` が未追跡ページを検出するファイル名 suffix。**既定値 `"Page.tsx"`（React/Playwright 前提）**。この既定はフレームワークによっては何にもマッチせず検出が常に 0 件になりうるため（例: Flutter の `.dart` ファイル）、`pagesDir` 配下の実ファイル命名規約に合わせて明示的に設定することを推奨。playwright テンプレートの POM（`LoginPage.ts` 等）も既定値とは拡張子が食い違うため、テンプレートにコメントで明記している。 |
| `textConstants` | required | UI 文字列定数（mirror） |
| `i18nSource` | optional<sup>+</sup> | text.ts の上流 i18n source（`ja.yaml`） |
| `manifest` | required | traceability manifest path |
| `specDir` | required | 設計根拠 doc dir |
| `implGlobs` | optional | `unregistered-impl` 検知（`specproof-check`）の対象を絞る glob リスト（`*` / `**` のみ対応の自前マッチャー）。**未設定時は検知自体を行わない**（opt-in）。 |
| `scratchDir` / `testRunnerConfig` / `idiomGuide` | optional | 補助参照 |
| `e2eReadme` | optional | E2E パッケージの README パス。specproof-bootstrap / specproof-implement skill が `{{config:layout.e2eReadme}}` として参照する。**同梱の playwright / flutter テンプレートはこのパスに実体の README.md を同梱済み**（変更起点別フロー・bootstrap 一度きりの規約・rationale doc 規約などの節を含む）。カスタムテンプレートを組む場合もこの節を持つ README を配置すること。 |

## fixtures<sup>+</sup>

page object fixture 名 -> POM ファイルの map。skill が step skeleton の fixture
destructuring を生成するとき解決する（`mainOperationPage` 以外の fixture 名が
素の config では欠落していた、という検証指摘への対応）。

## tags / projects / env / environments / implement / git / agents / conventions / examples

| ブロック | 要否 | 要点 |
|---|---|---|
| `tags` | required（slow/generate/admin/user） | Gherkin タグ正準名。sf/fixme/skip は optional。`fixme` / `skip` は省略時 `@fixme` / `@skip`。traceability エンジンの理由コメント必須タグ（`specproof-check`）と done gate（`specproof-stats --strict` の @fixme=0 判定）にも使われるため、リネーム時はこの値で集計・lint される。`@` は省略可（自動補完）。 |
| `projects[]` | required | ランナープロファイル。`name` + `tags` + `features`<sup>+</sup>（feature 限定）+ `conditional`<sup>+</sup>。 |
| `env` | required（baseUrl） | 環境変数の論理名。`adminUsername`<sup>+</sup> は authed-admin の条件判定。 |
| `environments[]` | required（1エントリ以上） | 実行環境プロファイル。環境別の auth / dotenv / excludeTags を宣言。詳細は後述。 |
| `implement`<sup>+</sup> | optional | `blastRadiusGlobs` = specproof-implement の編集許可スコープ（implGlobs とは別概念）。 |
| `git`<sup>+</sup> | optional | `commitScope` / `branchPrefix`。specproof-sync 自動コミット用。 |
| `agents`<sup>+</sup> | optional | `codeReviewer` / `securityReviewer` の識別子。 |
| `conventions` | optional | `agentsDoc` / `i18nLintPlugin` / `stepFrameworkPattern` / `pendingStubBody`。 |
| `examples` | optional | `domainName` / `specDoc`<sup>+</sup> / `internalConstants`。 |

## environments（required — 1 エントリ以上）

実行環境（local / dev / staging 等）ごとに異なるテスト挙動を宣言的に定義する。
**最低 1 エントリが必須。** 単一環境のリポでも `[{name: local, default: true}]` を記載する。

認証プロバイダ（`auth.provider` / `auth.description`）は `environments[]` 内にのみ定義する。
トップレベル `auth` は存在しない（環境プロファイルが認証の唯一の定義場所）。

### 設計原則

- **認証ロール軸（`projects[]`）と環境軸（`environments[]`）は直交する。**
  `authed` × `local`（mock auth）/ `authed` × `dev`（Google OAuth）の組み合わせは
  `projects[]` を複製せずに `environments[]` で吸収する。
- **`SPECPROOF_ENV` 環境変数**でアクティブプロファイルを選択する（`BDD_KIT_ENV` は旧環境変数名。後方互換のため引き続き読み取られるフォールバックとして残る）。
- **`{{config:auth.provider}}` トークンはアクティブ環境プロファイルの `auth.provider` に解決される。**

### 選択ルール

1. `SPECPROOF_ENV` が設定されている → 一致する `name` のエントリを使用。不一致時はエラー。
2. `SPECPROOF_ENV` が未設定 かつ `BDD_KIT_ENV`(非推奨の後方互換フォールバック)が設定されている → 同様に一致する `name` のエントリを使用。不一致時はエラー。
3. どちらも未設定 → `default: true` のエントリ。複数ある場合は先頭。
4. `default: true` もない → `environments[]` の先頭エントリ。

**後方互換**: `BDD_KIT_ENV` は `SPECPROOF_ENV` 導入前の環境変数名。`SPECPROOF_ENV` が優先され、`SPECPROOF_ENV` が未設定の場合にのみ `BDD_KIT_ENV` がフォールバックとして読み取られる。新規導入では `SPECPROOF_ENV` を使うこと。

### フィールド

| フィールド | 型 | 要否 | 説明 |
|---|---|---|---|
| `name` | string | required | 環境名（`local` / `dev` / `staging` / `prod` 等）。`SPECPROOF_ENV`(未設定時は後方互換フォールバックの `BDD_KIT_ENV`)の値と照合する。 |
| `default` | boolean | optional | `SPECPROOF_ENV` / `BDD_KIT_ENV` がどちらも未設定時に使うプロファイル。1 つだけ `true` にする。 |
| `dotenvFile` | string | optional | この環境で読む dotenv ファイルパス（e2e パッケージルート相対）。省略時は `.env`。 |
| `auth` | object | optional | この環境の認証設定。 |
| `auth.provider` | string | optional | 認証プロバイダ識別子（`mock` / `google` / `email-password` / `saml` 等）。 |
| `auth.description` | string | optional | 認証方式の人間向け説明。スキルがシナリオ実装時に参照する。 |
| `excludeTags` | string[] | optional | この環境で除外するタグのリスト。ランナーがフィルタに使い、スキルが skip 判定に使う。 |
| `envOverrides` | Record\<string, string\> | optional | dotenv 読み込み後に追加注入する環境変数。shell 既設定値は上書きしない。 |

### 例

```yaml
environments:
  - name: local
    default: true
    dotenvFile: ".env.local"
    auth:
      provider: mock
      description: "ローカル開発用モック認証。実 IdP への通信なし。"
    excludeTags:
      - "@google-auth"
      - "@requires-real-smtp"

  - name: dev
    dotenvFile: ".env.dev"
    auth:
      provider: google
      description: "Firebase Auth (Google) — dev project。"
    excludeTags: []

  - name: staging
    dotenvFile: ".env.staging"
    auth:
      provider: google
      description: "Firebase Auth (Google) — staging。本番同等の IdP 設定。"
    excludeTags:
      - "@destructive"
```

### 直交性: environments × projects × tags

```
environments[]  — 実行環境軸（local/dev/staging）  → SPECPROOF_ENV(未設定時は BDD_KIT_ENV)で選択
projects[]      — 認証ロール軸（authed/admin/guest）→ tags + conditional で選択
tags            — シナリオ属性軸（@slow/@admin 等）  → ランナーがフィルタ
```

`excludeTags` は環境軸から tags 軸へのフィルタ。例: local 環境では `@google-auth` を除外。
`projects[].conditional` は認証ロール軸から env 軸へのフィルタ。例: admin 環境変数がなければスキップ。
3 軸は独立に評価され、すべて通過したシナリオだけが実行対象になる。

## <sup>+</sup> adversarial 検証で追加・補正したフィールド

Phase 0 の coverage 検証（skill が参照する 143 個の hardcode token を素の config が
吸収できるか反証）で見つかった 12 ギャップ + 5 補正の反映:

1. `layout.i18nSource` — text.ts の上流 `ja.yaml` が素の config に無かった（gap）。
2. `fixtures` map — `mainOperationPage` 以外の fixture 名が解決不能だった（gap）。
3. `implement.blastRadiusGlobs` に `packages/web/src/components/exampleApp/**` — implGlobs から
   漏れていた specproof-implement の編集スコープ（gap/correction）。
4. `layout.stepFileSuffix: .steps.ts` — `stepFileExt: .ts` だけでは glob が `steps/*.ts` になり
   非 step ファイルを誤爆する（correction）。
5. `projects[].features` — guest が `auth.feature` のみ実行する事実は tag だけでは表現不可
   だった（correction）。
6. `git.commitScope` / `git.branchPrefix` — `feat(e2e):` / `feat/specproof-sync-<date>` が hardcode（gap）。
7. `commands.install` — drift skill の復旧手順 `npm ci`（gap, yarn/pnpm 環境への適応）。
8. `agents.codeReviewer` / `agents.securityReviewer` — レビューエージェント名（gap）。
9. `auth.provider` / `auth.description` — 認証プロバイダ参照（gap）。→ `environments[].auth` に統合済み。
10. `examples.specDoc` — new-feature が参照する代表 spec ファイル名（gap）。
11. `env.adminUsername` + `projects[].conditional` — authed-admin の runtime 条件性（correction）。
12. Playwright assertion/locator API（`toHaveURL` 等）と Gherkin キーワード集合は **意図的に
    config 化しない**。前者は idiomGuide（system.md）に、後者は `language` から Cucumber i18n
    テーブル経由で導出する。

検証の生データ: ワークフロー出力の `coverage.gaps` / `coverage.corrections`（12 + 5 件）。
