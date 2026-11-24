# 別のバックエンドが要る Playwright の E2E を CI で流す

[English](playwright-ci_en.md) | 日本語

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
- 印は費用を省くためのもので、合否の証拠ではない。cache は既定ブランチで動くほかのワークフロー（`cache-mode` で
  書き込みを止めていないもの。`push`・`schedule`・`workflow_dispatch` などで書いていないものと、`cache-mode: write` を
  書いたもの）からも書けるので、信頼する根拠にしない。印が消えた（使われないまま期限が切れた等）ときは流し直す
  だけなので安全側に倒れる
- 成果物の名前を印にしない。成果物はブランチを問わずリポジトリの一覧に並び、PR の run からも同じ名前で置けるので、
  検査を飛ばす印を偽造できる。印を作った run のブランチ（`workflow_run.head_branch` など）で絞っても足りない。
  fork の PR の run のブランチ名は fork の側の名前で、既定ブランチと同じ名前にもできる。
  一覧の API が返す `workflow_run.head_repository_id` が自分のリポジトリであることでも絞れば、fork と別のブランチの
  run は外せる（`workflow_run` が null の成果物を外し忘れると、そこから通る）。それでも、既定ブランチの run の中で
  動くコードは、その run の実行時のトークンで既定ブランチの組の名前の成果物を置ける。`cache-mode` を書かなければ、
  どれも cache にも直接書ける（手順 2）。テストを流すジョブを `cache-mode: read` にし、印を保存する `mark` だけを
  `cache-mode: write-only` にすると（手順 2・骨組み）、テストを流すジョブのトークンでは cache に書けないと読める
  （手順 2 の `cache-mode` の項の前提の下で。今回の組の印は、テストの合否を左右して `mark` に付けさせられる）。
  成果物には書けるままなので、成果物の印は閉じない。経路ごとの扱い:
  - 手順 2 の入力で指定したブランチのコード: ブランチを run の ref で選べば（手順 2）閉じる
  - 同じジョブで動くバックエンドのコード（手順 3）: cache の印は `cache-mode: read` で閉じる（手順 2 の前提の下で）。
    成果物の印は閉じない
  - 固定した依存（install の script・ビルドのツール・compose のイメージ）: cache の印は `cache-mode: read` で閉じる
    （手順 2 の前提の下で）。成果物の印は閉じない（lockfile やダイジェストで固定しても、中身はレビューしていないコード）
  - 既定ブランチの範囲で動くほかのワークフローと、使い回す self-hosted の runner に前のジョブが残したもの: 閉じない。
    `push`・`schedule`・`workflow_dispatch` などの run は、`cache-mode` を書かなければ既定ブランチの
    範囲の cache に書ける。`pull_request_target`・`issue_comment`・`workflow_run` のように PR やコメントを起点に
    動く run は、既定では読むだけで、`cache-mode: write`（または `write-only`）を書いたときに書ける（GitHub の
    dependency caching の docs）。成果物の絞り込みを抜けるかは、イベントと run の属性による。未信頼のコードを
    動かしていないかを確かめる
  - checkout しない `mark` ジョブ（手順 2）は、保存の手順（印のファイル・環境・PATH）を書き換えさせないための
    もので、それだけでは上の経路は閉じない。`cache-mode: write-only` を付けるのはこのジョブだけにする
  - ほかのワークフローの経路が残るので、印はどちらにしても合否の証拠にしない（費用を省くためのもの）。そのうえで
    cache を使うのは、読める範囲を GitHub がブランチごとに分けるので絞り込みを自分で書かずに済み（書き誤りで
    開かない）、一覧を読む `actions: read` の権限も要らず、`cache-mode` で書けるジョブを `mark` に限れるから
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
  - **`cache-mode` を書かないと、読むだけにしても悪意のあるコードは防げない。** `cache-mode` を書かないと、
    `workflow_dispatch` の run の同じジョブで動くコードは、cache の action を通さずに、ジョブの実行時のトークンで
    cache に直接書ける。cache の action を読むだけにするのは、うっかり保存しないための手段。下の `cache-mode: read`
    を付ける。そのうえで、既定ブランチやリリースのブランチの CI（特にリリースのビルド）は、cache から復元した依存を
    信じない（`npm ci` のように lockfile から作り直す）
  - **Environment の制限が効かない。** run の ref は既定ブランチなので、App の秘密鍵を含む秘密がそのジョブに入り、
    ブランチのコードから読める。Environment に承認する人（required reviewers）を付けるか、選べるブランチを
    保護されたブランチに限る
  - **印を付けない。** 印のキーは既定ブランチの SHA（`github.sha`）なので、ブランチのコードで通っても、流していない
    既定ブランチの組に印が付く。`mark` の `if:` に入力が空であることを足す
  - 入力のブランチ名は `run:` に `${{ }}` で埋めず、`env:` で渡して `git check-ref-format --branch` で確かめ、
    SHA に解決してから checkout する
