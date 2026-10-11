import { realpathSync } from "node:fs";
import { resolveWithinRoot } from "./resolve.js";

/** 読取対象は実体ごとに一度だけ残す。manifest の各参照の hash 検査には使わない。 */
export const uniqueFeatureTargets = <T>(
  repoRoot: string,
  targets: readonly T[],
  relativePath: (target: T) => string,
): T[] => {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const resolved = resolveWithinRoot(repoRoot, relativePath(target));
    let identity: string;
    try {
      identity = realpathSync(resolved);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      // 欠落した参照も残し、呼出元の欠落検査を省かない。
      identity = resolved;
    }
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};
