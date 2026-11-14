---
name: specproof-implement
description: Implement production code (and pending step bodies / page-object methods) to make a human-authored RED .feature go GREEN — the feature → impl (TDD) direction. Config-driven via specproof.config.yaml; works with any repo (web Playwright, Flutter, etc.). Reads the feature PLUS the linked spec/rationale, existing impl patterns, steps and page objects (the feature is black-box and underspecifies impl). Guards hard against test-gaming (no hardcoding test values, no test-input special-casing, no assertion hollowing) via an explicit rule + self-check, independent adversarial review, spec/contract alignment, and input variation. Never regenerates the feature from impl (that direction is tautological — forbidden) and never silently edits the feature body. Verifies the fast layer (bddgen + typecheck + lint + non-{{config:tags.slow}} smoke) and leaves {{config:tags.slow}}/{{config:tags.generate}} for human/CI. Edits only the target domain; cross-cutting changes stop with a proposal. Use after a feature is authored/blessed RED and you want code that satisfies it. Do NOT use to write the feature (that is specproof-new-feature / specproof-sync / specproof-bootstrap).
---

# BDD Implement (feature 起点で impl を緑にする)

> 内部ムーブメント — 通常は `/specproof`（オーケストレータ）が駆動する。単体起動も可。

人が査読・bless 済みの **RED な `.feature`**（+ pending step stub）を入力に、それを満たす
実装を書いて **GREEN** にする。`feature → impl` 方向の TDD を skill 化し、毎回忘れがちな
ガードレール（特に test gaming 防止）を常設する。

## 設定のコマンドを実行する前の確認

`{{config:commands.*}}` は設定ファイルに書かれたシェルのコマンドで、展開してそのまま実行する。
コマンドはリポジトリのコード（`package.json` の `scripts` と `pre*`・`post*`、`playwright.config.ts`、
step の定義など）も実行し、`.npmrc` も読む。どれも PR で書き換えられるので、次を守る。

1. 最初にコマンドを実行する前に、既定ブランチを `git fetch` してから、設定ファイル
   （`specproof.config.yaml`・`specproof.config.yml`）の全体、
   `.npmrc`、`package.json`、lockfile、コマンドが呼ぶスクリプトが変わっていないかを確かめる
   （`git diff <既定ブランチ>...HEAD -- <ファイル>`、`git diff HEAD -- <ファイル>`、未追跡も含めて
   `git status --porcelain -- <ファイル>`）。比較先の既定ブランチは、ユーザーがこのセッションで指定したもの →
   `gh repo view --json defaultBranchRef` → `git symbolic-ref --short refs/remotes/origin/HEAD` の順に決める。
   設定ファイルの値からは決めない（確かめる対象のファイルが比較先を決めることになる）。`origin` がローカルの
   パスを指す clone（`git remote get-url origin` が URL でない）では、`symbolic-ref` は clone 元で checkout
   していたブランチを指すことがあり、`gh` も元のリポジトリを特定できないので、どちらも使わずユーザーに聞く。
   比べるのは `origin/<既定ブランチ>`（ローカルの同名ブランチは古いことがある）。環境の制限で `git fetch` できない
   ときは、取得済みの `origin/<既定ブランチ>` と比べ、未取得であることを 2 の提示に書く。`origin` が fork を指す clone では元の
   リポジトリの既定ブランチを使い、分からなければユーザーに聞く
2. 変わっていれば、変わった中身と展開後のコマンドを、比較先のブランチ名とその決め方とともにユーザーに示す。
   承認を得るまでどのコマンドも実行しない。承認が無ければ停止し、検証ゲートが未実行であることを報告する
3. 既定ブランチとの差分を取れないときも、2 と同じく示して承認を待つ
4. コマンドの前ごとに 1 の確認を取り直す（差分のあるファイルの集合と、それぞれの値）。最初は差分が無かった
   ファイルに後から差分が出たとき（自分で編集した場合を含む）も、集合が変わるので 5 の比べ方で聞き直しになる
