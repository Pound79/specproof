---
name: bdd-kit
description: >
  Single entry point to introduce and drive bdd-kit in a repository. Detects the
  framework (Playwright / Flutter) and the working mode (brownfield = add E2E to
  an existing app / greenfield = grow spec + E2E together), scaffolds config, then
  drives the right internal movement (bootstrap / new-feature / implement / sync)
  — stopping at every human gate with a handoff report. Use when the user says
  "bdd-kit を導入して", "introduce / set up bdd-kit", or asks to start or continue
  the BDD flow and is not sure which skill to run.
---

# bdd-kit オーケストレータ（単一の入口）

このスキルは bdd-kit の**唯一の入口**。利用者は方向ラベル（impl→feature 等）を覚える必要はない。
オーケストレータが状況を検出し、内部ムーブメントを順に駆動し、**判断が要る所で停止**して
ハンドオフレポートを出す。方向ラベルの不変条件は methodology が内部で担保する。

> 内部ムーブメント（このスキルが駆動する。単体起動も可）:
> `bdd-setup`（検出・scaffold）/ `bdd-bootstrap`（impl→feature ドラフト）/
> `bdd-new-feature`（spec→feature）/ `bdd-implement`（feature→impl）/ `bdd-sync`（drift→feature）。
> drift の **検知**はスキルではなく決定論 CLI `{{config:commands.traceabilityCheck}}`（AI 不使用）。

## 守る不変条件（割ってはいけない）

- **実装は blessed feature にのみ**。`# bdd-kit: draft` マーカーが残る feature は未査読ドラフト＝
  実装しない（同語反復ファイアウォール）。`{{config:commands.traceabilityCheck}} --strict` と
  `bdd-implement` の着手前検査が機械的に止める。
- **黒箱・観測可能レベルのみ**。矛盾や理屈のおかしさは「ユーザーが観測できる振る舞い」の層でのみ
  指摘し、内部コードの良し悪しは判定しない。
- **AI は提示し、人間が裁定する**。spec↔impl の矛盾や「どちらが正か」は AI が決めず、人間に返す。
- **コードから権威ある spec を自動生成しない**（impl→spec 禁止。spec 不在時は §4）。

## 0. 設定の解決 / 未導入なら scaffold

1. リポルートの `bdd-kit.config.yaml` を探す。
   - **既にある** → 検証モード。`{{config:commands.traceabilityCheck}}` で drift を確認し、
     必要なら §3 / §5 のサイクルへ。
   - **無い** → `bdd-setup` ムーブメントを駆動して導入する: `npx -y @pound79/bdd-kit detect --json`
     で adapter を検出（曖昧なら「ブラウザで操作する Web アプリですか？」と 1 問だけ確認）→
     `npx -y @pound79/bdd-kit init --adapter <adapter> --dir <dir>` で scaffold →
     config をリポの実態に合わせて調整（baseUrl / language / layout / projects / environments）。
     **重い副作用（npm install 等）は実行せず案内のみ**。
     - **detect が落ちても推測着手しない**（出力を見ずに adapter を断定するのは禁止）。エラー別に対処:
       - **`ENOVERSIONS`（No versions available）** → registry 問題ではなく **`min-release-age` cooldown**
         をまず疑う。npm の「公開後 N 日未満のバージョンは入れない」サプライチェーン設定（`~/.npmrc` /
         repo `.npmrc` の `min-release-age=`）が効くと、cooldown 窓より新しいバージョンしか無いパッケージは
         全除外され ENOVERSIONS になる。確認は `npm config ls -l | grep -E '^(min-release-age|before) ='`
         （npm の版で出る側が違う: 新しめは `min-release-age=<日数>`、古い版は派生した `before=<日付>`。
         どちらかが cooldown を示せば原因）。回避は (a) cooldown が明けるのを待つ /
         (b) `npx -y --min-release-age=0 @pound79/bdd-kit detect --json`（**npm option は package 名より前**。
         後ろに置くと bdd-kit に渡り `Unknown command` になる）/ (c) `.npmrc` の `min-release-age` を一時
         コメントアウト。※ `min-release-age` は `envExport:false`＝**env では設定不可**。
       - **`E404` / 真の private・scoped registry** → public registry を `env` プレフィックスで明示して再実行
         （`@`/`:` を含む変数名はインライン代入で弾かれるため `env` 経由が必須。env 形式は project `.npmrc`
         より優先。`npx ... --registry=` は CLI が食う）:
         `env 'npm_config_registry=https://registry.npmjs.org/' 'npm_config_@pound79:registry=https://registry.npmjs.org/' npx -y @pound79/bdd-kit detect --json`

> **前提: adapter はバックエンド実装言語に依存しない。** E2E が操作するのは UI 層（ブラウザ画面 or
> モバイル画面）であり、サーバ側が PHP/Laravel/Go/Python/Ruby/Java/何でも**関係ない**。
> **ブラウザで操作できる Web アプリ → playwright**、**Flutter アプリ → flutter**。detect は
> `composer.json` / `artisan` 等を検知すると `web backend:` シグナルとして **playwright 候補を
> medium に積む**（`cli/src/detect.ts`）＝バックエンドの言語は「未対応」の理由にならない。
> 「PHP/Laravel だから adapter と噛み合わない」と言ってはならない。ブラウザ UI を持たない**純 API**
> を黒箱したい場合のみ playwright の `request` fixture で可能だが**テンプレート既定（ブラウザ POM）の
> 外**でカスタムが要る、と正確に伝える（「不可」ではない）。