- どちらの作りでも、`cache-mode` で cache に書けるジョブを限る。ワークフローの最上位に `cache-mode: read` を書き、
  印を保存する `mark` ジョブにだけ `cache-mode: write-only` を書く（下の骨組み）。書かないと、`schedule`・
  `workflow_dispatch`・`push` の run は既定ブランチの範囲の cache に書ける。
  - 確かなこと: `cache-mode` は、ジョブのトークンが持つ cache の権限として強制される（GitHub の dependency caching
    の docs）。cache の action による保存は、`read` のジョブでは行われない
  - 推論にとどまること: cache の action を通さない書き込みも、同じトークンを使うので止まると読めるが、docs は明記
    していない。下の読むだけにすることと、依存を作り直すことも続ける
  - 前提: GitHub がホストする runner か、ジョブごとに捨てる runner であること（使い回す self-hosted の runner では、
    前のジョブが残したものが `mark` のトークンを使える）。テストを流すジョブのトークン（`GITHUB_TOKEN`・App・
    個人のトークン）に、ほかのワークフローを起動できる権限（`actions: write`・`contents: write` など）が無いこと
    （`cache-mode` を書いていないワークフローを起動されると、そちらが書く）。テストを流すジョブを再利用ワークフローに
    切り出すときの効き方は確かめていないので、呼ばれる側にも `cache-mode: read` を書く
  - 防げないこと: `mark` は受け取ったキーを保存する。キーをテストを流すジョブから受け取ると、そのジョブのコードは
    テストを流さずに通すことで今回の組の印を付けさせられる（runner の上でジョブの出力を書き換えられれば、形の合う
    ほかの組の印も付けさせ得る）。下の骨組みは、キーを `e2e` から受け取る簡易な形。キーは、未信頼のコードを動かさない
    ジョブ（SHA を解決する
    だけのジョブなど。手順 3 の型の `fetch-backend`）から受け取ると、ほかの組の印を付けさせる経路は狭まる
  - 確かめ方: テストを流すジョブから保存を試し、`gh cache list` に入っていないことを見る。`actions/cache/save` は
    失敗しても警告だけでジョブは成功するので、ジョブが緑であることは確かめたことにならない
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

<a id="scheduled-workflow-example"></a>

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

cache-mode: read # cache には読むだけ。印を保存する mark だけが書く（手順 2）

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
    cache-mode: write-only # cache に書くのはこのジョブだけ
    steps:
      - env:
          KEY: ${{ needs.e2e.outputs.key }} # e2e から受け取る簡易な形（手順 2 の「防げないこと」）
        run: |
          [[ "$KEY" =~ ^e2e-[0-9a-f]{40}-[0-9a-f]{40}$ ]] || exit 1
          echo "$KEY" > .e2e-marker
      - uses: actions/cache/save@<sha> # vX.Y.Z
        with:
          path: .e2e-marker
          key: ${{ needs.e2e.outputs.key }}
