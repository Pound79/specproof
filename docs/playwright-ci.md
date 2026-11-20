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

2 つのリポジトリのどちらも前回通ったときから変わっていなければ、流さずに終える。

- 画面の SHA は `${{ github.sha }}`、バックエンドの SHA は App のトークンで API から取る（手順 2）。
  比べる SHA・checkout する SHA・印に書く SHA は同じ値にする。ブランチ名で checkout すると、
  取った後に進んだ別のコミットを流して、流していない組に印を付けることがある
- 印は `actions/cache/restore`（`lookup-only: true`）でキー `e2e-<画面の SHA>-<バックエンドの SHA>` の有無を見て、
  あれば以降の手順を飛ばす。テストが通ったときだけ、SHA の組を書いた小さなファイルを作って
  `actions/cache/save` で保存する（ファイルが無いと保存されない）。落ちた組に印を付けると、直さないまま次の回が飛ばされる
- 印は費用を省くためのもので、合否の証拠ではない。cache は既定ブランチで動くほかのワークフローからも書けるので、
  信頼する根拠にしない。印が消えた（使われないまま期限が切れた等）ときは流し直すだけなので安全側に倒れる
- 成果物の名前を印にしない。成果物はブランチを問わずリポジトリの一覧に並び、PR の run からも同じ名前で置けるので、
  検査を飛ばす印を偽造できる
- 手動で流すときに印を無視できるよう、`workflow_dispatch` に `force` の入力を設けるとよい
- 2 つの SHA の組は、リポジトリの外の変化（イメージの `latest` タグ、固定していない依存、日付で変わるデータ）を
  捉えない。compose の `image:` はダイジェスト（`@sha256:`）で固定する

## 2. 別の非公開リポジトリを読む

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
      # ...バックエンドの起動（手順 3）とテスト...
      - run: echo "${{ steps.sha.outputs.key }}" > .e2e-marker
      - uses: actions/cache/save@<sha> # vX.Y.Z  テストが通ったときだけここまで来る
        with:
          path: .e2e-marker
          key: ${{ steps.sha.outputs.key }}
```

## 3. バックエンドを docker compose で立ち上げる

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

## 4. 結果・ログ・成果物

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
