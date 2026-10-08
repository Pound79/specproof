import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { resolveDefaultManifestPath, resolveRepoRoot } from "./paths.js";
import { resolveWithinRoot } from "./resolve.js";

export interface TraceabilityConfig {
  /** Absolute path of the repo root. */
  repoRoot: string;
  /** Absolute path of the manifest YAML file. */
  manifestPath: string;
  /** Repo-relative pages directory used to discover bootstrap candidates. */
  pagesDir?: string;
  /** File-name suffix marking a file as a domain page (default 'Page.tsx'). */
  candidateSuffix?: string;
  /** Repo-relative features directory; scanned for unreviewed draft markers. */
  featuresDir?: string;
  /** Gherkin tag for scenarios awaiting automation; gates "done" (must reach 0)
   *  and requires a reason comment. From `tags.fixme`; defaults to "@fixme". */
  fixmeTag: string;
  /** Gherkin tag for intentionally-excluded scenarios; requires a reason
   *  comment. From `tags.skip`; defaults to "@skip". */
  skipTag: string;
  /** Glob patterns (from `layout.implGlobs`) identifying implementation files
   *  that should be registered in some link's impl[]. Undefined (not an empty
   *  array) when the config omits it, so the engine can skip the audit
   *  entirely rather than warn about every file. */
  implGlobs?: string[];
  /** Opt-in hard enforcement (top-level `strictUnregisteredImpl`, default
   *  false) making --strict fail on unregistered-impl warnings. implGlobs is
   *  structurally noisier than the other warning kinds, so it stays warn-only
   *  under --strict unless a repo explicitly opts in. */
  strictUnregisteredImpl: boolean;
  /** Opt-in hard enforcement (top-level `strictUnregisteredSpecHeadings`,
   *  default false) making --strict fail on unregistered-spec-heading
   *  warnings. Real spec docs often mix multiple domains' headings with
   *  intentionally-unlinked sections (revision history, glossary) in one
   *  file, so this stays warn-only under --strict unless a repo explicitly
   *  opts in. */
  strictUnregisteredSpecHeadings: boolean;
}

export interface DiscoverConfigOverrides {
  /** Force the repo root (skips the walk-up / git fallback). */
  root?: string;
  /** Force the manifest path (skips config-file and default resolution). */
  manifest?: string;
  /** Force the pages directory (wins over the config file). */
  pagesDir?: string;
  /** Force the candidate suffix (wins over the config file). */
  candidateSuffix?: string;
  /** Force the features directory (wins over the config file). */
  featuresDir?: string;
  /** Directory to start the walk-up from (default process.cwd()). */
  startDir?: string;
}

// Canonical reason-required tags. Repos that rename them via `tags.fixme` /
// `tags.skip` in specproof.config.yaml keep the same intent; these are the
// values used when the config omits them (back-compat with the pre-config
// behaviour and the engine's standalone API). Single source of truth —
// `stats.ts` and `check.ts` import these instead of re-declaring their own
// literals (the drift these constants now fix).
export const DEFAULT_FIXME_TAG = "@fixme";
export const DEFAULT_SKIP_TAG = "@skip";

const CONFIG_FILENAMES = ["specproof.config.yaml", "specproof.config.yml"];

// Pre-rename filenames (bdd-kit → specproof). Still discovered, but emit a
// deprecation warning to stderr so repos migrate at their own pace.
const LEGACY_CONFIG_FILENAMES = ["bdd-kit.config.yaml", "bdd-kit.config.yml"];

