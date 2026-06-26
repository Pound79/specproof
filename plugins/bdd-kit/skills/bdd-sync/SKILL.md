---
name: bdd-sync
description: Sync BDD features with detected spec/implementation drift. For each stale traceability link, reads the changed diff, regenerates the .feature file and step definitions, validates with the configured bdd runner and smoke tests, refreshes manifest hashes, and prepares a branch + commit + PR. Use after bdd-traceability-check reports drift, or when the user asks to sync specs/implementation/tests.
---

# BDD Sync

> 内部ムーブメント — 通常は `/bdd-kit`（オーケストレータ）が駆動する。単体起動も可。

drift が検出されたリンクについて、変更内容を E2E feature・steps・page objects に反映し、
検証してからマニフェストを更新し、PR を準備する。

## 0. 設定の解決（最初に必ず実行）

リポルートにある `bdd-kit.config.yaml` を読み込み、このドキュメント内の
`{{config:...}}` トークンをすべて実値へ解決してから以降のステップを実行すること。

- マニフェストパス、コマンド、タグ、レイアウト、プロジェクト設定はすべてこのファイルから取得する。
- `{{config:commands.traceabilityCheck}}` および traceability CLI が参照するのも同じファイルである。
- `bdd-kit.config.yaml` がリポルートに存在しない場合は**停止**し、ユーザーに
  `bdd-kit init --adapter <framework>` を実行するよう案内する。
- 生成ガイド（prompts/system.md）は、このスキルと同じディレクトリに配置された
  `prompts/system.md` を参照する。ただし `{{config:layout.idiomGuide}}` が設定されている場合は
  そのリポルート相対パスのファイルを優先して使用する。

## Arguments

- 省略可: `<link-id>` — そのリンクのみ同期する。省略時は stale な全リンクが対象。
  stale が 5 link を超える場合は、PR の肥大化を避けるため `<link-id>` 指定で
  ドメイン単位に分割実行することを検討する。

## Steps

### 1. Drift の特定

```bash
{{config:commands.traceabilityCheck}} --json
```

対象リンクの `entries` を取得する。clean なら「同期不要」と報告して終了。

### 2. リンクごとに「正」(authoritative side)を決定

| drift の組み合わせ              | 扱い                                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| impl のみ changed               | 実装が正。**観測可能な振る舞いが変わったか確認**: 変わったら feature を新挙動に合わせ更新し green を確認、変わらないリファクタなら feature 無変更で bless のみ（人著シナリオを上書きしない） |
| spec のみ changed               | 仕様が正。feature を仕様の新内容に合わせて更新                                                                                                              |
| **spec と impl の両方 changed** | **必ず停止。** 両方の diff を提示し、どちらに追従するかユーザーに確認 (Claude Code: AskUserQuestion / Cursor: AskQuestion ツール)。確認が取れるまで進めない |
| feature のみ changed            | 手動編集を bless。再生成せずハッシュ更新(Step 5)のみ                                                                                                        |
| いずれかが missing              | 自動同期しない。マニフェストのリンク定義修正をユーザーに提案                                                                                                |

### 3. Feature / steps の更新

対象リンクごとに:

1. 変更されたファイルの内容を把握する。drift は「ファイル内容の変化」で起きて
   いるので、まず該当パスの**現在内容を読むことを第一優先**とする:
   - 実装/仕様とも `<path>` の現在内容を読む (仕様は該当見出しセクション)
   - 変更の文脈が欲しい場合の補助として `git diff origin/main...HEAD -- <path>`
     または直近の変更コミット。ただし main 上の未コミット変更のみ・ベース
     ブランチが main でない等では diff が空になり得るため、空でも現在内容を正とする
2. 現在の `.feature` ファイルと、それを参照する `{{config:layout.stepsDir}}/*{{config:layout.stepFileSuffix}}` を読む。
3. `prompts/system.md`（`{{config:layout.idiomGuide}}` が設定されている場合はそのパス）の
   生成ガイドに**厳密に**従って `.feature` を更新する。
   Gherkin キーワード（機能:/背景:/シナリオ:/前提/もし/ならば/かつ）は
   `{{config:language}}` ロケールに従う。
4. 新しい step 句が必要な場合:
   - 既存の `{{config:layout.stepsDir}}/*{{config:layout.stepFileSuffix}}` に同じ意味の step がないか先に確認する
   - なければ適切な steps ファイルに追加し、必要なら page object
     (`{{config:layout.pagesDir}}`) にメソッドを追加する
   - page object には新 step が必要とする最小限のメソッドだけを足す
     (`{{config:fixtures}}` に列挙された POM パターンを踏襲)
5. 既存シナリオは、リンクされた仕様/実装が当該機能の削除を明示している場合を除き
   **削除しない**。

### 4. 検証ゲート (必須)

```bash
{{config:commands.generate}}       # Gherkin と step の対応を検証
{{config:commands.typecheck}}      # 型エラー検出
{{config:commands.smoke}}          # {{config:tags.slow}} 以外を実行 ({{config:env.baseUrl}} 等の env が必要)
```

- 失敗したら原因を診断して修正する。**自己修正は2回まで。**
  2回修正しても通らない場合は強行せず、停止して失敗内容をユーザーに報告する。
- `{{config:commands.smoke}}` の実行環境 ({{config:env.baseUrl}} / {{config:env.username}} 等) が無い場合は
  `{{config:commands.generate}}` + `{{config:commands.typecheck}}` まで通し、smoke が未実行であることを明示して報告する。
- **環境プロファイル**: アクティブ環境（`{{config:environments}}` から `BDD_KIT_ENV` または
  `default: true` で解決）の `excludeTags` に含まれるシナリオは smoke の対象外である。
  レポートで smoke 未実行シナリオを列挙する際、環境による除外と env 未設定による
  未実行を区別して明示する。

### 5. マニフェスト更新とPR

```bash
{{config:commands.traceabilityUpdate}}
{{config:commands.traceabilityCheck}}   # clean になることを確認
```

1. ブランチ作成: `{{config:git.branchPrefix}}<YYYY-MM-DD>` (main から。既に作業ブランチ上ならそのまま)
2. conventional commit: `feat({{config:git.commitScope}}): sync BDD features with spec/impl drift (<link-ids>)`
3. push して `gh pr create`。PR本文には以下を含める:
   - どのリンクがどちら側の変更に追従したか
   - 検証ゲートの実行結果 (smoke 未実行ならその旨)

## Safety rules

- `{{config:layout.stepFileExt}}` ファイルに日本語文字列を書かない
  (`{{config:conventions.agentsDoc}}` / `{{config:conventions.i18nLintPlugin}}`)。
  UI文字列のアサーションは `{{config:layout.textConstants}}` の定数を使うか、
  必要な定数を `{{config:layout.textConstants}}` に追加する
  (`{{config:layout.textConstants}}` は `{{config:layout.i18nSource}}` のミラー)。
- steps / page objects のコメントは英語。
- テストが落ちた状態でコミットしない。
- 両側変更時の自動解決は禁止 (必ずユーザー確認)。