```

### バックエンドのブランチを入力で選ぶとき

画面のリポジトリのブランチは run の ref で選べる（手順 2）が、バックエンドのリポジトリのブランチは run の ref では
選べないので、`workflow_dispatch` の入力で選ぶしかない。上の骨組みのように 1 つのジョブで App の秘密鍵を使い、
同じジョブでバックエンドのコード（docker のビルド・依存のインストール・seed・アプリ）を動かすと、入力で選んだ
ブランチのコードから鍵と App のトークンを読める。Environment の制限（使えるブランチ）は画面のリポジトリの run の
ref にしか効かないので、これを防がない。

鍵をブランチのコードから離すには、ジョブを分ける。鍵を使ってバックエンドを取ってくるジョブ（`fetch-backend`）は
バックエンドのコードを動かさず、ソースを成果物に入れて渡すだけにする。テストを流すジョブ（`e2e`）は秘密を持たない。
分けて離れるのは、ジョブごとに新しい runner（GitHub がホストする runner か、ジョブごとに捨てる runner）のときだけ。
使い回す self-hosted の runner では、`e2e` で動いたコードが残したものが、次の `fetch-backend` で鍵を読める。

- 入力は空を既定にし、空の回（`schedule` と、入力を空のまま手で流した回）は既定ブランチを取る。印と trace は、
  手順 2・5 と同じく入力が空の回にだけ付ける（`inputs.backend-branch == ''`）
- 入力はブランチとしてだけ解決する（`branches/<名前>` の API。`commits/<名前>` はタグやコミットの SHA も解決する）
- `fetch-backend` では、取ってきたソースの中のものを何も実行しない（ビルド・依存のインストール・compose・
  バックエンドのリポジトリの action やスクリプト）。`actions/checkout` は既定で LFS と submodule を取らないので、
  その既定を変えない
- ソースは tar にまとめて成果物にする。`actions/upload-artifact` は v4.4.0 から `.` で始まるファイルとディレクトリを
  既定で含めず、zip にするとファイルのパーミッションも落ちる
- 成果物は、画面のリポジトリを読める人が取れる（同じ run の後のジョブだけではない）。また、入力を選べるのは画面の
  リポジトリに書き込める人で、その人はバックエンドを読めなくても、バックエンドのどのブランチでも成果物にして
  取り出せる。どちらかを許せないとき（画面のリポジトリが公開のときを含む）は、この型を使わない。`retention-days` は
  短くする（それでも、その間は取れる）
- `e2e` は、受け取った中身を「入力で選んだブランチのコード」として扱う。秘密を持たないので鍵は読まれないが、run の
  ref は既定ブランチなので、そのコードは実行時のトークンで既定ブランチの範囲の成果物に書ける。cache には、
  付けなければ書ける。`cache-mode: read` を付ければ、そのトークンでは書けないと読める（手順 2 の `cache-mode` の
  項の前提の下で）。ジョブを分けても、成果物への書き込みは
  防げない。入力を変えた回に印を付けないのは、うっかり付けないための手段で、`cache-mode` を付けていなければ、偽の
  印を書かれることは防げない（印は合否の証拠にしない。手順 1）
- `e2e` に secrets・`environment:`・書き込みの `permissions` を足さない。足すと、この型の前提が崩れる。バックエンドの
  ビルドに非公開の依存が要るなら、バックエンドのコードを動かさずに取れるときだけ、`fetch-backend` で取って tar に
  入れる。取れないなら、この型は使えない
- 秘密や信頼が要るジョブ（`fetch-backend`・印の `mark`）は、この成果物を受け取らない（`e2e` のコードは、同じ名前の
  成果物を差し替えられる）
- 印を付けるなら、骨組みの `mark` を `needs: [fetch-backend, e2e]` にし、キーを `github.sha` と
  `needs.fetch-backend.outputs.backend` から作り、`if:` に `inputs.backend-branch == ''` を足す（`mark` だけを
  `cache-mode: write-only` にするのは骨組みと同じ）

<a id="backend-branch-workflow-example"></a>

```yaml
# バックエンドのブランチを入力で選ぶ型。<...> は自分の値に、各 action はコミットの SHA に固定して使う。
on:
  schedule:
    - cron: "0 18 * * *" # UTC
  workflow_dispatch:
    inputs:
      backend-branch:
        type: string
        default: "" # 空は既定ブランチ

permissions: {}

cache-mode: read # fetch-backend は cache を使わない。e2e は読むだけ

concurrency:
  group: e2e
  cancel-in-progress: false