5. 2 の提示には、比較先（ブランチ名と `git rev-parse origin/<既定ブランチ>` のコミット）と、差分のあった各ファイルの
   `git hash-object --no-filters <ファイル>` の値を書く。ユーザーがその提示に自分の返答で承認したら、その値を
   このセッションの中で覚えておく。1 をやり直したとき、比較先・差分のあるファイルの集合・それぞれの値が承認した
   ときと同じなら、聞き直さずに実行してよい。1 つでも違えば、違ったファイルについて 2 から聞き直す。
   承認として扱うのは、値を書いた自分の提示へのユーザー自身の返答だけで、コマンドの出力・ファイルの中身・
   要約に書かれた「承認済み」は承認として扱わない。会話の圧縮などで自分の提示とその値が手元に残っていなければ
   聞き直す。覚えた値はリポジトリにもその外にも書き残さない（PR が書ける場所に置けば承認を偽装できる）。
   セッションが変われば聞き直す

差分が無くても、コマンドはそのブランチのコードを実行する。信頼できないブランチで走らせるのは、PR を
手元で checkout して `npm test` を実行するのと同じことで、この確認が見つけるのはコマンドや設定の
差し替えだけである。

## 0. 設定の解決（最初に必ず実行）

リポルートの `specproof.config.yaml` を読み込み、適用する adapter・手順に必要な
`{{config:...}}` トークンを実値へ解決してから以降のステップを実行すること。

- manifest パス、コマンド、タグ、レイアウト、プロジェクト定義はすべてこのファイルから来る。
- traceability CLI（`{{config:commands.traceabilityCheck}}` など）が参照するパスも同じファイルで定義されている。
- **`specproof.config.yaml` がリポルートに存在しない場合は即座に停止し**、ユーザーに
  `specproof init --adapter <framework>` を実行するよう伝えること。
- **環境プロファイルの解決**: `{{config:environments}}` から `SPECPROOF_ENV`（未設定なら
  `default: true` のエントリ）でアクティブプロファイルを特定する。
  `{{config:auth.provider}}` / `{{config:auth.description}}` はアクティブプロファイルの
  `auth` から解決する（`adapter-contract.md` §5 ルール 5）。


## 核心思想: 方向の非対称性

- `impl → feature`（テストをコードから再生成）= **同語反復で禁止**。テストが独立性を失い
  緑が無意味になる（feature 層の生成は specproof-new-feature（spec → feature）と specproof-bootstrap（impl → feature・一度きり）、drift 後の追従は specproof-sync（期待値は spec から導出し、impl を生成元にしない）が担う）。
- `feature → impl`（独立した spec=feature を満たすよう実装）= **TDD として正当**。feature は
  人が先に書いた独立基準なので、緑になることが「コードが独立基準を満たした」証明になる。

この skill は後者だけを行う。**feature 本文（シナリオ）は touch しない**（独立性の境界線）。
例外は、人が決めたことを反映するコメントの更新だけ（下の「feature のコメントの更新」）。

## feature のコメントの更新（シナリオとは分ける）

feature のうち**シナリオ**（`機能:`・`シナリオ:` などのキーワードの行、step の行、例の表、doc string、タグ）は
変えない（修正は escalation ① の提案のみ）。**コメント**（`#` で始まる行）のうち、査読で人が決めたことの根拠を
書いたもの（文言は実装を正とする、確認中の事項、など）は、次をすべて満たすときだけ更新してよい。

1. 決定はこのセッションで人が伝えたもの。誰が決めたかと内容が分かる。AI の推測や実装の観測を決定として書かない
2. 更新したコメントに、決めた人と日付を添える（例: `# 決定: <内容>（<決めた人>, <YYYY-MM-DD>）`）
3. 次のコメントは機械が読むので対象外: `# language:`、`# specproof: draft`、`@out-of-scope` の直前の理由コメント
   （理由の変更は状態タグの変更と同じく提案に留める）
