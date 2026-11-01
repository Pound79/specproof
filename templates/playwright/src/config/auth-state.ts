import { lstatSync } from "node:fs";
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
 * being written over or removed. A symbolic link on the way (for example
 * `playwright/` or `.auth/` linked elsewhere) is refused too: the path looks
 * inside the package but the file it reaches is not.
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
  // Check every existing component below the package root; missing ones are
  // created by the setup as plain directories.
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let isLink: boolean;
    try {
      isLink = lstatSync(current).isSymbolicLink();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    if (isLink) {
      throw new Error(
        `storageState must not go through a symbolic link: ${JSON.stringify(file)} (${part})`,
      );
    }
  }
  return resolved;
}
