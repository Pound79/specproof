#!/usr/bin/env node
import { groupChangesSinceBless } from "./bless-changes.js";
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
import {
  CHANGES_SINCE_BLESS_INCOMPLETE,
  describeChangesSinceBless,
} from "./cli-check-changes-format.js";
import { createGitRunner } from "./git-runner.js";
import { describeImplExcludeHint } from "./impl-exclude-hint.js";
import { loadManifest } from "./manifest.js";
import { specSourceWarnings } from "./spec-source-warnings.js";
import { checkSpecSources } from "./spec-sources.js";
import { printJson, printText } from "./output.js";

const main = async (): Promise<void> => {
  const { flags, manifest, root } = parseCliArgs(process.argv.slice(2), "check");
  const config = discoverConfig({ manifest, root });
  const driftReport = await checkDrift(config.manifestPath, config.repoRoot, {
    featuresDir: config.featuresDir,
    implGlobs: config.implGlobs,
    implExcludeGlobs: config.implExcludeGlobs,
    specHeadingIgnore: config.specHeadingIgnore,
    gherkin: config.gherkin,
    language: config.language,
    configFile: config.configFile,
    unknownConfigKeys: config.unknownConfigKeys ?? [],
  });
  // 写した仕様の取り込み元。--spec-sources を付けたときだけ読む（既定では、設定が指すディレクトリで git を
  // 起動しない）。取り込み元が手元に無ければ警告を出さずに飛ばす。
  const specSources =
    config.specSources === undefined || !flags.has("--spec-sources")
      ? undefined
      : await checkSpecSources(
          config.repoRoot,
          config.specSources,
          (await loadManifest(config.manifestPath)).specSources ?? {},
        );
  const report = {
    ...driftReport,
    warnings: [
      ...driftReport.warnings,
      ...(specSources === undefined || config.specSources === undefined
        ? []
        : specSourceWarnings(config.specSources, specSources)),
    ],
  };
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
  // 探索とコミットごとのまとめは、git の起動の上限を共有する。
  const git =
    flags.has("--since-bless") && !report.clean && !report.allReferencesMissing
      ? createGitRunner(config.repoRoot)
      : undefined;
  const sinceBlessManifest =
    git === undefined ? undefined : await loadManifest(config.manifestPath);
  const history =
    git === undefined || sinceBlessManifest === undefined
      ? undefined
      : await findBlessedCommits(config.repoRoot, report.entries, sinceBlessManifest, {
          runner: git,
        });
  const changes =
    git !== undefined && sinceBlessManifest !== undefined && history?.available === true
      ? await groupChangesSinceBless(git, report.entries, history, sinceBlessManifest)
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
      // --since-bless を付けて履歴を辿れたときだけ、bless の後に参照を変えたコミットのまとめを足す。
      ...(changes === undefined
        ? {}
        : {
            sinceBless: {
              commits: changes.commits,
              uncommitted: changes.uncommitted,
              notGrouped: changes.notGrouped,
              incomplete: changes.incomplete,
            },
          }),
      warnings: attachFailsUnderStrict(report.warnings, strictOptions),
      ...(specSources === undefined ? {} : { specSources }),
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
    const changeLines = changes === undefined ? [] : describeChangesSinceBless(changes);
    if (changeLines.length > 0) {
      printText("");
      for (const line of changeLines) {
        printText(line);
      }
    }
    if (history?.incomplete === true) {
      printText(`\n${BLESS_HISTORY_INCOMPLETE}`);
    }
    if (changes?.incomplete === true) {
      printText(`\n${CHANGES_SINCE_BLESS_INCOMPLETE}`);
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