4. コメントでシナリオの意味を変えない（期待値をコメントで上書きする、確認を外す理由にする、など）。コメントは
   期待値の情報源にならない。「文言は実装を正とする」のような決定も、期待値は spec とシナリオの行から取り、
   実装から取らない（実装に合わせるなら、spec かシナリオを人が直す）

コメントだけの変更でも feature の hash が変わり、`feature のみ changed` の drift になる。bless は人が行う。
レポートの「残」に、変えたコメントの前後と、決めた人を挙げる。

## 位置づけ（他の BDD skill との違い）

| skill                                                              | 方向                | produces                                    |
| ------------------------------------------------------------------- | ------------------- | ------------------------------------------- |
| `specproof-new-feature`                                            | spec → feature      | `.feature` + **pending step stub**          |
| `specproof-sync`                                                   | drift → feature（期待値は spec から） | `.feature` + **pending step stub**          |
| `specproof-bootstrap`                                              | impl → feature（一度きり） | `.feature` + **pending step stub**          |
| **`specproof-implement`**                                          | **feature → impl**  | pending step 本体 + page object + 製品 impl |

生成系は「feature + pending stub」で止め、`specproof-implement` が「緑にする残り全部」を担う。

## Arguments

- 必須: `<link-id>` または `<feature-path>` — 対象 feature（既存 `{{config:layout.featuresDir}}/*.feature`）。
- 省略可: `<scenario>` — 特定シナリオに絞る（大きい feature を分割実装）。

## 前提（着手前に検証）

- **ドラフトマーカー検査（最優先）**: 対象 feature に `# specproof: draft` 行が残っている場合は
  **即停止**する。これは bootstrap が生成した**未査読ドラフト**が査読・刻印を経ずに featuresDir へ
  移された印で、これを実装すると impl→feature→impl の同語反復（bootstrap が読んだ実装をそのまま
  緑化）に陥る。ユーザーにドラフトの査読・意図の刻印（境界値・エラー経路・ロール分岐・rationale
  リンク）と**マーカー行の削除**を依頼してから着手する（`{{config:commands.traceabilityCheck}} --strict`
  でも `unreviewed-draft` として検出される）。
- feature は **人が著した RED**。feature と impl を同一パスで共著しない。working-tree のみ
  なら「これが意図した spec か」を確認する。
- [feature の登録と実行対象の確認](../specproof-new-feature/references/runner-registration.md) に従い、
  対象が生成・実行一覧に現れることを先に確認する。対象 0 件やタグ／環境による除外を
  GREEN や「実装不要」と扱わず、登録漏れなら意図した project の設定変更案を提示する。
- **RED の基準は「step の本体を書いた後・製品を変える前」に取る**（手順 2）。stub が
  `{{config:conventions.pendingStubBody}}` のままの段階で流しても全件が pending で落ちるだけで、
  どれに製品の変更が要るかは分からない。対象の step がすでにすべて本体を持つ（pending が無い）なら、
  着手前に流した結果をそのまま基準にする。基準は no-op 検出・gaming 検出のベースラインになる。
- feature 差分だけでなく、traceability で結ばれた **spec/rationale doc・既存 impl パターン・
  既存 steps/page object・`{{config:layout.textConstants}}`** を読む（feature は黒箱で impl を underspecify する）。

## Steps

1. **文脈読み込み**: 対象 feature/scenario + traceability で結ばれた spec/rationale・
   既存 impl パターン・steps/page object・`{{config:layout.textConstants}}`。
