#!/usr/bin/env node
import { findFeatureFiles } from "./feature-files.js";
import { uniqueFeatureTargets } from "./feature-identity.js";
import path from "node:path";
import { parseFeatureScenarios } from "./feature-scan.js";
import { printable } from "./display-text.js";
import { readFileOrNull } from "./hash.js";
import { loadManifest, type TraceabilityManifest } from "./manifest.js";
import { discoverConfig, type TraceabilityConfig } from "./config.js";
import { resolveWithinRoot } from "./resolve.js";
import { parseCliArgs, runCli } from "./cli-args.js";
import { printErrorText, printJson, printText } from "./output.js";
import { buildStats, formatStats, type FeatureScenarios } from "./stats.js";

interface FeatureSources {
  /** 集計する repo 相対パス。探索結果を優先し、未集計の登録分を足す。 */
  paths: string[];
  /** 設定したのに存在しなかった featuresDir。--strict では失敗の理由になる。 */
  missingFeaturesDir?: string;
}

const isNotFound = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
};

const findUnderFeaturesDir = async (config: TraceabilityConfig): Promise<string[] | undefined> => {
  const featuresDir = config.featuresDir;
  if (!featuresDir) return undefined;
  try {
    return await findFeatureFiles(config.repoRoot, featuresDir);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    printErrorText(
      `warn: featuresDir ${printable(JSON.stringify(featuresDir))} not found — counting manifest-registered features only`,
    );
    return undefined;
  }
};

// --manifest を省略し、featuresDir を探索できた場合は manifest が無くても集計できる。
const loadRegisteredFeatures = async (
  config: TraceabilityConfig,
  optional: boolean,
): Promise<string[]> => {
  let manifest: TraceabilityManifest;
  try {
    manifest = await loadManifest(config.manifestPath);
  } catch (error) {
    if (optional && isNotFound(error)) return [];
    throw error;
  }
  return [
    ...new Set(
      manifest.links.flatMap((link) => link.features.map((ref) => path.posix.normalize(ref.path))),
    ),
  ];
};

const collectFeaturePaths = async (
  config: TraceabilityConfig,
  manifestRequired: boolean,
): Promise<FeatureSources> => {
  const found = await findUnderFeaturesDir(config);
  const registered = await loadRegisteredFeatures(config, found !== undefined && !manifestRequired);
  const missingFeaturesDir =
    config.featuresDir && found === undefined ? config.featuresDir : undefined;
  return {
    paths: uniqueFeatureTargets(
      config.repoRoot,
      [...(found ?? []), ...registered],
      (relPath) => relPath,
    ),
    missingFeaturesDir,
  };
};

const main = async (): Promise<void> => {
  const { flags, manifest, root } = parseCliArgs(process.argv.slice(2), "stats");
  const config = discoverConfig({ manifest, root });
  const { paths, missingFeaturesDir } = await collectFeaturePaths(config, manifest !== undefined);
  const read = (relPath: string) => readFileOrNull(resolveWithinRoot(config.repoRoot, relPath));

  const features: FeatureScenarios[] = [];
  // 読めなかった feature は「シナリオ 0 件」と区別する。黙って外すと、その中の残件ごと消える。
  const missingFeatures: string[] = [];
  for (const relPath of paths) {
    const content = await read(relPath);
    if (content === null) missingFeatures.push(relPath);
    else {
      const scenarios = parseFeatureScenarios(relPath, content, {
        gherkin: config.gherkin,
        language: config.language,
      });
      features.push({ domain: relPath, scenarios });
    }
  }
  for (const relPath of missingFeatures) {
    printErrorText(
      `warn: registered feature ${printable(JSON.stringify(relPath))} not found — not counted`,
    );
  }

  const stats = buildStats(features);
  const report = {
    ...stats,
    done: stats.done && missingFeatures.length === 0 && missingFeaturesDir === undefined,
  };

  if (flags.has("--json")) {
    printJson({ ...report, missingFeatures, missingFeaturesDir });
  } else {
    printText(formatStats(report));
  }

  // Read-only by default. Under --strict, an outstanding @red-contract or a
  // disallowed @fixme / @skip / @fail fails the run so a "done" gate can be wired into CI.
  // 検査対象が欠けた状態は、残件 0 件とは判断できないので同じく失敗させる。
  if (flags.has("--strict") && !report.done) {
    process.exitCode = 1;
  }
};

runCli("traceability stats", main);
