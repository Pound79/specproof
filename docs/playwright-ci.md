# 別のバックエンドが要る Playwright の E2E を CI で流す

画面のリポジトリとは別のリポジトリにあるバックエンド（API・DB・キャッシュ）を立ち上げて、
Playwright の雛形の E2E を GitHub Actions で流すときの手引き。specproof の CLI はテストを実行せず、
結果も判定しない（実行と正式な GREEN は別のツールの責務。[roadmap](./roadmap.md)）。ここに書くのは、
利用側が自分のワークフローを組むときの決めごとと落とし穴で、雛形には含まれない。
同梱の `specproof-drift-check.yml`（PR ごとの drift の検査）とは別のワークフローにする。

## 1. いつ流すか: 定期実行と変更の検知

全シナリオを流すのは重いので、`schedule`（例: 毎日 1 回）と `workflow_dispatch`（手動）で流す。
`pull_request`・`pull_request_target`・`workflow_run` では起動しない。秘密と App のトークンを使うので、
PR の head を checkout して秘密と一緒に動かさない。`schedule` は既定ブランチでだけ動き、cron は UTC で書く。
同じ組を二重に流さないよう `concurrency` を付ける。

2 つのリポジトリのどちらも、前回、印を付けたときから変わっていなければ、流さずに終える。

- 画面の SHA は `${{ github.sha }}`、バックエンドの SHA は App のトークンで API から取る（手順 3）。
  比べる SHA・checkout する SHA・印に書く SHA は同じ値にする。ブランチ名で checkout すると、
  取った後に進んだ別のコミットを流して、流していない組に印を付けることがある
- 印は `actions/cache/restore`（`lookup-only: true`）でキー `e2e-<画面の SHA>-<バックエンドの SHA>` の有無を見て、
  あれば以降の手順を飛ばす。SHA の組を書いた小さなファイルを作って `actions/cache/save` で保存する
  （ファイルが無いと保存されない）。保存は、テストを流すジョブと分けた、checkout しないジョブで行う（手順 2）
- 印の付け方は 2 つある。どちらにするかを決めて、ワークフローの冒頭のコメントに書く。
  - **通ったときだけ印を付ける**（骨組みの例）: 落ちた組は次の回にもう一度流れる。一時的な失敗（バックエンドの
    起動の失敗など）は次の回で流し直される。落ち続ける組は、直るまで毎回流れて費用がかかる
  - **流したら印を付ける（落ちても）**: 前回流したときから変わっていなければ流さない。落ちた組は、直す変更が入って
    SHA が変わるか、`force` で流すまで流れない。落ちたことは run の結果と通知でしか分からないので、通知を
    見逃すと次の変更まで気づかない。一時的な失敗も流し直されないので、原因が環境なら `force` で流し直す。
    骨組みの `mark` ジョブの条件を
    `${{ !cancelled() && needs.e2e.outputs.ran == 'true' && (needs.e2e.result == 'success' || needs.e2e.result == 'failure') }}`
    にする。ジョブの `if:` に `!cancelled()` などの状態の関数が無いと `success()` が暗黙に付き、落ちた回に付かない。
    取り消された run と、テストを始める前（起動など）で落ちた run には付けない
- 印は費用を省くためのもので、合否の証拠ではない。cache は既定ブランチで動くほかのワークフローからも書けるので、
  信頼する根拠にしない。印が消えた（使われないまま期限が切れた等）ときは流し直すだけなので安全側に倒れる
