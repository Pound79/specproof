#!/usr/bin/env node
import { updateManifestHashes } from "./update.js";
import { discoverConfig } from "./config.js";
import { parseCliArgs, runCli } from "./cli-args.js";
import { describeChange, describeSkip, describeUpdateScope } from "./cli-update-format.js";
import { printText } from "./output.js";

const main = async (): Promise<void> => {
  const { flags, manifest, root, linkIds, specRefs } = parseCliArgs(
    process.argv.slice(2),
    "update",
  );
  const config = discoverConfig({ manifest, root });
  const dryRun = flags.has("--dry-run");
  const updated = await updateManifestHashes(config.manifestPath, config.repoRoot, {
    linkIds,
    specRefs,
    dryRun,
  });

  const skipped = updated.skipped ?? [];
  for (const change of updated.changes) {
    printText(describeChange(change));
  }
  // 飛ばしたリンクは bless していない。書いた分があっても終了コードを 1 にして、黙って済ませない。
  for (const skip of skipped) {
    printText(describeSkip(skip));
  }
  if (skipped.length > 0) {
    process.exitCode = 1;
  }

  if (updated.changes.length === 0) {
    // 変更が無いときは manifest を書き込まないので、更新したとは表示しない。
    printText(
      skipped.length > 0
        ? "No hash changes written; the skipped link(s) above were not blessed."
        : "No hash changes; manifest already up to date.",
    );
    return;
  }

  if (dryRun) {
    printText("\nDry run — manifest not modified.");
    return;
  }

  // 数えるのは hash が変わったリンクと参照だけ（manifest の全リンク数ではない）。
  const changedLinkCount = new Set(updated.changes.map((change) => change.linkId)).size;
  const scope =
    specRefs === undefined
      ? describeUpdateScope(linkIds, changedLinkCount)
      : `spec ref(s) refreshed in ${changedLinkCount} link(s)`;
  const refreshed = specRefs === undefined ? `${scope} refreshed` : scope;
  printText(
    `\nTraceability manifest updated: ${refreshed} (${updated.changes.length} hash(es) changed).`,
  );
};

runCli("traceability update", main);
