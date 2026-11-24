# specproof.config.yaml スキーマリファレンス

日本語 | [English](./config-schema_en.md)

consumer リポのルートに置く 1 枚の設定ファイル。specproof-* skill は実行時にこれを読み、
プロンプト内の `{{placeholder}}` を実値へ解決する。これにより skill 本体（SKILL.md）は
リポ非依存になり、Claude Code plugin として無改変配布できる。

正準の worked example は `templates/playwright/specproof.config.yaml`。

## 設計原則

- adapter は「コードの interface」ではなく「config が供給する capability の束」。
  skill は Markdown プロンプトで `implements` できないため、宣言的設定で適合する。
- framework 固有差（playwright vs flutter）は `adapter` と `commands` / `flutter` に局所化。
- traceability エンジン（`@pound79/specproof-traceability`）は共通のハッシュ規則を使う。feature の解析規則は `adapter` に応じて選び、設定から走査範囲・strict 判定・仕様の取り込み元も読む。

## トップレベルフィールド

traceability エンジンが読むキー（`layout.manifest` / `pagesDir` / `featuresDir` /
`candidateSuffix` / `implGlobs`、`strict*`）は型を検証する。
キーの省略と空の値は既定値を使い、値があるのに型が違う場合（`implGlobs` に文字列、
`strictUnregisteredImpl: "true"`、空文字列など）はエラーで止まる。
設定したつもりの監査が、型違いで黙って無効になることを防ぐため。

