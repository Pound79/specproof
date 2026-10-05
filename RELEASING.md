# Releasing

This repo publishes two npm packages from an npm-workspaces monorepo:

- `@pound79/specproof` — `cli/`
- `@pound79/specproof-traceability` — `packages/traceability/`

It also ships a **Claude Code plugin** whose version lives in two manifests
outside the npm workspaces:

- `.claude-plugin/marketplace.json` (`metadata.version`)
- `plugins/specproof/.claude-plugin/plugin.json` (`version`)

All four version sources are released in lockstep (same version). The npm
packages are published by
[`.github/workflows/release.yml`](.github/workflows/release.yml); the plugin is
served straight from the repo, so its manifests must be bumped too or the
plugin stays pinned to the old version even though the code is current. CI runs
`npm run check:versions` on every PR, and the Release workflow runs it again as
a pre-publish gate, so a drifted version can neither merge nor publish.

## TL;DR

```bash
git switch main && git pull --ff-only origin main
# edit CHANGELOG.md "## [Unreleased]" with this release's notes (no need to commit)
npm run release -- 0.1.5      # or: scripts/release.sh 0.1.5
```

The script runs typecheck/build/test, bumps every workspace `package.json` +
`package-lock.json` **and both plugin manifests**, stamps the CHANGELOG (heading
+ compare links), asserts all version sources agree (`check-versions.mjs`),
commits `chore: release v0.1.5`, then pushes `main` and the `v0.1.5` tag together in one
`git push --atomic`. Pushing the tag triggers the Release workflow, which
publishes both packages to npm with provenance. (Fallible work runs before any
file is changed, and the version bump / stamp is snapshotted and rolled back if
it fails partway — e.g. a failed `npm version` reify — so a failed or aborted run
never leaves a half-bumped tree.)

## How the publish actually works (read this once)

- The workflow fires on a **`v*` tag push**, then reads the `version` from each
  `package.json` and publishes it — **skipping any version already on npm**.
- The **published version comes from `package.json`**, not the tag name — but
  the workflow's first step verifies the pushed tag equals `v<cli/package.json
  version>` and fails loudly (before touching npm) if they disagree. This runs
  before any publish because npm publish can't be undone. Always bump
  `package.json` first — which `scripts/release.sh` does — so the tag you push
  already matches.
- `npm version --workspaces --allow-same-version` は既に対象版へ揃えた未公開候補も
  受け付ける。同版なら `package-lock.json` の差分がなくてもよいが、全 workspace の
  `package.json` と対応する lock entry が対象版と一致しなければ commit 前に拒否し、
  release ファイルを復元する。対象版への更新時にも同じ照合を行う。
- **The plugin is a separate channel.** `npm version --workspaces` only touches
  npm workspaces, so it cannot bump `.claude-plugin/marketplace.json` or
  `plugins/specproof/.claude-plugin/plugin.json`. `scripts/release.sh` bumps those
  explicitly. Claude Code reads the plugin's "latest version" from these
  manifests (not from npm), so if they lag, `/plugin install` reports the repo is
  already at the old version even after new code lands. `check-versions.mjs`
  (run in CI, by the release script, and as a pre-publish gate in the Release
  workflow) is the guard that keeps them in sync.

## Script options

```
scripts/release.sh <version> [--yes] [--skip-checks] [--allow-empty-changelog] [--dry-run]
```

- `--dry-run` — run the preconditions and print the plan; change nothing. Run
  this first if you want to see what will happen.
- `--yes` — skip the confirmation prompt before pushing (CI / non-interactive).
- `--skip-checks` — skip the local typecheck/build/test (CI runs them anyway).
- `--allow-empty-changelog` — allow releasing with an empty `[Unreleased]`
  section (discouraged).

The script refuses to run unless you are on `main`, the working tree is clean
except for `CHANGELOG.md`, and the target tag does not already exist.

差分・commit だけを準備して止める flag はない。`--dry-run` は計画表示のみで、
公開確認を拒否すると差分を復元する。承諾後は commit → tag → atomic push と進み、
公開 workflow を起動する。同版候補の受理は公開許可を代替しない。
CHANGELOG の確定などで source SHA が変わる場合、旧候補の pack 証拠を最終公開 SHA の
証拠へ流用せず、最終 exact SHA の version・検査・pack・空 consumer を再検証する。

## After releasing

```bash
gh run watch                                  # watch the Release workflow
npm view @pound79/specproof version             # expect the new version
npm view @pound79/specproof-traceability version
gh release view v0.1.5                        # GitHub Release is created automatically
```

The workflow creates the GitHub Release itself once both packages publish (title
`vX.Y.Z`, notes copied verbatim from the matching `CHANGELOG.md` section) — no
manual `gh release create` needed.

## Notes

- Need a token in CI? The workflow uses the `NPM_TOKEN` repo secret.
- From Claude Code you can drive this with the `release` skill
  (`.claude/skills/release/`), which authors the CHANGELOG from the git log and
  then runs `scripts/release.sh`.
- In a restricted shell where SSH push is blocked, push over HTTPS without
  persisting a token:
  ```bash
  git -c credential.helper='!gh auth git-credential' \
    push --atomic https://github.com/Pound79/specproof.git HEAD:main v0.1.5
  ```
