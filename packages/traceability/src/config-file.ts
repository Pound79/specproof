import path from "node:path";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { resolveWithinRoot } from "./resolve.js";
import { parseRepositoryYaml } from "./yaml-parse.js";

// 設定ファイルを読む部分。paths.ts（ルートの解決）と config.ts（設定の解釈）の両方が使うので、
// どちらにも依存しないここに置く。

export const CONFIG_FILENAMES = ["specproof.config.yaml", "specproof.config.yml"];

// 検証前の設定ファイル。値の型は readSection / readString などで確かめる。
export interface PartialConfigFile {
  adapter?: unknown;
  language?: unknown;
  layout?: unknown;
  tags?: unknown;
  strictUnregisteredImpl?: unknown;
  strictUnregisteredSpecHeadings?: unknown;
  strictFeatureLint?: unknown;
}

export const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MAX_CONFIG_BYTES = 1024 * 1024;

/** symlink そのものも含めて、その名前の項目があるか（リンク切れも「ある」とみなす）。 */
export const entryExists = (file: string): boolean => {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
};

/**
 * 設定ファイルは manifest や探索先の境界を決める入力なので、それ自体にも同じ境界を適用する。
 * repo 内に解決でき、開いた記述子が通常ファイルで、上限以下の大きさのときだけ読む。
 * FIFO は非ブロッキングで開いて待たずに拒否し、リンク切れを「設定なし」にしない。
 */
export const readConfigText = (repoRoot: string, name: string): string => {
  let file: string;
  try {
    file = resolveWithinRoot(repoRoot, name);
  } catch {
    throw new Error(`${name} is dangling or resolves outside the repository root.`);
  }
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`${name} must be a regular file`);
    const tooLarge = (): Error => new Error(`${name} exceeds ${MAX_CONFIG_BYTES} bytes`);
    if (stat.size > MAX_CONFIG_BYTES) throw tooLarge();
    // 読み取り中に増えても上限を超えないよう、1 バイト余分に読んで判定する。
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let total = 0;
    for (;;) {
      const read = readSync(fd, buffer, total, buffer.length - total, null);
      if (read === 0) break;
      total += read;
      if (total > MAX_CONFIG_BYTES) throw tooLarge();
    }
    return buffer.subarray(0, total).toString("utf8");
  } finally {
    closeSync(fd);
  }
};

export const parseConfigFile = (name: string, text: string): PartialConfigFile => {
  const parsed = parseRepositoryYaml(text, name);
  if (parsed === null || parsed === undefined) return {};
  if (!isMapping(parsed)) {
    throw new Error(`${name}: the top level must be a YAML mapping`);
  }
  return parsed as PartialConfigFile;
};

/** `dir` にある現行名の設定ファイルの名前。無ければ undefined。 */
export const findConfigFileName = (dir: string): string | undefined =>
  CONFIG_FILENAMES.find((name) => entryExists(path.join(dir, name)));
