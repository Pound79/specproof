import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { globBaseDir, globToRegExp } from './glob.js';
import { resolveWithinRoot } from './resolve.js';
import type { DriftWarning } from './check.js';
import type { TraceabilityManifest } from './manifest.js';

// Directory names never worth descending into for implGlobs matching — always
// excluded, at any depth, regardless of what implGlobs says.
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'build']);

// Every file under `absDir`, as paths relative to `absDir` (POSIX-separated),
// skipping EXCLUDED_DIR_NAMES at any depth so a huge node_modules tree is
// never even read.
const walkFiles = async (absDir: string): Promise<string[]> => {
  let dirents;
  try {
    dirents = await readdir(absDir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return [];
    }
    throw error;
  }
  const files: string[] = [];
  for (const dirent of dirents) {
    if (dirent.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(dirent.name)) {
        continue;
      }
      const nested = await walkFiles(path.join(absDir, dirent.name));
      files.push(...nested.map((rel) => `${dirent.name}/${rel}`));
    } else if (dirent.isFile()) {
      files.push(dirent.name);
    }
  }
  return files;
};

// Every repo file matching any of `implGlobs`, as repo-relative POSIX paths,
// deduped and sorted. Each pattern's walk is rooted at its longest literal
// prefix (globBaseDir) so `src/**/*.ts` only walks `src/`, not the whole repo.
export const findImplCandidates = async (
  repoRoot: string,
  implGlobs: string[]
): Promise<string[]> => {
  const matched = new Set<string>();
  for (const pattern of implGlobs) {
    const baseDir = globBaseDir(pattern);
    const regExp = globToRegExp(pattern);
    const relFiles = await walkFiles(resolveWithinRoot(repoRoot, baseDir));
    for (const relFile of relFiles) {
      const repoRelPath =
        baseDir === '.' ? relFile : path.posix.join(baseDir, relFile);
      if (regExp.test(repoRelPath)) {
        matched.add(repoRelPath);
      }
    }
  }
  return [...matched].sort();
};

const unregisteredImplWarning = (relPath: string): DriftWarning => ({
  kind: 'unregistered-impl',
  path: relPath,
  message: `implementation file is not registered in the traceability manifest: ${relPath}`,
});

// A-3: files matching `implGlobs` that no link's impl[] registers. Returns []
// when implGlobs is unset/empty — a repo that hasn't opted in gets no warnings
// at all, not even a "nothing configured" notice.
export const auditUnregisteredImpl = async (
  manifest: TraceabilityManifest,
  repoRoot: string,
  implGlobs: string[] | undefined
): Promise<DriftWarning[]> => {
  if (implGlobs === undefined || implGlobs.length === 0) {
    return [];
  }
  const registered = new Set(
    manifest.links.flatMap((link) =>
      link.impl.map((ref) => path.posix.normalize(ref.path))
    )
  );
  const candidates = await findImplCandidates(repoRoot, implGlobs);
  return candidates
    .filter((relPath) => !registered.has(relPath))
    .map(unregisteredImplWarning);
};
