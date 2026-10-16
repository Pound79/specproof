// Refuse to publish a release tarball unless npm would publish exactly the
// manifest checked out at this commit from it:
//
//   node scripts/verify-publish-manifest.mjs <pacote-dir> <tarball> <trusted-package.json>
//
// Run by the publish job of .github/workflows/release.yml, which holds
// `id-token: write`. The tarball comes from the build job, where dependency code
// runs, so it is untrusted. `npm publish <tarball>` reads its manifest with
// `pacote.manifest(spec, { fullMetadata: true, fullReadJson: true })`
// (lib/commands/publish.js), which extracts the tarball and reads the
// package.json it finds there. It then applies that manifest's `publishConfig`
// as npm config (proxy, TLS, scoped registry) for the publish and its OIDC
// token exchange, honours a top-level `tag`, and publishes fields that npm's
// prepare derives from files in the tarball (an install script from `*.gyp`,
// a start script from `server.js`, contributors from `AUTHORS`, gitHead by
// following `.git/HEAD` to any file on the runner).
//
// So, using the pacote bundled with the npm that will publish (<pacote-dir>,
// the runner's toolchain, not project dependencies) and npm's own cache
// (`npm_config_cache`, set by the workflow) so extraction happens in the same
// place as `npm publish`'s:
//   1. pacote.extract must yield a package.json byte-identical to the trusted
//      one from the checkout (`npm pack` stores package.json unchanged);
//   2. the extracted tree must have no `.git`;
//   3. npm's own manifest call must equal the trusted package.json, except for
//      DERIVED_FIELDS below.
// Other tarball contents (files, links, odd entry names) are what gets
// published; tampering with them in the build job is out of scope here, and
// pacote itself refuses links and paths outside the extraction directory.

import { lstatSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

// Fields npm's manifest may add or rewrite. `author` and `bugs` are normalized
// from the trusted package.json (`author`, `repository`); `readme` and
// `readmeFilename` come from the README, which is published content anyway;
// the rest is pacote's bookkeeping. Measured on `npm pack` output of both
// packages; allow another field here only after reviewing where npm takes it
// from.
const DERIVED_FIELDS = new Set([
  "author",
  "bugs",
  "readme",
  "readmeFilename",
  "_id",
  "_integrity",
  "_resolved",
  "_from",
]);

const [pacoteDir, tarball, trustedManifestPath] = process.argv.slice(2);
if (!pacoteDir || !tarball || !trustedManifestPath) {
  console.error("usage: verify-publish-manifest.mjs <pacote-dir> <tarball> <trusted-package.json>");
  process.exit(2);
}

// Messages can carry tarball-controlled text (entry names in pacote errors);
// keep it from starting a new line or a workflow command.
const loggable = (text) => String(text).replace(/[\r\n]+/g, " ").replaceAll("::", ": :");

const refuse = (reason) => {
  console.log(`::error::${loggable(tarball)}: ${loggable(reason)} — refusing to publish`);
  process.exit(1);
};

const tempDir = (prefix) => mkdtempSync(path.join(os.tmpdir(), prefix));

// npm keeps its cacache under <cache>/_cacache and extracts tarballs in its tmp.
// The workflow sets npm_config_cache for both this check and `npm publish`;
// without it the check would extract somewhere else than npm does.
const npmCache = process.env.npm_config_cache;
const cacheDir = () => path.join(npmCache, "_cacache");

const main = async () => {
  if (!npmCache) refuse("npm_config_cache is not set, so npm's extraction place is unknown");
  const pacote = createRequire(import.meta.url)(path.resolve(pacoteDir));
  const spec = `file:${path.resolve(tarball)}`;
  const trusted = readFileSync(trustedManifestPath);
  const trustedManifest = JSON.parse(trusted.toString("utf8"));

  const extracted = tempDir("verify-publish-extract-");
  await pacote.extract(spec, extracted, { cache: cacheDir() });

  try {
    lstatSync(path.join(extracted, ".git"));
    refuse("the tarball contains .git, which npm would follow to fill in gitHead");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (!readFileSync(path.join(extracted, "package.json")).equals(trusted)) {
    refuse(`npm would read a package.json that differs from ${trustedManifestPath}`);
  }

  const manifest = await pacote.manifest(spec, {
    cache: cacheDir(),
    fullMetadata: true,
    fullReadJson: true,
  });
  const fields = new Set([...Object.keys(manifest), ...Object.keys(trustedManifest)]);
  for (const field of fields) {
    if (DERIVED_FIELDS.has(field)) continue;
    if (!isDeepStrictEqual(manifest[field], trustedManifest[field])) {
      refuse(`npm would publish ${field} as ${JSON.stringify(manifest[field])}, not as in package.json`);
    }
  }
};

main().catch((error) => refuse(`cannot verify the tarball (${error.message})`));