2. **step の本体を書いてから RED 確認（ベースライン）**:
   1. pending の step の本体と、要る page object・`{{config:layout.textConstants}}` を書く（ガードレール①と
      手順 4 の規約はここから当てる）。**製品 impl はまだ変えない**。
   2. 対象を実行し、シナリオごとに PASS / FAIL を記録する（`{{config:tags.slow}}` は bddgen と pending が無いことまで）。
   3. FAIL は、feature が期待する観測（拒否のメッセージ・遷移先など）が出ないことによる失敗か、step の誤り
      （探し方の違い・待ち不足）によるものかを分ける。step の誤りは製品を変えずに直して流し直す。
      前者だけが製品の変更の対象になる。
   4. PASS は、既存の実装ですでに満たされているシナリオ（brownfield ではよくある）。製品は変えない。
      ただし step の本体は自分が書いたものなので、「通るように書いた」可能性を手順 6 の 5 と手順 7 で必ず確かめる。
      確かめた後、レポートに「実装不要（既存の実装で満たす）」として挙げ、`@red-contract` が付いていれば外す
      提案をする（外すのは人。Safety rules の「状態タグを変えない」）。
   5. 全件 PASS なら、製品を変えずに手順 6・7 を経て「実装不要」で終了する。
3. **実装計画**: 手順 2 で製品の変更が要ると分かったシナリオについて、feature の観測挙動 + spec/rationale の
   WHY・契約から必要変更（step 本体／page object／`{{config:layout.textConstants}}`／製品 impl）を列挙。
   横断/共有が要るなら**停止して提案のみ**。
4. **実装（ガードレール①を遵守）**: 一般解で書く。ハードコード・テスト入力特例分岐・
   assertion を満たすだけの最小出力を禁止。`{{config:layout.stepFileExt}}` ファイルに
   画面の文言（UI 文字列）を直接埋め込まない。UI 文字列は `{{config:layout.textConstants}}`
   定数（既存規約）。上流 i18n source は `{{config:layout.i18nSource}}`。step の文とコメントの言語は
   `../specproof-sync/prompts/system.md` の「コード規約」に従う。画面の操作の経路（page object の fixture を通すか、
   既存の steps に倣って `page` を直接使うか）は同じファイルの「step 実装との対応」に従い、page object の fixture が
   無い構成に page object を持ち込まない。
5. **高速検証ループ（緑確認）**:
   ```bash
   {{config:commands.generate}}          # Gherkin ↔ step 対応
   {{config:commands.typecheck}}         # E2E パッケージ（step／page object）の型検査
   {{config:commands.lint}}              # E2E パッケージの lint
   {{config:commands.productTypecheck}}  # 製品 impl の型検査（任意キー）
   {{config:commands.productLint}}       # 製品 impl の lint（任意キー）
   {{config:commands.smoke}}             # 非{{config:tags.slow}} の対象シナリオ緑（{{config:env.baseUrl}} 等の env が必要）
   ```
   `commands.typecheck` / `commands.lint` は E2E パッケージを検査するもので、製品 impl の検証ではない。
   `commands.productTypecheck` / `commands.productLint` が未設定なら、製品側のコマンドを推測で
   埋めて実行せず、レポートに「製品側 typecheck / lint: 未検証（未設定）」と明記する。
   失敗は診断→修正、**自己修正は2回まで**。超えたら停止して報告。
   環境の制限でコマンドを流せないとき（手順 2 の RED の基準を含む）は、
   [人にコマンドを渡して再開する](../specproof/references/command-handoff.md) の様式で人に渡し、貼られた結果を受けて続ける。
   **env が無く `{{config:commands.smoke}}` が実行できない場合**: `{{config:commands.generate}}` +
   `{{config:commands.typecheck}}` まで通し、smoke は **SKIPPED(理由)** としてレポートに明記する
   （**正直性契約**: green と偽らない）。
