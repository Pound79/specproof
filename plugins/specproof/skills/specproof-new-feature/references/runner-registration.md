# feature の登録と実行対象の確認

feature を作成・移動したら、生成対象と実行対象への登録を確認する。manifest の登録だけでは
E2E は実行されない。既存 feature の本文・状態タグや、project のタグ・環境条件は書き換えない。

## Playwright

1. `{{config:projects}}` と `{{config:layout.testRunnerConfig}}` を読み、対象の認証ロールを
   確認する。各 `projects[].features` は E2E パッケージ相対のパス／glob なので、対象 feature が
   意図した project に含まれるか照合する。feature 内のシナリオごとにタグを見て、実行させる
   すべての project を決める。`{{config:tags.admin}}` とタグ無しのシナリオが混在するなら、
   管理者 project と一般の認証 project の両方に登録する。
2. 新規 feature が未登録なら、意図した project の `features` にそのファイルのパスだけを
   追記する。既存の明示列挙を全件 glob へ変えず、認証専用 guest の範囲を広げない。
   `conditional`、`tags`、アクティブ環境の `excludeTags`、smoke の `{{config:tags.slow}}` 除外も確認する。
   認証ロールや実行環境が不明なら、候補 project と変更案を示して停止する。
3. `{{config:commands.generate}}` を実行し、E2E パッケージ内で、導入済み Playwright の
   `npx playwright test --list --project <project-name>` を登録した project ごとに実行する。
   対象 feature のシナリオが、状態タグで実行しないもの（`@draft` / `@human` / `@out-of-scope`）を
   除いて、いずれかの意図した project の一覧に現れることを確認する。生成コマンドの終了コードだけで済ませない。
4. 対象が 0 件なら完了と扱わず、登録漏れ・未成立の `conditional`・タグによる除外を報告する。
   意図した除外は未実行と記載し、条件を緩めて実行させない。`specproof-implement` は実行対象を
   確認してから RED を観測する。未実行を GREEN や「実装不要」と報告しない。

既存 feature の登録漏れを implement の着手前に見つけた場合は、上の範囲を守る設定変更案を
提示する。実装の編集範囲を越える変更は適用せず、設定を整えてから再開する。

## Flutter

`{{config:layout.testRunnerConfig}}` の `@GherkinTestSuite.featurePaths` が対象 feature を含むか、
`FlutterTestConfiguration.stepDefinitions` が必要な step を登録しているか確認する。
`projects` / `environments` は宣言であり、Dart runner へ自動注入されない。
生成後は設定済みコマンドで対象の実行を確認する。SDK・実行先がなく検証できない場合や、
状態タグ／実行タグ式で除外される場合は未実行と記載し、GREEN と報告しない。
