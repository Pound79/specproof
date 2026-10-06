import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "./resolve.js";

/** check と stats が共通に使う通常の feature ファイル探索。 */
export const findFeatureFiles = async (repoRoot: string, featuresDir: string): Promise<string[]> => {
  const directory = resolveWithinRoot(repoRoot, featuresDir);
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".feature")) continue;
    const file = resolveWithinRoot(repoRoot, path.join(entry.parentPath, entry.name));
    // リポジトリ内の file symlink は従来どおり検査し、外向きのリンクは上で拒否。
    const regular = entry.isFile() || (entry.isSymbolicLink() && (await stat(file)).isFile());
    if (regular) files.push(path.relative(path.resolve(repoRoot), file).split(path.sep).join("/"));
  }
  return files.sort();
};
