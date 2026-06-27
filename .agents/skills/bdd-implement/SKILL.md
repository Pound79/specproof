---
name: bdd-implement
description: Implement production code (and pending step bodies / page-object methods) to make a human-authored RED .feature go GREEN — the feature → impl (TDD) direction. Config-driven via bdd-kit.config.yaml; works with any repo (web Playwright, Flutter, etc.). Reads the feature PLUS the linked spec/rationale, existing impl patterns, steps and page objects (the feature is black-box and underspecifies impl). Guards hard against test-gaming (no hardcoding test values, no test-input special-casing, no assertion hollowing) via an explicit rule + self-check, independent adversarial review, spec/contract alignment, and input variation. Never regenerates the feature from impl (that direction is tautological — forbidden) and never silently edits the feature body. Verifies the fast layer (bddgen + typecheck + lint + non-{{config:tags.slow}} smoke) and leaves {{config:tags.slow}}/{{config:tags.generate}}/{{config:tags.sf}} for human/CI. Edits only the target domain; cross-cutting changes stop with a proposal. Use after a feature is authored/blessed RED and you want code that satisfies it. Do NOT use to write the feature (that is bdd-new-feature / bdd-sync / bdd-bootstrap).
---

# BDD Implement (feature 起点で impl を緑にする)

> 内部ムーブメント — 通常は `/bdd-kit`（オーケストレータ）が駆動する。単体起動も可。

人が査読・bless 済みの **RED な `.feature`**（+ pending step stub）を入力に、それを満たす
実装を書いて **GREEN** にする。`feature → impl` 方向の TDD を skill 化し、毎回忘れがちな
ガードレール（特に test gaming 防止）を常設する。

## 0. 設定の解決（最初に必ず実行）

リポルートの `bdd-kit.config.yaml` を読み込み、このドキュメント内のすべての
`{{config:...}}` トークンを実値へ解決してから以降のステップを実行すること。

- manifest パス、コマンド、タグ、レイアウト、プロジェクト定義はすべてこのファイルから来る。
- traceability CLI（`{{config:commands.traceabilityCheck}}` など）が参照するパスも同じファイルで定義されている。
- **`bdd-kit.config.yaml` がリポルートに存在しない場合は即座に停止し**、ユーザーに
  `bdd-kit init --adapter <framework>` を実行するよう伝えること。
- **環境プロファイルの解決**: `{{config:environments}}` から `BDD_KIT_ENV`（未設定なら
  `default: true` のエントリ）でアクティブプロファイルを特定する。
  `{{config:auth.provider}}` / `{{config:auth.description}}` はアクティブプロファイルの
  `auth` から解決する（`adapter-contract.md` §5 ルール 5）。

## 核心思想: 方向の非対称性

- `impl → feature`（テストをコードから再生成）= **同語反復で禁止**。テストが独立性を失い
  緑が無意味になる（feature 層生成は bdd-new-feature / bdd-sync / bdd-bootstrap が担う）。
- `feature → impl`（独立した spec=feature を満たすよう実装）= **TDD として正当**。feature は
  人が先に書いた独立基準なので、緑になることが「コードが独立基準を満たした」証明になる。

この skill は後者だけを行う。**feature 本文（シナリオ）は touch しない**（独立性の境界線）。

## 位置づけ（他の BDD skill との違い）

| skill                                            | 方向                | produces                                    |
| ------------------------------------------------ | ------------------- | ------------------------------------------- |
| `bdd-new-feature` / `bdd-sync` / `bdd-bootstrap` | spec/impl → feature | `.feature` + **pending step stub**          |
| **`bdd-implement`**                              | **feature → impl**  | pending step 本体 + page object + 製品 impl |

生成系は「feature + pending stub」で止め、`bdd-implement` が「緑にする残り全部」を担う。

## Arguments

- 必須: `<link-id>` または `<feature-path>` — 対象 feature（既存 `{{config:layout.featuresDir}}/*.feature`）。
- 省略可: `<scenario>` — 特定シナリオに絞る（大きい feature を分割実装）。

## 前提（着手前に検証）

- **ドラフトマーカー検査（最優先）**: 対象 feature に `# bdd-kit: draft` 行が残っている場合は
  **即停止**する。これは bootstrap が生成した**未査読ドラフト**が査読・刻印を経ずに featuresDir へ
  移された印で、これを実装すると impl→feature→impl の同語反復（bootstrap が読んだ実装をそのまま
  緑化）に陥る。ユーザーにドラフトの査読・意図の刻印（境界値・エラー経路・ロール分岐・rationale
  リンク）と**マーカー行の削除**を依頼してから着手する（`{{config:commands.traceabilityCheck}} --strict`
  でも `unreviewed-draft` として検出される）。
