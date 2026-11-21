import type { DriftWarning } from "./check.js";
import type { SpecSource, SpecSourceResult } from "./spec-sources.js";

const short = (commit: string | undefined): string => (commit ?? "").slice(0, 12);

/** check の warning にする。取り込み元が手元に無いなど、確かめられなかったものは出さない。 */
export const specSourceWarnings = (
  sources: SpecSource[],
  results: SpecSourceResult[],
): DriftWarning[] =>
  results.flatMap((result): DriftWarning[] => {
    const source = sources.find((candidate) => candidate.name === result.name);
    if (source === undefined) return [];
    const record = `specproof-update --record-spec-source ${result.name}`;
    const where = source.specDir === undefined ? {} : { path: source.specDir };
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
