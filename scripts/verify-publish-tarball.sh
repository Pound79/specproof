#!/usr/bin/env bash
#
# Refuse to publish a release tarball unless npm would read exactly the
# package.json checked out at this commit from it:
#
#   scripts/verify-publish-tarball.sh <tarball> <trusted-package.json>
#
# Run by the publish job of .github/workflows/release.yml. The check itself is
# verify-publish-manifest.mjs, which reads the tarball with the pacote of the
# npm that will publish, so it sees exactly what `npm publish <tarball>` sees.
# This wrapper only finds that pacote. The tarball is never parsed with the
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

# The pacote bundled with the npm next to this node. setup-node puts both node
# and npm in <toolcache>/node/<version>/<arch>/bin and npm under
# ../lib/node_modules/npm (Homebrew uses the same layout).
node_bin=$(command -v node) || refuse "node is not on PATH"
pacote_dir="$(dirname "$node_bin")/../lib/node_modules/npm/node_modules/pacote"
[ -d "$pacote_dir" ] || refuse "cannot find npm's pacote at $pacote_dir"

node "$script_dir/verify-publish-manifest.mjs" "$pacote_dir" "$tarball" "$trusted_manifest"
