---
name: specproof-bootstrap
description: Bootstrap a rich Gherkin .feature DRAFT from existing implementation (impl to feature) for a domain whose E2E coverage is thin or missing. Reads the UI page / lambda / existing feature+steps, enumerates user-observable behaviors as black-box scenarios, writes ALL observable specs into the feature (automating the deterministic ones and tagging the rest @red-contract, @human or @out-of-scope with a reason rather than dropping them), and carves only non-Gherkin specs (API status-code contracts, internal constants, non-functional) out to the rationale doc. Emits a draft to a scratch path for mandatory human review. One-time bootstrap only, NOT continuous regeneration. Use when an existing .feature is too thin and you want to expand coverage from current behavior. Do NOT use to auto-generate the "why" layer (design rationale) - that is human-authored, see the rationale doc convention.
---

# BDD Bootstrap (impl 起点で feature ドラフトを作る)

> 内部ムーブメント — 通常は `/specproof`（オーケストレータ）が駆動する。単体起動も可。

既存実装を読み、ある機能ドメインの「ユーザー視点で観測可能な振る舞い」を
{{config:language}} Gherkin の `.feature` **ドラフト**として一気に立ち上げる。
目的は薄い/欠落した E2E カバレッジを bootstrap すること。

## 0. 設定の解決（最初に必ず実行）

リポルートの `specproof.config.yaml` を読み、以降に登場する適用する adapter・手順に必要な `{{config:...}}` トークンを
そのファイルの対応フィールド値で置き換えてから作業を開始すること。
このファイルが存在しない場合は **STOP し、ユーザーに
`specproof init --adapter <framework>` の実行を依頼する**。

解決が必要な主な値:
- マニフェストパス: `{{config:layout.manifest}}`
- features/steps/pages の配置: `{{config:layout.featuresDir}}` / `{{config:layout.stepsDir}}` / `{{config:layout.pagesDir}}`
- ドラフト出力先: `{{config:layout.scratchDir}}`
- 生成・検証コマンド: `{{config:commands.generate}}` / `{{config:commands.typecheck}}` / `{{config:commands.smoke}}`
- トレーサビリティコマンド: `{{config:commands.traceabilityUpdate}}` / `{{config:commands.traceabilityCheck}}` / `{{config:commands.traceabilityList}}`
- タグ: `{{config:tags.slow}}` / `{{config:tags.generate}}` / `{{config:tags.admin}}` / `{{config:tags.user}}`
- 状態タグ（固定・設定で変えない）: `@draft` / `@red-contract` / `@human` / `@out-of-scope`
- ランナープロファイル: `{{config:projects}}`
- 環境プロファイル: `{{config:environments}}`
- fixture 名: `{{config:fixtures}}`

## 位置づけ（他の BDD skill との違い）

| skill                     | 方向                     | いつ使う                                            |
| ------------------------- | ------------------------ | --------------------------------------------------- |
| `specproof-new-feature`   | spec → feature           | 仕様セクションがあり E2E 未整備の**新規**機能       |
| `specproof-sync`          | drift → feature          | drift 検知後の追従。期待値は spec から導出し、impl を生成元にしない |
| **`specproof-bootstrap`** | **impl → feature**       | **既存実装はあるが feature が薄い**ドメインの底上げ |

**impl → feature は一度きりの bootstrap 専用。継続的に再生成してはいけない。** 理由:

- **同語反復**: テストを「いま動いているコード」から生成した瞬間、そのコードの回帰を
  検知する力を失う。バグが入っても feature がコードに追従して書き直され、赤になるべき
  瞬間に緑のままになる（テストの目的そのものが消える）。
- **権威の向き**: 正しい依存方向は feature → impl（仕様が実装を駆動）。bootstrap は
  その逆向きで、ゼロから初期化する初回の一回だけ許される。
- **重力的収縮**: impl の素読で書けるのは平均的ハッピーパスだけ。人間が意図設計した
  境界値・エラー経路・ロール分岐（`{{config:tags.user}}`/`{{config:tags.admin}}`・0件空状態・誤入力）・`@red-contract`/`@human`/`@out-of-scope` のシナリオ・
  rationale への WHY リンクが、再生成のたびに実装の平均像へ引き寄せられて静かに消える
  （テスト範囲の重力的収縮）。CI は green のままなので気づけない。