## 1. モード検出（brownfield / greenfield）

- **実装が既にある**（`{{config:layout.implGlobs}}` が指すファイルが存在）→ **brownfield**（§3）。
- **実装がほぼ無い／これから書く** → **greenfield**（§4）。
- 判別がつかなければ 1 問だけ確認する:「既存アプリに後付けで E2E を入れますか（brownfield）、
  それとも仕様と一緒にこれから育てますか（greenfield）？」

同時に **in-repo spec の有無**を判定する（`{{config:layout.specDir}}` に `##` 見出しの markdown が
あるか）。無ければ §5 を適用する。

## 2. 可逆/不可逆で止め方を分ける（共通方針）

- **可逆な作業**（scaffold・ドラフト生成・矛盾抽出・リンク stub）は**全ドメイン一括**で進め、
  最後に**ハンドオフレポート 1 枚**（§6）を出す。
- **不可逆な作業**（bless＝featuresDir への移動・`bdd-implement` による実装）は**ドメイン毎の
  明示ゲート**。査読なしに権威を刻ませない。

## 3. brownfield フロー

1. ドメインごとに `bdd-bootstrap` を駆動し、**ドラフトを scratch に一括生成**
   （`# bdd-kit: draft` マーカー入り。featuresDir は上書きしない）。
2. **振る舞い矛盾レンズ**（観測可能レベルのみ）: spec↔impl の食い違い・spec 内部矛盾・
   impl 観測挙動の不条理を抽出する。**AI は裁定しない** — 各々を「どちらの振る舞いで feature を
   書くか／spec が古いか／実装がバグか」の問いとしてレポートに出す。
3. **ハンドオフレポート（§6）を提示して停止**。
4. 人間がドラフトを査読・意図を刻印し（境界値・エラー経路・ロール分岐・rationale リンク、
   **マーカー行を削除**）featuresDir へ移したドメインだけ、`bdd-implement` を**1 つずつゲート**で駆動。

## 4. greenfield フロー

1. `bdd-setup` で scaffold（adapter 低信頼になりがち → 1 問確認）。
2. **env セットアップを能動支援**（dev サーバ起動コマンド検出→baseUrl 配線、`.env.example` 生成、
   認証 setup 雛形）。
3. 人間が挙げた**観測可能な振る舞い 1 本**を、spec 見出し+WHY の骨子 → `bdd-new-feature`(RED) →
   `bdd-implement` → green まで**通して駆動**（ワークエド・サンプル）。
4. env が揃わず green に届かなければ **RED + generate + typecheck まで到達**し、「`.env` を埋めれば
   green」と§6で正直に明示。以降は人間が同ループを回し、完了ダッシュボード（§6）で追う。

## 5. spec が無いリポ（impl→spec は禁止）

- **(b) spec 骨子抽出（既定）**: AI は「見出し＋観測可能トピックの骨子」までを impl から起こし、
  中身の権威（なぜ・正しさ）は人間が確定 → `bdd-new-feature`。`impl→骨子→人間が著した spec`。
- **(a) 2 点運用へ降格**: それも無理なら impl↔feature の 2 点トレーサビリティで正規運用。
  `{{config:commands.traceabilityCheck}}` は spec 側を「未アンカー（spec 側 drift 未ガード）」と
  明示報告する。詳細は ADR 0001。

## 6. ハンドオフレポート（固定フォーマット・必ず出す）

1. **やったこと** — scaffold・作成ドラフト・追加リンク（**provenance 明記**: draft か blessed か）。
2. **到達した検証** — `{{config:commands.generate}}` / `{{config:commands.typecheck}}` /
   `{{config:commands.lint}}` / `{{config:commands.smoke}}` を **PASS / FAIL / SKIPPED(理由)** で。
   **env が無く smoke 未実行なら green と偽らない**。
3. **決めてほしいこと（裁定）** — 振る舞い矛盾の権威側・`@skip` の sign-off・adapter/mode 確認。
4. **やってほしいこと（作業）** — `.env`/認証セットアップ・install・spec の WHY 加筆・`@fixme` の
   自動化・testability backlog（作るべき seam）。
5. **完了ダッシュボード** — `{{config:commands.traceabilityStats}}`（無ければ
   `npx -y -p @pound79/bdd-traceability bdd-traceability-stats`）で green-候補 / `@fixme`(→0) /
   `@skip`(要 sign-off) を集計（green は実行が要る点を明示）。
6. **次の一手** — 次に打つ単一コマンド。

## 7. 継続サイクル（導入後）

- spec / impl が変わった疑い → `{{config:commands.traceabilityCheck}}`（CLI・read-only・決定論）。
- drift あり → `bdd-sync <link-id>`（決定表に従い feature を追従、人間ゲートで bless）。
- 仕様の新セクション → `bdd-new-feature`。RED にした feature → `bdd-implement`。

## Safety rules

- 重い副作用（`npm install` / `flutter create` / テスト実行）は自動実行せず案内する。
- 検出が曖昧なら必ず 1 問確認（推測着手しない）。
- 不可逆作業（bless・implement）はドメイン毎にゲート。`# bdd-kit: draft` 残存 feature は実装しない。
- テストが落ちた状態でコミットしない。`{{config:tags.slow}}` 未実行は明示。
- コミット / bless は人間。製品コードは `{{config:agents.securityReviewer}}` レビュー必須。
