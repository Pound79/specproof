# リリース手順

[English](RELEASING.md) | 日本語

## 対象と準備

`@pound79/specproof`（`cli/`）と `@pound79/specproof-traceability`（`packages/traceability/`）を npm に公開します。Claude Code プラグインは GitHub から配布し、marketplace の `metadata.version` とプラグインの `version` を使います。リリーススクリプトは workspace、lockfile、両プラグイン manifest、同梱アダプターの設定と drift ワークフローの固定バージョンを揃えます。CI と公開直前に `npm run check:versions` で照合します。

```sh
git switch main && git pull --ff-only origin main
# CHANGELOG.md の [Unreleased] に今回の変更を書く
npm run release -- 0.1.5 --dry-run
npm run release -- 0.1.5
```

バージョンは今回の値に置き換えます。今後の互換性変更と移行手順は同じリリース節に日英で書いてください。`main` 上で実行し、`CHANGELOG.md` 以外の未コミット変更がなく、対象タグが未作成であることを確認します。

## コマンドと復元

```text
scripts/release.sh <version> [--yes] [--skip-checks] [--allow-empty-changelog] [--dry-run]
```

- `--dry-run` は前提を確認して計画を表示します。`--yes` は push 前の最終確認を省略します。
- `--skip-checks` はローカルの型検査・ビルド・テストを省略します。CI では実行します。
- `--allow-empty-changelog` は例外的に空の `[Unreleased]` を許可します。

スクリプトは検査を実行し、対象ファイルを退避してから版、CHANGELOG の見出し・比較リンクを更新します。全 workspace と lock entry が指定版に一致することを確かめます。既に同版の未公開候補でも実行でき、その場合は lockfile の差分がなくても構いません。確認を拒否するか更新に失敗した場合は対象ファイルと stage を復元します。並行して stage された無関係なファイルはリリースコミットに含めません。

承諾後、`chore: release vX.Y.Z` のコミットとタグを作り、`main` とタグを一度の `git push --atomic` で送ります。タグの push により公開が始まります。同版候補の受理は公開許可を代替しません。差分だけを準備するフラグはありません。公開対象のコミットが変わったら、最終 SHA で版・検査・tarball・空の導入先での動作を改めて確認します。

## 公開ワークフロー

[Release ワークフロー](.github/workflows/release.yml)は `v*` タグで起動し、タグと `cli/package.json` の版を照合します。npm に公開する版は各パッケージの manifest から決まり、既に公開済みの版は飛ばします。

1. **build** は `npm ci --ignore-scripts`、ビルド、テスト、両パッケージの `npm pack` を行い、tarball を `npm-tarballs` として渡します。このジョブは OIDC の公開資格情報を発行できません。
2. **publish** は期待する2つの tarball を検査し、`id-token: write` を使って `npm publish <tarball> --provenance` を実行します。依存をインストールせず、パッケージのスクリプトも実行しません。来歴はビルドの正しさを証明しないため、入力とビルド工程のレビューも必要です。公開する npm の pacote と同じ cache を使って manifest を取り出し、チェックアウトした `package.json` とバイト単位で照合します。`.git` を含む tarball は拒否します。npm が README 等から導く一部の値を除き、npm が解釈した manifest も一致させます。`binding.gyp`、`server.js`、`AUTHORS` からの暗黙の変更や、ビルド時の `publishConfig`・タグ・スクリプトの差し替えを防ぐためです。
3. **release** は npm の公開後、該当する CHANGELOG 節を本文にして GitHub Release を作成します。手作業での Release 作成は不要です。

## 公開の確認と再試行

```sh
# 確認するリリースのチェックアウトで、リポジトリのルートから実行する
version=$(node -p "require('./cli/package.json').version")
gh run watch
npm view "@pound79/specproof@$version" version
npm view "@pound79/specproof-traceability@$version" version
gh release view "v$version"
```

npm の trusted publisher は両パッケージで、所有者 `Pound79`、リポジトリ `specproof`、ワークフロー `release.yml`、Environment なし、`Allow npm publish` を指定します。OIDC に失敗すると npm の代替トークンで E404 または E401 が出ることがあります。設定を確認し、`gh run rerun <run-id> --failed` でやり直します。既に公開した版は再公開しません。

Claude Code の `.claude/skills/release/` は履歴から変更記録を準備して同じスクリプトを実行します。SSH を使えない環境では、承認済みのコミットとタグを HTTPS 経由で送れます。資格情報は保存しません。

```sh
git -c credential.helper='!gh auth git-credential' push --atomic https://github.com/Pound79/specproof.git HEAD:main v0.1.5
```
