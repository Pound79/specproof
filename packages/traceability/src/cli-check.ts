#!/usr/bin/env node
import { checkDrift } from "./check.js";
import { discoverConfig } from "./config.js";
import { parseCliArgs, runCli } from "./cli-args.js";
import {
  attachFailsUnderStrict,
  describeEntry,
  describeWarning,
  isCheckFailure,
  selectWarningsForDisplay,
  toGithubAnnotation,
  toGithubWarningAnnotation,
  warningFailsUnderStrict,
} from "./cli-check-format.js";

const main = async (): Promise<void> => {
  const { flags, manifest, root } = parseCliArgs(process.argv.slice(2));
  const config = discoverConfig({ manifest, root });
  const report = await checkDrift(config.manifestPath, config.repoRoot, {
    featuresDir: config.featuresDir,
    reasonRequiredTags: [config.fixmeTag, config.skipTag],
    implGlobs: config.implGlobs,
  });
  const strict = flags.has("--strict");
  const strictOptions = {
    strictUnregisteredImpl: config.strictUnregisteredImpl,
    strictUnregisteredSpecHeadings: config.strictUnregisteredSpecHeadings,
  };
  const { shown: shownWarnings, hiddenCount } = selectWarningsForDisplay(
    report.warnings,
  );

  if (flags.has("--github-annotations")) {
    for (const entry of report.entries) {
      console.error(toGithubAnnotation(entry));
    }
    for (const warning of shownWarnings) {
      console.error(toGithubWarningAnnotation(warning));
    }
  }

  if (flags.has("--json")) {
    console.log(
      JSON.stringify(
        {
          ...report,
          warnings: attachFailsUnderStrict(report.warnings, strictOptions),
        },
        null,
        2,
      ),
    );
  } else if (report.clean) {
    console.log("Traceability check: clean (no drift detected).");
  } else {
    console.log(
      `Traceability check: ${report.driftCount} drifted reference(s) across ${report.driftLinkCount} link(s).`,
    );
    const linkIds = [...new Set(report.entries.map((entry) => entry.linkId))];
    for (const linkId of linkIds) {
      const entries = report.entries.filter((entry) => entry.linkId === linkId);
      console.log(`\nlink: ${linkId}`);
      for (const entry of entries) {
        console.log(`  ${describeEntry(entry)}`);
      }
    }
    console.log(
      "\nNext: review the changes, sync features if needed, then run: specproof-update",
    );
  }

  if (!flags.has("--json") && report.bothSidesChanged.length > 0) {
    console.log("");
    for (const linkId of report.bothSidesChanged) {
      console.log(
        `!! link "${linkId}": BOTH spec and impl changed — specproof-sync must stop and ask which side is authoritative`,
      );
    }
  }

  if (!flags.has("--json") && shownWarnings.length > 0) {
    console.log("");
    for (const warning of shownWarnings) {
      console.log(
        describeWarning(
          warning,
          warningFailsUnderStrict(warning.kind, strictOptions),
        ),
      );
    }
    const hasHardWarning = shownWarnings.some((warning) =>
      warningFailsUnderStrict(warning.kind, strictOptions),
    );
    if (hiddenCount > 0) {
      console.log(`...and ${hiddenCount} more`);
    }
    if (!strict && hasHardWarning) {
      console.log(
        "(run specproof-check --strict to treat the [warning] item(s) above as errors; [advisory] item(s) require an explicit opt-in — see docs/config-schema.md)",
      );
    }
  }

  process.exitCode = isCheckFailure(report, strict, strictOptions) ? 1 : 0;
};

runCli("traceability check", main);
