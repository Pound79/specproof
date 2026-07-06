#!/usr/bin/env node
import { updateManifestHashes, type UpdateChange } from "./update.js";
import { discoverConfig } from "./config.js";
import { parseCliArgs, runCli } from "./cli-args.js";

// "PENDING" is the placeholder hash specproof-new-feature writes for a freshly
// scaffolded ref (see docs/methodology.md); showing it verbatim instead of an
// 8-char slice makes a first bless ("PENDING -> a1b2c3d4") visually distinct
// from a re-bless ("a1b2c3d4 -> e5f6a7b8").
const shortHash = (hash: string): string =>
  hash === "PENDING" ? hash : hash.slice(0, 8);

const describeChange = (change: UpdateChange): string => {
  const location = change.heading
    ? `${change.path} § ${change.heading}`
    : change.path;
  return `${change.linkId} ${change.side} ${location}: ${shortHash(change.oldHash)} -> ${shortHash(change.newHash)}`;
};

const main = async (): Promise<void> => {
  const { flags, manifest, root, linkId } = parseCliArgs(process.argv.slice(2));
  const config = discoverConfig({ manifest, root });
  const dryRun = flags.has("--dry-run");
  const updated = await updateManifestHashes(
    config.manifestPath,
    config.repoRoot,
    { linkId, dryRun },
  );

  if (updated.changes.length === 0) {
    console.log("No hash changes; manifest already up to date.");
  } else {
    for (const change of updated.changes) {
      console.log(describeChange(change));
    }
  }

  if (dryRun) {
    console.log("\nDry run — manifest not modified.");
    return;
  }

  const scope =
    linkId === undefined
      ? `${updated.links.length} link(s)`
      : `link "${linkId}"`;
  console.log(`\nTraceability manifest updated: ${scope} refreshed.`);
};

runCli("traceability update", main);
