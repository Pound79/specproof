#!/usr/bin/env node
import { checkDrift } from "./check.js";
import { discoverConfig } from "./config.js";
import { parseCliArgs, runCli } from "./cli-args.js";
import {
  attachFailsUnderStrict,
  describeAllReferencesMissing,
  describeBothSidesChanged,
  describeEntry,
  describeHiddenWarnings,
  describeLinkHeading,
  describeWarning,
  isCheckFailure,
  selectWarningsForDisplay,
  toGithubAnnotation,
  toGithubWarningAnnotation,
  warningFailsUnderStrict,
} from "./cli-check-format.js";
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

  if (flags.has("--github-annotations")) {
    for (const entry of report.entries) {
      console.error(toGithubAnnotation(entry));
    }
    // 参照ごとの注釈だけだと drift に見えるので、全参照 missing ならルートを確かめる案内も注釈にする。
    const rootHint = report.allReferencesMissing
      ? [{ message: describeAllReferencesMissing(report.driftCount) }]
      : [];
    for (const warning of [...shownWarnings, ...rootHint]) {
      console.error(toGithubWarningAnnotation(warning));
    }
  }

  if (flags.has("--json")) {
    printJson({
      ...report,
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
      }
    }
    if (!report.allReferencesMissing) {
      printText("\nNext: review the changes, sync features if needed, then run: specproof-update");
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
