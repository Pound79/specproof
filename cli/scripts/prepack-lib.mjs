// Side-effect-free helpers for scripts/prepack.mjs (imported by tests).
//
// The filter mirrors isScaffoldExcluded in src/init.ts: gitignored build
// leftovers (.dart_tool/, .flutter-plugins*, pubspec.lock, node_modules/) can
// exist in a local template checkout, and copying them into the package dir
// would ship stale generated state inside the published tarball.
import fs from "node:fs";
import path from "node:path";

const EXCLUDED_DIRS = new Set([".dart_tool", "node_modules", ".git"]);
const EXCLUDED_FILES = new Set([
  ".flutter-plugins",
  ".flutter-plugins-dependencies",
  "pubspec.lock",
]);

export const includeInBundle = (src) => {
  const name = path.basename(src);
  const isDirectory = fs.statSync(src).isDirectory();
  return isDirectory ? !EXCLUDED_DIRS.has(name) : !EXCLUDED_FILES.has(name);
};

export const bundle = (sources) => {
  for (const [from, to] of sources) {
    // Always start from a clean destination: if a previous `npm pack` failed
    // between prepack and postpack (or ran with an older, unfiltered prepack),
    // a stale copy survives here and cpSync alone would never remove its
    // excluded files — they would ship in the next tarball.
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true, filter: includeInBundle });
  }
};
