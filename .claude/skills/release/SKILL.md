---
name: release
description: >
  Release / publish a new version of the bdd-kit npm packages
  (@pound79/bdd-kit = cli, @pound79/bdd-traceability = packages/traceability).
  bdd-kit の新バージョンを切る / publish するときに使う。トリガ例: "リリースして",
  "v0.1.5 を出して", "バージョンを上げて publish", "cut a release", "bump and tag".
  Drives scripts/release.sh, which bumps every workspace version + the lockfile,
  stamps the CHANGELOG, commits, tags vX.Y.Z, and pushes — the tag fires
  .github/workflows/release.yml, which publishes to npm with provenance.
---

# Release bdd-kit

bdd-kit の npm パッケージをリリースする。**機械的処理は `scripts/release.sh` が担う**ので、
このスキルは判断が要る部分 — バージョン選定・CHANGELOG 執筆・最終確認 — を担当する。

## 必ず理解しておく前提

- リリースは `.github/workflows/release.yml` が **`v*` タグの push で発火**し、各 `package.json` の
  `version` を読んで npm publish する。**既に publish 済みのバージョンは skip**。
- **タグ名 ≠ publish される version**。version は `package.json` から読まれる。`package.json` を上げずに
  タグだけ打つと、workflow は「既出」で全 skip し **何も publish されず無言で成功する**。
- `npm version --workspaces` は `package.json` だけでなく **`package-lock.json` も更新**する。怠ると
  workflow 冒頭の `npm ci` が不整合で落ちる。`scripts/release.sh` はこの更新を検証する。
- publish は `id-token: write` + `--provenance` で行われるため supply-chain 来歴が付く。
  **必ずこの workflow 経由でリリースする**（ローカルからの手動 `npm publish` は使わない）。

## 手順

### 1. バージョンを決める
- 直近タグ: `git tag --sort=-v:refname | head -1`
- npm の現状: `npm view @pound79/bdd-kit version`
- 変更内容から semver を判断（破壊的変更 = major / 機能追加 = minor / 修正のみ = patch）。
- 両パッケージは lockstep（同一バージョン）で運用している。`npm version --workspaces` が両方を揃える。

### 2. main を最新化
```bash
git switch main && git pull --ff-only origin main
```

### 3. CHANGELOG の `## [Unreleased]` を執筆（このスキルの主担当）
- 前回タグからの差分を読む: `git log v<last>..main --oneline`
- 各コミット / PR を Keep a Changelog 形式（`### Added/Changed/Fixed/Removed`）に整理し、
  `CHANGELOG.md` の `## [Unreleased]` 直下に bullet を書く。該当する PR 番号
  （例: `(#123)`）を各項目に添える。
- publish 物に影響しない純内部変更（CI 設定変更など）は省略するか `Changed` に簡潔に。
- **コミットは不要**。`scripts/release.sh` は CHANGELOG.md の未コミット編集だけは許容し、
  stamp 後にバージョン bump とまとめて 1 コミットにする（他の未コミット変更があると弾く）。

### 4. リリーススクリプトを実行
```bash
scripts/release.sh <version>        # 例: scripts/release.sh 0.1.5
# または: npm run release -- <version>
```
スクリプトがやること（**失敗しうる検証・検査は mutation 前**に実行し、さらに **mutation
（bump / stamp）は snapshot され、コミット成立前に失敗・中断すれば自動 rollback** されるので、
半端な bump 状態が残らない設計）:
1. 前提チェック（main 上 / CHANGELOG 以外 clean / タグ未存在）+ CHANGELOG `[Unreleased]` が空でないか検証
2. `npm ci`（node_modules が無い時のみ）+ `npm run typecheck && npm run build && npm test`（`--skip-checks` で省略可）
3. `npm version <version> --workspaces --no-git-tag-version`（package.json 群 + lockfile）
4. CHANGELOG を stamp（`[Unreleased]` → `[<version>] - <date>`、compare link も更新）
5. 差分を表示し **push 前に確認プロンプト**（`--yes` で省略可）
6. `chore: release v<version>` を commit → `v<version>` タグ作成 →
   `git push --atomic origin main <tag>` で **main とタグを一括 push**（タグ push で publish 発火）

便利オプション:
- `--dry-run` — 前提チェックして実行計画だけ表示（変更しない）。まず叩いて確認すると安全。
- `--yes` — 確認プロンプトを飛ばす（CI / 非対話）。
- `--skip-checks` — ローカル検証を省略（CI 側でも走る）。
- `--allow-empty-changelog` — Unreleased が空でもリリース（非推奨）。

### 5. リリース後の検証
```bash
gh run watch                                  # Release workflow を監視
npm view @pound79/bdd-kit version             # <version> になっていれば成功
npm view @pound79/bdd-traceability version
gh release create v<version> --generate-notes # 任意: GitHub Release ノート
```

## トラブルシュート

- **何も publish されない / workflow が skip した** → `package.json` の version を上げ忘れ、または
  既に publish 済みのバージョンでタグを打った。`npm view <pkg> version` で確認し、version を上げ直して
  新しいタグを切る。
- **workflow が `npm ci` で落ちる** → `package-lock.json` が package.json と不整合。
  手で version を編集していないか確認し、`npm version --workspaces` で揃え直す（スクリプト経由なら自動）。
- **`git push` が SSH で失敗する制限環境** → HTTPS にフォールバック（token を config に残さない）:
  ```bash
  git -c credential.helper='!gh auth git-credential' \
    push --atomic https://github.com/Pound79/bdd-kit.git HEAD:main v<version>
  ```
- **間違ったタグを push してしまった（publish 前に気づいた）** →
  `git push --delete origin v<version>` でリモートタグを削除（既に publish 済みなら npm の unpublish は
  原則不可なので、次の patch を出す）。