- feature は **人が著した RED**。feature と impl を同一パスで共著しない。working-tree のみ
  なら「これが意図した spec か」を確認する。
- **着手前に対象を実行して RED を確認**（既に緑なら「実装不要」で終了＝no-op 検出・gaming
  検出のベースライン確立）。
- feature 差分だけでなく、traceability で結ばれた **spec/rationale doc・既存 impl パターン・
  既存 steps/page object・`{{config:layout.textConstants}}`** を読む（feature は黒箱で impl を underspecify する）。

## Steps

1. **文脈読み込み**: 対象 feature/scenario + traceability で結ばれた spec/rationale・
   既存 impl パターン・steps/page object・`{{config:layout.textConstants}}`。
2. **RED 確認（ベースライン）**: 対象を実行（`{{config:tags.slow}}` は bddgen + pending/fail を確認）。
   既に緑なら「実装不要」で終了。
3. **実装計画**: feature の観測挙動 + spec/rationale の WHY・契約から必要変更（step 本体／
   page object／`{{config:layout.textConstants}}`／製品 impl）を列挙。横断/共有が要るなら**停止して提案のみ**。
4. **実装（ガードレール①を遵守）**: 一般解で書く。ハードコード・テスト入力特例分岐・
   assertion を満たすだけの最小出力を禁止。`{{config:layout.stepFileExt}}` ファイルに
   `{{config:language}}` テキストを直接埋め込まない。UI 文字列は `{{config:layout.textConstants}}`
   定数（既存規約）。上流 i18n source は `{{config:layout.i18nSource}}`。
5. **高速検証ループ（緑確認）**:
   ```bash
   {{config:commands.generate}}      # Gherkin ↔ step 対応
   {{config:commands.typecheck}}
   {{config:commands.lint}}          # 製品 impl 側。e2e は lint 対象外
   {{config:commands.smoke}}         # 非{{config:tags.slow}} の対象シナリオ緑（{{config:env.baseUrl}} 等の env が必要）
   ```
   失敗は診断→修正、**自己修正は2回まで**。超えたら停止して報告。
6. **gaming 自己点検（①）＋入力バリエーション（④）**: チェックリストで点検。可能なら
   入力値を変えても破綻しないか確認（黒箱で不可なら省略・理由明記）。
7. **独立 adversarial レビュー（②）**: `{{config:agents.codeReviewer}}` + `{{config:agents.securityReviewer}}` に加えて、
   feature と diff を渡し「テストを通すための偽実装になっていないか」を反証させる
   gaming 観点のレビューを必ず通す（初版は {{config:agents.codeReviewer}} へその観点を明示指示。必要なら
   専用 agent 化）。CRITICAL/HIGH を修正。
   **フォールバック**: `{{config:agents.*}}` が未設定（テンプレ既定）でも**この層を省略しない**。
   レビュー用エージェントが無ければ、同じ反証観点（gaming・セキュリティ）を自分でインラインに実施する。
8. **`{{config:tags.slow}}`/`{{config:tags.generate}}`/`{{config:tags.sf}}`**: 実装はするが実行検証は委譲。「実装済み・smoke 緑・`{{config:tags.slow}}`
   未実行」を明示。
9. **レポート + 人間ゲート**: コミット/bless は人間（下記レポート様式）。

## ガードレール（4層 anti-gaming）

- **① 禁止ルール明文化＋自己点検**: gaming パターン（テスト値のハードコード／テスト入力
  だけの特例分岐／assertion を満たすだけの最小出力）を禁止し、実装後に self-review。
- **② 独立 adversarial レビュー**: `{{config:agents.codeReviewer}}` + 反証的 gaming レビュー（feature と diff）。
- **③ spec/rationale 整合**: 実装が WHY・契約（内部定数・スコア重み等）に整合するか。
  feature の underspecify を埋め、辻褄合わせを防ぐ。例として `{{config:examples.internalConstants}}`
  に列挙されているような内部定数（実装の内部 detail でユーザーには不可視なもの）は
  feature の step 文に書かず rationale doc（`{{config:layout.specDir}}`）へ回すことで
  spec/impl 整合の境界を明確にする。
- **④ 入力バリエーション**: 入力値を変えても破綻しないことを確認し特例ハードコードを炙る
  （黒箱で困難なら適用範囲限定・理由明記）。