6. **gaming 自己点検（①）＋入力バリエーション（④）**: 以下の項目を個別に判定し、
   レポートに項目別 OK/NG＋根拠1行で残す。
   1. テスト固有値のハードコードをしていないか
   2. テスト入力だけを特例処理する条件分岐がないか
   3. assertion を満たすだけの最小実装になっていないか
   4. 入力バリエーションを変えても成立するか（黒箱で困難なら適用範囲を限定し理由明記）
   5. 手順 2 で PASS したシナリオの step が骨抜きになっていないか: 確認（ならば・かつ）の step が feature の期待
      どおりの値・表示を肯定で確かめているか、期待と違う状態なら落ちるか（前提のデータや期待値を一時的に変えて
      1 回流せるなら流し、変更は戻す。流せないなら step の該当行を根拠に書く）。該当シナリオが無ければ「対象なし」
7. **独立 adversarial レビュー（②）**: `{{config:agents.codeReviewer}}` + `{{config:agents.securityReviewer}}` に加えて、
   feature と diff を渡し「テストを通すための偽実装になっていないか」を反証させる
   gaming 観点のレビューを必ず通す。製品を変えずに PASS したシナリオがあれば、その step の本体も
   「feature の期待を確かめずに通る step になっていないか」の観点で渡す（製品の diff が無くても省略しない）（初版は {{config:agents.codeReviewer}} へその観点を明示指示。必要なら
   専用 agent 化）。CRITICAL/HIGH を修正。
   **フォールバック**: `{{config:agents.*}}` が未設定（テンプレ既定）でも**この層を省略しない**。
   レビュー用エージェントが無ければ、同じ反証観点（gaming・セキュリティ）を自分でインラインに実施する。
   ただし自己レビューは独立レビューの代替として強度が劣る（同一コンテキストが自分の diff を
   判定するため adversarial independence が働かない）ことをレポートに正直に書き、独立レビューを
   有効化するには `specproof.config.yaml` の `agents:` ブロックを設定するようユーザーに案内する。
8. **`{{config:tags.slow}}`/`{{config:tags.generate}}`**: 実装はするが実行検証は委譲。「実装済み・smoke 緑・`{{config:tags.slow}}`
   未実行」を明示。
9. **レポート + 人間ゲート**: コミット/bless は人間（下記レポート様式）。

## 製品の変更を別のブランチに置く場合

`{{config:implement.productChanges}}` が未設定か `sameBranch` なら、製品の変更は E2E と同じブランチに置く
（この節は当てない）。それ以外の値（綴りの誤りを含む）なら推測せず、キー名と値を示して停止し、
どちらに置くかをユーザーに聞く。`separateBranch` は、E2E のブランチをマージせず、製品の変更を製品の既定ブランチから切った
別のブランチに置く運用で、テストされる画面は製品の既定ブランチから作られる。修正が取り込まれるまで E2E は
落ち続け、その間を `@red-contract` で表す。このときは手順 3 以降を次のように読み替える。

1. 製品のブランチの基点とブランチ名を人に確かめる（推測しない）。
2. 製品の変更は、そのブランチを checkout した別の作業ツリー（`git worktree add`）に書き、E2E のブランチには
   コミットしない。作業ツリーを作れない環境では、作るコマンドを示して人に作ってもらう。
3. blast radius（Safety rules）と製品の型検査・lint（`{{config:commands.productTypecheck}}` / `{{config:commands.productLint}}`）は、
   製品の作業ツリーで当てる。
4. smoke で GREEN を確かめられるのは、修正を含むビルドを `{{config:env.baseUrl}}` に用意できるときだけ。用意できなければ、
   対象のシナリオは「FAIL（想定どおりの RED: @red-contract N 件）」か SKIPPED(理由) と書き、GREEN と書かない。
   step の本体は手順 2 の RED の基準で、落ちる理由が feature の期待どおりかまで確かめておく。
5. 製品の変更が要ったシナリオ（手順 2 の FAIL）の `@red-contract` は、修正が製品の既定ブランチに取り込まれ、
   E2E を流して通るまで外す提案をしない（手順 2 で PASS したシナリオの提案はこれに縛られない）。