設定ファイルはリポジトリのルートの `specproof.config.yaml`（または `.yml`）で、1 MiB 以下の
通常ファイルでなければエラーで止まる。改名前の `bdd-kit.config.yaml` / `.yml` は 0.4.0 から読まず、
ルート（またはルートを探して親へたどる途中の、目印の無いディレクトリ）に旧名だけがあれば、名前の変更を
案内して止まる。エンジンが読まないキー（skill だけが読むキーを含む）の値の型は検証しない。
どの consumer も読まないキー（綴りの誤りなど）は `specproof-check` が警告 `unknown-config-key` を出し、
`--strict` で失敗する（[未知のキー](#未知のキー)）。`layout` と `tags` は mapping でなければエラーになり、
`tags.fixme` / `tags.skip` は書いてあるだけでエラーになる。`adapter: flutter` のとき、`language` はエンジンが読める `en` / `ja` の
どちらかにする（それ以外は feature を読む段でエラーになる）。

| フィールド | 要否 | 説明 |
|---|---|---|
| `adapter` | required | `playwright` \| `flutter`。framework 分岐キー。traceability は `flutter` のとき feature を Flutter の runner（Dart の gherkin）と同じ規則で読む。 |
| `bddRunner` | required | BDD フレームワーク識別子（例 `playwright-bdd`）。 |
| `bddGenTool` | required | 生成ツール名（ログ表示用、例 `bddgen`）。 |
| `language` | required | Gherkin 方言（Cucumber i18n ロケール、例 `ja`）。キーワード集合はここから導出。 |
| `strictUnregisteredImpl` | optional（既定 `false`） | `true` のとき、`unregistered-impl` 警告も他の warning と同様に `--strict` で失敗扱いになる。既定では `--strict` を付けても `unregistered-impl` は失敗させない（`layout.implGlobs` の粒度次第でノイズになりやすいための opt-in）。 |
| `strictFeatureLint` | optional（既定 `false`） | `true` のとき、`missing-then`・`step-order`・`duplicate-scenario-name`・`duplicate-scenario` 警告を `--strict` で失敗扱いにする。既存のスイートを壊さないための opt-in。`possible-contradiction` は人が判断する候補なので、`true` でも失敗させない。 |
| `strictUnregisteredSpecHeadings` | optional（既定 `false`） | `true` のとき、`unregistered-spec-heading` 警告も他の warning と同様に `--strict` で失敗扱いになる。既定では `--strict` を付けても失敗させない（登録済み spec ファイルに限定しても、改訂履歴・用語集などリンク対象外の見出しが同居する実運用でノイズになりやすいための opt-in）。 |

## commands

skill（AI エージェント）はこれらのコマンドをリポ**ルートから** `cwd` を変えずに実行する
（specproof の CLI とエンジンはこれらを実行しない。他人のブランチで skill を走らせる前に差分を
確かめる: [セキュリティモデル](security-model.md#読み書きする範囲信頼境界)）。
`e2eRoot` がリポ直下でない場合（playwright の既定 `packages/e2e` 等）、コマンド文字列
自体に `cd <e2eRoot> && ...` を含めること — `specproof init` は repo root の
package.json に workspaces を注入しないため、`npm run <script>` を裸で書くと
`Missing script` で失敗する。

| キー | 要否 | playwright 例 |
|---|---|---|
| `generate` | required | `cd packages/e2e && npm run bddgen` |
| `typecheck` | required | `cd packages/e2e && npm run typecheck`（E2E パッケージの型検査） |
| `lint` | required | `cd packages/e2e && npm run lint`（E2E パッケージの lint） |
| `productTypecheck` | optional | `npm run typecheck`（製品コードの型検査。未設定なら implement は「製品側は未検証」と報告する） |
| `productLint` | optional | `npm run lint`（製品コードの lint。未設定時の扱いは同上） |
| `smoke` | required | `cd packages/e2e && npm run test:smoke` |
| `install` | optional<sup>+</sup> | `npm ci` |
| `traceabilityUpdate` / `traceabilityCheck` / `traceabilityList` / `traceabilityStats` | optional | `npx -y -p @pound79/specproof-traceability specproof-*` |

## layout（リポルート相対パス）

パスはリポジトリのルートからの相対で書く。エンジンは `manifest`・`pagesDir`・`featuresDir` と
`implGlobs` の走査の起点が、字句と実体（symlink の解決先）の両方でルートの内側に解決できることを確かめ、外側を指す・
リンクが切れているときはエラーで止まる（[セキュリティモデル](security-model.md#読み書きする範囲信頼境界)）。

| フィールド | 要否 | 説明 |
|---|---|---|
| `e2eRoot` | required | E2E パッケージ root |
| `featuresDir` | required | `.feature` 置き場。未設定だと `specproof-check` は登録していない `.feature` を走査できず、警告 `features-dir-unset` を、指す先が存在しない・ディレクトリでないと `features-dir-missing` を出す（どちらも `--strict` で失敗） |
| `stepsDir` | required | step 定義 dir |
| `stepFileSuffix` | optional<sup>+</sup> | step ファイル命名規約（`.steps.ts`）。glob 誤爆防止。 |
| `stepFileExt` | required | step ファイル言語拡張子（`.ts`） |
| `pagesDir` | required | page object dir |
| `candidateSuffix` | optional | `specproof-list` が未追跡ページを検出するファイル名 suffix。**既定値 `"Page.tsx"`（React/Playwright 前提）**。この既定はフレームワークによっては何にもマッチせず検出が常に 0 件になりうるため（例: Flutter の `.dart` ファイル）、`pagesDir` 配下の実ファイル命名規約に合わせて明示的に設定することを推奨。playwright テンプレートの POM（`LoginPage.ts` 等）も既定値とは拡張子が食い違うため、テンプレートにコメントで明記している。 |
| `textConstants` | required | UI 文字列定数（mirror） |
| `i18nSource` | optional<sup>+</sup> | text.ts の上流 i18n source（`ja.yaml`） |
| `manifest` | required | traceability manifest path |
| `specDir` | required | 設計根拠 doc dir |
| `implGlobs` | optional | `unregistered-impl` 検知（`specproof-check`）の対象を絞る glob リスト（`*` / `**` のみ対応の自前マッチャー）。**未設定時は検知自体を行わない**（opt-in）。重複を除いて最大 256 本、1 本あたり 1,024 文字まで。超えると照合前にエラーで止まる。 |
| `implExcludeGlobs` | optional | `implGlobs` に当たるファイルのうち、`unregistered-impl` から外すものの glob リスト（書き方と上限は `implGlobs` と同じ。例: `"**/__tests__/**"`）。外した件数は `specproof-check` の出力に 1 行で出し、`--json` では `excludedAdvisories.unregisteredImpl`。登録済みの参照の drift には影響しない。`specproof init` は、検出したフレームワークの典型（Playwright: `**/__tests__/**`・`**/__mocks__/**`・`**/*.test.*`・`**/*.spec.*`、Flutter: `**/*_test.dart`・`**/*.g.dart`・`**/*.freezed.dart`・`**/*.mocks.dart`）を書く。テストや生成物らしいファイル（`*.test.*`・`*.spec.*`・`__tests__/`・`__mocks__/`・`*_test.dart`・`*.g.dart`・`*.freezed.dart`・`*.mocks.dart`）の `unregistered-impl` は、このキーで外していなくても、`specproof-check` のテキスト出力と注釈の一覧には既定で出さず、件数とこのキーの案内を 1 行で出す（`--include-tests` で一覧に出す。`--json` と終了コード、`strictUnregisteredImpl: true` で `--strict` の失敗の理由になるときは変えない）。`--include-tests` を付け、このキーが未設定で、そうしたファイルが 5 件以上あれば、これまでどおりこのキーを 1 行案内する。このキーは名前の形だけで外すので、`strictUnregisteredImpl: true` で固めるときは範囲を見直す（`docs/security-model.md` の「drift のゲートが保証しないこと」）。 |
| `specHeadingIgnore` | optional | `unregistered-spec-heading` から外す対象のリスト。`"<path>"` はそのファイルの見出しすべて、`"<path>#<見出し>"` は 1 つの見出し（最初の `#` で分ける）。役割の一覧・用語・改訂履歴など操作でない構成の見出しに使う。外した件数は出力に 1 行で出し、`--json` では `excludedAdvisories.unregisteredSpecHeading`。登録済みの見出しの drift と `duplicate-heading` には影響しない。 |
| `scratchDir` / `testRunnerConfig` / `idiomGuide` | optional | 補助参照 |
| `e2eReadme` | optional | E2E パッケージの README パス。specproof-bootstrap / specproof-implement skill が `{{config:layout.e2eReadme}}` として参照する。**同梱の playwright / flutter テンプレートはこのパスに実体の README.md を同梱済み**（変更起点別フロー・bootstrap 一度きりの規約・rationale doc 規約などの節を含む。見出しは playwright が英語、flutter が日本語）。カスタムテンプレートを組む場合もこの節を持つ README を配置すること。 |

## fixtures<sup>+</sup>

page object fixture 名 -> POM ファイルの map。skill が step skeleton の fixture
destructuring を生成するとき解決する（`mainOperationPage` 以外の fixture 名が
素の config では欠落していた、という検証指摘への対応）。

page object を持たない構成（`fixtures: {}`、または world・認証など page object でない fixture だけ）も
そのまま書いてよい。その場合 skill は新しい page object を持ち込まず、既存の steps の書き方に倣う
（生成ガイド `prompts/system.md` の「step 実装との対応」）。

## tags / projects / env / environments / implement / git / agents / conventions / examples

| ブロック | 要否 | 要点 |
|---|---|---|
| `runner` | optional | Playwright テンプレートの実行設定。`device`（既定 `Desktop Chrome`）/ `webServerCommand` / `globalTeardown` / `i18nLocaleStorageKey`。 |
| `tags` | required（slow/generate/admin/user） | Gherkin タグ正準名。状態タグ（`@draft` / `@red-contract` / `@human` / `@out-of-scope`）は固定で、ここでは設定しない。実行を止めるタグに別名を付ける設定になるので、`tags.fixme` / `tags.skip` を書くと読み込みが失敗する（理由は [ADR 0009](./adr/0009-retire-fixme-skip.md)）。`tags.slow`（既定 `@slow`）は smoke が除外する単一のタグで、状態タグは指定できない。Playwright の `test:smoke` は環境変数 `SPECPROOF_SMOKE=1` で smoke と判定し、`tags.slow` をタグ式で除外する（npm スクリプトを介さず `bddgen` と `playwright` を直接起動して smoke として実行するなら、両方に `SPECPROOF_SMOKE=1` を付ける。除外は生成時にも効く）。使える値はアダプターで異なる。Flutter（`tool/smoke.dart` の検証 `^@\w[^@()&\s\\]*$`）は `@` の直後が ASCII の英数字か `_` で、`&`・括弧・空白・2 つ目の `@`・バックスラッシュを含まないタグだけを受け付ける。Playwright は空白・括弧・2 つ目の `@`・バックスラッシュを含むタグを拒否する。例えば `@長時間` は Playwright では使えるが Flutter では使えない。 |
| `projects[]` | required | ランナープロファイル。`name` + `tags` + `features`<sup>+</sup>（feature 限定）+ `conditional`<sup>+</sup>。Playwright テンプレートは `storageState` / `setup` / `credentialsEnv`（`username` / `password` / `newPassword`）も読む。`tags` には状態タグに触れる式と括弧の対応が取れていない式を書けない（Playwright テンプレートの設定読み込みがエラーにする）。 |
| `env` | required（baseUrl） | 環境変数の論理名。`adminUsername`<sup>+</sup> は authed-admin の条件判定。 |
| `environments[]` | required（1エントリ以上） | 実行環境プロファイル。環境別の auth / dotenv / excludeTags を宣言。詳細は後述。 |
| `implement`<sup>+</sup> | optional | `blastRadiusGlobs` = specproof-implement の編集許可スコープ（implGlobs とは別概念）。`productChanges` = 製品の変更を置く場所。`sameBranch`（既定。E2E と同じブランチ）か `separateBranch`（E2E のブランチはマージせず、製品の変更は製品の既定ブランチから切った別のブランチに置く）。`separateBranch` の扱いは specproof-implement の「製品の変更を別のブランチに置く場合」。エンジンは読まない（skill だけが読む）。 |
| `git`<sup>+</sup> | optional | `commitScope` / `branchPrefix`。specproof-sync 自動コミット用。 |
| `agents`<sup>+</sup> | optional | `codeReviewer` / `securityReviewer` の識別子。 |
| `conventions` | optional | `agentsDoc` / `i18nLintPlugin` / `stepFrameworkPattern` / `pendingStubBody`。 |
| `examples` | optional | `domainName` / `specDoc`<sup>+</sup> / `internalConstants`。 |
| `specSources[]` | optional | 写した仕様の取り込み元。下の [specSources](#specsources)。 |

## specSources

別のリポジトリにある仕様を、利用側のスクリプトで `layout.specDir` などに写しているときに、取り込んだコミットを
記録し、取り込み元が先に進んだら check で知らせる。取り込み自体は利用側のスクリプトが行い、specproof の CLI は
実行しない。

```yaml
specSources:
  - name: permissions                 # 必須。128文字以内。先頭は半角英数字、以降は半角英数字と . _ -
    repo: ../backend                  # 必須。取り込み元のチェックアウト（ルート相対か絶対）
    ref: origin/develop               # 必須。比べる ref（リモートのブランチ・ブランチの名前、refs/ で始まる完全な名前、commit id）
    paths: [config/permissions]       # 任意。取り込み元の中で比べるパス（省略時はリポジトリ全体）
    specDir: docs/specs/permissions   # 任意。写した先（警告の場所と skill の案内に使う）
    importCommand: scripts/import-permissions.sh  # 任意。skill だけが読み、人の確認を得てから実行する
```

- `ref` の解決: 40 桁（SHA-256 のリポジトリなら 64 桁）の commit id はそのコミットを使う（大文字でもよく、記録は小文字にそろえる。git は桁数がリポジトリの
  形式と合わない hex を名前として探すので、解決した id が書いた値を小文字にしたものと同じときだけ使う。40・64 桁の
  hex だけの名前のブランチは commit id として扱うので、`refs/heads/<名前>` と書く）。`refs/` で始まる完全な
  名前はその ref だけを読む。それ以外の名前は `refs/remotes/<ref>`、`refs/heads/<ref>` の順に、名前が完全に
  一致する ref だけを読み、どちらも無ければ解決できないものとして扱う。タグは `refs/tags/<名前>` と書いたときだけ
  読み、短い名前をタグとして解決しない（git の名前の探索は `refs/tags/<名前>` を `refs/heads`・`refs/remotes` より
  先に読むので、取り込み元に push できる人が同じ名前のタグを置くと、記録も比べもそのタグのコミットになる。fetch は
  既定でタグも取ってくる）。`HEAD`・短縮したコミット id・`heads/<名前>`・`tags/<名前>` の形も解決しない
- 記録: 取り込んだ後に `specproof-update --record-spec-source <name>` を実行すると、`repo` で `ref` が指すコミットを
  manifest の `specSources.<name>` に書く（hash は更新しない。`--dry-run` も使える）。記録するのは ref が指す
  コミットで、取り込みのコマンドが実際に写した中身を確かめるものではない。読んだ取り込み元の絶対パスを出すので、
  取り込んだものと同じかを確かめる。取り込み元が無い・`ref` を解決できない・`paths` が今の ref に無いときは
  何も書かずに失敗する。手元の ref を読むだけで、fetch しない（先に `git -C <repo> fetch` する）
- HEAD との比べ: 記録の前に、`repo` の HEAD のコミットと `ref` のコミットで `paths`（省略時はリポジトリ全体）の中身を
  （ファイルの mode を含めて）比べ、違えば何も書かずに失敗する（`--dry-run` でも）。取り込みのコマンドが
  作業ツリーから写していて、取り込み元が別のブランチのままだと、記録（ref）と写した中身が食い違うため。HEAD が別のブランチでも `paths` の中身が同じなら
  記録する。取り込みのコマンドが ref から読む形（下）で、HEAD が違っても構わないときは `--allow-head-mismatch` を
  付ける（違うことを出力に残して記録する）。作業ツリーは読まないので、コミットしていない変更は見つけない
- 取り込みのコマンドは、作業ツリーでなく `ref` から読む形にするとよい。ただし作業ツリーから写すときに git の
  checkout が行うパスの検証と、CLI が git に掛けている制限は効かなくなるので、取り込みのコマンドの側で次を守る
  （`repo` は PR で変えられ、取り込みは `--record-spec-source` の確かめより前に走る）。
  - 写す前に `specproof-update --record-spec-source <name> --dry-run` を流し、成功することを確かめる（manifest は
    変えない）。取り込み元が読める（実体の `.git`・自分が持ち主・部分 clone でない）こと、`ref` を解決できること、
    `paths` が `ref` にあることを、記録が無い初回でも確かめ、どれかが欠ければ失敗する。`specproof-check
    --spec-sources` は記録が無い・取り込み元を読めないときも成功で終わるので、この確かめには使えない。取り込みが
    `ref` から読む形で HEAD が `paths` の中で違うときは、そのことを確かめてから `--allow-head-mismatch` を付ける
  - git は CLI と同じ制限で起動する: `--git-dir=<repo>/.git` を明示し、環境変数 `GIT_NO_LAZY_FETCH=1`・
    `GIT_NO_REPLACE_OBJECTS=1` を付け、`-c protocol.allow=never` と内蔵の transport ごとの
    `-c protocol.<名前>.allow=never` を渡す（部分 clone の足りないオブジェクトを取りに行かせない。取りに行くと、
    取り込み元の設定に書かれたコマンドが動きうる）
  - 最初にコミット id を 1 度だけ決め、以後はその id を使う（途中で ref が動いても、ほかのコミットの中身を混ぜない）。
    その id を出力すると、記録した値と照らせる。決め方は CLI と同じ上の「`ref` の解決」にそろえ、`rev-parse` に
    `<ref>` を直接渡さない（短い名前は同じ名前のタグが先に読まれ、`refs/remotes/<ref>` のような完全な名前も、
    その ref が無ければ `refs/tags/refs/remotes/<ref>` などへ落ちる）。
    - 短い名前: `git --git-dir="$repo/.git" for-each-ref --format='%(objectname) %(refname)' --
      "refs/remotes/$ref" "refs/heads/$ref"` の出力から、`%(refname)` が候補の文字列と完全に一致する行を、
      この順に選ぶ。名前は前方一致で当たる（`refs/remotes/origin/feat` で `refs/remotes/origin/feat/x` も出る）ので、
      行の有無でなく ref 名の一致で選ぶ。一致する行が無くても終了コードは 0 なので、そのときは失敗にする
    - `refs/` で始まる完全な名前: 同じ形で、その名前 1 つだけを引いて完全一致で選ぶ
    - 選んだ id を `rev-parse --verify "$id^{commit}"` でコミットにする
    - commit id（40・64 桁の hex。大文字小文字を区別せずに判定する）: 小文字にした値（`tr 'A-F' 'a-f'` など）を
      `rev-parse --verify "$id^{commit}"` に渡し、返った id がその値と同じときだけ使う
  - `ls-tree -r -z <コミット id> -- <paths>` で mode も読み、通常のファイル（`100644`・`100755`）だけを写す。
    シンボリックリンク（`120000`）と submodule（`160000`）は写さない。パスに `..`・`.git`（大文字小文字を区別せずに比べる）・空の成分があれば、
    書き出す前に止める（細工した tree は、取り込み先の外を指すパスを持てる）
  - 中身は `cat-file blob <blob の id>` で読む（`--filters`・`--textconv` を付けない限り、フィルタや属性を当てない）。
    `git archive` は属性（`export-subst` など）を当てるので向かない
- 確かめ: `specproof-check --spec-sources` は、記録したコミットと今の `ref` の間で `paths` の中身（ファイルの mode を
  含む）が違えば
  `spec-source-outdated` を、今の `ref` に `paths` のどれかが無ければ（書き誤り・取り込み元での移動）同じ種類で
  そのことを、記録が無ければ `spec-source-unrecorded` を参考の警告として出す。警告を出さずに飛ばすのは、`repo` の
  パスが無いとき（取り込み元を checkout していない PR の CI など）だけ（記録が無いことは manifest だけで分かるので、
  そのときも `spec-source-unrecorded` は出す）。パスはあるのに確かめられないときは、`spec-source-unresolved` を
  参考の警告として 1 行出し、理由と直し方を添える: `repo` を取り込み元として読まない（実体の `.git` が無い・自分が
  持ち主でない・`git worktree` の作業ツリー・部分 clone。どれに当たったかは分けず、下の `repo` の条件を案内する）、
  `ref` を解決できない（調べた ref の名前と、タグは `refs/tags/<名前>` と書くこと）、記録したコミットが取り込み元に
  無い（fetch していない・浅い clone・履歴の書き換え。履歴ごと fetch する）、git が途中で読めない（壊れた clone・
  中身の無い `.git` など。clone として正しいかを確かめる）。パスは設定に
  書いた `repo` の値で出す。
  どれも `--strict` でも失敗しない。`--json` には全体に
  `specSources: [{ name, status, recorded, current, missingPaths, reason }]` を足す（`status` は `current` / `outdated` /
  `path-missing` / `unrecorded` / `unavailable`。`reason` は `unavailable` のときだけで、`source-missing`（警告なし）/
  `source-unreadable` / `ref-unresolved` / `recorded-missing` / `read-failed`）
- `--spec-sources` を付けないと、check は取り込み元を読まず、出力も変えない。`repo` は設定の値なので PR で変えられる。
  PR の CI（既定のワークフロー）で、PR が指すディレクトリの git を起動しないための opt-in で、手元や取り込み元を
  checkout したジョブで付ける
- `repo` は取り込み元のチェックアウトのルートにする。直下に実体の `.git` ディレクトリ（シンボリックリンク・ファイル
  でない）があり、自分が持ち主で、部分 clone でないときだけ読む（サブディレクトリ・`git worktree` の作業ツリー・
  submodule・bare リポジトリ・部分 clone は使えない）。`git worktree` の作業ツリーを使えないのは、その `.git` が
  別の git ディレクトリを指すファイルで、設定やオブジェクトを共有の git ディレクトリ（`commondir`）から読むため。
  持ち主を確かめているのは `<repo>/.git` だけなので、`repo` の値（PR で変えられる）から `commondir` の先の別の
  git ディレクトリの設定（CLI がコマンドラインで上書きしていない残りの設定）を読ませると、「自分が持つディレクトリの
  設定だけを読む」前提が崩れる（`include.path` や `objects/info/alternates` のように、実体の `.git` からでも別の
  場所を読む設定は、この確かめでは防いでいない）。別のブランチの中身を写したいときは、worktree を作らず、上の
  ref から読む形にする。
  読むときは `--git-dir` で明示し、transport を禁じ、外部のプログラムを起動しない設定で `git config --null --list`
  （部分 clone の判定）/ `git for-each-ref`（`ref` の完全な名前での引き当て）/ `git rev-parse` / `git ls-tree` だけを実行する。`paths` に `.` を含めばリポジトリ全体を比べる。`importCommand` は CLI では実行しない
- manifest の `specSources` は、名前も値も引用した `"<name>": "<commit>"` の形で書く（数値や真偽値に見える名前も
  文字列として扱う）

## 未知のキー

`specproof-check` は、設定ファイルにあってどの consumer（traceability エンジン・skill・テンプレートの
設定読み込み）も読まないキーを、警告 `unknown-config-key` で 1 件ずつ知らせる。綴りを誤ったキー
（`layout.featureDir`、`strictUnregisteredImp` など）は黙って既定値に落ち、設定したつもりの監査や
コマンドが効かないため。ほかの構造の警告と同じく `--strict` で失敗する（opt-out の設定は無い）。
メッセージはキーの経路（`layout.featureDir`、`projects[0].tag`、識別子でないキーは
`["a b"]` のように引用する）だけを示し、値は出さない。100 件を超えると走査を止め、最初の 100 件と、
超えたことを示す 1 件（`truncated: true`）を出す。テキストと annotation に出すのは 20 件までで、超えたことを
示す 1 件は必ず出す（`--json` は全件）。メッセージのキーの経路は 200 文字で切り詰め、末尾に `…` を付ける。`specproof-update` / `list` / `stats` は
この警告を出さない。

検査の深さの規則: consumer がキーの名前を決め打ちで読む mapping は、キーの集合を固定して検査する。
キーの名前を利用者が決める mapping は中を見ない。値が mapping・配列でないとき（型違い）は
中を見ない（エンジンが読むキーの型はエンジンが、テンプレートが読むキーはテンプレートが確かめる）。

| 範囲 | 既知のキー |
|---|---|
| トップレベル | `specSources` / `adapter` / `bddRunner` / `bddGenTool` / `language` / `commands` / `layout` / `fixtures` / `tags` / `projects` / `env` / `environments` / `implement` / `git` / `agents` / `conventions` / `examples` / `runner` / `flutter` / `strictUnregisteredImpl` / `strictUnregisteredSpecHeadings` / `strictFeatureLint` |
| `commands` | `generate` / `typecheck` / `lint` / `productTypecheck` / `productLint` / `smoke` / `install` / `traceabilityUpdate` / `traceabilityCheck` / `traceabilityList` / `traceabilityStats` |
| `layout` | `e2eRoot` / `featuresDir` / `stepsDir` / `stepFileSuffix` / `stepFileExt` / `pagesDir` / `candidateSuffix` / `textConstants` / `i18nSource` / `manifest` / `specDir` / `implGlobs` / `implExcludeGlobs` / `specHeadingIgnore` / `scratchDir` / `testRunnerConfig` / `idiomGuide` / `e2eReadme` |
| `projects[]` の各要素 | `name` / `tags` / `features` / `storageState` / `setup` / `conditional` / `credentialsEnv` |
| `projects[].credentialsEnv` | `username` / `password` / `newPassword` |
| `environments[]` の各要素 | `name` / `default` / `dotenvFile` / `auth` / `excludeTags` / `envOverrides` / `allowInsecureHttp` |
| `environments[].auth` | `provider` / `description` |
| `specSources[]` の各要素 | `name` / `repo` / `ref` / `paths` / `specDir` / `importCommand` |
| `implement` | `blastRadiusGlobs` / `productChanges` |
| `git` | `commitScope` / `branchPrefix` |
| `agents` | `codeReviewer` / `securityReviewer` |
| `conventions` | `agentsDoc` / `i18nLintPlugin` / `stepFrameworkPattern` / `pendingStubBody` |
| `examples` | `domainName` / `specDoc` / `internalConstants` |
| `runner` | `device` / `webServerCommand` / `globalTeardown` / `i18nLocaleStorageKey` |
| `flutter` | `gherkinParser` / `testEntry` / `device` / `buildRunnerPin` / `buildYamlSources` / `traceabilityHashSource` |

中を見ない（名前を利用者が決める）mapping: `fixtures`（フィクスチャ名）、`tags`（タグの正準名。
`tags.sf` のような任意のタグを足せる。`tags.fixme` / `tags.skip` は従来どおりエラー）、`env`
（環境変数の論理名。`projects[].conditional: env.<名前>` が任意の名前を参照できる）、
`environments[].envOverrides`（環境変数名）。

廃止したキー（`runner.authDir` など）と、過去の検討資料（`docs/history/`）にだけ現れるキーは既知に
含めない。既知のキーを増やすときは、この表と `packages/traceability/src/config-keys.ts` を同時に更新する。

## environments（required — 1 エントリ以上）

実行環境（local / dev / staging 等）ごとに異なるテスト挙動を宣言的に定義する。
**最低 1 エントリが必須。** 単一環境のリポでも `[{name: local, default: true}]` を記載する。

認証プロバイダ（`auth.provider` / `auth.description`）は `environments[]` 内にのみ定義する。
トップレベル `auth` は存在しない（環境プロファイルが認証の唯一の定義場所）。

### 設計原則

- **認証ロール軸（`projects[]`）と環境軸（`environments[]`）は直交する。**
  `authed` × `local`（mock auth）/ `authed` × `dev`（Google OAuth）の組み合わせは
  `projects[]` を複製せずに `environments[]` で吸収する。
- **`SPECPROOF_ENV` 環境変数**でアクティブプロファイルを選択する。
- **`{{config:auth.provider}}` トークンはアクティブ環境プロファイルの `auth.provider` に解決される。**

### 選択ルール

1. `SPECPROOF_ENV` が設定されている → 一致する `name` のエントリを使用。不一致時はエラー。
2. 未設定 → `default: true` のエントリ。複数ある場合は先頭。
3. `default: true` もない → `environments[]` の先頭エントリ。

改名前の環境変数 `BDD_KIT_ENV` は 0.4.0 から読まない。`SPECPROOF_ENV` が無く `BDD_KIT_ENV` だけが
設定されていれば、既定の環境で黙って走らせず、`SPECPROOF_ENV` への変更を案内して止まる。

### フィールド

| フィールド | 型 | 要否 | 説明 |
|---|---|---|---|
| `name` | string | required | 環境名（`local` / `dev` / `staging` / `prod` 等）。`SPECPROOF_ENV` の値と照合する。 |
| `default` | boolean | optional | `SPECPROOF_ENV` が未設定のときに使うプロファイル。1 つだけ `true` にする。 |
| `dotenvFile` | string | optional | この環境で読む dotenv ファイルパス（e2e パッケージルート相対）。省略時は `.env`。 |
| `auth` | object | optional | この環境の認証設定。 |
| `auth.provider` | string | optional | 認証プロバイダ識別子（`mock` / `google` / `email-password` / `saml` 等）。 |
| `auth.description` | string | optional | 認証方式の人間向け説明。スキルがシナリオ実装時に参照する。 |
| `excludeTags` | string[] | optional | この環境で除外するタグのリスト。ランナーがフィルタに使い、スキルが skip 判定に使う。各要素は単一のタグ（`/^@[^@\s()]+$/`）に限り、状態タグ（`@draft` / `@red-contract` / `@human` / `@out-of-scope`）は書けない（Playwright テンプレートの設定読み込みがエラーにする）。 |
| `envOverrides` | Record\<string, string\> | optional | dotenv 読み込み後に追加注入する環境変数。shell 既設定値は上書きしない。 |
| `allowInsecureHttp` | boolean | optional | `true` のときだけ、この環境で loopback 以外のホストへの `http://` の baseURL に認証情報を送ってよい。既定（未設定・`false`・真偽値の `true` 以外）は止める。Playwright テンプレートだけが読む。0.5.0 で追加。詳細は後述。 |

#### `environments[].allowInsecureHttp`

Playwright テンプレートは baseURL（`env.baseUrl` が指す環境変数の値）を確かめる。設定ファイルの
`projects[]` のうち `conditional` を満たすもののどれかが認証情報を使う（`setup: true`・`credentialsEnv`・
空でない `storageState` のどれかを持つ）とき、`playwright.config.ts` の読み込みでブラウザを起動する前に
確かめ、auth setup もログインの前にもう一度確かめる。判定は設定ファイルの project で行い、CLI の
`--project` で選んだものではない（`authed` を持つ設定で `--project guest` だけを走らせても確かめる）。
`http://` で、ホストが loopback（`localhost`・`*.localhost`・`127.0.0.0/8`・`::1`）でなければ、選ばれた
環境プロファイルに `allowInsecureHttp: true` が無い限り、認証情報を送らずに失敗する。`localhost.`
（末尾のドット）・`[::ffff:127.0.0.1]`・`0.0.0.0` は loopback とみなさない。`https://` と loopback への `http://` はこの設定に関係なく通り、
`http://` でも `https://` でもない scheme はこの設定があっても止める。https を用意できない環境だけで、
その `environments[]` エントリに明示して許可する。許可はホストではなく環境に結び付くので、許可した環境では
どの http のホストも通る。確かめるのは baseURL だけで、リダイレクト先やコードで直接指定した別の URL は
見ない。

```yaml
environments:
  - name: staging
    dotenvFile: ".env.staging"
    allowInsecureHttp: true   # この環境だけ平文の http を許す
```

`environments[]` のエントリに書けるキーは、上の表の `name`・`default`・`dotenvFile`・`auth`・`excludeTags`・
`envOverrides`・`allowInsecureHttp` である。Playwright テンプレートの設定の読み込みは未知のキーを検査しない
（書き間違えたキーは黙って無視される）。traceability エンジンが設定の未知キーを検査するときは、この一覧を
`environments[]` の既知のキーとする。

### 例

```yaml
environments:
  - name: local
    default: true
    dotenvFile: ".env.local"
    auth:
      provider: mock
      description: "ローカル開発用モック認証。実 IdP への通信なし。"
    excludeTags:
      - "@google-auth"
      - "@requires-real-smtp"

  - name: dev
    dotenvFile: ".env.dev"
    auth:
      provider: google
      description: "Firebase Auth (Google) — dev project。"
    excludeTags: []

  - name: staging
    dotenvFile: ".env.staging"
    auth:
      provider: google
      description: "Firebase Auth (Google) — staging。本番同等の IdP 設定。"
    excludeTags:
      - "@destructive"
```

### 直交性: environments × projects × tags

```
environments[]  — 実行環境軸（local/dev/staging）  → SPECPROOF_ENV で選択
projects[]      — 認証ロール軸（authed/admin/guest）→ tags + conditional で選択
tags            — シナリオ属性軸（@slow/@admin 等）  → ランナーがフィルタ
```

`excludeTags` は環境軸から tags 軸へのフィルタ。例: local 環境では `@google-auth` を除外。
状態タグの扱いは環境によらず固定で、runner のテンプレートは `@draft` / `@human` / `@out-of-scope` を常に除外し、
`@red-contract` はテンプレートの絞り込みでは除外しない。ただし `@red-contract` のシナリオも `projects[].tags`
（`@admin` など）・コマンドラインの `--grep`・smoke コマンドの `tags.slow` によるタグ単位の除外 といった絞り込みには従う。
`@human` と併記した `@red-contract` は実装待ちのまま人が確かめ、E2E では実行しない。
`excludeTags` に状態タグやタグ式（`not @x`・`@a and @b` など）を書くと、
Playwright テンプレートの設定読み込みが失敗する（`@red-contract` を外して E2E を緑に見せないため）。
`projects[].tags` も、状態タグに触れる式や括弧の対応が取れていない式を書くと設定読み込みが失敗する。
Flutter テンプレートは同じ理由で、状態タグに触れる `SPECPROOF_TAGS` と括弧の対応が取れていない `SPECPROOF_TAGS` を拒否する。
コマンドラインの `--grep-invert @red-contract` はテンプレートでは止められないので、使わない。
`projects[].conditional` は認証ロール軸から env 軸へのフィルタ。例: admin 環境変数がなければスキップ。
3 軸は独立に評価され、すべて通過したシナリオだけが実行対象になる。

## <sup>+</sup> adversarial 検証で追加・補正したフィールド

Phase 0 の coverage 検証（skill が参照する 143 個の hardcode token を素の config が
吸収できるか反証）で見つかった 12 ギャップ + 5 補正の反映:

1. `layout.i18nSource` — text.ts の上流 `ja.yaml` が素の config に無かった（gap）。
2. `fixtures` map — `mainOperationPage` 以外の fixture 名が解決不能だった（gap）。
3. `implement.blastRadiusGlobs` に `packages/web/src/components/exampleApp/**` — implGlobs から
   漏れていた specproof-implement の編集スコープ（gap/correction）。
4. `layout.stepFileSuffix: .steps.ts` — `stepFileExt: .ts` だけでは glob が `steps/*.ts` になり
   非 step ファイルを誤爆する（correction）。
5. `projects[].features` — guest が `auth.feature` のみ実行する事実は tag だけでは表現不可
   だった（correction）。
6. `git.commitScope` / `git.branchPrefix` — `feat(e2e):` / `feat/specproof-sync-<date>` が hardcode（gap）。
7. `commands.install` — drift skill の復旧手順 `npm ci`（gap, yarn/pnpm 環境への適応）。
8. `agents.codeReviewer` / `agents.securityReviewer` — レビューエージェント名（gap）。
9. `auth.provider` / `auth.description` — 認証プロバイダ参照（gap）。→ `environments[].auth` に統合済み。
10. `examples.specDoc` — new-feature が参照する代表 spec ファイル名（gap）。
11. `env.adminUsername` + `projects[].conditional` — authed-admin の runtime 条件性（correction）。
12. Playwright assertion/locator API（`toHaveURL` 等）と Gherkin キーワード集合は **意図的に
    config 化しない**。前者は idiomGuide（system.md）に、後者は `language` から Cucumber i18n
    テーブル経由で導出する。

検証の生データ: ワークフロー出力の `coverage.gaps` / `coverage.corrections`（12 + 5 件）。

## skill 用キーの解決とテンプレート例

両テンプレートは `layout.i18nSource`、`conventions.*`、`examples.*`、`git.*` を明示する。
`i18nSource`、`conventions.agentsDoc`、`examples.specDoc` は consumer に合わせて編集する例であり、
存在しないパスを skill が勝手に作成・補完してよいという意味ではない。
`conventions.i18nLintPlugin: none` は専用 plugin 未導入という明示値。専用検査は未実施と報告する。
`conventions.pendingStubBody` は常に失敗する pending の例であり、空の成功実装に置き換えない。

旧例の `tags.sf` は特定サービス固有の任意タグで、汎用 skill は要求しない。
外部サービス依存の重いシナリオは、そのタグに加えて `tags.slow` 等を明示して分類する。

Flutter の `projects[]` / `env` / `environments[]` は skill が読む宣言。Dart suite のフィルタ・
auth・環境変数へ自動で反映されない。初期 counter 例は認証なし・URL不要で、
`env.baseUrl` は共通語彙の名前だけを宣言する。不要な資格情報や URL を設定する必要はない。
`flutter.*` は setup skill が pubspec/build.yaml/実行コマンドと照合する。
Playwright の認証保存先は `projects[].storageState` が正本。未使用の `runner.authDir` は削除した。

設定の必須キーが欠けていれば停止する。任意項目は、その手順が明示した fallback に限って
省略できる（例: agents 未設定時の非独立自己レビュー）。adapter 固有キーは該当 adapter でのみ解決する。
