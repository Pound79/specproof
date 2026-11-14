// 未登録の実装・見出しの advisory から、利用者が明示した対象を外す（layout.implExcludeGlobs /
// layout.specHeadingIgnore）。外すのは advisory だけで、登録済みの参照の drift には触れない。
// 外した件数は報告に残し、黙って消えたように見せない。
import path from "node:path";
import type { DriftWarning } from "./check.js";
import { compileGlob } from "./glob.js";
import { assertGlobLimits } from "./impl-audit.js";

export interface AdvisoryExclusionOptions {
  /** unregistered-impl から外すファイルの glob（implGlobs と同じ書き方）。 */
  implExcludeGlobs?: string[];
  /** unregistered-spec-heading から外す対象。`<path>` はファイル全体、`<path>#<見出し>` は 1 つの見出し。 */
  specHeadingIgnore?: string[];
}

export interface ExcludedAdvisoryCounts {
  unregisteredImpl: number;
  unregisteredSpecHeading: number;
}

export interface AdvisoryExclusionResult {
  warnings: DriftWarning[];
  /** どちらかの設定があるときだけ。 */
  excluded?: ExcludedAdvisoryCounts;
}

const normalize = (relPath: string): string => path.posix.normalize(relPath);

// 最初の `#` で分ける。パスに `#` を含むファイルは、見出しを付けずにファイル全体で外す形だけが使える。
const parseHeadingIgnore = (entries: string[]): { files: Set<string>; headings: Set<string> } => {
  const files = new Set<string>();
  const headings = new Set<string>();
  for (const entry of entries) {
    const hash = entry.indexOf("#");
    if (hash < 0) {
      files.add(normalize(entry.trim()));
    } else {
      headings.add(`${normalize(entry.slice(0, hash).trim())}#${entry.slice(hash + 1).trim()}`);
    }
  }
  return { files, headings };
};

export const applyAdvisoryExclusions = (
  warnings: DriftWarning[],
  options: AdvisoryExclusionOptions,
): AdvisoryExclusionResult => {
  const { implExcludeGlobs, specHeadingIgnore } = options;
  if (implExcludeGlobs === undefined && specHeadingIgnore === undefined) {
    return { warnings };
  }
  const patterns = [...new Set(implExcludeGlobs ?? [])];
  assertGlobLimits(patterns, "layout.implExcludeGlobs");
  const matchers = patterns.map(compileGlob);
  const ignore = parseHeadingIgnore(specHeadingIgnore ?? []);

  const isExcluded = (warning: DriftWarning): "impl" | "heading" | undefined => {
    if (warning.path === undefined) return undefined;
    const relPath = normalize(warning.path);
    if (warning.kind === "unregistered-impl") {
      return matchers.some((matcher) => matcher.test(relPath)) ? "impl" : undefined;
    }
    if (warning.kind === "unregistered-spec-heading") {
      const ignored =
        ignore.files.has(relPath) ||
        (warning.heading !== undefined && ignore.headings.has(`${relPath}#${warning.heading}`));
      return ignored ? "heading" : undefined;
    }
    return undefined;
  };

  const verdicts = warnings.map(isExcluded);
  return {
    warnings: warnings.filter((_, index) => verdicts[index] === undefined),
    excluded: {
      unregisteredImpl: verdicts.filter((verdict) => verdict === "impl").length,
      unregisteredSpecHeading: verdicts.filter((verdict) => verdict === "heading").length,
    },
  };
};