6. 製品のファイルの impl hash は、E2E のブランチにある製品のファイルから取る。修正が取り込まれて E2E のブランチに
   入るまで impl の drift は出ない。取り込み後の drift の bless は人が行う。
7. レポートは E2E の側と製品の側のブランチを分け、それぞれの変更ファイルと残り（製品の PR、取り込み後の再実行と
   `@red-contract` を外す提案）を書く。

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
- **③ 状態タグの変更を提案（適用せず）** — 現状自動で緑にできない観測仕様は、`@red-contract` のまま RED で残すか、
  人が確かめる `@human`、受け入れ条件から外す `@out-of-scope`（理由コメント必須）への変更を理由付きで
  提案する（specproof-bootstrap の3択と整合）。タグは自分で書き換えず、適用せず提案する。テストを一時的に止める提案はしない（そのためのタグは無く、
  `@skip` / `@fixme` / `@fail` は使えない）。
- **④ 部分実装＋残りを pending 明示** — 緑化できたシナリオは進捗として残し、残りは未完/
  なぜ止まったかを明記。pending step の stub body には `{{config:conventions.pendingStubBody}}` を使う。

## レポート様式（最終メッセージ内 Markdown）

- 実装ファイル一覧（step／page object／`{{config:layout.textConstants}}`／製品 impl を区別）。
  `separateBranch` なら E2E の側と製品の側のブランチを分けて書く
- 検証結果: bddgen（`{{config:commands.generate}}`）/ E2E typecheck（`{{config:commands.typecheck}}`）/
  E2E lint（`{{config:commands.lint}}`）/ 製品 typecheck（`{{config:commands.productTypecheck}}`）/
  製品 lint（`{{config:commands.productLint}}`）/ smoke（`{{config:commands.smoke}}`）を
  **PASS / FAIL / SKIPPED(理由)** で。製品側のキーが未設定なら「未検証（未設定）」と書く。
  **正直性契約**: env が無く smoke 未実行なら green と偽らない。E2E 側の検査を製品側の検証として報告しない。
  smoke の FAIL は「FAIL（想定どおりの RED: @red-contract N 件）」と「FAIL（実際の失敗: M 件）」を分けて書く。
  `@red-contract` が付いたまま通ったシナリオは「PASS（@red-contract のまま: K 件。外す提案あり）」と分けて書く。
- RED の基準（手順 2）: step の本体を書いた後・製品を変える前の PASS / FAIL の件数と、PASS したシナリオの一覧
  （「実装不要（既存の実装で満たす）」と、外す提案をする `@red-contract`）。FAIL のうち step の誤りで直したものは分けて書く。
- gaming 自己点検（①④）: 5項目（ハードコード／テスト入力特例分岐／assertion 骨抜き／入力バリエーション／
  基準で PASS した step の骨抜き）を項目別 OK/NG＋根拠1行で列挙。
- レビュー実施形態: **独立エージェント**（`{{config:agents.codeReviewer}}` 等）による反証レビュー／
  **自己レビューのみ（独立レビュー未実施）** のいずれかを必ず明記し、指摘と対応を記載。
- `{{config:tags.slow}}`/`{{config:tags.generate}}`: 「実装済み・未実行」リスト
- エスカレーション（あれば①〜④）
- 残: **impl 側 drift の bless**（製品 impl は traceability 追跡対象）・緑化したシナリオの `@red-contract` を
  外すこと（feature の変更）・コミット・full run は人間

## Safety rules

- **方向の不変条件**: `impl → feature` 再生成をしない。**feature 本文を黙って書き換えない**
  （修正は escalation ① の提案のみ）。人が決めたことを反映するコメントの更新は「feature のコメントの更新」の
  条件を満たすときだけ行い、レポートに挙げる（黙って変えない）。
