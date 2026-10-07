import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "./resolve.js";

const isWithin = (parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const statOrNull = async (file: string) => {
  try {
    return await stat(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
};

/**
 * check と stats が共通に使う feature ファイル探索。
 * 再帰 readdir はディレクトリのリンクを辿って repo 外やループまで走査するため、
 * リンクは自前で判定する。repo 外を指すリンクは中を読む前に拒否し、featuresDir 自身・
 * その祖先・配下を指すリンクは辿らない。repo 内の別ディレクトリは実体ごとに一度だけ辿る。
 */
export const findFeatureFiles = async (
  repoRoot: string,
  featuresDir: string,
): Promise<string[]> => {
  const directory = resolveWithinRoot(repoRoot, featuresDir);
  const base = await realpath(directory);
  const root = path.resolve(repoRoot);
  const followed: string[] = [];
  const files: string[] = [];
  const toRelative = (file: string): string => path.relative(root, file).split(path.sep).join("/");

  const visitLink = async (full: string, entry: Dirent): Promise<void> => {
    const target = await statOrNull(full);
    if (target === null) {
      // 従来どおり .feature 名のリンク切れは失敗させ、それ以外は無視する。
      if (entry.name.endsWith(".feature")) resolveWithinRoot(repoRoot, full);
      return;
    }
    const checked = resolveWithinRoot(repoRoot, full);
    if (target.isFile()) {
      if (entry.name.endsWith(".feature")) files.push(toRelative(checked));
      return;
    }
    if (!target.isDirectory()) return;
    const physical = await realpath(checked);
    const covered =
      isWithin(base, physical) ||
      isWithin(physical, base) ||
      followed.some((seen) => isWithin(seen, physical) || isWithin(physical, seen));
    if (covered) return;
    followed.push(physical);
    await walk(full);
  };

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) await visitLink(full, entry);
      else if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".feature")) files.push(toRelative(full));
    }
  };

  await walk(directory);
  return files.sort();
};
