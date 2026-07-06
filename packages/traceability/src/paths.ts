import path from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Files that mark a directory as the repo root, in precedence order. The
// legacy bdd-kit.config.yaml / .yml names are still recognized (back-compat
// after the specproof rename) but sort after the current names.
const ROOT_MARKERS = [
  "specproof.config.yaml",
  "specproof.config.yml",
  "bdd-kit.config.yaml",
  "bdd-kit.config.yml",
  "traceability.yaml",
];

// MSYS / Git Bash returns paths like /c/Users/... — convert to C:/Users/...
// before handing to path.resolve, which would otherwise interpret /c as a
// directory off the current drive root on Windows.
export const normalizeMsysPath = (p: string): string => {
  if (process.platform !== "win32") return p;
  const m = /^\/([a-zA-Z])(\/.*)?$/.exec(p);
  return m ? `${m[1].toUpperCase()}:${m[2] ?? "/"}` : p;
};

/**
 * Resolves the repo root by walking up from `startDir` (default
 * `process.cwd()`) looking for a specproof config (or the deprecated
 * bdd-kit.config.yaml) or a traceability manifest, then falling back to
 * `git rev-parse --show-toplevel`. Throws when neither strategy resolves.
 *
 * Unlike the original monorepo implementation this does NOT resolve relative to
 * the module location: the package is published and installed under an
 * arbitrary `node_modules` path, so only the consumer's cwd / git tree is
 * meaningful.
 */
export const resolveRepoRoot = (startDir: string = process.cwd()): string => {
  let dir = path.resolve(startDir);
  for (;;) {
    for (const marker of ROOT_MARKERS) {
      if (existsSync(path.join(dir, marker))) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    if (top) {
      return path.resolve(normalizeMsysPath(top));
    }
  } catch {
    // fall through to the explicit error below
  }

  throw new Error(
    `Could not resolve a repo root from "${startDir}": found no ` +
      `${ROOT_MARKERS.join(" / ")} in any ancestor directory, and the path is ` +
      "not inside a git repository. Pass --root or --manifest explicitly.",
  );
};

/** The conventional manifest location at the repo root. */
export const resolveDefaultManifestPath = (repoRoot: string): string =>
  path.join(repoRoot, "traceability.yaml");
