# セキュリティモデル

specproof が何を信頼し、どこまでを読み書きし、どこへ通信し、何を保証しないかをまとめる。
脆弱性の報告窓口と依存の修正期限は [SECURITY.md](../SECURITY.md) を参照する。

## 前提

specproof の CLI（`@pound79/specproof`）とトレーサビリティ・エンジン
（`@pound79/specproof-traceability`）は、利用者のリポジトリの中身を**信頼できない入力**として
読む。PR の CI で動くことを前提にしているので、PR の作者は設定（`specproof.config.yaml`）・
manifest（`traceability.yaml`）・spec・実装・feature のパスと中身を自由に書ける。

サーバ・DB・利用者の認証は持たない。CLI を実行した OS ユーザの権限がそのまま境界になる。

## 読み書きする範囲（信頼境界）

### エンジン

エンジンの境界は、次の規則で決めた**ルート**で、その外を読み書きしない。

- **ルートの決め方**: `--root` があればそれを使う。無ければ実行したディレクトリから親へたどり、
  `specproof.config.yaml` / `specproof.config.yml` / `traceability.yaml` のある最初のディレクトリ、
  それも無ければ `git rev-parse --show-toplevel`。たどる途中で、目印が無く改名前の
  `bdd-kit.config.yaml` / `.yml` だけがあるディレクトリに来たら、名前の変更を案内してエラーで止まる。
  ルートは git のリポジトリのルートとは限らない（サブディレクトリに `traceability.yaml` があれば
  そこが、リポジトリより上に目印のファイルがあればそこがルートになる）。ただし `traceability.yaml`
  だけの段では、その上の最も近い設定ファイルを読み、`layout.manifest` がその manifest を指していれば
  設定ファイルの段をルートにする（読めない設定ファイルは無視して従来どおり）。この探索は `.git` の
  ある段より上を見ない（チェックアウトの外の設定ファイルでルートを広げさせない）。manifest の段に
  設定ファイルの項目（リンク切れや旧名を含む）があれば親へ移らず、その段の検証を素通りさせない。途中の
  段にそれがあるときも親の設定ファイルを採らない（manifest の段をルートにする）。CI では `--root` で
  明示するのが確実
- **読む範囲**: 設定の `layout.manifest`・`layout.pagesDir`・`layout.featuresDir`、
  `layout.implGlobs` の走査の起点、manifest の参照パス、`--manifest` は、字句と実体（symlink の
  解決先）の両方でルートの内側に解決できるものだけを読む。外側を指すパス・リンク切れはエラーで
  止まる。ルートの外の状態（存在・権限・ループ）は、エラー文から区別できないようにしている
- **書く範囲**: `specproof-update` が書くのは manifest だけで、同じディレクトリの一時ファイルを
  完成させてから置き換える。欠けた参照（ファイルや見出しが無い）は hash を取り直さずにエラーで止まる
