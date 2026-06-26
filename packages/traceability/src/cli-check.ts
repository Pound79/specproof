#!/usr/bin/env node
import { checkDrift } from "./check.js";
import { discoverConfig } from "./config.js";
import { parseCliArgs, runCli } from "./cli-args.js";
import {
  describeEntry,
  describeWarning,
  isCheckFailure,
  toGithubAnnotation,
  toGithubWarningAnnotation,
} from "./cli-check-format.js";

const main = async (): Promise<void> => {
  const { flags, manifest, root } = parseCliArgs(process.argv.slice(2));
  const config = discoverConfig({ manifest, root });
  const report = await checkDrift(config.manifestPath, config.repoRoot, {
    featuresDir: config.featuresDir,
    reasonRequiredTags: [config.fixmeTag, config.skipTag],
  });
  const strict = flags.has("--strict");

  if (flags.has("--github-annotations")) {
    for (const entry of report.entries) {
      console.error(toGithubAnnotation(entry));
    }
    for (const warning of report.warnings) {
      console.error(toGithubWarningAnnotation(warning));
    }
  }

  if (flags.has("--json")) {
    console.log(JSON.stringify(report, null, 2));
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
      "\nNext: review the changes, sync features if needed, then run: bdd-traceability-update",
    );
  }

  if (!flags.has("--json") && report.warnings.length > 0) {
    console.log("");
    for (const warning of report.warnings) {
      console.log(describeWarning(warning));
    }
    if (!strict) {
      console.log(
        "(run bdd-traceability-check --strict to treat the above warning(s) as errors)",
      );
    }
  }

  process.exitCode = isCheckFailure(report, strict) ? 1 : 0;
};

runCli("traceability check", main);
