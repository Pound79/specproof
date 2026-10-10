import path from "node:path";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
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
  /** Opt-in hard enforcement (top-level `strictFeatureLint`, default false)
   *  making --strict fail on missing-then, step-order, duplicate-scenario-name
   *  and duplicate-scenario warnings. */
  strictFeatureLint: boolean;
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

// runner がシナリオを止めたり、失敗を想定扱いにしたりするタグ。実装待ちは @red-contract、人が確かめる条件は @human、
// 受け入れ条件から外すものは @out-of-scope（理由コメント必須）で表す。
// feature に付いていれば check が disallowed-tag を出し、stats は完了にしない。
// @fail は playwright-bdd が「失敗を想定どおり」として扱う印で、落ちるテストを黙らせられるので同じく扱う。
export const DISALLOWED_TAGS: readonly string[] = Object.freeze(["@fixme", "@skip", "@fail"]);

// 受け入れ条件から外す宣言。理由コメントを必須にする。
export const OUT_OF_SCOPE_TAG = "@out-of-scope";

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
  strictFeatureLint?: unknown;
}

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MAX_CONFIG_BYTES = 1024 * 1024;

/** symlink そのものも含めて、その名前の項目があるか（リンク切れも「ある」とみなす）。 */
const entryExists = (file: string): boolean => {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
};

/**
 * 設定ファイルは manifest や探索先の境界を決める入力なので、それ自体にも同じ境界を適用する。
 * repo 内に解決でき、開いた記述子が通常ファイルで、上限以下の大きさのときだけ読む。
 * FIFO は非ブロッキングで開いて待たずに拒否し、リンク切れを「設定なし」にしない。
 */
const readConfigText = (repoRoot: string, name: string): string => {
  let file: string;
  try {
    file = resolveWithinRoot(repoRoot, name);
  } catch {
    throw new Error(`${name} is dangling or resolves outside the repository root.`);
  }
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`${name} must be a regular file`);
    const tooLarge = (): Error => new Error(`${name} exceeds ${MAX_CONFIG_BYTES} bytes`);
    if (stat.size > MAX_CONFIG_BYTES) throw tooLarge();
    // 読み取り中に増えても上限を超えないよう、1 バイト余分に読んで判定する。
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let total = 0;
    for (;;) {
      const read = readSync(fd, buffer, total, buffer.length - total, null);
      if (read === 0) break;
      total += read;
      if (total > MAX_CONFIG_BYTES) throw tooLarge();
    }
    return buffer.subarray(0, total).toString("utf8");
  } finally {
    closeSync(fd);
  }
};

const parseConfigFile = (name: string, text: string): PartialConfigFile => {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    throw new Error(`Failed to parse ${name}: ${(error as Error).message}`);
  }
  if (parsed === null || parsed === undefined) return {};
  if (!isMapping(parsed)) {
    throw new Error(`${name}: the top level must be a YAML mapping`);
  }
  return parsed as PartialConfigFile;
};

interface ConfigSource {
  /** エラーで示す、実際に読んだ設定ファイル名。 */
  name: string;
  config: PartialConfigFile;
}

const readConfigFile = (repoRoot: string): ConfigSource | null => {
  for (const name of CONFIG_FILENAMES) {
    if (entryExists(path.join(repoRoot, name))) {
      return { name, config: parseConfigFile(name, readConfigText(repoRoot, name)) };
    }
  }
  for (const name of LEGACY_CONFIG_FILENAMES) {
    if (entryExists(path.join(repoRoot, name))) {
      process.stderr.write(`${name} is deprecated; rename it to specproof.config.yaml\n`);
      return { name, config: parseConfigFile(name, readConfigText(repoRoot, name)) };
    }
  }
  return null;
};

const isOmitted = (value: unknown): value is null | undefined =>
  value === undefined || value === null;

// 設定したつもりの値が型違いで「未設定」に落ちると、監査が黙って無効になる。
// キーの省略と空の値（null）は既定値を使い、値があるのに型が違えばキーを示して止める。
// エラーには実際に読んだファイル名を付ける。
const configReaders = (source: string) => {
  const invalid = (key: string, expected: string, value: unknown): Error =>
    new Error(
      `${source}: ${key} must be ${expected} (got ${
        Array.isArray(value) ? "array" : value === "" ? "empty string" : typeof value
      })`,
    );

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

  return { readSection, readString, readStringArray, readBoolean };
};

/**
 * Discovers the effective traceability config. Resolution order:
 *   1. Explicit overrides (--root / --manifest / --pages-dir) win.
 *   2. `layout.*` / `tags.*` fields from specproof.config.yaml (or the
 *      deprecated bdd-kit.config.yaml) at the repo root.
 *   3. Conventional defaults (`traceability.yaml`).
 *
 * Synchronous because `resolveRepoRoot` may shell out to `git rev-parse`.
 */
export const discoverConfig = (overrides: DiscoverConfigOverrides = {}): TraceabilityConfig => {
  const repoRoot = overrides.root
    ? path.resolve(overrides.root)
    : resolveRepoRoot(overrides.startDir);

  const source = readConfigFile(repoRoot);
  const fileConfig = source?.config ?? {};
  const sourceName = source?.name ?? CONFIG_FILENAMES[0];
  const { readSection, readString, readStringArray, readBoolean } = configReaders(sourceName);
  const layout = readSection(fileConfig.layout, "layout");
  // tags.* は runner 側の設定（slow など）で、この engine は読まない。ただし tags.fixme /
  // tags.skip は、実行を止めるタグに別名を付ける設定として書かれうる。別名は DISALLOWED_TAGS
  // で検出できず、止まったシナリオが黙って完了扱いになるので、書かれていたら失敗させる。
  // 値は出さない（改行で CI のログ行を偽装させない）。
  const tags = readSection(fileConfig.tags, "tags");
  for (const key of ["fixme", "skip"]) {
    if (tags[key] !== undefined) {
      throw new Error(
        `${sourceName}: tags.${key} is not supported — tags that switch scenarios off cannot be used. Remove it and tag those scenarios with @red-contract (not implemented yet), @human (checked by a person) or @out-of-scope (excluded, with a reason comment).`,
      );
    }
  }
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
  const strictFeatureLint = readBoolean(fileConfig.strictFeatureLint, "strictFeatureLint", false);
  return {
    repoRoot,
    manifestPath,
    pagesDir,
    candidateSuffix,
    featuresDir,
    implGlobs,
    strictUnregisteredImpl,
    strictUnregisteredSpecHeadings,
    strictFeatureLint,
  };
};