- 成果物の名前を印にしない。成果物はブランチを問わずリポジトリの一覧に並び、PR の run からも同じ名前で置けるので、
  検査を飛ばす印を偽造できる。印を作った run のブランチ（`workflow_run.head_branch` など）で絞っても足りない。
  fork の PR の run のブランチ名は fork の側の名前で、既定ブランチと同じ名前にもできる。
  一覧の API が返す `workflow_run.head_repository_id` が自分のリポジトリであることでも絞れば、fork と別のブランチの
  run は外せる（`workflow_run` が null の成果物を外し忘れると、そこから通る）。それでも、既定ブランチの run の中で
  動くコードは、その run の実行時のトークンで既定ブランチの組の名前の成果物を置ける。どれも cache にも直接書ける
  （手順 2）ので、cache にしても閉じない。経路ごとの扱い:
  - 手順 2 の入力で指定したブランチのコード: ブランチを run の ref で選べば（手順 2）閉じる
  - 同じジョブで動くバックエンドのコード（手順 3）: 閉じない。バックエンドの SHA を取るブランチを保護された
    ブランチに限り、そこにあるコードを信頼する前提を置く
  - 固定した依存（install の script・ビルドのツール・compose のイメージ）: 閉じない。lockfile やダイジェストで
    固定しても、中身はレビューしていないコード
  - 既定ブランチの範囲で動くほかのワークフローと、使い回す self-hosted の runner に前のジョブが残したもの: 閉じない。
    `push`・`schedule`・`workflow_dispatch` などの run は、`cache-mode` を書かなければ既定ブランチの
    範囲の cache に書ける。`pull_request_target`・`issue_comment`・`workflow_run` のように PR やコメントを起点に
    動く run は、既定では読むだけで、`cache-mode: write`（または `write-only`）を書いたときに書ける（GitHub の
    dependency caching の docs）。成果物の絞り込みを抜けるかは、イベントと run の属性による。未信頼のコードを
    動かしていないかを確かめる
  - checkout しない `mark` ジョブ（手順 2）は、保存の手順（印のファイル・環境・PATH）を書き換えさせないための
    もので、上の経路は閉じない
  - だから印は、どちらにしても合否の証拠にしない（費用を省くためのもの）。そのうえで cache を使うのは、読める
    範囲を GitHub がブランチごとに分けるので絞り込みを自分で書かずに済み（書き誤りで開かない）、一覧を読む
    `actions: read` の権限も要らないから
  - 成果物の名前の印から cache の印に切り替えるときは、印の成果物を上げる手順を消す。cache にはまだ印が無いので、
    切り替えた後の最初の回は変更が無くても流れる。古い印の成果物は読まなくなるので、保持の期限で消えるのを待つか、
    手で（画面か `gh api`）消す。消すためにワークフローへ `actions: write` を足さない。印を読むためだけに付けていた
    `actions: read` は外す
- 手動で流すときに印を無視できるよう、`workflow_dispatch` に `force` の入力を設けるとよい
- 2 つの SHA の組は、リポジトリの外の変化（イメージの `latest` タグ、固定していない依存、日付で変わるデータ）を
  捉えない。compose の `image:` はダイジェスト（`@sha256:`）で固定する

## 2. キャッシュは読むだけにする

手で流すときに、`workflow_dispatch` の入力でブランチを指定し、そのブランチのコードを checkout して流せる作りにすると、
そのブランチのコード（依存のインストールの script、ビルド、テストのコード）がジョブの中で動く。run 自体は既定ブランチの
上で動くので、そのジョブが保存した cache は既定ブランチの範囲に入り、既定ブランチやリリースのブランチの CI がそれを
信じて使う。入力でブランチを指定できるのは `workflow_dispatch` を起動できる人（書き込み権限のある人）だけだが、
選べるブランチには、bot が依存を更新するブランチのように第三者のコードが入ったものも含まれる。

- **ブランチは入力でなく、run の ref で選ぶ。** 別のブランチを流したいときは、ワークフローをそのブランチで起動する
  （Actions の画面の「Use workflow from」、または `gh workflow run --ref <branch>`）。run の ref がそのブランチになるので、
  保存した cache はそのブランチの範囲に入り、手順 3 の Environment の制限（使えるブランチを既定ブランチに限る）も効く
- 入力でブランチを指定する作りにするなら、次を前提にする。
  - **読むだけにしても、悪意のあるコードは防げない。** 同じジョブで動くコードは、cache の action を通さずに、
    ジョブの実行時のトークンで cache に直接書ける。読むだけにするのは、うっかり保存しないための手段。
    既定ブランチやリリースのブランチの CI（特にリリースのビルド）は、cache から復元した依存を信じない
    （`npm ci` のように lockfile から作り直す）
  - **Environment の制限が効かない。** run の ref は既定ブランチなので、App の秘密鍵を含む秘密がそのジョブに入り、
    ブランチのコードから読める。Environment に承認する人（required reviewers）を付けるか、選べるブランチを
    保護されたブランチに限る
  - **印を付けない。** 印のキーは既定ブランチの SHA（`github.sha`）なので、ブランチのコードで通っても、流していない
    既定ブランチの組に印が付く。`mark` の `if:` に入力が空であることを足す
  - 入力のブランチ名は `run:` に `${{ }}` で埋めず、`env:` で渡して `git check-ref-format --branch` で確かめ、
    SHA に解決してから checkout する
