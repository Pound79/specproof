#!/usr/bin/env node
import { findBlessedCommits, MAX_COMMITS } from "./bless-history.js";
import { checkDrift, type DriftWarning } from "./check.js";
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
  describeExcludedAdvisories,
  describeHiddenWarnings,
  describeLinkHeading,
  describeNextSteps,
  describeSharedSpecSections,
  describeWarning,
  isCheckFailure,
  selectWarningsForDisplay,
  toGithubAnnotation,
  toGithubWarningAnnotation,
  warningFailsUnderStrict,
} from "./cli-check-format.js";
import {
  describeWarningSummary,
  orderWarningsByGroup,
  type WarningGroup,
  warningGroup,
} from "./cli-check-warning-groups.js";
import { describeImplExcludeHint } from "./impl-exclude-hint.js";
import { loadManifest } from "./manifest.js";
import { printJson, printText } from "./output.js";

const main = async (): Promise<void> => {
  const { flags, manifest, root } = parseCliArgs(process.argv.slice(2), "check");
  const config = discoverConfig({ manifest, root });
  const report = await checkDrift(config.manifestPath, config.repoRoot, {
    featuresDir: config.featuresDir,
    implGlobs: config.implGlobs,
    implExcludeGlobs: config.implExcludeGlobs,
    specHeadingIgnore: config.specHeadingIgnore,
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
  // 直すものを先に並べる（テキストと注釈の両方。GitHub は 1 step の注釈を 10 件までしか出さない）。
  const display = selectWarningsForDisplay(orderWarningsByGroup(report.warnings, strictOptions));
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
  // シンボリックリンクの参照は実体のパスで履歴を辿る。示す差分も実体のパスで取る。
  const searchedPathByEntry = new Map(
    history?.available ? report.entries.map((entry, index) => [entry, history.paths[index]]) : [],
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
        if (commit === undefined) return entry;
        const searchedPath = searchedPathByEntry.get(entry);
        return searchedPath === undefined || searchedPath === entry.path
          ? { ...entry, blessedCommit: commit }
          : { ...entry, blessedCommit: commit, blessedPath: searchedPath };
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
          searchedPathByEntry.get(entry),
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
    const sharedSections = report.allReferencesMissing
      ? []
      : describeSharedSpecSections(report.entries);
    if (sharedSections.length > 0) {
      printText("");
      for (const line of sharedSections) {
        printText(line);
      }
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
    const summary = describeWarningSummary(report.warnings, strictOptions);
    if (summary !== undefined) printText(summary);
    // 隠した件数の行は、その種類の組の末尾に出す（参考の見出しの下に直すものの残りを出さない）。
    const hiddenLinesOf = (group: WarningGroup): string[] =>
      describeHiddenWarnings({
        ...display,
        hiddenByKind: Object.fromEntries(
          Object.entries(display.hiddenByKind).filter(
            ([kind]) => warningGroup(kind as DriftWarning["kind"], strictOptions) === group,
          ),
        ),
      });
    for (const group of ["fix", "reference"] as const) {
      const members = shownWarnings.filter(
        (warning) => warningGroup(warning.kind, strictOptions) === group,
      );
      if (members.length === 0) continue;
      printText(group === "fix" ? "To fix:" : "For reference:");
      for (const warning of members) {
        printText(describeWarning(warning, warningFailsUnderStrict(warning.kind, strictOptions)));
      }
      for (const line of hiddenLinesOf(group)) {
        printText(line);
      }
    }
    const hasHardWarning = shownWarnings.some((warning) =>
      warningFailsUnderStrict(warning.kind, strictOptions),
    );
    if (!strict && hasHardWarning) {
      printText(
        "(run specproof-check --strict to treat the [warning] item(s) above as errors; [advisory] item(s) require an explicit opt-in — see docs/config-schema.md)",
      );
    }
  }

  const excludedLine = describeExcludedAdvisories(report.excludedAdvisories);
  if (!flags.has("--json") && excludedLine !== undefined) {
    printText(excludedLine);
  }

  // 表示の上限で隠す前の全件で数える。
  const implExcludeHint = describeImplExcludeHint(report.warnings, config.implExcludeGlobs);
  if (!flags.has("--json") && implExcludeHint !== undefined) {
    printText(implExcludeHint);
  }

  process.exitCode = isCheckFailure(report, strict, strictOptions) ? 1 : 0;
};

runCli("traceability check", main);
