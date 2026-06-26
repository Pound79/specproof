#!/usr/bin/env node
import { updateManifestHashes } from "./update.js";
import { discoverConfig } from "./config.js";
import { parseCliArgs, runCli } from "./cli-args.js";

const main = async (): Promise<void> => {
  const { manifest, root, linkId } = parseCliArgs(process.argv.slice(2));
  const config = discoverConfig({ manifest, root });
  const updated = await updateManifestHashes(
    config.manifestPath,
    config.repoRoot,
    { linkId },
  );
  const scope =
    linkId === undefined
      ? `${updated.links.length} link(s)`
      : `link "${linkId}"`;
  console.log(`Traceability manifest updated: ${scope} refreshed.`);
};

runCli("traceability update", main);
