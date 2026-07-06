import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { resolveDefaultManifestPath, resolveRepoRoot } from "./paths.js";

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

interface PartialConfigFile {
  layout?: {
    manifest?: unknown;
    pagesDir?: unknown;
    candidateSuffix?: unknown;
    featuresDir?: unknown;
    implGlobs?: unknown;
  };
  tags?: {
    fixme?: unknown;
    skip?: unknown;
  };
  strictUnregisteredImpl?: unknown;
  strictUnregisteredSpecHeadings?: unknown;
}

const parseConfigFile = (file: string): PartialConfigFile => {
  try {
    const parsed: unknown = parse(readFileSync(file, "utf8"));
    return (parsed ?? {}) as PartialConfigFile;
  } catch (error) {
    throw new Error(`Failed to parse ${file}: ${(error as Error).message}`);
  }
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
      process.stderr.write(
        `${name} is deprecated; rename it to specproof.config.yaml\n`,
      );
      return parseConfigFile(file);
    }
  }
  return null;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

// Gherkin tags always start with "@", and the feature scanner only keeps
// "@"-prefixed tokens. A config value missing the "@" (e.g. "todo") would
// silently never match a scanned tag and re-introduce the very false-green this
// config plumbing fixes — so normalize it to the canonical "@todo" form here.
const normalizeTag = (raw: string): string =>
  raw.startsWith("@") ? raw : `@${raw}`;

/**
 * Discovers the effective traceability config. Resolution order:
 *   1. Explicit overrides (--root / --manifest / --pages-dir) win.
 *   2. `layout.*` / `tags.*` fields from specproof.config.yaml (or the
 *      deprecated bdd-kit.config.yaml) at the repo root.
 *   3. Conventional defaults (`traceability.yaml`, "@fixme" / "@skip").
 *
 * Synchronous because `resolveRepoRoot` may shell out to `git rev-parse`.
 */
export const discoverConfig = (
  overrides: DiscoverConfigOverrides = {},
): TraceabilityConfig => {
  const repoRoot = overrides.root
    ? path.resolve(overrides.root)
    : resolveRepoRoot(overrides.startDir);

  const fileConfig = readConfigFile(repoRoot);
  const fileManifest = asString(fileConfig?.layout?.manifest);
  const filePagesDir = asString(fileConfig?.layout?.pagesDir);
  const fileFeaturesDir = asString(fileConfig?.layout?.featuresDir);
  const candidateSuffix =
    overrides.candidateSuffix ?? asString(fileConfig?.layout?.candidateSuffix);

  let manifestPath: string;
  if (overrides.manifest) {
    manifestPath = path.resolve(overrides.manifest);
  } else if (fileManifest) {
    manifestPath = path.resolve(repoRoot, fileManifest);
  } else {
    manifestPath = resolveDefaultManifestPath(repoRoot);
  }

  const pagesDir = overrides.pagesDir ?? filePagesDir;
  const featuresDir = overrides.featuresDir ?? fileFeaturesDir;
  const implGlobs = asStringArray(fileConfig?.layout?.implGlobs);
  const strictUnregisteredImpl = asBoolean(
    fileConfig?.strictUnregisteredImpl,
    false,
  );
  const strictUnregisteredSpecHeadings = asBoolean(
    fileConfig?.strictUnregisteredSpecHeadings,
    false,
  );
  const fixmeTag = normalizeTag(
    asString(fileConfig?.tags?.fixme) ?? DEFAULT_FIXME_TAG,
  );
  const skipTag = normalizeTag(
    asString(fileConfig?.tags?.skip) ?? DEFAULT_SKIP_TAG,
  );
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