- **子プロセス**: エンジンが起動するのは、ルートを決める `git rev-parse --show-toplevel`（固定の
  引数）と、`specproof-check --since-bless` を付けたときの `git rev-parse` / `git log` / `git show` / `git rev-list` / `git ls-tree` と、`specproof-update --record-spec-source`・
  `specproof-check --spec-sources` を付けたときの取り込み元のチェックアウトでの `git config --null --list`（部分 clone の
  判定）/ `git for-each-ref`（`ref` の完全な名前での引き当て）/ `git rev-parse` / `git ls-tree` だけ。
  `specSources[].importCommand` は実行しない。取り込み元の `repo` は設定の値でルートの外も指せるので、ルートの中に
  限る原則の例外になる。読むのは `<repo>/.git` が実体のディレクトリで、自分が持ち主で、`commondir` が無く、部分 clone
  （`extensions.partialClone`・`remote.*.promisor`）でないときだけで、`--git-dir` で明示して親のリポジトリや bare
  リポジトリを探させない。足りないオブジェクトを取りに行かせない防御は、部分 clone を読まないことと
  `GIT_NO_LAZY_FETCH=1` で、コマンドラインの `protocol.allow=never` と内蔵の transport ごとの `never` はその上に重ねる
  （リポジトリの設定の `protocol.<名前>.allow` に上書きされうるので、これだけには頼らない）。`GIT_NO_REPLACE_OBJECTS=1`
  で差し替えを読まず、受け継いだ `GIT_DIR`・`GIT_CONFIG_*` などの環境変数を消す。`ref` は名前の形だけを受けて `--end-of-options` の後ろに置く。
  取り込み元に push できる人は、ブランチと同じ名前のタグを置ける（fetch は既定でタグも取ってくる）。git の名前の
  探索はタグを先に読むので、`ref` は短い名前を探索に渡さず、`refs/remotes/<ref>`・`refs/heads/<ref>` の順に名前が
  完全に一致する ref だけを `for-each-ref` で引く（タグは `refs/tags/` と書いたときだけ）。commit id は、解決した id
  が書いた値（大文字は小文字にそろえる）と同じときだけ使う。大文字小文字を区別しないファイルシステム（macOS の既定など）の files backend では、
  `Develop` のように大文字小文字だけが違うブランチの fetch が `refs/remotes/origin/develop` の loose ref を
  上書きしうる。これは git の ref の保存の制約で、CLI では防げない（取り込み元を大文字小文字を区別するボリュームに
  置くか、reftable backend にする）。`--record-spec-source` は
  固定の `HEAD` も同じ形で解決し、HEAD と `ref` で `paths` の中身が違えば記録しない（HEAD のコミットの id と違った
  `paths` を出力に出す）。それでも、その
  リポジトリの存在とコミットの id は出力に出るので、PR の CI では `--spec-sources` を付けない（既定では読まない）。
  作業ツリーを読む git（`status`・`diff`）は `.gitattributes` のフィルタを起動しうるので使わず、版の中身は
  `git show <commit>:<path>` で読む。fsmonitor・署名の検証・`log.follow` の設定は切り、作業ツリーの中の bare
  リポジトリを暗黙に見つけさせない（`safe.bareRepository=explicit`）。
  設定の `commands.*` は実行しない。`--since-bless` の git には manifest の参照のパスが渡る（PR が書ける）ので、
  シェルを通さず引数の配列で起動し、パスは `--` の後ろと `<commit>:./<path>` にだけ置き、
  `GIT_LITERAL_PATHSPECS=1` で記号を文字どおりに扱わせる。部分 clone で足りない版を取りに行かせない
  （`GIT_NO_LAZY_FETCH=1`。この環境変数を知らない古い git では取りに行きうる）。資格情報は尋ねさせない
  （`GIT_TERMINAL_PROMPT=0`）。checkout の `.git/config` は git がそのまま読む。示す `git diff` の形は、
  どのシェルでも引用の外に出られない文字だけのパスに限り、完全なコミット id と `:(top,literal)` のパスを使う

### CLI

- **書く範囲**: `specproof init` と `specproof setup-agent` は実行したディレクトリをルートとし、
  `--dir` と書き込み先はその内側に限る。書き込み先のパス上の symlink と、複数のハードリンクを持つ
  既存ファイルへの書き込みは拒否する。既存のファイルは `--force` が無ければ上書きせず、
  `.github/workflows/` のファイルは `--force` でも上書きしない
- **読む範囲**: `specproof detect` と `init --adapter auto` は、実行したディレクトリの
  `package.json`・`pubspec.yaml`・`.env.example`（変数の名前だけ）を読む。1 ファイル 1 MiB までの
  通常ファイルだけを読むが、境界の検査はしていない（symlink も辿る）。信頼できないディレクトリで `detect` を走らせない