## ブロック時エスカレーション（正直に緑化不能なら停止して出力）

- **① feature 修正案を diff 提案（適用せず）** — feature が誤り/underspecified の疑い時。
- **② spec/rationale 不足を列挙** — 黒箱で埋まらない内部契約・定数・スコア重みを「要人間
  追記」として提示。該当する典型例は `{{config:examples.internalConstants}}` を参照せよ
  （プロジェクト固有の内部定数一覧が定義されている）。
- **③ `{{config:tags.fixme}}`/`{{config:tags.skip}}` 化を提案** — 現状自動で緑にできない観測仕様は理由付きで格下げ提案
  （bdd-bootstrap の3択と整合）。
- **④ 部分実装＋残りを pending 明示** — 緑化できたシナリオは進捗として残し、残りは未完/
  なぜ止まったかを明記。pending step の stub body には `{{config:conventions.pendingStubBody}}` を使う。

## レポート様式（最終メッセージ内 Markdown）

- 実装ファイル一覧（step／page object／`{{config:layout.textConstants}}`／製品 impl を区別）
- 検証結果: bddgen（`{{config:commands.generate}}`）/ typecheck（`{{config:commands.typecheck}}`）/ lint（`{{config:commands.lint}}`）/ smoke（`{{config:commands.smoke}}`）（✓✗）
- `{{config:tags.slow}}`/`{{config:tags.generate}}`/`{{config:tags.sf}}`: 「実装済み・未実行」リスト
- gaming 自己点検＋adversarial レビュー結果（指摘と対応）
- エスカレーション（あれば①〜④）
- 残: **impl 側 drift の bless**（製品 impl は traceability 追跡対象）・コミット・full run は人間

## Safety rules

- **方向の不変条件**: `impl → feature` 再生成をしない。**feature 本文を黙って書き換えない**
  （修正は escalation ① の提案のみ）。
- **独立性**: feature と impl を同一パスで共著しない（前提＝人著の RED feature）。
- **gaming 禁止**: ハードコード・テスト入力特例・assertion 骨抜きをしない。
- **blast radius**: 対象ドメインの範囲（`{{config:implement.blastRadiusGlobs}}`）に限定。横断/共有
  ファイルは**停止して提案のみ**。`implement.blastRadiusGlobs` が未設定なら、対象ドメインに対応する
  `{{config:layout.implGlobs}}` のファイル群を保守的な既定スコープとする。
- **自己修正2回上限**、超えたら停止報告。**テストが落ちた状態でコミットしない**。`{{config:tags.slow}}`
  未実行を明示。
- `{{config:layout.stepFileExt}}` ファイルに `{{config:language}}` テキストを直接書かない（UI 文字列は `{{config:layout.textConstants}}` 定数）。
- **人間ゲート省略不可**（コミット/bless は人間）。製品コードは `{{config:agents.securityReviewer}}` 必須。
- `{{config:layout.testRunnerConfig}}` のプロジェクト構成（{{config:projects}}）に整合しないタグの
  シナリオを緑化対象にしない。
- **環境 excludeTags**: アクティブ環境プロファイルの `excludeTags` に含まれるタグを持つシナリオは
  当該環境では skip されるため、緑化対象にしない。
  smoke 実行時の `BDD_KIT_ENV` を確認し、対象シナリオが実行される環境で検証すること。
- 認証プロバイダ（`{{config:auth.provider}}`）の制約（`{{config:auth.description}}`）を踏まえて
  認証シナリオのステップを実装すること。認証プロバイダはアクティブ環境プロファイルに
  よって異なる場合がある（例: local=mock, dev=Google OAuth）。実装は現在のアクティブ環境の
  プロバイダに合わせつつ、環境固有の分岐が必要な場合はその旨をレポートに明記する。
- step framework pattern: `{{config:conventions.stepFrameworkPattern}}`（`{{config:layout.stepsDir}}` 内の step ファイルは
  `*{{config:layout.stepFileSuffix}}` の命名規約に従う）。

## フロー上の位置（`{{config:layout.e2eReadme}}`「変更起点別フロー」）

- **① spec-first**: `/bdd-new-feature` or `/bdd-sync` で feature+stub → **`/bdd-implement`** で緑化 → bless
- **② feature-first**: 人が feature 編集 → **`/bdd-implement`** で緑化 → bless

`bdd-sync`（impl → feature）とは**反対方向**。混同しないこと。詳細は
`{{config:layout.e2eReadme}}`「変更起点別フロー」「bootstrap は一度きり・実装変更後の追従経路」節。
