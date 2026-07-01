#!/usr/bin/env bash
#
# Release the bdd-kit npm packages.
#
# The Release workflow (.github/workflows/release.yml) fires on a `v*` tag push
# and publishes whatever version is in each package.json (skipping versions that
# are already on npm). The tag NAME is just the trigger — the published version
# is read from package.json. So this script's whole job is to make the repo state
# correct *before* the tag is pushed. Fallible work runs before any file is
# mutated, AND the mutation itself is snapshotted and rolled back on failure, so
# a failed/aborted run never leaves a half-bumped tree:
#
#   1. sync main; validate the CHANGELOG "[Unreleased]" section has notes
#   2. install deps + run typecheck/build/test  (before any mutation)
#   3. bump every workspace package + the lockfile to <version>   (npm version)
#   4. bump the two Claude Code plugin manifests to <version>
#      (.claude-plugin/marketplace.json + plugins/bdd-kit/.claude-plugin/plugin.json)
#      -- npm version --workspaces cannot reach these, so they are bumped here;
#      forgetting this is what once stranded the plugin at 0.1.4 while npm was 0.1.5
#   5. stamp the CHANGELOG: [Unreleased] -> [<version>] - <date>, update compare links
#   6. assert every version source agrees (scripts/check-versions.mjs)
#   7. commit "chore: release v<version>"
#   8. create the tag, then push main + tag atomically  -> triggers npm publish
#
# Usage:
#   scripts/release.sh <version> [options]
#
# Options:
#   --yes                    skip the interactive confirmation before pushing
#   --skip-checks            don't run typecheck/build/test locally (CI runs them anyway)
#   --allow-empty-changelog  allow releasing with an empty "[Unreleased]" section
#   --dry-run                run preconditions and print the plan; make NO changes
#
# Example:
#   scripts/release.sh 0.1.5
#
set -euo pipefail

VERSION=""
ASSUME_YES=false
SKIP_CHECKS=false
ALLOW_EMPTY_CHANGELOG=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=true ;;
    --skip-checks) SKIP_CHECKS=true ;;
    --allow-empty-changelog) ALLOW_EMPTY_CHANGELOG=true ;;
    --dry-run) DRY_RUN=true ;;
    -*) echo "error: unknown option: $arg" >&2; exit 64 ;;
    *)
      if [ -n "$VERSION" ]; then echo "error: version specified twice ($VERSION, $arg)" >&2; exit 64; fi
      VERSION="$arg"
      ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }

[ -n "$VERSION" ] || die "missing <version>. Usage: scripts/release.sh <version> [--yes] [--skip-checks] [--dry-run]"

# Plain X.Y.Z (optionally with a -prerelease suffix). No leading "v".
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  die "version must be semver like 0.1.5 (got: '$VERSION'; do not prefix with 'v')"
fi
TAG="v$VERSION"

# Always operate from the repo root.
cd "$(git rev-parse --show-toplevel)"

echo "==> Releasing $TAG"

# --- preconditions -----------------------------------------------------------

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || die "must be on 'main' to release (currently on '$BRANCH')"

# Allow CHANGELOG.md to be pre-edited (the "[Unreleased]" notes for this
# release); reject any other uncommitted change so the release commit stays
# focused on the version bump + changelog.
DIRTY="$(git status --porcelain --untracked-files=no | grep -v ' CHANGELOG\.md$' || true)"
if [ -n "$DIRTY" ]; then
  printf 'error: working tree has uncommitted changes other than CHANGELOG.md:\n%s\n' "$DIRTY" >&2
  exit 1
fi

if [ "$DRY_RUN" != true ]; then
  echo "==> Syncing main with origin"
  git pull --ff-only origin main
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  die "tag $TAG already exists locally"
fi
if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
  die "tag $TAG already exists on origin"
fi

RELEASE_DATE="$(date +%F)"

