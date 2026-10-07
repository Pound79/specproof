import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

const physicalRootOf = (root: string, repoRoot: string): string => {
  try {
    return realpathSync(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Repository root does not exist: ${repoRoot}`);
    }
    throw error;
  }
};

/** 存在する最長の祖先を realpath で解決し、未作成の残りをそのまま連結する。 */
const physicalPathOf = (target: string): string => {
  const missing: string[] = [];
  let existing = target;
  for (;;) {
    try {
      return path.join(realpathSync(existing), ...[...missing].reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const parent = path.dirname(existing);
      if ((code !== "ENOENT" && code !== "ENOTDIR") || parent === existing) throw error;
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
};

// Resolves a manifest-relative path against the repo root and guarantees the
// result stays inside the root. Guards against hand-edit mistakes (and the odd
// malicious entry) where `ref.path` is `../something` or an absolute path that
// would make the drift check read files outside the repository.
export const resolveWithinRoot = (repoRoot: string, refPath: string): string => {
  const root = path.resolve(repoRoot);
  let resolved = path.resolve(root, refPath);
  // path.relative-based containment, so a sibling like `/repo/root-evil` is not
  // mistaken for being inside `/repo/root`.
  if (!isWithin(root, resolved)) {
    // cwd は物理パスなので、symlink 経由の root と相対 --manifest の組み合わせは
    // 字句上は外に見える。絶対パスに限り、実体で比べ直して root 側の表記へ戻す。
    // 相対の `../` 参照は実体が中にあっても従来どおり拒否する。
    const physicalRoot = path.isAbsolute(refPath) ? physicalRootOf(root, repoRoot) : undefined;
    const physical = physicalRoot === undefined ? undefined : physicalPathOf(resolved);
    if (physicalRoot === undefined || physical === undefined || !isWithin(physicalRoot, physical)) {
      throw new Error(`Manifest path "${refPath}" resolves outside the repository root.`);
    }
    resolved = path.join(root, path.relative(physicalRoot, physical));
  }

  const physicalRoot = physicalRootOf(root, repoRoot);

  let current = root;
  const relative = path.relative(root, resolved);
  for (const part of relative === "" ? [] : relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") break;
      throw error;
    }

    let physicalCurrent: string;
    try {
      physicalCurrent = realpathSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Manifest path "${refPath}" contains an unresolved symbolic link.`);
      }
      throw error;
    }
    if (!isWithin(physicalRoot, physicalCurrent)) {
      throw new Error(`Manifest path "${refPath}" resolves outside the repository root.`);
    }
  }
  return resolved;
};
