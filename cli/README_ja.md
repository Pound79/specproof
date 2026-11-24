# @pound79/specproof

[English](README.md) | 日本語

Node.js 24 以上で、既存リポジトリに BDD の設定、テストパッケージ、drift 検査の PR ワークフローを作成する CLI です。AI エージェントを使う場合は [specproof の skill](https://github.com/Pound79/specproof/blob/main/README_ja.md) を導入して `/specproof` から始めると、フレームワークの判定と設定の調整を順に進められます。

## 使い方

リポジトリ直下で実行します。個別インストールは不要です。

```sh
npx @pound79/specproof detect --json
npx @pound79/specproof init --adapter auto
```

`detect` はファイルを変更せず候補を表示します。`--json` で機械可読な結果を出します。`init` は `--adapter playwright` または `--adapter flutter` で明示的に選択できます。`auto` は高い確度の候補が1件、またはそれがなく中程度の候補が1件（React アプリなど）なら採用します。候補が競合する場合や確度が低い場合は明示してください。

| init のオプション | 意味 |
|---|---|
| `--adapter <playwright\|flutter\|auto>` | 必須。使用するアダプターを選択します。 |
| `--dir <e2e-dir>` | 生成先。リポジトリ内に置きます。既定と異なる場合は生成設定内のパスも更新します。 |
| `--force` | 既存ファイルを上書きします。`.github/workflows/` の既存 CI ワークフローは `--force` でも上書きしないので、変更は手で統合します。 |
| `--agent <claude\|codex>` | 完了後の案内を指定したエージェント向けにします。省略時は両方を表示します。 |

## エージェントへの導入

```sh
npx @pound79/specproof setup-agent codex
npx @pound79/specproof setup-agent claude
npx @pound79/specproof setup-agent codex --force
```

Codex 用の skill は `.agents/skills/` に作成します。Claude Code の場合はインストール手順を表示します。

## 配置先と既存ファイル

配置先に空白や引用符を含める場合は、CLI に渡す `--dir` の値を shell で引用する。
生成設定は YAML と shell の両方に合わせて引用し、ディレクトリ名をコマンドとして実行しない。
制御文字を含む配置先は、ファイルを書き込む前に拒否する。

```bash
npx @pound79/specproof init --adapter playwright --dir 'e2e tests'
```

`init` / `setup-agent` は、配置先の symlink を `--force` でも拒否する。複数の
hardlink を持つ既存ファイルは、`--force` で上書きする時に拒否する（上書きしない
ファイルは従来どおり skip する）。hardlink の共有先がリポジトリ内か外かは判別せず、
共有ファイルを上書きしない。別プロセスによる検査後のパス差し替えには排他を保証しない。
書き込みの途中で失敗した `init` は、その実行で作ったファイルを消し、`--force` で上書きしたファイルを
元の内容と権限に戻してから止まる（作ったディレクトリは空になったものだけを消す）。取り消しの前に
パスの安全の検査をやり直し、別のプロセスが置き換えたファイルには触らず、戻せなかったものとして示す。

配置先に `.gitignore` が既にあると、`init` はそれを書き換えない（`--force` のときだけ雛形で上書きする）。
その代わり、雛形の `.gitignore` にある秘密と実行結果の除外（playwright は `.env`・`.env.*`・`.npmrc`・
`playwright/.auth`・`test-results`・`playwright-report`、flutter は `.env`・`.env.*`・`.npmrc`）のうち、
既存のファイルで除外されていない行を警告として stderr に並べる。比べるのは行の文字列で、末尾の空白と
先頭の `/` を無視し、後の行の否定（`!.env` など）は前の除外を打ち消すとみなす。末尾の `/` はディレクトリの
項目（`test-results/` など）では同じとみなし、ファイルの項目（`.env/` など）では除外とみなさない。
`.env*` のような同等のパターンや親ディレクトリの `.gitignore` での除外は判定しないので、
警告に出た行は実際に追跡されうるかを確かめてから足す。既存の `.gitignore` が通常のファイルでない・1 MiB を超える・
読めないときは、`init` を止めず、どの除外も無いものとして警告する。

[トレーサビリティエンジン](https://www.npmjs.com/package/@pound79/specproof-traceability)・[MIT ライセンス](LICENSE)
