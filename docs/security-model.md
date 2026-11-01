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
  そこが、リポジトリより上に目印のファイルがあればそこがルートになる）。CI では `--root` で
  明示するのが確実
- **読む範囲**: 設定の `layout.manifest`・`layout.pagesDir`・`layout.featuresDir`、
  `layout.implGlobs` の走査の起点、manifest の参照パス、`--manifest` は、字句と実体（symlink の
  解決先）の両方でルートの内側に解決できるものだけを読む。外側を指すパス・リンク切れはエラーで
  止まる。ルートの外の状態（存在・権限・ループ）は、エラー文から区別できないようにしている
- **書く範囲**: `specproof-update` が書くのは manifest だけで、同じディレクトリの一時ファイルを
  完成させてから置き換える。欠けた参照（ファイルや見出しが無い）は hash を取り直さずにエラーで止まる
- **子プロセス**: エンジンが起動するのは、ルートを決める `git rev-parse --show-toplevel`（固定の
  引数）だけ。設定の `commands.*` は実行しない

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

## 通信先

| 主体 | 通信先 | 用途 | 資格情報 |
|---|---|---|---|
| CLI・エンジン | なし | 実行時に外部へ通信しない | なし |
| 同梱の drift-check ワークフロー | GitHub（checkout）、Node.js の取得元（setup-node） | リポジトリの取得、Node.js の用意 | ワークフローの `GITHUB_TOKEN` |
| 同梱の drift-check ワークフロー | npm レジストリ（既定は registry.npmjs.org） | `npx` でエンジンを取得する | なし |
| 同梱の drift-check ワークフロー | GitHub REST API | PR のコメントの一覧・作成・更新、PR の head の確認 | ワークフローの `GITHUB_TOKEN`（`contents: read`・`pull-requests: write`） |
| AI skill | npm レジストリ | `npx` で CLI・エンジンを取得する（setup、`commands.traceability*`） | なし |
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
