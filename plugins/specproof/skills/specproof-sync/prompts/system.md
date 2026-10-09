# Gherkin 生成ガイド

feature ファイルを生成・更新するときは、このガイドに厳密に従うこと。
既存の `{{config:layout.featuresDir}}/*.feature` ファイルが文体・粒度の正であり、
迷ったら既存ファイルの書き方に合わせる。

---

## 0. 設定の解決（最初に必ず実行）

このガイドを使う前に、リポルートの `specproof.config.yaml` を読み、以下の手順で設定を解決すること。

1. リポルートに `specproof.config.yaml` が存在するか確認する。
   存在しない場合は **停止** し、ユーザーに次を伝える:
   > `specproof init --adapter <framework>` を実行して設定ファイルを作成してください。

2. ファイルが存在する場合、以下の適用する adapter・手順に必要な `{{config:...}}` トークンをファイル内の対応フィールドの値に解決してからガイドの残りを適用する。
   - `{{config:commands.traceabilityCheck}}` / `{{config:commands.traceabilityUpdate}}` など
     traceability CLI コマンドの実値もここで確定する。
   - マニフェストパス (`{{config:layout.manifest}}`), コマンド (`{{config:commands.*}}`),
     タグ (`{{config:tags.*}}`), レイアウト (`{{config:layout.*}}`), プロジェクト (`{{config:projects}}`) は
     すべてこの config ファイルから来る。

3. `{{config:language}}` の値を確認し、Cucumber i18n テーブルから対応する Gherkin キーワード集合
   （`機能:` / `背景:` / `シナリオ:` / `前提` / `もし` / `ならば` / `かつ` 相当の各ロケール語形）を導出する。
   キーワードは config に個別列挙されていないため、必ずロケール値から導出すること。

---

## ファイル形式

- 先頭は必ず `# language: {{config:language}}`
- キーワードは `{{config:language}}` ロケールの Gherkin キーワードを使う（上記 section 0 で導出したもの）
- `機能:` 相当キーワードの直下に、その機能の目的と前提条件を2〜4行の散文で書く
  (例: 「このアプリは {{config:auth.provider}} 認証で保護されている。…」)
- 決定的でない事情(データ依存・権限依存)がある場合は `#` コメントで理由を書く

---

## シナリオの書き方

- シナリオ名は観察可能な振る舞いの宣言文
  (良: 「正しい資格情報でログインできる」 / 悪: 「ログインをテストする」)
- step はユーザー視点の操作・観察のみ。内部実装（API 名・セレクタ・内部データストア）を
  step 文に書かない
  （例: {{config:examples.domainName}} ドメインにおける `{{config:examples.internalConstants}}` の類は
  ユーザーには不可視のため step 文に出さず rationale doc へ回す）
- 1シナリオは3〜7 step 程度。長くなるなら分割する
- 共通の前提は「背景:」相当ブロックにまとめる

---

## ドラフトの点検（提案だけ・人が採否を決める）

bootstrap・new-feature・sync は、`{{config:layout.idiomGuide}}` を設定していても、この節だけは
このファイルから読む（idiomGuide が決めるのは文体と言い回しで、この点検ではない）。

bootstrap と new-feature は、ドラフトを書き終えたら、各シナリオに下の表の 3 項目（否定だけの確認・値の無い確認・
統制できない前提）を当てる。該当したものは報告の「決めてほしいこと」に、
`シナリオ名 / 項目 / 提案する行 / 理由` の 1 行で並べる。sync は既存 feature を直すときに
4 項目目（確認を減らす変更）を当て、該当したら Step 3 の規則に従って停止する。
**点検の結果でドラフトを書き換えない。** 表の「提案すること」は人に示す案で、採るかどうかは
人が決める（AI は提示し、人間が裁定する）。キーワードは `{{config:language}}` の
「ならば」「かつ」（Then / And）に読み替える。

| 項目 | 当てはまるシナリオ | 提案すること |
|---|---|---|
| 否定だけの確認 | 確認（ならば・かつ）が「表示されない」「遷移しない」など否定だけ | エラー画面・白画面・読み込み中でも通ってしまう。正しく起きたことを肯定で確かめる行（拒否のメッセージ・遷移先・状態の表示）を足す案を示す。否定の行は消さずに残す |
| 値の無い確認 | 「件数が表示される」「反映される」など、何が出れば正しいかが書かれていない | 前提でデータを固定し、期待値を具体的な値で書く案を示す。値は spec から導き、spec に値が無ければ**値を推測しない**。spec への加筆を「やってほしいこと」に回す（spec が無いリポでは、この項目は spec の作成依頼になる） |
| 統制できない前提 | 外部システムの状態、複数の人が使う環境の共有データ、実時間など、テストが前提を決定的に用意できない | 自動化しても結果が安定しない。特定の環境でなら再現できるなら環境タグを提案する。どこでも再現できないなら `@human`（人が確かめて記録を残す）を提案し、自動化に要る seam（決定的な時計・外部システムの代役など）を testability backlog として書く |
| 確認を減らす変更 | 既存 feature を直すときに、確認を減らす（ならば・かつの行を削る、否定だけにする、具体的な値を外す、より緩い step に置き換える、既存シナリオの状態タグを付け替えて実行から外す: `@human` / `@draft` / `@out-of-scope` に変える、`@red-contract` を外す） | 回帰を見逃す原因になる。変更の前後と根拠の spec 節を並べて人に示す。`specproof-sync` では spec の明示が無い限り行わず停止する |

