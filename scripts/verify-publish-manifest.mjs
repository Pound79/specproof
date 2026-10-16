// Refuse to publish a release tarball unless npm would read exactly the
// package.json checked out at this commit from it:
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
// token exchange, honours a top-level `tag`, and fills in `gitHead` by
// following `.git/HEAD` in the extracted tree to any file on the runner.
//
// So, using the pacote bundled with the npm that will publish (<pacote-dir>,
// the runner's toolchain, not project dependencies):
//   1. pacote.extract must yield a package.json byte-identical to the trusted
//      one from the checkout (`npm pack` stores package.json unchanged), which
//      covers every field npm reads from it at once;
//   2. the extracted tree must have no `.git`, so prepare cannot read files
//      outside the tarball into `gitHead`;
//   3. npm's own manifest call must agree on name and version and set no
//      `gitHead`.
// Other tarball contents (files, links, odd entry names) are what gets
// published; tampering with them in the build job is out of scope here, and
// pacote itself refuses links and paths outside the extraction directory.

import { lstatSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

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

const main = async () => {
  const pacote = createRequire(import.meta.url)(path.resolve(pacoteDir));
  const spec = `file:${path.resolve(tarball)}`;
  const trusted = readFileSync(trustedManifestPath);
  const { name, version } = JSON.parse(trusted.toString("utf8"));

  const extracted = tempDir("verify-publish-extract-");
  await pacote.extract(spec, extracted, { cache: tempDir("verify-publish-cache-") });

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
    cache: tempDir("verify-publish-cache-"),
    fullMetadata: true,
    fullReadJson: true,
  });
  if (manifest.name !== name || manifest.version !== version) {
    refuse(`npm reads ${manifest.name}@${manifest.version}, expected ${name}@${version}`);
  }
  if (manifest.gitHead !== undefined) {
    refuse("npm fills in gitHead for this tarball");
  }
};

main().catch((error) => refuse(`cannot verify the tarball (${error.message})`));
