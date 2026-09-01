import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

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
  if (!isWithin(root, resolved)) {
    throw new Error(
      `Manifest path "${refPath}" resolves outside the repository root.`
    );
  }

  let physicalRoot: string;
  try {
    physicalRoot = realpathSync(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Repository root does not exist: ${repoRoot}`);
    }
    throw error;
  }

  let current = root;
  const relative = path.relative(root, resolved);
  for (const part of relative === '' ? [] : relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') break;
      throw error;
    }

    let physicalCurrent: string;
    try {
      physicalCurrent = realpathSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `Manifest path "${refPath}" contains an unresolved symbolic link.`
        );
      }
      throw error;
    }
    if (!isWithin(physicalRoot, physicalCurrent)) {
      throw new Error(
        `Manifest path "${refPath}" resolves outside the repository root.`
      );
    }
  }
  return resolved;
};