**bootstrap 後の変更は必ず feature-first**（人間が `.feature` を先に編集 → 赤 → 実装 → 緑）。
実装変更の feature 追従は再生成ではなく `{{config:commands.traceabilityCheck}}`（検知・CLI）→ `/specproof-sync`（期待値は spec から導出・impl の
振る舞い変化は人間ゲートで停止・既存シナリオ非削除）→ `{{config:commands.traceabilityUpdate}}`（bless）で行う。詳細は
`{{config:layout.e2eReadme}}`「bootstrap は一度きり・実装変更後の追従経路」節。

## 前提（生成は「正しさ」を作らない）

impl から生成した feature は「**今こう動いている**」の読めるスナップショットに
すぎず、「この振る舞いが意図通り（正しい）」という担保は含まない。
**正しさは人間の査読で刻印する。** 査読ゲート（Step 7）は省略不可。

## Arguments

- 必須: `<domain>` — 対象ドメイン（例 `{{config:examples.domainName}}`）。既存 `.feature` のベース名でよい。
  **`<domain>` が無い場合は `{{config:commands.traceabilityList}}` を実行**し、登録済みドメインと
  「未追跡の bootstrap 候補（feature 未整備のページ＝ suggested-domain 付き）」を提示して、
  どれを bootstrap するかユーザーに確認してから進める（推測で着手しない）。
- 省略可: `<impl-paths>` — 読むべき実装ファイル。省略時は domain から推定し、不明なら確認する。

## Steps

1. 対象ドメインの実装と既存テストを読む:
   - UI ページ（`{{config:layout.implGlobs}}` が指す実装ファイル群）
   - 既存 `{{config:layout.featuresDir}}/<domain>.feature` と対応 `{{config:layout.stepsDir}}/*{{config:layout.stepFileSuffix}}`、page object
     （`{{config:layout.pagesDir}}/*.{{config:layout.stepFileExt}}`）
2. **観測可能な振る舞いだけ**を列挙する。ブラックボックス厳守:
   step 文に内部 API 名・セレクタ・内部定数（`{{config:examples.internalConstants}}` に列挙された値など）を書かない。
   入力・ボタン活性条件・結果表示・空状態・エラー表示・ローディング/非同期完了の可視状態を網羅。
3. **「仕様として存在する観測可能な振る舞い」は、自動化の難易度に関わらず一旦すべて
   `.feature` に書く**（テスト困難を理由に rationale へ逃がさない）。置き場所は3択:
   - **自動化する** — 決定的に再現でき、すぐ自動化できる: タグ無し（smoke 実行）または
     `{{config:tags.slow}}`（実バックエンド・smoke 除外）。
   - **`.feature` に書くが今は自動で確かめない** — 観測可能な振る舞いだが、自動化が難しい（データを
     決定的に用意できない・失敗注入 seam が無い・一過性で捉えにくい・環境依存）場合。次のどれかを付ける:
     - `@red-contract` — 自動化する。`@human` が付いていなければ E2E で実行し、落ちるのを観測し続ける。
       `@human` と併記した場合は実装待ちのまま人が確かめ、E2E では実行しない。
       step 句の**定義は必須**（{{config:bddGenTool}} は未定義 step を生成エラーにする）。
       未実装の本体は `{{config:conventions.pendingStubBody}}` stub にする。
     - `@human` — 人が確かめて記録する。E2E では実行しない。自動化に必要な seam は coverageNotes に
       testability backlog として挙げる。
     - `@out-of-scope` — 受け入れ条件に含めない。E2E では実行しない。**シナリオの直前に「なぜ外すか」の
       1行コメント（`# ...`）が必須**（無いと `{{config:commands.traceabilityCheck}}` が `missing-reason` を出す）。
       Feature・Rule・Examples ではなくシナリオ自身に付け、`@red-contract` と同じシナリオに併用しない。
     壊れたテスト・不安定なテストを一時的に止めるタグは無い。直るまで赤のままにする。
     `@fixme` / `@skip` と playwright-bdd の `@fail` は退役したので付けない（`retired-tag` になり `--strict` で失敗する）。
     **環境限定シナリオ**: 特定の認証プロバイダや外部サービスに依存するシナリオ（例: Google OAuth
     同意画面、実メール送信）は上の状態タグではなく、環境タグ（例: `@google-auth`）を付ける。
     該当環境の `{{config:environments}}` エントリの `excludeTags` にそのタグが含まれていれば
     当該環境では実行されない（`@human` とは異なり、対応環境では実行される）。
   - **rationale doc へ回す** — Gherkin の Given/When/Then に**乗らない**非 behavior のみ:
     API ステータスコード契約・内部ロジック/フォーマッタの定数（`{{config:examples.internalConstants}}` に
     例示されるような外部観測不能な値・スコア計算の正確性・タイブレーク順・内部フィルタ定数の除外結果など）・
     非機能要件・認可のステータスコード区別（UI 非可視）・内部データストアの状態・監査ログの書き込み・
     LLM 出力の言語品質。`coverageNotes` に「rationale 行き／理由」を残す。
     判断の核心は「**観測可能な振る舞いか**」であって「テストが簡単か」ではない。
     観測可能なら難しくても `.feature`（状態タグ可）に置く。観測不能なら rationale。
     （`{{config:layout.e2eReadme}}`「仕様の置き場所」と「テストが難しい ≠ 観測不能」の落とし穴を参照）
