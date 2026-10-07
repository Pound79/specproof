import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "./resolve.js";

const isWithin = (parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

/**
 * check と stats が共通に使う feature ファイル探索。
 * 再帰 readdir はディレクトリのリンクを辿って repo 外やループまで走査するため、
 * リンクは自前で判定する。
 * - repo の内外は realpath で先に確かめ、repo 外の実体は stat も readdir もしない。
 *   `.feature` 名のリンクは repo 外でもリンク切れでも同じ文言で拒否し、それ以外の名前の
 *   リンクは中を読まずに無視する（repo 外のパスの有無を結果から区別できないようにする）。
 * - featuresDir 自身・その祖先・配下を指すリンクと、既に辿った実体の配下は辿らない。
 *   祖先を後から辿る場合に備え、見つけたファイルは実体で重複を除く（最初のパスを残す）。
 */
export const findFeatureFiles = async (
  repoRoot: string,
  featuresDir: string,
): Promise<string[]> => {
  const directory = resolveWithinRoot(repoRoot, featuresDir);
  const base = await realpath(directory);
  const root = path.resolve(repoRoot);
  const followed: string[] = [];
  const seenFiles = new Set<string>();
  const files: string[] = [];
  const toRelative = (file: string): string => path.relative(root, file).split(path.sep).join("/");

  const addFile = async (full: string): Promise<void> => {
    const physical = await realpath(full);
    if (seenFiles.has(physical)) return;
    seenFiles.add(physical);
    files.push(toRelative(full));
  };

  const visitLink = async (full: string, entry: Dirent): Promise<void> => {
    const isFeatureName = entry.name.endsWith(".feature");
    try {
      resolveWithinRoot(repoRoot, full);
    } catch {
      if (!isFeatureName) return;
      throw new Error(
        `Feature file link "${toRelative(full)}" is dangling or resolves outside the repository root.`,
      );
    }
    const target = await stat(full);
    if (target.isFile()) {
      if (isFeatureName) await addFile(full);
      return;
    }
    if (!target.isDirectory()) return;
    const physical = await realpath(full);
    const covered =
      isWithin(base, physical) ||
      isWithin(physical, base) ||
      followed.some((seen) => isWithin(seen, physical));
    if (covered) return;
    followed.push(physical);
    await walk(full);
  };

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    // 最初のパスを残す重複排除が OS の列挙順に左右されないようにする。
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) await visitLink(full, entry);
      else if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".feature")) await addFile(full);
    }
  };

  await walk(directory);
  return files.sort();
};
