import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

/**
 * Reject a write target when an existing path component is a symbolic link.
 * This keeps scaffold/setup writes inside the physical repository, including
 * when the final file does not exist yet.
 */
export const assertSafeRepositoryWrite = (
  repoRoot: string,
  targetPath: string,
): void => {
  const lexicalRoot = path.resolve(repoRoot);
  const lexicalTarget = path.resolve(targetPath);
  if (!isWithin(lexicalRoot, lexicalTarget)) {
    throw new Error(`Write target must stay within the repository: ${targetPath}`);
  }

  const physicalRoot = realpathSync(lexicalRoot);
  let current = lexicalRoot;
  let deepestExisting = lexicalRoot;
  const relative = path.relative(lexicalRoot, lexicalTarget);

  for (const part of relative === "" ? [] : relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      const entry = lstatSync(current);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Refusing to write through symbolic link inside repository: ${current}`,
        );
      }
      deepestExisting = current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }

  const physicalAncestor = realpathSync(deepestExisting);
  if (!isWithin(physicalRoot, physicalAncestor)) {
    throw new Error(
      `Refusing to write outside the physical repository root: ${targetPath}`,
    );
  }
};

export type SourceTreeExclude = (
  name: string,
  isDirectory: boolean,
) => boolean;

/** List regular files under a trusted source tree without following symlinks. */
export const walkRegularFilesWithoutSymlinks = (
  sourceRoot: string,
  exclude: SourceTreeExclude = () => false,
): string[] => {
  const rootEntry = lstatSync(sourceRoot);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
    throw new Error(`Source root must be a real directory, not a symbolic link: ${sourceRoot}`);
  }

  const visit = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      const entry = lstatSync(full);
      if (entry.isSymbolicLink()) {
        throw new Error(`Source tree must not contain a symbolic link: ${full}`);
      }
      if (entry.isDirectory()) {
        return exclude(name, true) ? [] : visit(full);
      }
      if (!entry.isFile()) {
        throw new Error(`Source tree entry must be a regular file: ${full}`);
      }
      return exclude(name, false) ? [] : [path.relative(sourceRoot, full)];
    });

  return visit(sourceRoot);
};