4. `../specproof-sync/prompts/system.md`（または `{{config:layout.idiomGuide}}` が指すガイド）の生成ガイドに従い、
   既存 `.feature` の文体に合わせてドラフトを書く。**既存 step 句を最大限再利用**し、新規が必要なものは
   別途列挙する。実 AI 生成等の重い処理を伴うシナリオには `{{config:tags.generate}} {{config:tags.slow}}`、
   管理者限定には `{{config:tags.admin}}`、Step 3 の
   「今は自動で確かめない」シナリオには `@red-contract` / `@human` / `@out-of-scope`（理由コメント付き）を付ける。
5. **ドラフトはスクラッチに出す**（例 `{{config:layout.scratchDir}}/<domain>.feature`）。
   各ドラフトの先頭付近（`# language:` 行の直後）に **`# specproof: draft` マーカー行**
   （Gherkin コメント＝全 runner が無視）を入れる。これは「未査読ドラフト」の機械可読な印で、
   Step 7 で人間が featuresDir へ移す際に**この行を削除する＝レビュー完了の明示行為**。
   マーカーが残ったまま featuresDir に置かれると `{{config:commands.traceabilityCheck}} --strict` が
   `unreviewed-draft` として失敗させ、`specproof-implement` も着手を拒否する（同語反復ループ防止）。
   **既存 `{{config:layout.featuresDir}}/*.feature` を上書きしない。** あわせて
   「新規実装が必要な step 句」「再利用した step 句」「coverageNotes」を報告する。
   `coverageNotes` は別ファイルにせず**エージェントの最終レポート内の Markdown 箇条書き**とし、
   各項目を「対象の振る舞い / 置き場所（自動化・`.feature`＋`@red-contract`/`@human`/`@out-of-scope`・
   環境タグ（`@google-auth` 等）・rationale doc）/ 対象環境（どの `{{config:environments}}`
   エントリで実行/除外されるか）/ 理由」の1行で書く。
   `.feature` に状態タグ付きで残したものと rationale へ回したものを混同しない。
   環境タグ付きシナリオは状態タグとは別カテゴリで報告する（環境タグは
   対応環境では実行される点が `@human` / `@out-of-scope` と異なる）。
6. **bootstrap の盲点を自己点検する**（impl 読みで最も取りこぼしやすい層）:
   - 横断認可・セキュリティ契約（他ユーザーのリソースにアクセスすると forbidden/403 等）
   - API 契約バリデーション（リクエストサイズ・文字数上限などの境界）
   - 別エンドポイント／別ページの操作フロー
     観測可能なら feature に追加し（自動化が難しければ Step 3 に従い `@red-contract`/`@human`/`@out-of-scope`）、
     観測不能なら rationale doc へ回す。漏れを `coverageNotes` に残す。
