---
name: bdd-setup
description: >
  Internal movement of the /bdd-kit orchestrator: detect the framework
  (Flutter / Playwright web), scaffold config + templates via `bdd-kit init`,
  then tailor bdd-kit.config.yaml to the repo. Prefer running /bdd-kit (the
  single entry point), which drives this automatically and then routes by mode;
  invoke this directly only to (re-)scaffold an already-detected repo.
---

# BDD Setup (リポジトリに bdd-kit を導入する)

> 内部ムーブメント — 通常は `/bdd-kit`（オーケストレータ）が駆動する。単体起動も可。

対象リポジトリのフレームワーク (Flutter / Playwright web) を自動検出し、
`bdd-kit init` でテンプレートを scaffold したうえで、
`bdd-kit.config.yaml` をリポジトリの実態に合わせて調整する。

## 重要な前提: bdd-kit はバックエンド実装言語に依存しない

bdd-kit の E2E テストは **UI 層**（ブラウザ画面 or モバイル画面）を操作対象とする。
バックエンドが PHP/Laravel/Go/Python/Ruby/Java/何であっても**関係ない**:

- **ブラウザで操作できる Web アプリ** → playwright adapter（`baseUrl` に対してブラウザを開く）
- **Flutter モバイル/デスクトップアプリ** → flutter adapter

したがって:
- 「PHP リポだから対応していない」「Laravel だから特別な adapter が必要」等の懸念は**不要**。
- adapter の選択は「**ユーザーが何で操作するか**」（ブラウザ or Flutter アプリ）で決まる。
  サーバ側の言語・フレームワークは判断材料にならない。
- Web アプリであれば `package.json` が無くても（あるいは `composer.json` しか無くても）
  **playwright adapter で正しい**。検出が候補なし/low の場合でも、ユーザーに「これは
  ブラウザで操作する Web アプリですか？」と確認すれば adapter を決定できる。

## 0. 前提チェック

1. リポルートに `bdd-kit.config.yaml` が**既に存在する場合**:
   - 「bdd-kit は導入済みです」と伝え、設定の検証モードに切り替える。
   - `npx -y -p @pound79/bdd-traceability bdd-traceability-check --json` で drift 確認を提案。
   - `/bdd-kit`（オーケストレータ）または `bdd-traceability-check`（drift 検知 CLI）を案内して終了。
   - **既存 config を上書きしない**（ユーザーが明示的に「再初期化してほしい」と言わない限り）。
2. `npx` が利用可能か確認（`which npx`）。利用不可なら Node.js のインストールを案内して STOP。

## 1. フレームワーク検出

```bash
npx -y @pound79/bdd-kit detect --json
```

> **detect が失敗したら原因別に対処（必須・推測着手しない）**:
>
> - **`ENOVERSIONS`（No versions available）** — registry ではなく **`min-release-age` cooldown** を
>   まず疑う。「公開後 N 日未満のバージョンは入れない」サプライチェーン設定（`~/.npmrc` / repo `.npmrc`
>   の `min-release-age=`）が効くと、cooldown 窓より新しいバージョンしか無いパッケージは全除外され
>   ENOVERSIONS になる。確認: `npm config ls -l | grep -E '^(min-release-age|before) ='`（npm の版で
>   出る側が違う: 新しめは `min-release-age=<日数>`、古い版は派生した `before=<日付>`。どちらかが
>   cooldown を示せば原因）。回避: (a) cooldown が明けるのを待つ /
>   (b) `npx -y --min-release-age=0 @pound79/bdd-kit detect --json`（**npm option は package 名より前**。
>   後ろだと bdd-kit に渡って `Unknown command`）/ (c) `.npmrc` の `min-release-age` を一時コメントアウト。
>   ※ `min-release-age` は `envExport:false` で **env では設定不可**。
>
> - **`E404` / 真の private・scoped registry** — public registry を `env` プレフィックスで明示して再実行。
>   `@`/`:` を含む変数名はインライン代入（`VAR=val cmd`）で構文エラーになるため **`env` 経由が必須**。
>   env 形式は project `.npmrc` より優先（`npx ... --registry=` は CLI 引数に食われ効かない）:
>
>   ```bash
>   env 'npm_config_registry=https://registry.npmjs.org/' \
>       'npm_config_@pound79:registry=https://registry.npmjs.org/' \
>       npx -y @pound79/bdd-kit detect --json
>   ```
>
> detect が成功するまで adapter を推測で決めない（検出を飛ばすと「PHP だから非対応」等の誤判定に直結する）。

出力 JSON の `candidates` 配列を読む:
- **単一 high confidence** → Step 2 で要約を提示し、確認してから進む。
- **単一 medium confidence** → 候補を提示し、「これはブラウザで操作する Web アプリですか？」
  と確認する。ユーザーが yes なら Step 2 に進み、no なら adapter/dir の選択を求める。
- **複数候補 / low confidence / 候補なし** → 候補一覧を提示し、**必ずユーザーに選択を求める**。
  推測で着手しない。

### 検出の補足情報をリポから読み取る

検出結果の精度を上げるため、以下を追加で確認する（ファイルが無ければスキップ）:

- `README.md` / `package.json` description — プロジェクトの概要（Web アプリか CLI か）
- `.env.example` — 環境変数名（ベースURL、認証情報のキー名）
- `src/` や `app/` のディレクトリ構成 — フレームワーク規約の手がかり
- 既存テストディレクトリ（`tests/`, `__tests__/`, `test/`, `integration_test/`）

## 2. ユーザー確認

検出結果の要約を提示する:

```
検出結果:
  adapter:    playwright (high confidence)
  dir:        packages/e2e
  signals:    dep: @playwright/test
  monorepo:   true

この構成で bdd-kit を導入しますか？
```

ユーザーの承認を得てから次へ進む。adapter や dir を変えたいと言われたらその値を使う。

## 3. Scaffold 実行

```bash
npx -y @pound79/bdd-kit init --adapter {{adapter}} --dir {{dir}}
```

出力を確認し、scaffold されたファイル一覧をユーザーに報告する。
既存ファイルが skip された場合はその旨を伝え、`--force` の使用について案内する。

## 4. bdd-kit.config.yaml の調整（このスキルの付加価値）

生成された `bdd-kit.config.yaml` をリポの実態に合わせて編集する。
各変更に理由を1行添えて報告する。

調整対象（該当するもののみ）:

- **`baseUrl`** — `package.json` の `scripts.dev` / `scripts.start` からポートを推定
  （vite→5173, next→3000, 明示 `--port XXXX` があればそれ）。
  推定できなければ TODO コメントを残す。
- **`language`** — リポの主言語を推定（README が日本語、i18n ファイルに `ja` がある → `ja`）。
  不明なら `en` のまま。
- **`layout.*`** — 実際のディレクトリ構成に合わせる:
  - `pagesDir`: 既存の Page Object / Widget のディレクトリがあればそのパス
  - `implGlobs`: 実装ファイルの glob パターン
  - `textConstants`: i18n / 定数ファイルのパス
- **`projects`** — `.env.example` に admin 系の変数があれば `authed-admin` プロジェクトを有効化。
  なければ `authed` + `guest` のみ。
- **`env`** — `.env.example` のキー名を `env.baseUrl` / `env.username` / `env.password` 等に反映。
- **flutter 固有** — `flutter.device` を開発環境に合わせる（macOS / Linux / Chrome）。

- **`environments`（環境プロファイル）** — `.env.example` に環境サフィックス付きキー
  （例: `*_LOCAL_*`, `*_DEV_*`）や認証プロバイダのヒント（`MOCK_AUTH`, `GOOGLE_AUTH`,
  `AUTH_PROVIDER` 等）がある場合、`environments` ブロックをコメントアウト状態で提案する:
  - `local`（`auth.provider: mock`）/ `dev`（`auth.provider: google`）の 2 エントリを雛形に
  - `dotenvFile` を `.env.local` / `.env.dev` に設定
  - 認証プロバイダに依存するシナリオ用の `excludeTags`（例: `@google-auth`）を提案
  - 確信がない場合は TODO コメントを残し、ユーザーに判断を委ねる
  - `.env.example` に環境ヒントがない場合は、テンプレートのデフォルト `local` エントリのみを残す
    （`environments` は必須フィールドなので最低 1 エントリは必要）

**調整しないもの**:
- `tags`, `commands`, `fixtures` — テンプレートのデフォルトで十分。
- Gherkin 生成スタイル — `idiomGuide` で制御（テンプレート既定の system.md）。

## 5. 次の手順の案内（実行はしない）

重い副作用コマンドは**実行せず案内のみ**（人間ゲート尊重）:

### Playwright の場合
```
次の手順:
1. cd {{dir}} && npm install && npm run install:browsers
2. cp .env.example .env して認証情報を記入
3. npm run test:smoke で動作確認
```

### Flutter の場合
```
次の手順:
1. cd {{dir}} && flutter create --platforms=macos --project-name {{project-name}} .
2. flutter pub get && dart run build_runner build --delete-conflicting-outputs
3. flutter test integration_test/gherkin_suite_test.dart -d macos
```

## 6. ワークフロー接続

- 既存の実装ファイルがあるドメイン → `/bdd-bootstrap` を案内
- 新規機能の仕様から始める場合 → `/bdd-new-feature` を案内
- スキルが未導入の場合 → エージェントに応じたインストールを案内:
  - **Claude Code**: `/plugin marketplace add Pound79/bdd-kit` → `/plugin install bdd-kit@bdd-kit`
  - **Codex / その他**: `npx @pound79/bdd-kit setup-agent codex` で `.agents/skills/` にスキルを配置
  - **手動**: `plugins/bdd-kit/skills/` 以下の SKILL.md をエージェントのスキルディレクトリにコピー

## Safety rules

- 既存の `bdd-kit.config.yaml` を無断で上書きしない。
- 検出が曖昧なら必ずユーザーに確認する（推測着手しない）。
- `npm install`, `flutter create`, テスト実行等の重い副作用コマンドは自動実行しない。
- 検出が候補なしなら未対応として正直に報告する。
- config 調整は保守的に: 確信がない値には TODO コメントを残し、ユーザーに判断を委ねる。