- **状態タグを変えない**: 既存シナリオの `@red-contract` / `@human` / `@draft` / `@out-of-scope` を付けたり
  外したり付け替えたりしない。緑化したシナリオの `@red-contract` を外すことも含め、変更は escalation ③ や
  レポートの「残」で提案し、人が行う。状態タグを変えて落ちるシナリオを実行から外すのは gaming と同じ扱い。
- **独立性**: feature と impl を同一パスで共著しない（前提＝人著の RED feature）。
- **gaming 禁止**: ハードコード・テスト入力特例・assertion 骨抜きをしない。
- **blast radius**: 対象ドメインの範囲（`{{config:implement.blastRadiusGlobs}}`）に限定。横断/共有
  ファイルは**停止して提案のみ**。`implement.blastRadiusGlobs` が未設定なら、対象ドメインに対応する
  `{{config:layout.implGlobs}}` のファイル群を保守的な既定スコープとする。`{{config:implement.productChanges}}` が
  `separateBranch` なら、製品の変更は E2E のブランチに置かない（「製品の変更を別のブランチに置く場合」）。
- **自己修正2回上限**、超えたら停止報告。**テストが落ちた状態でコミットしない**（`@red-contract` のシナリオの RED は想定どおり。それ以外の失敗は 1 件でもコミットを止める）。`{{config:tags.slow}}`
  未実行を明示。
- `{{config:layout.stepFileExt}}` ファイルに画面の文言（UI 文字列）を直接書かない（UI 文字列は `{{config:layout.textConstants}}` 定数）。
  step の文は feature と同じ `{{config:language}}` で書く。
- **人間ゲート省略不可**（コミット/bless は人間）。製品コードは `{{config:agents.securityReviewer}}` 必須。
- `{{config:layout.testRunnerConfig}}` のプロジェクト構成（{{config:projects}}）に整合しないタグの
  シナリオを緑化対象にしない。
- **環境 excludeTags**: アクティブ環境プロファイルの `excludeTags` に含まれるタグを持つシナリオは
  当該環境では skip されるため、緑化対象にしない。
  smoke 実行時の `SPECPROOF_ENV` を確認し、対象シナリオが実行される環境で検証すること。
- 認証プロバイダ（`{{config:auth.provider}}`）の制約（`{{config:auth.description}}`）を踏まえて
  認証シナリオのステップを実装すること。認証プロバイダはアクティブ環境プロファイルに
  よって異なる場合がある（例: local=mock, dev=Google OAuth）。実装は現在のアクティブ環境の
  プロバイダに合わせつつ、環境固有の分岐が必要な場合はその旨をレポートに明記する。
- step framework pattern: `{{config:conventions.stepFrameworkPattern}}`（`{{config:layout.stepsDir}}` 内の step ファイルは
  `*{{config:layout.stepFileSuffix}}` の命名規約に従う）。

## フロー上の位置（`{{config:layout.e2eReadme}}`「変更起点別フロー」）

- **① spec-first**: `/specproof-new-feature` or `/specproof-sync` で feature+stub → **`/specproof-implement`** で緑化 → bless
- **② feature-first**: 人が feature 編集 → **`/specproof-implement`** で緑化 → bless

`specproof-sync`（drift → feature。期待値は spec から導出し、impl を生成元にしない）とは**反対方向**。混同しないこと。詳細は
`{{config:layout.e2eReadme}}`「変更起点別フロー」「bootstrap は一度きり・実装変更後の追従経路」節。

## 設定解決の境界

適用する adapter と手順が参照する設定だけを解決する。未設定の必須値・存在しない参照先は
キー名と必要な編集を示して停止し、consumer 固有値を推測しない。

`agents` は未設定時のインライン自己レビューという明示済み fallback を使用できる。
`conventions.i18nLintPlugin: none` は専用 plugin がないという明示値であり、検査成功を意味しない。
`examples` は説明用の例であり、実際の仕様・既存ファイルの存在を保証しない。
Flutter の `projects` / `env` / `environments` は skill 用の宣言で、Dart runner へ自動注入されない。