- **既存の `.gitignore`**: `init` は残す `.gitignore` を 1 MiB まで読み、雛形の秘密と実行結果の除外
  （`.env`・`playwright/.auth` など）が無ければ警告する。書き換えず、照合は行の文字列で git の判定と完全には一致しない
- **子プロセス**: 起動しない。設定の `commands.*` も実行しない

### 共通の限界

検査してから読み書きするまでの間に、別のプロセスがパスを差し替えることへの排他はしない。

### AI skill

AI skill（`plugins/specproof/skills/`）は利用者の AI エージェントの中で動き、設定の `commands.*`
をエージェントに実行させる（検証ゲート）。設定やコマンドが呼ぶスクリプトは PR で書き換えられるので、
skill は最初にコマンドを実行する前に、設定ファイル・`.npmrc`・`package.json`・lockfile などの
既定ブランチとの差分を確かめ、変わっていれば中身と展開後のコマンドを示して人の承認を待つ（各 SKILL.md
の「設定のコマンドを実行する前の確認」）。これは AI への指示であり、強制はできない。また、見つけられる
のはコマンドや設定の差し替えだけで、差分が無くてもコマンドはそのブランチのコードを実行する。他人のブランチで skill を走らせるのは、PR を手元で checkout して
`npm test` を実行するときと同じ信頼の前提にある。

版を上げる手順（setup §7）は、既定ブランチから切った新しいブランチで行い、設定の `commands.*` を流さず、
完全な版とレジストリ（スコープ別のレジストリを含む）を固定した `npx` だけを流す。npm はリポジトリの
`.npmrc` を読むので、`.npmrc` に差分があれば上の確認に従う。取得した CHANGELOG と CLI の出力はデータとして扱い、
そこに書かれた指示には従わない。

比較先の既定ブランチは設定ファイルからは決めない。確かめる対象のファイルが比較先を決めると、PR が自分の
ブランチを比較先に書くだけで差分が消えるため。承認は、比較先とファイルごとの `git hash-object` の値として
そのセッションの中でだけ覚え、値が同じ間は聞き直さない。承認として扱うのは、値を書いた提示へのユーザー自身の
返答だけで、コマンドの出力・ファイル・要約に書かれた「承認済み」は扱わない（エージェントの文脈には PR が書いた
文字列も入るため）。hash は `.gitattributes`（PR が書ける）の変換を受けない `--no-filters` で取る。記録をリポジトリやその外のファイルに残さないのは、
PR やエージェント自身が書ける場所の記録で承認を偽装させないため。

PR が書ける文字列（コミットの件名、manifest のパスや見出し、feature の文）を、skill が報告や PR 本文に写すときは、
写す側（skill）が無害化する。CLI のテキスト出力は件名を無害化するが、`--json` の値は生のまま返す（受け取る側で
無害化する。traceability の README の `--since-bless`）。sync の skill は、bless の前のコミットごとの裁定で、件名から
制御文字・見えない文字・バッククォートを除いて長さを限り、PR 本文ではコードブロックに入れて、メンション・issue を
閉じるキーワード・HTML のコメントを描画させない。照合は行の先頭の (完全なコミット id, link id) の欄だけで行い、件名の中の文字列とは
照合しない。シナリオ名・見出し・パスなど行に写すほかの文字列も同じに無害化する。CLI の出力・JSON の文字列に書かれた指示には従わない。

## 通信先