7. **人間の査読ゲート（必須）**: ユーザーがドラフトを読み、意図を刻印（編集・取捨選択し、
   `# specproof: draft` マーカー行を削除）してから `{{config:layout.featuresDir}}/` へ移す。移したら新規 step 句のうち既存 steps で賄えないものを
   `specproof-new-feature` の Step 4 と同様に stub 化する（既存 `{{config:layout.stepsDir}}/*{{config:layout.stepFileSuffix}}` への追加を優先し、
   未実装本体は `{{config:conventions.pendingStubBody}}`）。その後 pending step を実装し、検証:
   ```bash
   {{config:commands.generate}}        # Gherkin と step の対応
   {{config:commands.typecheck}}
   {{config:commands.smoke}}    # pending step 実装後。{{config:env.baseUrl}} 等の env が必要
   ```
   smoke の実行環境が無い場合は `{{config:commands.generate}}` + `{{config:commands.typecheck}}` まで通し、smoke が未実行である
   ことを明示してから commit する。
8. 既存 feature の拡張なら bless:
   ```bash
   {{config:commands.traceabilityUpdate}}
   {{config:commands.traceabilityCheck}}   # clean を確認
   ```
   新規リンクなら `{{config:layout.manifest}}` に追記（`specproof-new-feature` の手順に準拠）。

## なぜ層（rationale doc）は自動生成しない

`.feature` に書けない仕様（設計根拠・非機能・横断/認可）は人間が書く rationale doc に置く。
**この skill で rationale doc を自動生成してはいけない。** 実装からの自動抽出は
行番号の写し・根拠の捏造を生み、捨てたいはずの「仕様書の腐敗」を再生産する
（specproof-bootstrap パイロットで実証済み）。AI が許されるのは「topic の骨子出し」までで、
各項目の「なぜ」は人間が確定する。規約は `{{config:layout.e2eReadme}}` の
「なぜ層ドキュメント（rationale doc）の規約」を参照。

## Safety rules

- 既存の `.feature` / steps / page object を**上書きしない**（ドラフトは別所に出す）。
- **継続再生成しない**（bootstrap は一度きり。以後は feature-first）。
- **ドラフトには `# specproof: draft` マーカーを必ず入れる**。featuresDir へ移すのは人間が
  マーカーを削除した後（未査読ドラフトの実装を構造的に防ぐ＝同語反復ファイアウォール）。
- ブラックボックス厳守（内部実装詳細を step 文に出さない）。
- `.{{config:layout.stepFileExt}}` に {{config:language}} テキストを直書きしない。UI 文字列は `{{config:layout.textConstants}}` の定数を使う（上流は `{{config:layout.i18nSource}}`）。
- 人間の査読ゲートを省略しない。テストが落ちた状態でコミットしない（`@red-contract` のシナリオが
  RED なのは想定どおり。それ以外の失敗は残さない）。
- **観測可能な仕様を「テストが難しい」だけの理由で rationale に逃がさない**。
  `.feature` にシナリオとして書き、`@red-contract` / `@human` / `@out-of-scope`（理由コメント付き）のどれかを付ける。
- 壊れた・不安定なシナリオを一時的に止めない（そのためのタグは無い）。`@fixme` / `@skip` / `@fail` は使わない。
- 既存の `.feature` を読んで拡張するときも、既存シナリオの状態タグは書き換えない。変更が要ると考えたら、
  ドラフトの査読時に人が判断できるよう coverageNotes に提案として書く。
  rationale 行きは Gherkin に乗らない非 behavior に限る（Step 3 の3択を参照）。
- 「なぜ」を推測で書かない（rationale doc は人間が確定する）。
- `{{config:layout.testRunnerConfig}}` の project 構成（`{{config:projects}}`）に
  合わないタグを付けない（`specproof-new-feature` の Safety rules に準拠）。
- **環境タグの整合性**: 生成するシナリオの環境タグが `{{config:environments}}` の
  全エントリの `excludeTags` に含まれていないことを確認する（全除外=実行されない dead code）。
  環境固有の認証フロー（例: mock vs Google OAuth）を検出した場合は coverageNotes に
  環境タグの推奨値と対応する `excludeTags` エントリを提案する。

## 設定解決の境界

適用する adapter と手順が参照する設定だけを解決する。未設定の必須値・存在しない参照先は
キー名と必要な編集を示して停止し、consumer 固有値を推測しない。

`agents` は未設定時のインライン自己レビューという明示済み fallback を使用できる。
`conventions.i18nLintPlugin: none` は専用 plugin がないという明示値であり、検査成功を意味しない。
`examples` は説明用の例であり、実際の仕様・既存ファイルの存在を保証しない。
Flutter の `projects` / `env` / `environments` は skill 用の宣言で、Dart runner へ自動注入されない。