// 検証前の設定ファイル。値の型は readSection / readString などで確かめる。
interface PartialConfigFile {
  layout?: unknown;
  tags?: unknown;
  strictUnregisteredImpl?: unknown;
  strictUnregisteredSpecHeadings?: unknown;
}

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseConfigFile = (file: string): PartialConfigFile => {
  let parsed: unknown;
  try {
    parsed = parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse ${file}: ${(error as Error).message}`);
  }
  if (parsed === null || parsed === undefined) return {};
  if (!isMapping(parsed)) {
    throw new Error(`${path.basename(file)}: the top level must be a YAML mapping`);
  }
  return parsed as PartialConfigFile;
};

const readConfigFile = (repoRoot: string): PartialConfigFile | null => {
  for (const name of CONFIG_FILENAMES) {
    const file = path.join(repoRoot, name);
    if (existsSync(file)) {
      return parseConfigFile(file);
    }
  }
  for (const name of LEGACY_CONFIG_FILENAMES) {
    const file = path.join(repoRoot, name);
    if (existsSync(file)) {
      process.stderr.write(`${name} is deprecated; rename it to specproof.config.yaml\n`);
      return parseConfigFile(file);
    }
  }
  return null;
};

// 設定したつもりの値が型違いで「未設定」に落ちると、監査が黙って無効になる。
// キーの省略と空の値（null）は既定値を使い、値があるのに型が違えばキーを示して止める。
const invalid = (key: string, expected: string, value: unknown): Error =>
  new Error(
    `specproof.config.yaml: ${key} must be ${expected} (got ${
      Array.isArray(value) ? "array" : value === "" ? "empty string" : typeof value
    })`,
  );

const isOmitted = (value: unknown): value is null | undefined =>
  value === undefined || value === null;

const readSection = (value: unknown, key: string): Record<string, unknown> => {
  if (isOmitted(value)) return {};
  if (!isMapping(value)) throw invalid(key, "a mapping", value);
  return value;
};

const readString = (value: unknown, key: string): string | undefined => {
  if (isOmitted(value)) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(key, "a non-empty string", value);
  }
  return value;
};

const readStringArray = (value: unknown, key: string): string[] | undefined => {
  if (isOmitted(value)) return undefined;
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw invalid(key, "an array of non-empty strings", value);
  }
  return [...value];
};

const readBoolean = (value: unknown, key: string, fallback: boolean): boolean => {
  if (isOmitted(value)) return fallback;
  if (typeof value !== "boolean") throw invalid(key, "true or false", value);
  return value;
};

// Gherkin tags always start with "@", and the feature scanner only keeps
// "@"-prefixed tokens. A config value missing the "@" (e.g. "todo") would
// silently never match a scanned tag and re-introduce the very false-green this
// config plumbing fixes — so normalize it to the canonical "@todo" form here.
// 空白を含むタグや "@" だけのタグは scanner が一致させられないので拒否する。
const readTag = (value: unknown, key: string, fallback: string): string => {
  const raw = readString(value, key);
  if (raw === undefined) return fallback;
  const tag = raw.startsWith("@") ? raw : `@${raw}`;
  if (tag.length === 1 || /\s/.test(tag)) {
    throw new Error(`specproof.config.yaml: ${key} must be a single Gherkin tag (got "${raw}")`);
  }
  return tag;
};

/**
 * Discovers the effective traceability config. Resolution order:
 *   1. Explicit overrides (--root / --manifest / --pages-dir) win.
 *   2. `layout.*` / `tags.*` fields from specproof.config.yaml (or the
 *      deprecated bdd-kit.config.yaml) at the repo root.
 *   3. Conventional defaults (`traceability.yaml`, "@fixme" / "@skip").
 *
 * Synchronous because `resolveRepoRoot` may shell out to `git rev-parse`.
 */
export const discoverConfig = (overrides: DiscoverConfigOverrides = {}): TraceabilityConfig => {
  const repoRoot = overrides.root
    ? path.resolve(overrides.root)
    : resolveRepoRoot(overrides.startDir);

  const fileConfig = readConfigFile(repoRoot) ?? {};
  const layout = readSection(fileConfig.layout, "layout");
  const tags = readSection(fileConfig.tags, "tags");
  const fileManifest = readString(layout.manifest, "layout.manifest");
  const filePagesDir = readString(layout.pagesDir, "layout.pagesDir");
  const fileFeaturesDir = readString(layout.featuresDir, "layout.featuresDir");
  const fileCandidateSuffix = readString(layout.candidateSuffix, "layout.candidateSuffix");
  const candidateSuffix = overrides.candidateSuffix ?? fileCandidateSuffix;

  let manifestPath: string;
  if (overrides.manifest) {
    manifestPath = path.resolve(overrides.manifest);
  } else if (fileManifest) {
    manifestPath = path.resolve(repoRoot, fileManifest);
  } else {
    manifestPath = resolveDefaultManifestPath(repoRoot);
  }

  // 明示指定も含め、manifest の読み書きをリポジトリ内に限定する。
  manifestPath = resolveWithinRoot(repoRoot, manifestPath);

  const pagesDir = overrides.pagesDir ?? filePagesDir;
  const featuresDir = overrides.featuresDir ?? fileFeaturesDir;
  if (pagesDir !== undefined) resolveWithinRoot(repoRoot, pagesDir);
  if (featuresDir !== undefined) resolveWithinRoot(repoRoot, featuresDir);
  const implGlobs = readStringArray(layout.implGlobs, "layout.implGlobs");
  const strictUnregisteredImpl = readBoolean(
    fileConfig.strictUnregisteredImpl,
    "strictUnregisteredImpl",
    false,
  );
  const strictUnregisteredSpecHeadings = readBoolean(
    fileConfig.strictUnregisteredSpecHeadings,
    "strictUnregisteredSpecHeadings",
    false,
  );
  const fixmeTag = readTag(tags.fixme, "tags.fixme", DEFAULT_FIXME_TAG);
  const skipTag = readTag(tags.skip, "tags.skip", DEFAULT_SKIP_TAG);
  // Identical tags collapse the skip bucket into fixme (skip always 0) and
  // silently distort the done gate. Fail loudly rather than mis-report.
  if (fixmeTag === skipTag) {
    throw new Error(
      `specproof.config.yaml: tags.fixme and tags.skip must differ; both resolve to "${fixmeTag}"`,
    );
  }

  return {
    repoRoot,
    manifestPath,
    pagesDir,
    candidateSuffix,
    featuresDir,
    fixmeTag,
    skipTag,
    implGlobs,
    strictUnregisteredImpl,
    strictUnregisteredSpecHeadings,
  };
};
