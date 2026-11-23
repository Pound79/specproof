import type { DriftWarning } from "./check.js";
import {
  describeRefLookup,
  type SpecSource,
  type SpecSourceResult,
  type SpecSourceUnavailableReason,
} from "./spec-sources.js";

const short = (commit: string | undefined): string => (commit ?? "").slice(0, 12);

// 確かめられなかった理由ごとの案内。パスは設定に書いた `repo` の値で出す（解決した絶対パスは出さない）。
// 読まない理由（持ち主・worktree・部分 clone など）は分けず、docs の条件を案内する。
const unresolvedReason = (
  source: SpecSource,
  result: SpecSourceResult,
  reason: Exclude<SpecSourceUnavailableReason, "source-missing">,
): string => {
  const repo = JSON.stringify(source.repo);
  switch (reason) {
    case "source-unreadable":
      return `cannot read ${repo} as a spec source (it must be the root of a non-partial clone you own, with a real .git directory, not a git worktree; see specSources in docs/config-schema.md)`;
    case "ref-unresolved":
      return `could not resolve ref ${JSON.stringify(source.ref)} in ${repo} (${describeRefLookup(source.ref)}). Fix specSources[].ref, or fetch the ref`;
    case "recorded-missing":
      return `the recorded commit is not in ${repo}. Fetch the source (a shallow clone may lack it; fetch its history), or re-import and run: specproof-update --record-spec-source ${result.name}`;
    case "read-failed":
      return `git could not read ${repo} while checking ${JSON.stringify(source.ref)}; check that ${repo} is a valid clone (see specSources in docs/config-schema.md)`;
  }
};

/**
 * check の warning にする。取り込み元のディレクトリが無い（PR の CI など）ときだけ出さずに飛ばし、ほかの
 * 確かめられなかったものは spec-source-unresolved として理由を出す。
 */
export const specSourceWarnings = (
  sources: SpecSource[],
  results: SpecSourceResult[],
): DriftWarning[] =>
  results.flatMap((result): DriftWarning[] => {
    const source = sources.find((candidate) => candidate.name === result.name);
    if (source === undefined) return [];
    const record = `specproof-update --record-spec-source ${result.name}`;
    const where = source.specDir === undefined ? {} : { path: source.specDir };
    if (result.status === "unavailable") {
      // 理由の付け忘れで黙らないよう、理由が無ければ読めなかったものとして出す。
      const reason = result.reason ?? "read-failed";
      if (reason === "source-missing") return [];
      return [
        {
          kind: "spec-source-unresolved",
          ...where,
          message: `spec source ${JSON.stringify(result.name)}: could not check for changes since the recorded commit ${short(result.recorded)}: ${unresolvedReason(source, result, reason)}`,
        },
      ];
    }
    if (result.status === "unrecorded") {
      return [
        {
          kind: "spec-source-unrecorded",
          ...where,
          message: `spec source ${JSON.stringify(result.name)} has no recorded commit. After importing the spec, run: ${record}`,
        },
      ];
    }
    if (result.status === "path-missing") {
      return [
        {
          kind: "spec-source-outdated",
          ...where,
          message: `spec source ${JSON.stringify(result.name)}: ${source.ref} (${short(result.current)}) has no ${(result.missingPaths ?? []).map((entry) => JSON.stringify(entry)).join(", ")}. Check specSources[].paths in specproof.config.yaml (the source may have moved the files), then re-import and run: ${record}`,
        },
      ];
    }
    if (result.status === "outdated") {
      const scope = source.paths.length === 0 ? "the repository" : source.paths.join(", ");
      return [
        {
          kind: "spec-source-outdated",
          ...where,
          message: `spec source ${JSON.stringify(result.name)}: ${source.ref} (${short(result.current)}) has changes in ${scope} since the recorded commit ${short(result.recorded)}. Re-import the spec (review the configured importCommand before running it), sync the features, then run: ${record}`,
        },
      ];
    }
    return [];
  });