- どちらの作りでも、依存のキャッシュ（`node_modules`・npm のキャッシュ・ブラウザのバイナリ）は
  `actions/cache/restore` で読むだけにする。`actions/cache` と、`actions/setup-node` などの `cache:` 入力は、
  ジョブの終わりに保存もするので使わない。`actions/setup-node` は v6 から、`package.json` の `packageManager`
  （または `devEngines.packageManager`）が npm だと `cache:` を書かなくてもキャッシュを使うので、
  `package-manager-cache: false` を付ける（v5 も、パッケージマネージャを検出してキャッシュを既定で使う）。
  ほかの setup 系の action や、docker の `cache-to: type=gha` も cache に書く
- 印の保存は、テストを流すジョブと分けた、checkout しない別のジョブで行う（下の骨組みの `mark`）。同じジョブの中では、
  先に動いたコードが後の手順の入力（印のファイル、環境、PATH にあるツール）を書き換えられる。別のジョブが新しい環境で
  始まるのは、GitHub がホストする runner か、ジョブごとに捨てる runner のときだけ。使い回す self-hosted の runner では
  分けても前のジョブの残したものを受け継ぐ
- workspace の composite action（`./.github/actions/*`）は、checkout したブランチの版が読まれる。保存など、
  信頼が要る手順をそれに任せない

## 3. 別の非公開リポジトリを読む

バックエンドのリポジトリが非公開なら、そのリポジトリだけを読める GitHub App のトークンを使う。
個人のアクセストークンは、持ち主の権限の全部と期限の長さを持ち込むので使わない。

- この用途専用の App を作り、権限は Contents の Read だけ、導入先はバックエンドのリポジトリだけにする。
  長く使えるのはトークンではなく App の秘密鍵で、鍵があれば App の権限でトークンをいくらでも作れる
- 秘密鍵は、使えるブランチを既定ブランチに限った Environment の secret に置き、ジョブに `environment:` を付ける。
  repository の secret は、書き込み権限のある人が push したどのブランチの run からも読める
- `actions/create-github-app-token` は、対象のリポジトリと `contents: read` に絞ったトークンを作る。
  トークンはおよそ 1 時間で切れ、ジョブの終わりに action が失効させる（失効を止める入力は使わない）
- トークンを URL に埋めない（`https://x-access-token:<token>@github.com/...` は使わない）。SHA は `gh api` で取り、
  checkout には `token:` で渡して `persist-credentials: false` を付け、`.git/config` に残さない
- `uses:` はコミットの SHA に固定し、版をコメントに書く（同梱の `specproof-drift-check.yml` と同じ書き方）

