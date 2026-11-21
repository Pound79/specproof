#!/usr/bin/env node
import { updateManifestHashes } from "./update.js";
import { discoverConfig } from "./config.js";
import { CliUsageError, parseCliArgs, runCli } from "./cli-args.js";
import { printable } from "./display-text.js";
import { recordSpecSource } from "./spec-source-record.js";
import { readSourceToRecord } from "./spec-sources.js";
import type { TraceabilityConfig } from "./config.js";
import {
  describeChange,
  describeHeadMismatch,
  describeRecorded,
  describeSkip,
  describeUpdateScope,
} from "./cli-update-format.js";
import { printText } from "./output.js";

// 取り込み元の ref が今指すコミットを manifest に記録する。hash は更新しない。
const recordSource = async (
  config: TraceabilityConfig,
  name: string,
  { dryRun, allowHeadMismatch }: { dryRun: boolean; allowHeadMismatch: boolean },
): Promise<void> => {
  const source = config.specSources?.find((candidate) => candidate.name === name);
  if (source === undefined) {
    throw new CliUsageError(
      `--record-spec-source: no spec source named ${printable(JSON.stringify(name))} in specSources`,
    );
  }
  const read = await readSourceToRecord(config.repoRoot, source);
  if (read === undefined) {
    throw new Error(
      `spec source ${JSON.stringify(name)}: could not read ref ${JSON.stringify(source.ref)} in ${JSON.stringify(source.repo)} (it must be the root of a non-partial clone you own, with the ref fetched)`,
    );
  }
  if (read.missingPaths.length > 0) {
    throw new Error(
      `spec source ${JSON.stringify(name)}: ${source.ref} has no ${read.missingPaths.map((entry) => JSON.stringify(entry)).join(", ")}; check specSources[].paths before recording`,
    );
  }
  // 取り込みのスクリプトが作業ツリー（HEAD）から写していると、記録する ref のコミットと写した中身が食い違う。
  const mismatch = describeHeadMismatch(name, source.ref, read);
  if (mismatch !== undefined && !allowHeadMismatch) {
    throw new Error(
      `${mismatch}; if the import read the working tree, switch the source to ${source.ref} and import again. If the import read ${source.ref} itself, pass --allow-head-mismatch to record anyway`,
    );
  }
  const { previous } = await recordSpecSource(
    config.manifestPath,
    config.repoRoot,
    name,
    read.commit,
    {
      dryRun,
    },
  );
  printText(describeRecorded(name, source.ref, read, previous));
  if (mismatch !== undefined) {
    printText(`${mismatch} (recorded anyway: --allow-head-mismatch)`);
  }
  printText(
    "(This records the commit the ref points to; it checks the committed HEAD against it but not uncommitted changes, and does not verify what the import command copied.)",
  );
  if (dryRun) printText("\nDry run — manifest not modified.");
};

const main = async (): Promise<void> => {
  const {
    flags,
    manifest,
    root,
    linkIds,
    specRefs,
    recordSpecSource: sourceName,
  } = parseCliArgs(process.argv.slice(2), "update");
  const config = discoverConfig({ manifest, root });
  const dryRun = flags.has("--dry-run");
  const allowHeadMismatch = flags.has("--allow-head-mismatch");
  if (sourceName !== undefined) {
    if (linkIds !== undefined || specRefs !== undefined) {
      throw new CliUsageError(
        "--record-spec-source cannot be combined with --link-id or --spec-ref",
      );
    }
    await recordSource(config, sourceName, { dryRun, allowHeadMismatch });
    return;
  }
  if (allowHeadMismatch) {
    throw new CliUsageError("--allow-head-mismatch can only be used with --record-spec-source");
  }
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
