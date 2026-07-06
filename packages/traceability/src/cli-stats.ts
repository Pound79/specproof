#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseScenarios } from "./feature-scan.js";
import { readFileOrNull } from "./hash.js";
import { loadManifest } from "./manifest.js";
import { discoverConfig, type TraceabilityConfig } from "./config.js";
import { resolveWithinRoot } from "./resolve.js";
import { parseCliArgs, runCli } from "./cli-args.js";
import { buildStats, formatStats, type FeatureScenarios } from "./stats.js";

// Repo-relative feature paths to census: every *.feature under featuresDir when
// configured, otherwise the manifest-registered features.
const collectFeaturePaths = async (
  config: TraceabilityConfig,
): Promise<string[]> => {
  const featuresDir = config.featuresDir;
  if (featuresDir) {
    const absDir = resolveWithinRoot(config.repoRoot, featuresDir);
    try {
      const entries = await readdir(absDir, { recursive: true });
      return entries
        .filter((entry) => entry.endsWith(".feature"))
        .map((entry) =>
          path.posix.join(featuresDir, entry.split(path.sep).join("/")),
        );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }
      process.stderr.write(
        `warn: featuresDir "${featuresDir}" not found — counting manifest-registered features only\n`,
      );
    }
  }
  const manifest = await loadManifest(config.manifestPath);
  return [
    ...new Set(
      manifest.links.flatMap((link) =>
        link.features.map((ref) => path.posix.normalize(ref.path)),
      ),
    ),
  ];
};

const main = async (): Promise<void> => {
  const { flags, manifest, root } = parseCliArgs(process.argv.slice(2));
  const config = discoverConfig({ manifest, root });
  const featurePaths = await collectFeaturePaths(config);

  const features: FeatureScenarios[] = [];
  for (const relPath of featurePaths) {
    const content = await readFileOrNull(
      resolveWithinRoot(config.repoRoot, relPath),
    );
    if (content !== null) {
      features.push({ domain: relPath, scenarios: parseScenarios(content) });
    }
  }

  const report = buildStats(features, {
    fixmeTag: config.fixmeTag,
    skipTag: config.skipTag,
  });

  if (flags.has("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatStats(report));
  }

  // Read-only by default. Under --strict, an outstanding @fixme fails the run
  // so a "done" gate can be wired into CI (ADR 0002: @fixme=0 is hard at done).
  if (flags.has("--strict") && !report.fixmeClean) {
    process.exitCode = 1;
  }
};

runCli("traceability stats", main);
