#!/usr/bin/env node
import { findFeatureFiles } from "./feature-files.js";
import path from "node:path";
import { parseScenarios } from "./feature-scan.js";
import { readFileOrNull } from "./hash.js";
import { loadManifest } from "./manifest.js";
import { discoverConfig, type TraceabilityConfig } from "./config.js";
import { resolveWithinRoot } from "./resolve.js";
import { parseCliArgs, runCli } from "./cli-args.js";
import { buildStats, formatStats, type FeatureScenarios } from "./stats.js";

interface FeatureSources {
  /** 集計する repo 相対パス。featuresDir があればその配下、無ければ manifest の登録分。 */
  paths: string[];
  /** 設定したのに存在しなかった featuresDir。--strict では失敗の理由になる。 */
  missingFeaturesDir?: string;
}

const collectFeaturePaths = async (config: TraceabilityConfig): Promise<FeatureSources> => {
  const featuresDir = config.featuresDir;
  let missingFeaturesDir: string | undefined;
  if (featuresDir) {
    try {
      return { paths: await findFeatureFiles(config.repoRoot, featuresDir) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }
      missingFeaturesDir = featuresDir;
      process.stderr.write(
        `warn: featuresDir "${featuresDir}" not found — counting manifest-registered features only\n`,
      );
    }
  }
  const manifest = await loadManifest(config.manifestPath);
  const paths = [
    ...new Set(
      manifest.links.flatMap((link) => link.features.map((ref) => path.posix.normalize(ref.path))),
    ),
  ];
  return { paths, missingFeaturesDir };
};

const main = async (): Promise<void> => {
  const { flags, manifest, root } = parseCliArgs(process.argv.slice(2), "stats");
  const config = discoverConfig({ manifest, root });
  const { paths, missingFeaturesDir } = await collectFeaturePaths(config);

  const features: FeatureScenarios[] = [];
  // 読めなかった feature は「シナリオ 0 件」と区別する。黙って外すと、その中の残件ごと消える。
  const missingFeatures: string[] = [];
  for (const relPath of paths) {
    const content = await readFileOrNull(resolveWithinRoot(config.repoRoot, relPath));
    if (content === null) missingFeatures.push(relPath);
    else features.push({ domain: relPath, scenarios: parseScenarios(content) });
  }
  for (const relPath of missingFeatures) {
    process.stderr.write(`warn: registered feature "${relPath}" not found — not counted\n`);
  }

  const report = buildStats(features, {
    fixmeTag: config.fixmeTag,
    skipTag: config.skipTag,
  });

  if (flags.has("--json")) {
    console.log(JSON.stringify({ ...report, missingFeatures }, null, 2));
  } else {
    console.log(formatStats(report));
  }

  // Read-only by default. Under --strict, an outstanding @fixme fails the run
  // so a "done" gate can be wired into CI (ADR 0002: @fixme=0 is hard at done).
  // 検査対象が欠けた状態は、残件 0 件とは判断できないので同じく失敗させる。
  const incomplete = missingFeatures.length > 0 || missingFeaturesDir !== undefined;
  if (flags.has("--strict") && (!report.fixmeClean || incomplete)) {
    process.exitCode = 1;
  }
};

runCli("traceability stats", main);