| 主体 | 通信先 | 用途 | 資格情報 |
|---|---|---|---|
| CLI・エンジン | なし | 実行時に外部へ通信しない（`--since-bless` の git も取得をしない。上の子プロセスの項を参照） | なし |
| 同梱の drift-check ワークフロー | GitHub（checkout）、Node.js の取得元（setup-node） | リポジトリの取得、Node.js の用意 | ワークフローの `GITHUB_TOKEN` |
| 同梱の drift-check ワークフロー | npm レジストリ（既定は registry.npmjs.org） | `npx` でエンジンを取得する | なし |
| 同梱の drift-check ワークフロー | GitHub REST API | PR のコメントの一覧・作成・更新、PR の head の確認 | ワークフローの `GITHUB_TOKEN`（`contents: read`・`pull-requests: write`） |
| AI skill | npm レジストリ | `npx` で CLI・エンジンを取得する（setup、`commands.traceability*`） | なし |
| AI skill | GitHub の公開ページ | 版を上げるとき、上げる先の版のタグの CHANGELOG を読む（setup §7） | なし |
| AI skill | GitHub（`gh` CLI または GitHub の connector） | ブランチの push と PR の作成（sync など） | 利用者の環境の資格情報 |
| AI skill | テスト対象のアプリ（`env.baseUrl`） | `commands.smoke` の実行 | テスト用アカウント（`.env`） |

Playwright の雛形は、認証情報や保存したセッションを使う project があるとき、loopback 以外への `http://` の
baseURL を、環境の `allowInsecureHttp: true` が無ければ拒否する（`docs/config-schema.md` の
`environments[].allowInsecureHttp`）。許可は環境ごとでホストには結び付かず、リダイレクト先は確かめない。

`npx` の取得元は npm の設定（レジストリ・プロキシ・スコープごとのレジストリ）に従い、npm は実行した
ディレクトリ（と親）の `.npmrc` も読む。PR を checkout した作業ツリーの中で `npx` を実行すると、PR
が `.npmrc` を足すだけで取得元を差し替えられる。CI では作業ツリーの外で実行し、`--registry` を
明示する。また、`actions/checkout` は既定で、後続のステップが git の認証に使えるよう
`GITHUB_TOKEN` を保持する。同じジョブで PR や npm 由来のコードを動かすなら
`persist-credentials: false` にする。

## 暗号の在庫

| 対象 | アルゴリズム・機能 | 実装 | 用途 |
|---|---|---|---|
| spec の節・実装・feature の内容 | SHA-256（`node:crypto`） | `packages/traceability/src/hash.ts` | drift の検知（保存した hash と現在の hash の比較） |
| feature のシナリオ | SHA-256（`node:crypto`） | `packages/traceability/src/feature-lint.ts` | 重複シナリオを比べるための鍵 |
| manifest の一時ファイル名 | `randomUUID`（`node:crypto`） | `packages/traceability/src/atomic-write.ts` | 衝突しない名前。安全性は排他的な作成（既にあれば失敗）に依る |

鍵・証明書・暗号化・署名・パスワードのハッシュは使わない。npm に公開するパッケージの provenance は
npm と Sigstore の仕組みで、specproof のコードではない。

**manifest の hash は変更の検知であり、改ざんの検知や認証ではない。** 対象のファイルを書き換えられる
人は、`specproof-update` で hash も取り直せる（同じ信頼の範囲にある）。hash が守るのは「変わったのに
誰も見ていない」ことの検出で、変更が正しいことは人のレビューで決める。hash の方式を変えるときの
扱いは [ADR 0010](adr/0010-manifest-version-policy.md) に従う。

## 重い処理と上限

