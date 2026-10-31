#!/usr/bin/env node
import { updateManifestHashes } from "./update.js";
import { discoverConfig } from "./config.js";
import { parseCliArgs, runCli } from "./cli-args.js";
import { describeChange } from "./cli-update-format.js";
import { printText } from "./output.js";

const main = async (): Promise<void> => {
  const { flags, manifest, root, linkId } = parseCliArgs(process.argv.slice(2), "update");
  const config = discoverConfig({ manifest, root });
  const dryRun = flags.has("--dry-run");
  const updated = await updateManifestHashes(config.manifestPath, config.repoRoot, {
    linkId,
    dryRun,
  });

  if (updated.changes.length === 0) {
    // 変更が無いときは manifest を書き込まないので、更新したとは表示しない。
    printText("No hash changes; manifest already up to date.");
    return;
  }
  for (const change of updated.changes) {
    printText(describeChange(change));
  }

  if (dryRun) {
    printText("\nDry run — manifest not modified.");
    return;
  }

  const scope = linkId === undefined ? `${updated.links.length} link(s)` : `link "${linkId}"`;
  printText(`\nTraceability manifest updated: ${scope} refreshed.`);
};

runCli("traceability update", main);