---

## タグ規約

| タグ                         | 意味                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `{{config:tags.slow}}`       | 実 AI 生成を呼ぶ等、時間がかかる。smoke では除外される                            |
| `{{config:tags.generate}}`   | ドメイン固有の重い生成処理を実際に実行する（常に `{{config:tags.slow}}` と併用）  |
| `{{config:tags.admin}}`      | 管理者ユーザー（`{{config:projects}}` の admin プロジェクト）で実行               |
| `{{config:tags.user}}`       | 一般ユーザーで実行（admin との対比シナリオに付与）                                |
| `@draft`                     | 作るか未定の草案。E2E では実行しない。完了判定に数えない                          |
| `@red-contract`              | 実装待ち。`@human` が付いていなければ E2E で実行し、落ちるのを観測し続ける。`@human` と併記した場合は実装待ちのまま人が確かめ、E2E では実行しない。残っている間は完了にならない |
| `@human`                     | 人が確かめて記録する。E2E では実行しない                                          |
| `@out-of-scope`              | 受け入れ条件に含めない。E2E では実行しない。直前に理由の1行コメント（`# ...`）必須 |

状態タグ（`@draft` / `@red-contract` / `@human` / `@out-of-scope`）は固定で、設定では変えない。
壊れた・不安定なシナリオを一時的に止めるタグは無い。runner がシナリオを止めたり失敗を想定扱いにしたりするタグ
（`@skip` / `@fixme` / playwright-bdd の `@fail`）は使えない（付いていると `specproof-check` が `disallowed-tag` を出す）。特定の環境だけで
動くシナリオは環境タグと `environments[].excludeTags`（単一のタグだけ。状態タグは書けない）で表す。
`@red-contract` はテンプレートの絞り込みでは除外しないが、`projects[].tags`・`--grep` などの絞り込みには従う。
コマンドラインの `--grep-invert @red-contract` は使わない（テンプレートでは止められない）。
`@out-of-scope` は Feature・Rule・Examples ではなくシナリオ自身に付け、`@red-contract` と併用しない。
既存シナリオの状態タグは人の確認なしに付け外し・付け替えをしない（変更案として提示する）。

---

## step 実装との対応

- step 文は `{{config:layout.stepsDir}}/*{{config:layout.stepFileSuffix}}` の
  Given/When/Then 定義と完全一致が必要。
  新しい step を作る前に、既存 step で表現できないか必ず確認する
- step 実装は page object fixture（`{{config:fixtures}}` で定義されたもの）を経由する。
  直接 `page.locator` を steps に書かない
- UI 文字列のアサーションは `{{config:layout.textConstants}}` の定数を使う。
  新しい文字列が必要なら `{{config:layout.i18nSource}}` の該当キーを確認して
  `{{config:layout.textConstants}}` に追加する

---

## コード規約 (steps / page objects)

- `{{config:layout.stepFileExt}}` ファイルに `{{config:language}}` テキストを書かない
  （コメントも英語。`{{config:conventions.i18nLintPlugin}}` が検査）
- 肯定形 web-first assertion (`toHaveURL` / `toBeVisible`) を使うときは、
  非同期遷移の判定タイミングを `waitForURL` / `waitForLoadState` 等で明示する
  （操作直後の即時 green による silent pass を防ぐ）
- mutation を避け、page object メソッドは小さく保つ

## 設定解決の境界

適用する adapter と手順が参照する設定だけを解決する。未設定の必須値・存在しない参照先は
キー名と必要な編集を示して停止し、consumer 固有値を推測しない。

`agents` は未設定時のインライン自己レビューという明示済み fallback を使用できる。
`conventions.i18nLintPlugin: none` は専用 plugin がないという明示値であり、検査成功を意味しない。
`examples` は説明用の例であり、実際の仕様・既存ファイルの存在を保証しない。
Flutter の `projects` / `env` / `environments` は skill 用の宣言で、Dart runner へ自動注入されない。