```yaml
# 骨組みの例。<...> は自分の値に、各 action はコミットの SHA に固定して使う。
on:
  schedule:
    - cron: "0 18 * * *" # UTC
  workflow_dispatch:
    inputs:
      force:
        type: boolean
        default: false

permissions:
  contents: read

concurrency:
  group: e2e
  cancel-in-progress: false

jobs:
  e2e:
    runs-on: ubuntu-latest
    environment: e2e # 秘密鍵はここ。使えるブランチを既定ブランチに限る
    outputs:
      key: ${{ steps.sha.outputs.key }}
      ran: ${{ steps.ran.outputs.ran }}
    steps:
      - id: app-token
        uses: actions/create-github-app-token@<sha> # vX.Y.Z
        with:
          client-id: ${{ vars.<APP_CLIENT_ID> }}
          private-key: ${{ secrets.<APP_PRIVATE_KEY> }}
          owner: <owner>
          repositories: <backend-repo> # owner を付けない名前
          permission-contents: read
      - id: sha
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
        run: |
          backend=$(gh api "repos/<owner>/<backend-repo>/commits/<branch>" --jq .sha)
          echo "backend=$backend" >> "$GITHUB_OUTPUT"
          echo "key=e2e-${GITHUB_SHA}-${backend}" >> "$GITHUB_OUTPUT"
      - id: marker
        if: ${{ !inputs.force }}
        uses: actions/cache/restore@<sha> # vX.Y.Z
        with:
          path: .e2e-marker
          key: ${{ steps.sha.outputs.key }}
          lookup-only: true
      # 以降の手順にはすべて if: steps.marker.outputs.cache-hit != 'true' を付ける
      - uses: actions/checkout@<sha> # vX.Y.Z
        with:
          persist-credentials: false
      - uses: actions/checkout@<sha> # vX.Y.Z
        with:
          repository: <owner>/<backend-repo>
          ref: ${{ steps.sha.outputs.backend }} # ブランチ名でなく、比べた SHA
          path: backend
          token: ${{ steps.app-token.outputs.token }}
          persist-credentials: false
      # ...画面のビルド・バックエンドの起動（手順 4）...
      - id: ran # テストを始めた印。テストが落ちても立っている（印を見て飛ばした回と、起動で落ちた回は立たない）
        run: echo "ran=true" >> "$GITHUB_OUTPUT"
      # ...テスト...

  # 印の保存は、テストを流したジョブと分ける（手順 2）。checkout せず、ファイルを作って保存するだけ。
  mark:
    needs: e2e
    # 通ったときだけ印を付ける。落ちても付けるなら手順 1 の条件にする。
    if: ${{ needs.e2e.result == 'success' && needs.e2e.outputs.ran == 'true' }}
    runs-on: ubuntu-latest
    permissions: {} # cache の保存は実行時のトークンで行うので、GITHUB_TOKEN の権限は要らない
    steps:
      - env:
          KEY: ${{ needs.e2e.outputs.key }}
        run: |
          [[ "$KEY" =~ ^e2e-[0-9a-f]{40}-[0-9a-f]{40}$ ]] || exit 1
          echo "$KEY" > .e2e-marker
      - uses: actions/cache/save@<sha> # vX.Y.Z
        with:
          path: .e2e-marker
          key: ${{ needs.e2e.outputs.key }}
```

## 4. バックエンドを docker compose で立ち上げる

- **ファイルの持ち主**: Linux の runner では、コンテナの中の root が書いたファイルはホストでも root の
  持ち物になり、runner のユーザーから読めないことがある（macOS の Docker では起きにくいので手元では気づかない）。
  seed の出力などホストで読むファイルを書くサービスは、runner のユーザーで動かすか、ホストのディレクトリに
  マウントせずに `docker compose cp` で取り出す。bash の `UID` は読み取り専用で export もされず、`GID` は無いので、
  別の名前で渡す:
  ```yaml
  - run: |
      echo "HOST_UID=$(id -u)" >> "$GITHUB_ENV"
      echo "HOST_GID=$(id -g)" >> "$GITHUB_ENV"
  ```
  compose 側は `user: "${HOST_UID}:${HOST_GID}"` にする
- **準備を待つ**: DB などに `healthcheck` を書き、`docker compose up --wait` で準備が終わるまで待つ。
  固定の秒数で待たない
- **migration と seed**: 起動の後に migration を流してから seed を入れる。流していない migration があると、
  変えていないシナリオまで全部落ちる
- **初回の遅さ**: 起動直後の最初の要求は遅いことがある。テストの前に一度要求を送って温める
  （Playwright の `globalSetup` に置ける）
- **使い捨ての秘密**: JWT の署名鍵などテストの中だけで使う秘密は、実行ごとに作って捨てる
  （例: `openssl rand -hex 32`）。作った値は secrets ではないので自動では伏せられない。使う前に
  `echo "::add-mask::$KEY"` で伏せ、`$GITHUB_ENV` か `$RUNNER_TEMP` の env ファイルで compose に渡す。
  `docker compose config` は解決した環境変数をすべて出すので実行しない。DB も実行ごとに作り直す
- **データ**: seed とテスト用の利用者は合成したデータにし、本物の個人情報や本番のデータを使わない。
  接続先は compose で立てたものだけにする
