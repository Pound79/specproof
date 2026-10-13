import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

/**
 * 書込先の symlink と、他のパスと内容を共有する既存ファイルの hardlink を拒否する。
 * 検査後に別プロセスがパスを差し替える競合への排他保証は行わない。
 */
export const assertSafeRepositoryWrite = (repoRoot: string, targetPath: string): void => {
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
        throw new Error(`Refusing to write through symbolic link inside repository: ${current}`);
      }
      // realpath では hardlink の共有先を判別できないため、既存の最終ファイルで拒否する。
      if (current === lexicalTarget && entry.isFile() && entry.nlink > 1) {
        throw new Error(`Refusing to write to file with multiple hard links: ${current}`);
      }
      deepestExisting = current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }

  const physicalAncestor = realpathSync(deepestExisting);
  if (!isWithin(physicalRoot, physicalAncestor)) {
    throw new Error(`Refusing to write outside the physical repository root: ${targetPath}`);
  }
};

export type SourceTreeExclude = (name: string, isDirectory: boolean) => boolean;

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
