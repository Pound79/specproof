---
name: bdd-new-feature
description: Bootstrap a new BDD feature from a spec document section. Creates a Gherkin .feature file (in the language specified by bdd-kit.config.yaml), stub step definitions, and a new traceability manifest link, then validates with the configured bdd generation tool. Use when a new spec section exists but has no E2E coverage yet. Driven entirely by bdd-kit.config.yaml — no repo-specific values are hardcoded in this skill.
---

# New BDD Feature Scaffold

> 内部ムーブメント — 通常は `/bdd-kit`（オーケストレータ）が駆動する。単体起動も可。

仕様書の1セクションから、新しい E2E feature・stub steps・トレーサビリティリンクを
一式作成する。

## 0. 設定の解決（最初に必ず実行）

リポルートの `bdd-kit.config.yaml` を読み、以下のすべての `{{config:...}}` トークンを
実値へ解決してから後続ステップを実行すること。

```
bdd-kit.config.yaml の読み込み先: <repo-root>/bdd-kit.config.yaml
```

- マニフェストパス → `{{config:layout.manifest}}`
- feature 置き場 → `{{config:layout.featuresDir}}`
- steps 置き場 → `{{config:layout.stepsDir}}`
- step ファイル命名規約 → `{{config:layout.stepFileSuffix}}`
- UI 文字列定数 → `{{config:layout.textConstants}}`
- i18n ソース → `{{config:layout.i18nSource}}`
- 生成コマンド → `{{config:commands.generate}}`
- 型検査コマンド → `{{config:commands.typecheck}}`
- トレーサビリティ更新 → `{{config:commands.traceabilityUpdate}}`
- トレーサビリティ確認 → `{{config:commands.traceabilityCheck}}`
- タグ（slow / generate / admin） → `{{config:tags.slow}}` / `{{config:tags.generate}}` / `{{config:tags.admin}}`
- ランナープロジェクト構成 → `{{config:projects}}`
- 環境プロファイル → `{{config:environments}}`
- Gherkin 言語 → `{{config:language}}`
- BDD フレームワーク → `{{config:bddRunner}}`
- step 生成パターン → `{{config:conventions.stepFrameworkPattern}}`
- 未実装 stub ボディ → `{{config:conventions.pendingStubBody}}`
- フィクスチャ → `{{config:fixtures}}`

`bdd-kit.config.yaml` がリポルートに存在しない場合は**ここで停止し**、
ユーザーに次のコマンドの実行を促すこと:

```bash
bdd-kit init --adapter <framework>
```

---

## Arguments

- 必須: `<spec-doc>` — 例 `{{config:examples.specDoc}}`
- 必須: `<heading>` — 対象の `## ` 見出し
- 省略可: `<feature-name>` — `.feature` のベース名 (省略時は見出しから英語slugを導出)

## Steps

1. `<spec-doc>` の `<heading>` セクションを読み、ユーザーに見える振る舞いを抽出する。
2. このセクションを実装しているファイル (web ページ / lambda 等) を特定する。
   仕様から自明でなければユーザーに確認する
   (Claude Code: AskUserQuestion / Cursor: AskQuestion ツール)。
3. `../bdd-sync/prompts/system.md`（存在する場合）または `{{config:layout.idiomGuide}}`（設定されている場合）の生成ガイドに従い
   `{{config:layout.featuresDir}}/<feature-name>.feature` を作成する:
   - Gherkin 言語 `{{config:language}}` のキーワード（`機能:` / `背景:` / `シナリオ:` / `前提` / `もし` / `ならば` / `かつ` 等）を使う。
     キーワード集合は `{{config:language}}` から Cucumber i18n テーブル経由で導出する。
   - `機能:` ブロックに目的を散文で記述
   - happy path 2〜3 シナリオ + エラー系 1 シナリオを最低限カバー
   - 実 AI 生成を伴うシナリオには `{{config:tags.generate}} {{config:tags.slow}}`、管理者限定には `{{config:tags.admin}}`
   - **環境固有シナリオのタグ付け**: 特定の認証プロバイダや外部サービスに依存するシナリオ
     （例: Google OAuth の同意画面、実メール送信の検証）には、対応する環境でのみ実行される
     専用タグ（例: `@google-auth`, `@requires-real-smtp`）を付ける。
     該当タグが少なくとも 1 つの `{{config:environments}}` エントリの
     `excludeTags` に含まれ**ない**ことを確認する（全環境で除外されるシナリオは dead code）。
     環境タグと対応する `excludeTags` エントリの追加もあわせて提案する。
4. 新しい step 句のうち既存 steps で賄えないものについて stub を作成する:
   - まず `{{config:layout.stepsDir}}/*{{config:layout.stepFileSuffix}}` を読み、同じドメインの既存ファイルに
     追加できるかを判断する。feature 名と steps 名は 1:1 ではなく、steps は
     短いドメイン名を使う
     （例: `{{config:examples.domainName}}.feature` → `{{config:examples.domainName}}.steps{{config:layout.stepFileExt}}`
     のように feature 名をそのまま使わず短縮ドメイン名にする）
   - 新規ファイルが必要な場合も `.feature` 名をそのまま使わず、既存に倣った
     短いドメイン名にする (steps の分割方針とぶつけない)
   - `{{config:bddRunner}}` の `{{config:conventions.stepFrameworkPattern}}` パターン (既存 steps ファイル参照)
   - 未実装 step の本体は `{{config:conventions.pendingStubBody}}`
   - step ファイル中に各言語ネイティブ文字列（日本語等）を書かない。UI 文字列は
     `{{config:layout.textConstants}}` の定数を使う（上流: `{{config:layout.i18nSource}}`）
   - フィクスチャの destructure には `{{config:fixtures}}` の fixture 名を用いる
5. `{{config:layout.manifest}}` に新しいリンクを追加する
   (id / label / spec / impl / features。hash は `PENDING` でよい):

   ```bash
   {{config:commands.traceabilityUpdate}}
   {{config:commands.traceabilityCheck}}   # clean を確認
   ```

   ツールは `PENDING` を特別扱いしないため、仮 hash を入れた直後は意図的に
   drift が出るのが正常。追加後すぐ `{{config:commands.traceabilityUpdate}}` で実ハッシュに更新する。

6. 検証:

   ```bash
   {{config:commands.generate}}
   {{config:commands.typecheck}}
   ```

7. 作成物の一覧と、ユーザーが次に実装すべき pending step を報告する。

## Safety rules

- 既存の feature / steps / page objects を変更しない (新規追加のみ)。
- step 定義ファイルに UI 文字列や言語依存の生文字列を書かない。
  `{{config:layout.textConstants}}` の定数を使うこと（`{{config:layout.i18nSource}}` が上流）。
- `{{config:layout.testRunnerConfig}}` のプロジェクト構成 (`{{config:projects}}`) に
  合わないタグを付けない。
  （例: `{{config:tags.admin}}` タグは admin プロジェクトのみが実行する想定になっている）
- **環境タグの整合性**: 生成するシナリオのタグが `{{config:environments}}` の全エントリの
  `excludeTags` に含まれていないことを確認する（全除外=実行されない dead code）。