- **画面のビルドの設定**: ビルドに埋め込む値（`NEXT_PUBLIC_*` など、API の URL）は、git の外のファイル（`.env` など）に
  頼らない。リポジトリにある雛形（`.env.example` など）をコピーし、CI で決まる値を上書きしてからビルドする。
  値が空のまま作ると、画面は API でなく自分自身に要求を送り、多くのシナリオが 404 で落ちる。手元で新しい
  worktree を作ったときも同じことが起きる（雛形の README の「テストの前に環境を確かめる」で、テストの前に拾える）
- **Node の版**: 画面と E2E のパッケージで `engines` の要求が違うことがある。画面のビルドの後、E2E の前に、
  E2E のパッケージの `engines` に合う版を `actions/setup-node` で入れ直す（`package-manager-cache: false`。手順 2）

## 5. 結果・ログ・成果物

雛形の README のとおり、trace・スクリーンショット・動画・HTML レポート（`test-results/`・`playwright-report/`）と、
保存したセッション（`playwright/.auth/`）は CI の成果物に上げない。trace にはテスト用アカウントのセッション
（cookie・入力した値・通信の本文）が入り、認証情報を使い捨てにしていても、画面に出たデータや通信の中身は残る。
ジョブが取り消されると `playwright/.auth/` を消す後始末も走らないが、runner ごと捨てられる。

- CI で見るのは、Playwright の `list` / `line` のレポーターがログに出す、失敗したシナリオと失敗の文。
  画面のリポジトリが公開なら、ログは誰でも読める。失敗の文には期待値と実際の値（画面の文字列・URL）が出るので、
  テストに秘密を値として埋めない。失敗したときに compose のログを丸ごと出さず、`docker compose ps` と
  healthcheck の状態くらいに留める
- 落ちたら、その回の SHA の組（画面とバックエンド）を手元で checkout して流し直し、trace は手元で開く
  （`npx playwright show-trace`）。CI だけで落ちるときは、runner と同じ OS のコンテナで再現する
- 結果を残したいときは、成否と落ちたシナリオの名前だけを書いた要約を残す

### 例外: 落ちた run の trace を短く残す

既定は上のとおり上げない。次の条件をすべて満たすときだけ、落ちた run の `test-results/` を短い期間だけ成果物に
残してよい。手元で再現できない CI だけの失敗を、trace で調べるための例外。

- テスト用の認証情報（JWT の署名の鍵など）とセッションは実行ごとに作って捨て、その実行の外では使えない
  （手順 4 の「使い捨ての秘密」）。本物のアカウント・共有のテスト用アカウントの認証情報を使っていない
- 使い捨ての鍵は `$RUNNER_TEMP` の env ファイルで compose にだけ渡し、`$GITHUB_ENV` に入れない（テストのプロセスに
  渡さない。テストのコードが鍵を使うと、要求の本文やヘッダ、標準出力として trace に残る）
- バックエンドはデバッグ表示を切って動かし、エラーの応答に環境変数やスタックトレースを出さない。外部のサービスの
  本物の鍵を compose に渡さない。画面のビルドに埋め込む値に秘密を入れない（埋め込んだ値は通信に乗って trace に入る）
- seed とテスト用の利用者は合成したデータで、DB は実行ごとに作り直して捨てる
- 画面のリポジトリを読める人（Actions を読める権限を持つ連携の App を含む）が、バックエンドの応答の中身を
  見てもよい。成果物を読めるのは、ログと同じくリポジトリを読める人全員になる。公開リポジトリでは上げない
- 手順 2 の入力でブランチを指定した回ではない（そのブランチのコードが `test-results/` に置くものを決められる）

それでも trace には、画面に出た合成データ、入力した値、通信の本文が残る。`::add-mask::` が伏せるのはログだけで、
成果物の中身は伏せない。`test-results/` には trace のほかに、スクリーンショット・動画・テストが添付したファイルも入る。
上げるのは `test-results/` だけにし、保存したセッション（`playwright/.auth/`）と HTML レポート（`playwright-report/`。
trace を中に含む）は含めない。

```yaml
- if: ${{ failure() && inputs.branch == '' }} # 入力でブランチを指定する作りでなければ failure() だけ
  uses: actions/upload-artifact@<sha> # vX.Y.Z
  with:
    name: e2e-traces
    path: <E2E のパッケージ>/test-results/
    retention-days: 7
```
