import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Resolves a storageState path (as written in specproof.config.yaml) against the
 * e2e package root, so the logged-in session always lands in this package's
 * gitignored `playwright/.auth/` no matter which directory Playwright runs from.
 *
 * The auth setup overwrites this path and the auth teardown deletes it, so a
 * path outside the package (`../.env`, an absolute path) is refused instead of
 * being written over or removed.
 */
export function resolveAuthStatePath(file: string, root: string = packageRoot): string {
  const resolved = path.resolve(root, file);
  const relative = path.relative(root, resolved);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`storageState must be a file inside the e2e package: ${JSON.stringify(file)}`);
  }
  return resolved;
}
