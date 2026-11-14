#!/usr/bin/env node
import { findBlessedCommits, MAX_COMMITS } from "./bless-history.js";
import { checkDrift } from "./check.js";
import { discoverConfig } from "./config.js";
import { parseCliArgs, runCli } from "./cli-args.js";
import {
  attachFailsUnderStrict,
  describeAllReferencesMissing,
  describeBlessedCommit,
  describeBothSidesChanged,
  GIT_HISTORY_UNAVAILABLE,
  BLESS_HISTORY_INCOMPLETE,
  describeEntry,
  describeHiddenWarnings,
  describeLinkHeading,
  describeNextSteps,
  describeWarning,
  isCheckFailure,
  selectWarningsForDisplay,
  toGithubAnnotation,
  toGithubWarningAnnotation,
  warningFailsUnderStrict,
} from "./cli-check-format.js";
import { loadManifest } from "./manifest.js";
import { printJson, printText } from "./output.js";

const main = async (): Promise<void> => {
  const { flags, manifest, root } = parseCliArgs(process.argv.slice(2), "check");
  const config = discoverConfig({ manifest, root });
  const report = await checkDrift(config.manifestPath, config.repoRoot, {
    featuresDir: config.featuresDir,
    implGlobs: config.implGlobs,
    gherkin: config.gherkin,
    language: config.language,
    configFile: config.configFile,
    unknownConfigKeys: config.unknownConfigKeys ?? [],
  });
  const strict = flags.has("--strict");
  const strictOptions = {
    strictUnregisteredImpl: config.strictUnregisteredImpl,
    strictUnregisteredSpecHeadings: config.strictUnregisteredSpecHeadings,
    strictFeatureLint: config.strictFeatureLint,
  };
  const display = selectWarningsForDisplay(report.warnings);
  const shownWarnings = display.shown;
  // --since-bless は drift があるときだけ git を見る。全参照 missing はルートの取り違えなので探さない。
  const history =
    flags.has("--since-bless") && !report.clean && !report.allReferencesMissing
      ? await findBlessedCommits(
          config.repoRoot,
          report.entries,
          await loadManifest(config.manifestPath),
        )
      : undefined;
  const blessedByEntry = new Map(
    history?.available ? report.entries.map((entry, index) => [entry, history.commits[index]]) : [],
  );

  if (flags.has("--github-annotations")) {
    // 全参照 missing のときは、参照ごとの注釈（同期と update を勧める）を出さず、ルートを確かめる
    // 案内 1 件に集約して先頭に出す。GitHub は 1 step の warning 注釈を 10 件までしか表示しないので、
    // 後ろに置くと参照が 10 件以上ある manifest で案内が見えなくなる。
    const rootHint = report.allReferencesMissing
      ? [{ message: describeAllReferencesMissing(report.driftCount) }]
      : [];
    const annotatedEntries = report.allReferencesMissing ? [] : report.entries;
    for (const entry of annotatedEntries) {
      console.error(toGithubAnnotation(entry));
    }
    for (const warning of [...rootHint, ...shownWarnings]) {
      console.error(toGithubWarningAnnotation(warning));
    }
  }

  if (flags.has("--json")) {
    printJson({
      ...report,
      // --since-bless を付けたときだけ、探した参照に blessedCommit（見つからなければ null）を足す。
      entries: report.entries.map((entry) => {
        const commit = blessedByEntry.get(entry);
        return commit === undefined ? entry : { ...entry, blessedCommit: commit };
      }),
      ...(history === undefined
        ? {}
        : { gitHistoryAvailable: history.available, blessHistoryIncomplete: history.incomplete }),
      warnings: attachFailsUnderStrict(report.warnings, strictOptions),
    });
  } else if (report.clean) {
    printText("Traceability check: clean (no drift detected).");
  } else {
    printText(
      `Traceability check: ${report.driftCount} drifted reference(s) across ${report.driftLinkCount} link(s).`,
    );
    const linkIds = [...new Set(report.entries.map((entry) => entry.linkId))];
    for (const linkId of linkIds) {
      const entries = report.entries.filter((entry) => entry.linkId === linkId);
      printText(`\n${describeLinkHeading(linkId)}`);
      for (const entry of entries) {
        printText(`  ${describeEntry(entry)}`);
        const blessed = describeBlessedCommit(
          entry,
          blessedByEntry.get(entry),
          MAX_COMMITS,
          history?.prefix,
        );
        if (blessed !== undefined) {
          printText(`    ${blessed}`);
        }
      }
    }
    if (history !== undefined && !history.available) {
      printText(`\n${GIT_HISTORY_UNAVAILABLE}`);
    }
    if (history?.incomplete === true) {
      printText(`\n${BLESS_HISTORY_INCOMPLETE}`);
    }
    if (!report.allReferencesMissing) {
      printText("");
      for (const line of describeNextSteps(report.entries)) {
        printText(line);
      }
    }
  }

  if (!flags.has("--json") && report.allReferencesMissing) {
    printText("");
    printText(describeAllReferencesMissing(report.driftCount, config.repoRoot));
  }

  if (!flags.has("--json") && report.bothSidesChanged.length > 0) {
    printText("");
    for (const linkId of report.bothSidesChanged) {
      printText(describeBothSidesChanged(linkId));
    }
  }

  if (!flags.has("--json") && shownWarnings.length > 0) {
    printText("");
    for (const warning of shownWarnings) {
      printText(describeWarning(warning, warningFailsUnderStrict(warning.kind, strictOptions)));
    }
    const hasHardWarning = shownWarnings.some((warning) =>
      warningFailsUnderStrict(warning.kind, strictOptions),
    );
    for (const line of describeHiddenWarnings(display)) {
      printText(line);
    }
    if (!strict && hasHardWarning) {
      printText(
        "(run specproof-check --strict to treat the [warning] item(s) above as errors; [advisory] item(s) require an explicit opt-in — see docs/config-schema.md)",
      );
    }
  }

  process.exitCode = isCheckFailure(report, strict, strictOptions) ? 1 : 0;
};

runCli("traceability check", main);
