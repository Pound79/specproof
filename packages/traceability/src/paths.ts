import path from "node:path";
import { existsSync, lstatSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Files that mark a directory as the repo root, in precedence order.
const ROOT_MARKERS = ["specproof.config.yaml", "specproof.config.yml", "traceability.yaml"];

// 改名（bdd-kit → specproof、0.2.0）前の設定ファイル名。0.4.0 で読むのをやめた。黙って無視すると
// 置いた設定が効かないまま検査が通るので、現行の目印が無い段にこれがあれば名前の変更を案内して止める。
const REMOVED_CONFIG_FILENAMES = ["bdd-kit.config.yaml", "bdd-kit.config.yml"];

/** symlink そのものも含めて、その名前の項目があるか（リンク切れも「ある」とみなす）。 */
const entryExists = (file: string): boolean => {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
};

/** `dir` に旧名の設定ファイルがあれば、名前の変更を案内して止める。 */
export const assertNoRemovedConfig = (dir: string): void => {
  for (const name of REMOVED_CONFIG_FILENAMES) {
    if (entryExists(path.join(dir, name))) {
      throw new Error(`${name} is no longer read; rename it to specproof.config.yaml`);
    }
  }
};

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
 * `process.cwd()`) looking for a specproof config or a traceability
 * manifest, then falling back to
 * `git rev-parse --show-toplevel`. Throws when neither strategy resolves.
 *
 * A directory on the way up that has no marker but holds a removed
 * `bdd-kit.config.*` name stops with a rename message instead of being passed
 * over (the config placed there would otherwise be ignored silently).
 *
 * Unlike the original monorepo implementation this does NOT resolve relative to
 * the module location: the package is published and installed under an
 * arbitrary `node_modules` path, so only the consumer's cwd / git tree is
 * meaningful.
 */
export const resolveRepoRoot = (startDir: string = process.cwd()): string => {
  const initialDir = path.resolve(startDir);
  let dir = initialDir;
  for (;;) {
    for (const marker of ROOT_MARKERS) {
      if (existsSync(path.join(dir, marker))) {
        return dir;
      }
    }
    assertNoRemovedConfig(dir);
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: initialDir,
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
      `${ROOT_MARKERS.join(" / ")} in any ancestor directory, and ` +
      "git rev-parse did not return a repository root. Pass --root explicitly " +
      "(and --manifest for a non-default manifest).",
  );
};

/** The conventional manifest location at the repo root. */
export const resolveDefaultManifestPath = (repoRoot: string): string =>
  path.join(repoRoot, "traceability.yaml");
