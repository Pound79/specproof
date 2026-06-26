# bdd-kit — 方法論リファレンス

> **適用範囲**: フレームワーク非依存・リポジトリ非依存の BDD 振る舞いテスト生成方法論。
> フレームワーク固有の値（コマンド・パス・タグ名など）はすべて `bdd-kit.config.yaml` で解決される
> `{{placeholder}}` 表記で参照する。

---

## 目次

1. [5 ロール・スキルモデル](#1-5-ロールスキルモデル)
2. [方向の非対称性不変条件](#2-方向の非対称性不変条件)
3. [3 バケット分類](#3-3-バケット分類)
4. [ドリフト解決決定表](#4-ドリフト解決決定表)
5. [アンチ・ゲーミング 4 層ガード](#5-アンチゲーミング-4-層ガード)
6. [feature-first 原則とヒューマン・レビューゲート不変条件](#6-feature-first-原則とヒューマンレビューゲート不変条件)
7. [トレーサビリティ・マニフェスト — 全体をつなぐ結合組織](#7-トレーサビリティマニフェスト--全体をつなぐ結合組織)

---

## 1. ロール・スキルモデル

bdd-kit の入口は単一の `/bdd-kit` オーケストレータで、状況を検出して**方向ラベル付きの内部
ムーブメント**（`bdd-bootstrap` / `bdd-new-feature` / `bdd-sync` / `bdd-implement`）を駆動する。
各ムーブメントは**方向ラベル**を持ち、その方向が責務と権限の境界を決定する。drift の**検知**は
スキルではなく決定論 CLI（`bdd-traceability-check`・AI 不使用）が担う。

| スキル | 方向ラベル | 一言説明 |
|---|---|---|
| `bdd-bootstrap` | **impl → feature** | 既存実装を起点に feature ドラフトを一度だけ作成する。E2E カバレッジがほぼ無いドメインの底上げ専用。 |
| `bdd-new-feature` | **spec → feature** | 仕様書の新規セクションを起点に、feature・stub step・トレーサビリティリンクを一式作成する。 |
| `bdd-sync` | **spec/impl diff → feature** | drift 検知後の同期。変更されたスペック／実装の diff を feature に反映する。 |
| `bdd-traceability-check`（CLI・スキルではない） | **read-only 検知** | マニフェストのハッシュと現ファイルを比較して drift を報告する決定論 CLI（AI 不使用・ファイル非変更）。利用者は `/bdd-kit` オーケストレータか CLI を直接使う。 |
| `bdd-implement` | **feature → impl** | 人が先に書いた RED 状態の feature を起点に、step 本体・画面操作抽象層・製品 impl を実装する。 |

### 各スキルの使い分け

```
新規機能のスペックができた
  └→ bdd-new-feature（spec → feature）

既存機能に feature がほとんど無い
  └→ bdd-bootstrap（impl → feature）※一度きり

feature が RED になった / pending step がある
  └→ bdd-implement（feature → impl）

spec または impl が変わった疑いがある
  └→ bdd-traceability-check（read-only CLI）
       └ drift あり → bdd-sync（spec/impl diff → feature）
```

### なぜ方向ラベルを付けるか

方向ラベルは「どちらが権威（authoritative side）か」を明示するための設計上の契約である。
権威の向きを常に意識することで、スキルをまたいだ誤用（例: 実装変更のたびに feature を
再生成する）を防ぐ。

---

## 2. 方向の非対称性不変条件

BDD 方法論の最も重要な不変条件は次の一文に集約される。

> **`impl → feature` 再生成は同語反復であり、継続的に行うことを禁止する。**
> **`feature → impl` 実装は TDD として正当であり、bdd-implement が担う唯一の方向である。**

### `impl → feature`（継続再生成禁止）の理由

#### 同語反復によるテスト独立性の喪失

実装コードから feature を再生成した瞬間、その feature は「いま動いているコード」を写し取った
コピーになる。バグが混入しても feature はコードに追従して書き直され、赤になるべき瞬間に
緑のままになる。テストが「コードが仕様を満たすことの独立した証明」である目的が根本から
消滅する。

#### テスト範囲の重力的収縮

実装の素読で機械的に生成できるのは平均的ハッピーパスだけである。人間が意図して設計した
境界値・エラー経路・ロール分岐・`@fixme`/`@skip` シナリオ・rationale へのリンクは、
再生成のたびに「実装の平均像」に向かって静かに引き寄せられ消える。
CI は green のままなのでカバレッジ縮小に気づけない。

#### 権威の向き

正しい依存方向は **feature → impl**（仕様が実装を駆動する）。`impl → feature` は
初回の bootstrap にのみ例外的に許可される一方通行であり、継続運用では禁止する。

### `feature → impl`（TDD として正当）の理由

人が先に書いた feature は実装から独立した基準である。その基準を満たすように実装を書き、
テストが green になることで「コードが独立基準を満たした」ことが証明される。
これは TDD の本質と同じであり、AI による支援は実装の加速であって基準の歪曲ではない。

### bootstrap の例外と終点

`bdd-bootstrap` は `impl → feature` 方向で動作するが、**一度きりの初期化**という制約が付く。
bootstrap 後の変更はすべて feature-first（人間が `.feature` を先に編集 → 赤 → 実装 → 緑）で行う。
実装変更を feature に追随させる必要がある場合は「drift 検知 → `bdd-sync` による差分反映」であり、
再生成ではない。

---

## 3. 3 バケット分類

仕様として存在するすべての振る舞いを、自動化の難易度ではなく
**「ユーザーが観測可能か」という唯一の軸**で分類する。

### 判断の核心

> 観測可能 → 難しくても `.feature` に置く（自動化が難しければ skip タグ可）
> 観測不能 → rationale doc へ回す
> **「テストが難しい ≠ 観測不能」の落とし穴に注意すること**

### バケット A — 自動化する

決定的に再現でき、すぐ自動化できる振る舞い。
タグなし（smoke 実行対象）または `{{tag_slow}}`（実バックエンド呼び出しなど、smoke 除外）を付ける。

### バケット B — `.feature` に書くが skip する

観測可能な振る舞いだが、以下のいずれかに該当するもの:

- 決定的なテストデータを用意できない
- 失敗注入の seam がない（外部依存の強制失敗など）
- 環境依存で CI で再現できない
- 現時点でテストする価値が低い

このケースでは **シナリオを feature から消さず**、`@fixme`（後で自動化する意図あり）または
`@skip`（当面自動化しない）を付け、**必ず「なぜ skip か」を 1 行コメントで添える**。

**バケット B の下位種別 — 環境条件付き（B-env）**: 観測可能かつ自動化可能だが**特定の実行環境
でのみ**再現できる振る舞い（実 Google OAuth 同意画面・実メール送信など）は、`@fixme`/`@skip` では
なく**環境タグ**（例 `@google-auth`）を付ける。`bdd-kit.config.yaml` の `environments[]` の
`excludeTags` により対象外環境では自動 skip され、対応環境では実行される（`@fixme` と違い「永久に
未自動化」ではない）。これは 3 軸（environments × projects × tags）の直交性で表現する。

`{{bdd_runner}}` が `test.fixme()`/`test.skip()` 相当に変換することで、レポートには
「タイトル付き skip として現れる」= 未自動化の仕様が一覧で見え続ける。
skip シナリオも step 句の**定義は必須**（`{{cmd_bddgen}}` は未定義 step を生成エラーにする）。
body は実行されないので stub で足りる。

### バケット C — rationale doc へ回す

Gherkin の Given/When/Then に**乗らない非 behavior のみ**:

- API ステータスコード契約（HTTP 400/401/403 の内部的区別）
- 内部ロジック・フォーマッタの定数・スコア重み・ビジネスルール
- 非機能要件（性能・SLA・スループット）
- UI 非可視の認可ステータスコード区別
- 内部データストアの状態・監査ログの書き込み
- LLM 出力の言語品質など

### なぜ「観測可能か」を唯一の軸とするか

「テストが難しい」という理由で観測可能な振る舞いを rationale に逃がすと、仕様としての
記録場所が分散し、後から「この振る舞いはどこに書いてあるか」が追えなくなる。
難しくても `.feature` に置いて skip することで、仕様の網羅性を feature ファイルで一元管理できる。

### rationale doc は自動生成しない

`.feature` に書けない仕様（設計根拠・非機能・横断認可）は人間が書く rationale doc に置く。
この方法論では rationale doc を自動生成しない。理由:

- 実装からの自動抽出は行番号の写しか根拠の捏造になる
- 捨てたいはずの「仕様書の腐敗（仕様と実装のずれが自動追従で隠れる状態）」を再生産する
- AI が許されるのは「topic の骨子出し」までであり、各項目の「なぜ」は人間が確定する

---

## 4. ドリフト解決決定表

drift 検知（`bdd-traceability-check`）の後、`bdd-sync` は次の決定表に従って処理する。

| drift の組み合わせ | 扱い | 理由 |
|---|---|---|
| impl のみ changed | 実装が正。**観測可能な振る舞いが変わったら** feature の文言・シナリオを更新して green を確認。**変わらないリファクタなら** feature 無変更で bless（ハッシュ更新）のみ | 実装が仕様の最新の表明。リファクタで人著シナリオを上書きしない |
| spec のみ changed | 仕様が正。feature を仕様の新内容に合わせて更新 | 仕様書が権威 |
| **spec と impl の両方 changed** | **必ず停止。** 両方の diff を提示し、どちらに追従するかユーザーに確認。確認が取れるまで進めない | リファクタ中・仕様変更中・マージ競合のいずれかの可能性が高く、ドメイン判断なしに「正」を決められない。自動追従すると意図しない仕様上書きや実装の巻き戻しが起きる |
| feature のみ changed | 手動編集を bless。再生成せずハッシュ更新のみ | 人間の意図的な feature 編集を尊重する |
| いずれかが missing | 自動同期しない。マニフェストのリンク定義修正をユーザーに提案 | リンク定義がないことはマニフェスト設計自体が不完全であり、ファイルを作成・削除する前に意図を確認すべき |

### 既存シナリオを削除しない原則

`bdd-sync` は feature 更新時に既存シナリオを削除しない。
仕様・実装上で機能が明示的に削除されていない限り、シナリオの消失は
「テストが壊れたから消した」（silent failure）と区別できない。
削除は仕様側の明示的な意図に紐付けて、人間の判断で行う。

### drift 検知の read-only 原則

drift 検知（`bdd-traceability-check` CLI）はファイルを一切変更しない。
SHA-256 ハッシュをマニフェスト YAML に刻み込んで決定論的に drift を検出するだけであり、
AI による「内容の推測」は行わない。次アクションの選択は常にユーザーに委ねる。

---

## 5. アンチ・ゲーミング 4 層ガード

`bdd-implement` が `feature → impl` 方向で実装を行う際、
「テストを通すためだけの偽実装」（ゲーミング）を防ぐために 4 層の防護を設ける。

### ゲーミングとは

feature が正当な仕様の証明であり続けるためには、実装がテスト固有の入力値を
ハードコードしたり、テスト入力だけを特例処理する分岐を入れたりしてはならない。
そのような実装は assertion を通すが、実際の仕様を満たしていない「偽実装」である。

### 層 ① — 禁止ルール明文化 + 実装後自己点検

実装前に次のパターンを明示禁止する:

- テスト固有値のハードコード
- テスト入力だけを特例処理する条件分岐
- assertion を骨抜きにする最小出力（fake implementation）

実装後に self-review チェックリストで点検する。

### 層 ② — 独立 adversarial レビュー

実装後に `{{code_reviewer_agent}}` + `{{security_reviewer_agent}}` を起動し、
さらに feature と diff を渡して「テストを通すための偽実装か」を反証させる
gaming hunter 観点のレビューを必ず実施する。CRITICAL/HIGH の指摘を修正する。

### 層 ③ — spec/rationale 整合チェック

feature は振る舞いの黒箱であり、実装を underspecify する。
補足コンテキスト（WHY・内部定数・スコア重み・ビジネスルール等を含む spec/rationale doc）を
読んでから実装することで、辻褄合わせを防ぐ。

### 層 ④ — 入力バリエーション検証

対象シナリオの入力値を変えても破綻しないことを確認し、特例ハードコードを炙り出す。
黒箱で入力変更が難しい場合は適用範囲を限定し理由を明記する。

### 自己修正 2 回上限

検証ゲート（`{{cmd_bddgen}}` / typecheck / smoke など）が失敗した場合、
自己修正は 2 回まで。2 回修正しても通らない場合は強行せず、停止して失敗内容を報告する。
理由: 修正ループが収束しない場合、AI が間違った方向に固執するリスクがある。
根本原因の診断にはより深いコンテキストが必要であり、ユーザーの判断を仰ぐべき状態を意味する。

---

## 6. feature-first 原則とヒューマン・レビューゲート不変条件

### feature-first 原則

bootstrap 完了後、すべての仕様変更は次の順序で行う:

1. 人間が `.feature` を先に編集する（RED にする）
2. `bdd-implement` で実装を書く
3. テストが green になることを確認する
4. トレーサビリティを bless する

これが BDD の本来のサイクルであり、実装変更 → feature 追従（再生成）という逆向きを禁止する
根拠でもある。

### ヒューマン・レビューゲートが省略不可な場面

以下のすべての場面でヒューマン・レビューゲートは省略不可とする。

#### bootstrap 後のドラフト査読

`bdd-bootstrap` が生成するドラフトはスクラッチパス（`{{scratch_dir}}`）に出し、
既存の `{{e2e_features_dir}}/*.feature` を上書きしない。
ユーザーがドラフトを読み、意図を刻印（編集・取捨選択）してから `{{e2e_features_dir}}/` へ移す。

理由: bootstrap は実装の「平均的ハッピーパス」しか読み取れない。
人間の意図設計（境界値・エラー経路・ロール分岐・rationale リンク）を刻み込む機会を
ゲートとして設ける。

#### bdd-implement のコミット・bless

`bdd-implement` は実装を書くが、コミットおよびトレーサビリティの bless は人間が行う。
製品コードは `{{security_reviewer_agent}}` レビューが必須。

#### 自己修正 2 回超過時

自己修正 2 回を超えて検証ゲートが通らない場合、強行せずに停止してユーザーに報告する。

### テストが落ちた状態でコミットしない

すべてのスキルに共通するルール: **テストが落ちた状態でコミットしない**。
`{{tag_slow}}` シナリオが未実行の場合は「未実行」を明示してからコミットする。

---

## 7. トレーサビリティ・マニフェスト — 全体をつなぐ結合組織

トレーサビリティ・マニフェスト（`{{traceability_manifest}}`）は、
「仕様書の見出し」「実装ファイル」「feature ファイル」という 3 者の関係を
SHA-256 ハッシュと共に記録する YAML ファイルである。

### マニフェストの役割

この 3 者は同一の振る舞いを別々の抽象レベルで表現している。どれか一つが変更されたとき、
他の 2 者が追随しているかを機械的に検証できなければ、E2E テストは「テストが存在するが
仕様とずれている」というサイレントな不整合を生む。

マニフェストに SHA-256 ハッシュを刻み込むことで、**AI を一切介さずに決定論的**に
drift を検出できる。これがこの方法論全体を支える根幹の仕組みである。

### マニフェストのエントリ構造

```yaml
- id: <feature-id>
  label: "<機能の説明>"
  spec:
    - path: <spec-doc-path>
      heading: <見出し>        # 見出し行のテキスト（先頭の "#"+空白 は除く）
      headingLevel: 2          # 任意（既定 2 = "## "）。### を指すなら 3
      hash: <sha256-hash>      # PENDING → bless コマンドで実ハッシュに更新
  impl:
    - path: <impl-file-path>
      hash: <sha256-hash>
  features:
    - path: <feature-file-path>
      hash: <sha256-hash>
```

ハッシュは各 ref（`spec`/`impl`/`features` の各要素）に紐付く。
新規リンク追加直後は各 `hash: PENDING` で構わない。
`{{cmd_traceability_update}}` を実行することで実ハッシュに更新され、
`{{cmd_traceability_check}}` が clean になる。

最初から実ハッシュを手書きするのは不可能（ファイル内容確定前に計算できない）。
PENDING を仮値として使い、ツールで自動計算・上書きすることで、人手によるハッシュ管理ミスをなくす。

### 各スキルとマニフェストの関係

| スキル | マニフェストに対する操作 |
|---|---|
| `bdd-traceability-check`（CLI） | ハッシュを比較して drift を報告（read-only） |
| `bdd-sync` | drift 解決後に `{{cmd_traceability_update}}` → `{{cmd_traceability_check}}` で bless |
| `bdd-new-feature` | 新規エントリを `hash: PENDING` で追加 → bless |
| `bdd-bootstrap` | 既存 feature 拡張の場合は update/check を実行。新規リンクは `bdd-new-feature` 手順に準拠 |
| `bdd-implement` | bless（コミットとともに）は人間が行う |

### マニフェストのスキーマ不変条件

drift 検知 CLI（`bdd-traceability-check`）が返す JSON 出力コントラクトはフレームワーク・言語・プラットフォームを問わず共通である。
チェックスクリプトの実装言語（TypeScript / Dart / Python など）が変わっても、
出力 JSON の形式は次のスキーマに従う。

```jsonc
{
  "clean": boolean,         // true = drift なし
  "driftCount": number,     // drift している ref エントリの数（1 リンクが複数 ref を持てる）
  "driftLinkCount": number, // drift している distinct なリンクの数
  "entries": [
    {
      "linkId": string,
      "side": "spec" | "impl" | "feature",
      "path": string,
      "heading": string,         // spec 側のみ存在（impl/feature エントリでは省略）
      "storedHash": string,      // マニフェストに記録されたハッシュ
      "currentHash": string,     // 現ファイル/セクションのハッシュ（FILE_MISSING/SECTION_MISSING のことも）
      "status": "changed" | "missing"
    }
  ],
  "warnings": [                  // 非 drift の構造警告。既定は表示のみ、--strict で失敗扱い（consumer の drift CI が --strict 運用）
    {
      "linkId": string,
      "kind": "empty-link",      // spec/impl/features が全空のリンク（追跡対象なし）
      "message": string
    }
  ]
}
```

---

## 付録: スキル間の全体フロー

```
  ┌───────────────────────────────────────────────────────┐
  │  仕様書に新セクション       既存機能に feature が無い  │
  │  bdd-new-feature            bdd-bootstrap              │
  │  (spec → feature)           (impl → feature, 一度のみ) │
  └────────────┬───────────────────────┬──────────────────┘
               │                       │
               ▼                       ▼
        feature + stub step + traceability エントリ（PENDING）
               │
               ▼
        bdd-implement（feature → impl）
        RED → GREEN ループ（4 層ガード）
               │
               ▼
        人間ゲート（コミット・bless）
               │
        ┌──────▼──────────────────────────────┐
        │  継続的な変更サイクル                │
        │  spec または impl が変わった疑い     │
        │    ↓                                │
        │  bdd-traceability-check（read-only） │
        │    ↓ drift あり                     │
        │  bdd-sync（diff → feature 更新）    │
        │    ↓                                │
        │  bdd-implement（必要なら）           │
        │    ↓                                │
        │  人間ゲート（bless・コミット）       │
        └─────────────────────────────────────┘
```

---

## 付録: bdd-kit.config.yaml プレースホルダ一覧

このドキュメントで使用している `{{placeholder}}` は `bdd-kit.config.yaml` から解決される。
主要なプレースホルダの意味を以下に示す。

| プレースホルダ | 意味 |
|---|---|
| `{{cmd_bddgen}}` | Gherkin と step 定義の整合確認コマンド |
| `{{cmd_typecheck}}` | 型チェックコマンド |
| `{{cmd_traceability_update}}` | マニフェストのハッシュを更新するコマンド |
| `{{cmd_traceability_check}}` | drift チェックを実行するコマンド |
| `{{cmd_smoke}}` | smoke テスト実行コマンド（`{{tag_slow}}` タグを除外） |
| `{{e2e_features_dir}}` | feature ファイルが置かれるディレクトリ |
| `{{scratch_dir}}` | bootstrap ドラフトの一時出力先 |
| `{{traceability_manifest}}` | トレーサビリティ・マニフェスト YAML のパス |
| `{{tag_slow}}` | 外部呼び出し等で低速なシナリオに付けるタグ |
| `{{tag_generate}}` | ドメイン固有の重い生成処理を伴うシナリオのタグ |
| `{{tag_role_admin}}` | 管理者ロールで実行するシナリオのタグ |
| `{{tag_role_user}}` | 一般ユーザーロールで実行するシナリオのタグ |
| `{{bdd_runner}}` | BDD テストランナー（フレームワーク固有） |
| `{{code_reviewer_agent}}` | コードレビューエージェント識別子 |
| `{{security_reviewer_agent}}` | セキュリティレビューエージェント識別子 |
| `{{gherkin_language}}` | Gherkin のロケール（例: `ja`） |
