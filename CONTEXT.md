# specproof

spec ↔ impl ↔ feature のトレーサビリティ駆動 BDD フローを、framework 非依存の 3 層
（方法論 skill / traceability エンジン / 足場テンプレート）に分離した振る舞いテスト生成キット。

このファイルは**用語集**であり、実装詳細・設計判断は含まない（判断は `docs/` と `docs/adr/`）。

## Language

**Spec（仕様 / spec doc）**:
リポ内 markdown の `##` 見出しセクション。振る舞いの権威的記述で、drift はこの見出し単位の
ハッシュで検知する。Notion 等リポ外にあると drift が動かない。
_Avoid_: ドキュメント, 設計書

**Feature（`.feature`）**:
ユーザーが観測可能な振る舞いだけを Gherkin で記述した、実装非依存の振る舞い仕様。
selector・URL・内部 API を書かない黒箱。
_Avoid_: テスト, テストケース

**Bootstrap ドラフト**:
既存実装を素読して機械生成した、未査読の feature 草案（scratch dir に出力）。「いまコードが
こう動いている」のスナップショットにすぎず、正しさの担保を持たない。権威ではない。
_Avoid_: 生成済み feature, 自動 feature

**Blessed feature**:
人間がドラフトを査読し意図（境界値・エラー経路・ロール分岐・rationale リンク）を刻印して
featuresDir に移した feature。specproof-implement が緑化を目指す、実装から独立した RED 基準。
_Avoid_: 確定 feature, 本番 feature

**Draft marker（`# specproof: draft`）**:
bootstrap がドラフトに埋める Gherkin コメント行。featuresDir に残存＝未査読ドラフトの昇格を意味する。
人間が査読・刻印して移す際に削除する（＝レビュー完了の明示）。`specproof-check --strict` が
`unreviewed-draft` として失敗させ、specproof-implement は着手を拒否する（同語反復ファイアウォール）。
レガシーな `# bdd-kit: draft` マーカーも後方互換のため引き続き検出される。
_Avoid_: TODO コメント

**Drift**:
bless 済みマニフェスト（baseline）に対する spec/impl/feature の SHA-256 ハッシュ差分。
決定論的・AI 不使用・baseline 確定後にのみ検知できる。
_Avoid_: 乖離, ずれ, mismatch（初見の意味的矛盾には使わない）

**Bless**:
spec/impl/feature が整合した状態を確定し、マニフェストのハッシュを実値へ更新する人間の行為。
_Avoid_: 承認

**Rationale doc**:
`.feature` に乗らない非 behavior（設計根拠・内部定数・非機能・UI 非可視の認可ステータス区別）を
人間が記述する文書。AI は自動生成しない。
_Avoid_: 仕様書（spec と紛らわしい）

## 導入モード

specproof が対応すべき 2 つのユースケース。入口 skill と「完了」の意味が異なる。

**Brownfield 導入（catch-up）**:
既に稼働中のプロダクトへ後付けで E2E を導入する経路。入口は bootstrap（impl→feature ドラフト）
または spec 骨子抽出。目的は既存の観測可能な振る舞いのカバレッジ。`@red-contract` / `@human` の比率が高い状態から始まる。
_Avoid_: 後付け, レトロフィット

**Greenfield 導入（spec-first growth）**:
開発中プロダクトで spec と feature を先に書き、impl を緑化して育てる経路。入口は
new-feature（spec→feature, RED-first）。完了は done 定義に従う。
_Avoid_: 新規, TDD モード

## 完了とタグ

状態タグは固定で、設定では変えない。受け入れ条件を扱う外部のツールと同じ語彙で読めるようにするため。

**@draft**:
作るか未定の草案。E2E では実行せず、完了判定に数えない。`# specproof: draft` マーカー（未査読の
bootstrap ドラフトの印）とは別物。
_Avoid_: 保留

**@red-contract**:
実装待ちの条件。`@human` が付いていなければ E2E で実行し、落ちるのを観測し続ける。`@human` と併記した場合は
実装待ちのまま人が確かめ、E2E では実行しない。1 件でも残れば完了しない。緑になったら（`@human` 併記なら人が
確かめたら）人がタグを外す。runner のテンプレートの絞り込みでは除外しないが、プロジェクトの `tags`・`--grep`・
smoke の `--grep-invert @slow` などの絞り込みには従う。コマンドラインの `--grep-invert @red-contract` は使わない。
_Avoid_: fixme, TODO

**@human**:
人が確かめて記録する条件。E2E では実行しない。specproof 単体では件数だけを数え、
確認記録を扱う外部のツールが、人の確認記録で完了にする。
_Avoid_: 手動テスト, skip

**@out-of-scope**:
受け入れ条件に含めない宣言。E2E では実行せず、完了の判定に含めない（件数は別に数える）。直前に「なぜ外すか」の
1 行コメントが必須（無いと `missing-reason`）。シナリオ自身に付ける。Feature・Rule・Examples からの継承は
`missing-reason`、Examples に付けると `specproof-stats` も拒否する。`@red-contract` との併用も `specproof-stats` がエラーにする。
_Avoid_: skip, 除外（環境タグによる除外と紛らわしい）

**退役タグ（@fixme / @skip / @fail）**:
以前の「後で自動化する」「当面自動化しない」の印と、playwright-bdd の「失敗を期待する」修飾（`@fail`）。
どれも落ちる条件を黙らせて完了に見せられる。退役し、残っていれば `specproof-check` が `retired-tag`、`specproof-stats --strict` が失敗を返す。
壊れたテストを一時的に止める代わりのタグは無く、直るまで赤のままにする（ADR 0009）。

**Done（完了定義）**:
受け入れ対象（`@out-of-scope` と `@draft` を除く）のすべての条件が、実行して GREEN か、人の確認記録が
ある `@human` であり、`@red-contract` と退役タグが 0 件の状態。`specproof-stats --strict` が見るのは
静的な半分（`@red-contract` と退役タグが 0 件）だけで、それも CI に組み込んだリポジトリでしか止まらない
（drift-check のワークフローテンプレートは実行しない）。`@human` の確認記録は specproof の外で持つ。
_Avoid_: 全 green, zero-skip

**Testability backlog**:
`@human` の条件を自動化するために製品へ作るべき test seam の一覧
（メール捕捉・決定論クロック・失敗注入フック・冪等 teardown 等）。seam ができた条件は
`@red-contract` に付け替えて自動化する。
_Avoid_: human リスト（意味を限定する）