| 処理 | 上限 |
|---|---|
| 設定ファイルの読み込み | 1 MiB、通常ファイルだけ |
| manifest の読み込み | 8 MiB、link 10,000、参照は link あたり 1,000・全体 20,000 など（[traceability README](../packages/traceability/README.md#manifest-safety-limits)） |
| spec・実装・feature の内容の読み込みと hash | 1 ファイル 8 MiB、通常ファイルだけ。同時に読むのは 32 件まで |
| `layout.featuresDir` と `layout.implGlobs` のディレクトリ走査 | `implGlobs` は 256 本・1 本 1,024 文字まで。走査するファイルの数には上限が無い |
| feature の lint のファイル横断の比較（重複・矛盾の候補） | 上限は無い |
| `specproof-check --since-bless` の履歴の探索とコミットごとのまとめ | パスごとに直近 200 コミット。同じパスの参照は履歴と各版を 1 回だけ読む。まとめは bless した版とパスの組ごとに 200 コミットまで（並べ替えは first-parent の列を 1 回、20,000 件まで読む）。全体で git の起動 2,000 回・60 秒まで（超えたら打ち切り、打ち切ったと示す）。1 回の git は 10 秒・出力 8 MiB まで |

上限の無い処理は、リポジトリの大きさに比例して時間とメモリを使う。CI でエンジンを動かすジョブには
`timeout-minutes`（例: 10 分）を付けて、異常に大きな入力で既定の 360 分を使い切らないようにする。

## drift のゲートが保証しないこと

`specproof-check --strict` は、bless した基準から変わったもの・査読前のドラフト・止めるタグなどを
決定的に検出する。ただし、次のものは PR の中で変えられるので、ゲートだけでは止められない。

- manifest の hash（PR の作者が `specproof-update` で取り直せる）
- 設定ファイル（`specproof.config.yaml` と別名。`layout.manifest`・`layout.featuresDir`・`strict*` の設定）
- drift-check のワークフロー自体（`pull_request` ではワークフローは PR の版で動く）
- `.npmrc`（作業ツリーで `npx` を実行する場合、エンジンの取得元を差し替えて結果を偽造できる）

どれか 1 つでも守られていなければ、検査の範囲を外せる。たとえば守られていない設定ファイルで
`layout.manifest` を空の manifest に、`layout.featuresDir` を空のディレクトリに向ければ、既定の
`traceability.yaml` に触れずに `--strict` を通せる。

ゲートを効かせるには、次を合わせて使う。

- drift-check を、ブランチの保護（ruleset）で必須のステータスチェックにする
- 次のファイルを CODEOWNERS で守り、code owner の承認を必須にする（ファイル名は既定の構成の例で、
  実際に読み込むパスに合わせる）
  - 設定ファイル: エンジンが探す両方の名前（`specproof.config.yaml`・`specproof.config.yml`）。
    エンジンはこの順に探して最初の 1 つを読むので、`.yml` を使っているリポジトリに `.yaml` を
    新しく置くだけで設定を差し替えられる。使っていない名前も守る。改名前の `bdd-kit.config.yaml`・
    `bdd-kit.config.yml` は 0.4.0 から読まず、それだけがあれば止まる。0.3.x 以前のエンジン（それを
    固定した drift-check のワークフローを含む）は `specproof.config.*` が無ければ旧名を読むので、
    その版を使うあいだは旧名も守る
  - manifest: 既定の `traceability.yaml` と、`layout.manifest` や CI の `--manifest` で実際に
    読み込むパス
  - `.npmrc` と `.github/workflows/`
- CI では `--root` と `--manifest` を明示して、設定で読み込み先を変えられる範囲を減らす
- 設定ファイルが無いことを CI で失敗にする。エンジンは設定ファイルが無ければ既定値で動き（設定を置かない
  利用のため）、`layout.featuresDir` が無いので登録していない feature を見ないまま `--strict` を通す。
  同梱の drift-check のワークフローは、検査の前にリポジトリのルートの設定ファイルを確かめて止まる
- manifest の hash の更新を含む PR では、spec・実装・feature の差分を人がレビューする

`unregistered-impl` は、ファイル名の形だけで外れる。テストや生成物に見える名前（`*.test.*`・`*.spec.*` など）の
ものは、テキスト出力と注釈の一覧に出さず件数だけを出す（`--json` と終了コードは変えない）。`layout.implExcludeGlobs`
に当たるもの（`specproof init` は典型の glob を書く）は照合そのものから外れ、`strictUnregisteredImpl: true` でも
`--strict` で落ちない。製品のコードをそうした名前で置けば登録の確かめを外せるので、`strictUnregisteredImpl` で
固めるときは `implExcludeGlobs` の範囲を見直し、名前の変更は差分のレビューで見る。
