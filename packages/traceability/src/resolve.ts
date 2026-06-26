import path from 'node:path';

// Resolves a manifest-relative path against the repo root and guarantees the
// result stays inside the root. Guards against hand-edit mistakes (and the odd
// malicious entry) where `ref.path` is `../something` or an absolute path that
// would make the drift check read files outside the repository.
export const resolveWithinRoot = (
  repoRoot: string,
  refPath: string
): string => {
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, refPath);
  // Compare with a trailing separator so a sibling like `/repo/root-evil`
  // is not mistaken for being inside `/repo/root`.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(
      `Manifest path "${refPath}" resolves outside the repository root.`
    );
  }
  return resolved;
};
