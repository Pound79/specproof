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

2. ファイルが存在する場合、以下のすべての `{{config:...}}` トークンをファイル内の対応フィールドの値に解決してからガイドの残りを適用する。
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

## タグ規約

| タグ                         | 意味                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `{{config:tags.slow}}`       | 実 AI 生成を呼ぶ等、時間がかかる。smoke では除外される                            |
| `{{config:tags.generate}}`   | ドメイン固有の重い生成処理を実際に実行する（常に `{{config:tags.slow}}` と併用）  |
| `{{config:tags.admin}}`      | 管理者ユーザー（`{{config:projects}}` の admin プロジェクト）で実行               |
| `{{config:tags.user}}`       | 一般ユーザーで実行（admin との対比シナリオに付与）                                |
| `{{config:tags.fixme}}`      | 後で自動化する意図あり。シナリオは feature に残す。理由コメント必須               |
| `{{config:tags.skip}}`       | 当面自動化しない。シナリオは feature に残す。rationale リンクをコメントで添える   |

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
