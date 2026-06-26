# bdd-kit

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
featuresDir に移した feature。bdd-implement が緑化を目指す、実装から独立した RED 基準。
_Avoid_: 確定 feature, 本番 feature

**Draft marker（`# bdd-kit: draft`）**:
bootstrap がドラフトに埋める Gherkin コメント行。featuresDir に残存＝未査読ドラフトの昇格を意味する。
人間が査読・刻印して移す際に削除する（＝レビュー完了の明示）。`traceability-check --strict` が
`unreviewed-draft` として失敗させ、bdd-implement は着手を拒否する（同語反復ファイアウォール）。
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

bdd-kit が対応すべき 2 つのユースケース。入口 skill と「完了」の意味が異なる。

**Brownfield 導入（catch-up）**:
既に稼働中のプロダクトへ後付けで E2E を導入する経路。入口は bootstrap（impl→feature ドラフト）
または spec 骨子抽出。目的は既存の観測可能な振る舞いのカバレッジ。skip 比率の高い状態から始まる。
_Avoid_: 後付け, レトロフィット

**Greenfield 導入（spec-first growth）**:
開発中プロダクトで spec と feature を先に書き、impl を緑化して育てる経路。入口は
new-feature（spec→feature, RED-first）。完了は done 定義に従う。
_Avoid_: 新規, TDD モード

## 完了とタグ

**@fixme**:
「いずれ自動化する意図のある TODO」。未自動化の宿題。**done 時点で 0 でなければならない**。
_Avoid_: skip（@skip と混同しない）

**@skip**:
「意識的に自動化しない」シナリオ。理由＋自動化に必要な seam を記録する。done 時点でも残ってよいが、
**1 件ずつ人間の sign-off が要る**。
_Avoid_: fixme, 保留

**Done（完了定義）**:
すべての観測可能な振る舞いが「green」または「sign-off 済みの @skip」であり、かつ @fixme が 0 の状態。
greenfield の到達可能なゴールライン。
_Avoid_: 全 green, zero-skip

**Testability backlog**:
greenfield において、@skip リストが示す「green に昇格させるために製品へ作るべき test seam」の一覧
（メール捕捉・決定論クロック・失敗注入フック・冪等 teardown 等）。
_Avoid_: skip リスト（意味を限定する）