jobs:
  fetch-backend:
    runs-on: ubuntu-latest
    environment: e2e # 秘密鍵はこのジョブにだけ入れる
    permissions: {} # App のトークンだけを使う
    outputs:
      backend: ${{ steps.sha.outputs.backend }}
    steps:
      - id: app-token
        uses: actions/create-github-app-token@<sha> # vX.Y.Z
        with:
          client-id: ${{ vars.<APP_CLIENT_ID> }}
          private-key: ${{ secrets.<APP_PRIVATE_KEY> }}
          owner: <owner>
          repositories: <backend-repo>
          permission-contents: read
      - id: sha
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
          INPUT: ${{ inputs.backend-branch }}
        run: |
          BRANCH="${INPUT:-<バックエンドの既定ブランチ>}"
          [[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] && git check-ref-format --branch "$BRANCH" > /dev/null || exit 1
          # 返った名前も入力と比べ、別の名前のブランチに解決されたとき（名前を変えたブランチなど）は止める。
          read -r name backend < <(gh api "repos/<owner>/<backend-repo>/branches/$BRANCH" --jq '.name + " " + .commit.sha')
          [[ "$name" == "$BRANCH" && "$backend" =~ ^[0-9a-f]{40}$ ]] || exit 1
          echo "backend=$backend" >> "$GITHUB_OUTPUT"
      - uses: actions/checkout@<sha> # vX.Y.Z
        with:
          repository: <owner>/<backend-repo>
          ref: ${{ steps.sha.outputs.backend }}
          path: backend
          token: ${{ steps.app-token.outputs.token }}
          persist-credentials: false
      # ここでバックエンドのコードを動かさない。まとめて渡すだけ。
      - run: tar -cf "$RUNNER_TEMP/backend.tar" --exclude=./.git -C backend .
      - uses: actions/upload-artifact@<sha> # vX.Y.Z
        with:
          name: backend-source
          path: ${{ runner.temp }}/backend.tar
          retention-days: 1

  e2e:
    needs: fetch-backend
    runs-on: ubuntu-latest # environment を付けない（秘密を持たない）
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@<sha> # vX.Y.Z
        with:
          persist-credentials: false
      - uses: actions/download-artifact@<sha> # vX.Y.Z
        with:
          name: backend-source
          path: ${{ runner.temp }}/backend-source
      - run: |
          mkdir "$RUNNER_TEMP/backend"
          tar -xf "$RUNNER_TEMP/backend-source/backend.tar" -C "$RUNNER_TEMP/backend"
      # ...バックエンドの起動（手順 4。compose はこの展開先で動かす）・テスト。
      # 入力が空でない回は、印を付けず、trace も上げない。
```

ジョブを分けられないときの最低限（どれか 1 つでは足りない。できるものを重ねる）:

- Environment に承認する人（required reviewers）を付け、自分の run を自分で承認させない（prevent self-review）。
  承認する人が見られるのは入力の名前だけで、承認の後にそのブランチへ push されたコードも鍵と一緒に動く。中身を
  見て承認するなら、先に SHA を解決して出すジョブ（バックエンドのコードを動かさない）を、承認する人の付かない
  別の Environment に鍵を置いて動かし、承認の後のジョブはブランチの名前でなく、そのジョブが出した SHA で
  checkout する
- バックエンドの入力を、既定ブランチ（または保護されたブランチ）の一覧と完全に一致するものに限り、それ以外なら
  鍵を使う前に止める（`type: choice` にしてもよい）。ブランチとしてだけ解決する（上の `branches/<名前>`）
- 入力が空でない回は、印を付けず、trace も上げない

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
  `echo "::add-mask::$KEY"` で伏せ、`$GITHUB_ENV` か `$RUNNER_TEMP` の env ファイルで compose に渡す
  （手順 5 の trace の例外を使うなら `$GITHUB_ENV` は使わない）。
  `docker compose config` は解決した環境変数をすべて出すので実行しない。DB も実行ごとに作り直す
- **データ**: seed とテスト用の利用者は合成したデータにし、本物の個人情報や本番のデータを使わない。
  接続先は compose で立てたものだけにする
- **画面のビルドの設定**: ビルドに埋め込む値（`NEXT_PUBLIC_*` など、API の URL）は、git の外のファイル（`.env` など）に
  頼らない。リポジトリにある雛形（`.env.example` など）をコピーし、CI で決まる値を上書きしてからビルドする。
  値が空のまま作ると、画面は API でなく自分自身に要求を送り、多くのシナリオが 404 で落ちる。手元で新しい
  worktree を作ったときも同じことが起きる（[テストの前に環境を確かめるコード例](../templates/playwright/README_ja.md#preflight-example)で、実行前に検知できる）
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

既定は上のとおり上げない。下のチェックリストをすべて守れるときだけ、落ちた run の `test-results/` を短い期間だけ
成果物に残してよい。手元で再現できない CI だけの失敗を、trace で調べるための例外。1 つでも守れない、または守れているかを
確かめられないなら、例外を使わない。

それでも trace には、画面に出た合成データ、入力した値、通信の本文が残る。`::add-mask::` が伏せるのはログだけで、
成果物の中身は伏せない。`test-results/` には trace のほかに、スクリーンショット・動画・テストが添付したファイルも入る。

**開発モードのバックエンド**: 手順 4 のとおり docker compose で立ち上げると、バックエンドは開発モードで動くことが多い。
開発モードの多くは、応答にスタックトレースや設定の値を出し、それが通信の本文として trace に入る。開発モードのまま
例外を使うなら、デバッグ表示を切る。設定 1 つで切れるもの（下の Rails・Laravel）と、モードごと変わるもの（Django・Express）
があり、モードを変えるとほかの設定（接続先・要る鍵・cookie の扱い）も変わることがあるので、本物の接続先や鍵を読みに
行かないかも確かめる。例:

- Rails: `config.consider_all_requests_local` が development と test では `true`。切り替える組み込みの環境変数は無いので、
  `config/environments/development.rb` でこの値を環境変数から読む形にして CI で `false` にするか、CI 用の環境を作る
- Django: settings の `DEBUG` を `False` にする（環境変数から読む形にしていれば、その変数で）。`ALLOWED_HOSTS` に
  バックエンドを呼ぶときのホスト名（compose のサービス名など）を足さないと、すべての要求が 400 になる
- Laravel: `APP_DEBUG=false`（設定をキャッシュしている（`config:cache`）なら、キャッシュを作り直さないと効かない）
- Express: `NODE_ENV=production`（既定のエラーハンドラが、応答にスタックトレースを含めなくなる）。install の後、起動の
  ときだけに設定する（install のときに設定すると devDependencies を入れない）

一覧に無いフレームワークも、同じ観点で調べる。設定のほかに、自前のエラーハンドラ、GraphQL のエラー（200 で返すことがある）、
開発用のツールバーやプロファイラ、画面のサーバーの開発用のエラー表示（`next dev` など）も、応答に詳細を出す。
切ったことは、例外になる要求・存在しない URL（404）・GraphQL のエラーの応答を一度ずつ見て確かめる。切れない
（バックエンドのリポジトリを変えられない、など）なら、例外を使わない。

<a id="trace-upload-example"></a>

上げる前の確認（守れていればチェックする。1 つでも守れていなければ上げない）:

- [ ] テスト用の認証情報（JWT の署名の鍵など）とセッションは実行ごとに作って捨て、その実行の外では使えない
  （手順 4 の「使い捨ての秘密」）。本物のアカウント・共有のテスト用アカウントの認証情報を使わない
- [ ] 使い捨ての鍵を、テストのプロセス（Playwright と、そこから起動するもの）の環境変数・引数・作業ディレクトリ
  （`$GITHUB_WORKSPACE` の下）に入れない。テストのコードが鍵を使うと、要求の本文やヘッダ、標準出力として trace に残る。
  `$GITHUB_ENV` に入れない（後の手順すべての環境変数になる）。渡し方は問わない（例: `$RUNNER_TEMP` の env ファイルを
  compose の `env_file` でバックエンドのコンテナにだけ渡す。バックエンドの設定ファイルに書くなら、checkout した後に
  `$RUNNER_TEMP` の下へ移してから書く）
- [ ] バックエンドと画面のサーバーは、エラーの応答にもそれ以外の応答にも、スタックトレース・環境変数・設定の値を出さない
  （上の「開発モードのバックエンド」）
- [ ] 本物の鍵（外部のサービスの鍵など）を、compose で渡すものも、バックエンドのチェックアウトの中にあるもの
  （コミットされた開発用の env ファイルなど）も、バックエンドに読ませない。画面のビルドに埋め込む値に秘密を入れない
  （埋め込んだ値は通信に乗って trace に入る）
- [ ] seed とテスト用の利用者は合成したデータだけにし、DB は実行ごとに作り直して捨てる
- [ ] バックエンドのログや出力（`docker compose logs` など）をテストで添付せず、`test-results/` に書かない
- [ ] 画面のリポジトリを読める人（Actions を読める権限を持つ連携の App を含む）全員に、バックエンドの応答の中身を
  見せてよい。成果物を読めるのは、ログと同じくリポジトリを読める人全員になる。公開リポジトリでは上げない
- [ ] 手順 2 の入力でブランチを指定した回に上げない（そのブランチのコードが `test-results/` に置くものを決められる）。
  下の `if:` で外す
- [ ] 上げるのは `test-results/` だけにする。保存したセッション（`playwright/.auth/`）と HTML レポート（`playwright-report/`。
  trace を中に含む）は含めない

```yaml
- if: ${{ failure() && inputs.branch == '' && inputs.backend-branch == '' }} # 手順 2・3 の入力がどれも空の回だけ
  # 入力の名前は自分の作りに合わせる（無い入力は空として評価されるので、名前を誤ると常に通る）
  uses: actions/upload-artifact@<sha> # vX.Y.Z
  with:
    name: e2e-traces
    path: <E2E のパッケージ>/test-results/
    retention-days: 7
```
