#!/usr/bin/env bash
#
# Refuse to publish a release tarball unless npm would publish exactly the
# manifest checked out at this commit from it:
#
#   scripts/verify-publish-tarball.sh <tarball> <trusted-package.json>
#
# Run by the publish job of .github/workflows/release.yml. The check itself is
# verify-publish-manifest.mjs, which reads the tarball with the pacote of the
# npm that will publish and in npm's cache, so it sees exactly what `npm
# publish <tarball>` sees: the package.json must be byte-identical to the
# checked-out one, there must be no `.git`, and npm's manifest must not add or
# change fields beyond the few it derives. This wrapper only finds that pacote. The tarball is never parsed with the
# system tar: its listing can disagree with node-tar (npm), which is how
# earlier checks were bypassed.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <tarball> <trusted-package.json>" >&2
  exit 2
fi
tarball=$1
trusted_manifest=$2
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

refuse() {
  echo "::error::$tarball: $1 — refusing to publish"
  exit 1
}

# The pacote bundled with the npm that the publish step will run: the `npm` on
# PATH is a link to <npm>/bin/npm-cli.js, and pacote is <npm>/node_modules/pacote.
npm_bin=$(command -v npm) || refuse "npm is not on PATH"
npm_cli=$(realpath "$npm_bin") || refuse "cannot resolve $npm_bin"
pacote_dir="$(dirname "$npm_cli")/../node_modules/pacote"
[ -d "$pacote_dir" ] || refuse "cannot find the pacote of $npm_cli at $pacote_dir"

node "$script_dir/verify-publish-manifest.mjs" "$pacote_dir" "$tarball" "$trusted_manifest"