# Validate the CHANGELOG up front (read-only) so we fail before mutating anything.
# Exit codes from the check: 0 = has notes, 1 = empty, 2 = no "[Unreleased]" heading.
set +e
node - <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync("CHANGELOG.md", "utf8");
const marker = "## [Unreleased]";
const idx = text.indexOf(marker);
if (idx === -1) process.exit(2);
const rest = text.slice(idx + marker.length);
const nextRel = rest.search(/\n## \[/);
const body = (nextRel === -1 ? rest : rest.slice(0, nextRel)).trim();
process.exit(body ? 0 : 1);
NODE
CHANGELOG_RC=$?
set -e
[ "$CHANGELOG_RC" = 2 ] && die 'CHANGELOG.md: "## [Unreleased]" heading not found'
CHANGELOG_EMPTY=false
[ "$CHANGELOG_RC" = 1 ] && CHANGELOG_EMPTY=true

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "DRY RUN — would do the following and make no changes:"
  echo "  - git pull --ff-only origin main"
  if [ "$CHANGELOG_EMPTY" = true ] && [ "$ALLOW_EMPTY_CHANGELOG" != true ]; then
    echo "  - ABORT: CHANGELOG '[Unreleased]' is empty — add notes first or pass --allow-empty-changelog"
  fi
  [ "$SKIP_CHECKS" = true ] && echo "  - skip local checks" || echo "  - npm ci (if node_modules missing) + npm run typecheck && npm run build && npm test"
  echo "  - snapshot release files (rolled back automatically if the bump fails)"
  echo "  - npm version $VERSION --workspaces --no-git-tag-version   (bumps cli + packages/* + lockfile)"
  echo "  - bump plugin manifests to $VERSION (.claude-plugin/marketplace.json + plugins/bdd-kit/.claude-plugin/plugin.json)"
  echo "  - stamp CHANGELOG [Unreleased] -> [$VERSION] - $RELEASE_DATE (+ update compare links)"
  echo "  - node scripts/check-versions.mjs   (assert all version sources agree)"
  echo "  - git commit -m \"chore: release $TAG\""
  echo "  - git tag -a $TAG -m \"$TAG\""
  echo "  - git push --atomic origin main $TAG   (triggers npm publish)"
  exit 0
fi

if [ "$CHANGELOG_EMPTY" = true ] && [ "$ALLOW_EMPTY_CHANGELOG" != true ]; then
  die 'CHANGELOG.md "## [Unreleased]" is empty — add release notes first, or re-run with --allow-empty-changelog'
fi

# --- install deps + checks (BEFORE any mutation) -----------------------------
# node_modules must exist so `npm version` updates package-lock.json; without it,
# npm only edits the package.json files and the lockfile drifts (CI's `npm ci`
# would then fail). Install regardless of --skip-checks for that reason.

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (npm ci)"
  npm ci
fi

if [ "$SKIP_CHECKS" = true ]; then
  echo "==> Skipping local checks (--skip-checks)"
else
  echo "==> Running checks (typecheck, build, test)"
  npm run typecheck
  npm run build
  npm test
fi

# --- safety net: snapshot release-managed files for atomic rollback ----------
# `npm version` edits the workspace package.json files and only THEN reifies the
# lockfile (which can hit the registry and fail). To make the whole mutation
# all-or-nothing, snapshot every file the release touches and restore them on
# any failure / interrupt / abort that happens before the commit is made — so a
# failed bump never leaves package.json ahead of the lockfile / CHANGELOG.
# Globs mirror the "workspaces" field of the root package.json. The two
# .claude-plugin manifests are NOT npm workspaces (npm version can't touch them)
# but are bumped below in lockstep, so they belong in the snapshot set too.
RELEASE_FILES=(
  package-lock.json
  CHANGELOG.md
  cli/package.json
  .claude-plugin/marketplace.json
  plugins/bdd-kit/.claude-plugin/plugin.json
)
for p in packages/*/package.json; do
  [ -e "$p" ] && RELEASE_FILES+=("$p")
done

SNAP_DIR="$(mktemp -d)"
SNAPSHOT_TAKEN=false
MUTATION_FINALIZED=false
rollback_release_files() {
  [ "$SNAPSHOT_TAKEN" = true ] || return 0
  echo "==> Rolling back: restoring release files to their pre-release state" >&2
  for f in "${RELEASE_FILES[@]}"; do
    [ -e "$SNAP_DIR/$f" ] || continue
    mkdir -p "$(dirname "$f")"
    cp -p "$SNAP_DIR/$f" "$f"
  done
  # Drop anything we may have staged so the tree ends up exactly as we found it.
  git reset -q -- "${RELEASE_FILES[@]}" 2>/dev/null || true
}
cleanup() {
  [ "$MUTATION_FINALIZED" = true ] || rollback_release_files
  rm -rf "$SNAP_DIR"
}
trap cleanup EXIT INT TERM

for f in "${RELEASE_FILES[@]}"; do
  mkdir -p "$SNAP_DIR/$(dirname "$f")"
  cp -p "$f" "$SNAP_DIR/$f"
done
SNAPSHOT_TAKEN=true

# --- mutate: bump versions (package.json files + package-lock.json) ----------

echo "==> Bumping all workspaces to $VERSION"
npm version "$VERSION" --workspaces --no-git-tag-version >/dev/null

if git diff --name-only | grep -q '^package-lock\.json$'; then
  echo "    package-lock.json updated"
else
  die "package-lock.json was not updated by 'npm version' — refusing to release a lockfile that 'npm ci' will reject"
fi

# --- mutate: bump the Claude Code plugin manifests ---------------------------
# The plugin's version is read from these manifests, NOT from npm. They live
# outside the npm "workspaces", so `npm version --workspaces` above left them
# untouched. Bump them here so the plugin ships the same version as the npm
# packages (otherwise the plugin stays pinned to the old version even though the
# code is current — the bug this whole section exists to prevent).

echo "==> Bumping plugin manifests to $VERSION"
node - "$VERSION" <<'NODE'
const fs = require("node:fs");
const [version] = process.argv.slice(2);
// [file, accessor] — accessor knows where the version lives in each manifest.
const targets = [
  [".claude-plugin/marketplace.json", (j) => { j.metadata.version = version; }],
  ["plugins/bdd-kit/.claude-plugin/plugin.json", (j) => { j.version = version; }],
];
for (const [file, set] of targets) {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  set(json);
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`    ${file}: version -> ${version}`);
}
NODE

# --- mutate: stamp the CHANGELOG ---------------------------------------------

echo "==> Stamping CHANGELOG.md"
node - "$VERSION" "$RELEASE_DATE" "$ALLOW_EMPTY_CHANGELOG" <<'NODE'
const fs = require("node:fs");
const [version, date, allowEmpty] = process.argv.slice(2);
const file = "CHANGELOG.md";
const text = fs.readFileSync(file, "utf8");
const marker = "## [Unreleased]";
const idx = text.indexOf(marker);
if (idx === -1) {
  console.error('CHANGELOG.md: "## [Unreleased]" heading not found');
  process.exit(1);
}
const rest = text.slice(idx + marker.length);
const nextRel = rest.search(/\n## \[/);
const body = (nextRel === -1 ? rest : rest.slice(0, nextRel)).trim();
if (!body && allowEmpty !== "true") {
  console.error('CHANGELOG.md: "## [Unreleased]" is empty.');
  process.exit(2);
}
const tail = nextRel === -1 ? "" : rest.slice(nextRel);
let out =
  text.slice(0, idx) +
  `## [Unreleased]\n\n## [${version}] - ${date}\n\n` +
  (body ? body + "\n" : "") +
  tail;
out = out.replace(/\n{3,}/g, "\n\n");

// Update the compare-link reference definitions (Keep a Changelog style), if present:
//   [Unreleased]: .../compare/v<prev>...HEAD   ->   .../compare/v<version>...HEAD
//   + insert     [<version>]: .../compare/v<prev>...v<version>
const linkRe = /^\[Unreleased\]:\s*(https?:\/\/\S+\/compare\/)v([0-9A-Za-z.\-]+)\.\.\.HEAD\s*$/m;
const m = out.match(linkRe);
if (m) {
  const base = m[1];
  const prev = m[2];
  if (prev !== version) {
    out = out.replace(
      linkRe,
      `[Unreleased]: ${base}v${version}...HEAD\n[${version}]: ${base}v${prev}...v${version}`,
    );
  }
} else {
  console.error("    note: no '[Unreleased]: .../compare/vX...HEAD' link found — skipping link update");
}

fs.writeFileSync(file, out);
console.log(`    CHANGELOG.md: stamped [${version}] - ${date}`);
NODE

# --- assert: every version source now agrees ---------------------------------
# Belt-and-suspenders: if the bump logic above ever regresses (a renamed
# manifest, a bad accessor), fail here BEFORE committing/tagging. On failure the
# EXIT trap rolls the release files back, so nothing is left half-bumped.

echo "==> Verifying all version sources agree on $VERSION"
node scripts/check-versions.mjs

# --- review + confirm --------------------------------------------------------

echo ""
echo "==> Changes to be committed:"
git --no-pager diff --stat -- "${RELEASE_FILES[@]}"
echo ""

if [ "$ASSUME_YES" != true ]; then
  printf "Commit and push main + %s atomically (this triggers npm publish via the Release workflow)? [y/N] " "$TAG"
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) die "aborted by user — release files rolled back; nothing committed, tagged, or pushed" ;;
  esac
fi

# --- commit, tag, then push branch + tag atomically --------------------------
# Push main and the tag in ONE atomic operation so we never end up with the
# release commit on main but no tag (which would leave publish un-triggered and
# hard to re-run). --atomic = all refs succeed or none do.

echo "==> Committing release"
git add -- "${RELEASE_FILES[@]}"
git commit -m "chore: release $TAG"
# Past this point the bump is captured in a commit; a later tag/push failure must
# NOT roll the files back (they belong to the commit now — just re-run the push).
MUTATION_FINALIZED=true

echo "==> Tagging $TAG"
git tag -a "$TAG" -m "$TAG"

echo "==> Pushing main + $TAG atomically (this starts the Release workflow)"
# In a normal terminal the SSH remote works. In a restricted/sandboxed shell
# where SSH is blocked, push over HTTPS instead, e.g.:
#   git -c credential.helper='!gh auth git-credential' \
#     push --atomic https://github.com/Pound79/bdd-kit.git HEAD:main "$TAG"
git push --atomic origin main "$TAG"

echo ""
echo "==> Done. Verify the release:"
echo "    gh run watch                                  # watch the Release workflow"
echo "    npm view @pound79/bdd-kit version             # expect $VERSION"
echo "    npm view @pound79/bdd-traceability version    # expect $VERSION"
echo "    gh release create $TAG --generate-notes       # optional GitHub Release"
