# Releasing

This repo publishes two npm packages from an npm-workspaces monorepo:

- `@pound79/bdd-kit` — `cli/`
- `@pound79/bdd-traceability` — `packages/traceability/`

It also ships a **Claude Code plugin** whose version lives in two manifests
outside the npm workspaces:

- `.claude-plugin/marketplace.json` (`metadata.version`)
- `plugins/bdd-kit/.claude-plugin/plugin.json` (`version`)

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
- The **tag name is only a trigger**: the published version comes from
  `package.json`, not the tag. Tagging `v0.1.5` while `package.json` still says
  `0.1.4` publishes nothing (it's "already published") and the run goes green
  silently. Always bump `package.json` first — which `scripts/release.sh` does.
- `npm version --workspaces` updates `package-lock.json` too. A bumped
  `package.json` with a stale lockfile makes the workflow's `npm ci` fail. The
  script verifies the lockfile was updated and refuses to continue otherwise.
- **The plugin is a separate channel.** `npm version --workspaces` only touches
  npm workspaces, so it cannot bump `.claude-plugin/marketplace.json` or
  `plugins/bdd-kit/.claude-plugin/plugin.json`. `scripts/release.sh` bumps those
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

## After releasing

```bash
gh run watch                                  # watch the Release workflow
npm view @pound79/bdd-kit version             # expect the new version
npm view @pound79/bdd-traceability version
gh release create v0.1.5 --generate-notes     # optional GitHub Release notes
```

## Notes

- Need a token in CI? The workflow uses the `NPM_TOKEN` repo secret.
- From Claude Code you can drive this with the `release` skill
  (`.claude/skills/release/`), which authors the CHANGELOG from the git log and
  then runs `scripts/release.sh`.
- In a restricted shell where SSH push is blocked, push over HTTPS without
  persisting a token:
  ```bash
  git -c credential.helper='!gh auth git-credential' \
    push --atomic https://github.com/Pound79/bdd-kit.git HEAD:main v0.1.5
  ```
