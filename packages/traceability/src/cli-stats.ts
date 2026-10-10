#!/usr/bin/env node
import { findFeatureFiles } from "./feature-files.js";
import path from "node:path";
import { parseFeatureScenarios } from "./feature-scan.js";
import { readFileOrNull } from "./hash.js";
import { loadManifest, type TraceabilityManifest } from "./manifest.js";
import { discoverConfig, type TraceabilityConfig } from "./config.js";
import { resolveWithinRoot } from "./resolve.js";
import { parseCliArgs, runCli } from "./cli-args.js";
import { buildStats, formatStats, type FeatureScenarios } from "./stats.js";

interface FeatureSources {
  /** 集計する repo 相対パス。featuresDir があればその配下、無ければ manifest の登録分。 */
  paths: string[];
  /** manifest に登録された feature。集計対象に入らないものも実在を確かめる。 */
  registered: string[];
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
    process.stderr.write(
      `warn: featuresDir ${JSON.stringify(featuresDir)} not found — counting manifest-registered features only\n`,
    );
    return undefined;
  }
};

// featuresDir を集計するときは manifest が無くてもよい。登録が無ければ確かめる対象も無い。
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

const collectFeaturePaths = async (config: TraceabilityConfig): Promise<FeatureSources> => {
  const found = await findUnderFeaturesDir(config);
  const registered = await loadRegisteredFeatures(config, found !== undefined);
  const missingFeaturesDir =
    config.featuresDir && found === undefined ? config.featuresDir : undefined;
  return { paths: found ?? registered, registered, missingFeaturesDir };
};

const main = async (): Promise<void> => {
  const { flags, manifest, root } = parseCliArgs(process.argv.slice(2), "stats");
  const config = discoverConfig({ manifest, root });
  const { paths, registered, missingFeaturesDir } = await collectFeaturePaths(config);
  const read = (relPath: string) => readFileOrNull(resolveWithinRoot(config.repoRoot, relPath));

  const features: FeatureScenarios[] = [];
  // 読めなかった feature は「シナリオ 0 件」と区別する。黙って外すと、その中の残件ごと消える。
  const missingFeatures: string[] = [];
  for (const relPath of paths) {
    const content = await read(relPath);
    if (content === null) missingFeatures.push(relPath);
    else features.push({ domain: relPath, scenarios: parseFeatureScenarios(relPath, content) });
  }
  // featuresDir の探索では、登録したのに消えた feature が見えない。登録分の実在も確かめる。
  const scanned = new Set(paths);
  for (const relPath of registered) {
    if (!scanned.has(relPath) && (await read(relPath)) === null) missingFeatures.push(relPath);
  }
  for (const relPath of missingFeatures) {
    process.stderr.write(
      `warn: registered feature ${JSON.stringify(relPath)} not found — not counted\n`,
    );
  }

  const report = buildStats(features);

  if (flags.has("--json")) {
    console.log(JSON.stringify({ ...report, missingFeatures, missingFeaturesDir }, null, 2));
  } else {
    console.log(formatStats(report));
  }

  // Read-only by default. Under --strict, an outstanding @red-contract or a
  // disallowed @fixme / @skip / @fail fails the run so a "done" gate can be wired into CI.
  // 検査対象が欠けた状態は、残件 0 件とは判断できないので同じく失敗させる。
  const incomplete = missingFeatures.length > 0 || missingFeaturesDir !== undefined;
  if (flags.has("--strict") && (!report.done || incomplete)) {
    process.exitCode = 1;
  }
};

runCli("traceability stats", main);
