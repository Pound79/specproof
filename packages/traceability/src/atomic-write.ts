import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 8 * 1024 * 1024;

/** 最終要素のリンク・特殊ファイルを拒否し、比較用の読み取りも上限を守る。 */
const readCurrent = async (file: string): Promise<{ text: string; mode: number } | null> => {
  let entry;
  try {
    entry = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!entry.isFile()) throw new Error("Manifest write target must be a regular file, not a symbolic link");
  if (entry.size > MAX_BYTES) throw new Error("Invalid traceability manifest: file exceeds 8 MiB");
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new Error("Manifest write target must be a regular file");
    if (opened.size > MAX_BYTES) throw new Error("Invalid traceability manifest: file exceeds 8 MiB");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_BYTES) throw new Error("Invalid traceability manifest: file exceeds 8 MiB");
    return { text: buffer.subarray(0, total).toString("utf8"), mode: opened.mode & 0o777 };
  } finally {
    await handle.close();
  }
};

/** 同じディレクトリで一時保存し、完成した通常ファイルだけを rename する。 */
export const writeFileAtomic = async (
  file: string,
  text: string,
  expectedText?: string,
): Promise<void> => {
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
    throw new Error("Invalid traceability manifest: file exceeds 8 MiB");
  }
  const before = await readCurrent(file);
  const assertUnchanged = (current: typeof before): void => {
    if (expectedText !== undefined && current?.text !== expectedText) {
      throw new Error("Manifest changed during update; retry after reviewing the current file");
    }
  };
  assertUnchanged(before);
  if (before?.text === text) return;

  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  // wx は既存のファイルやリンクを上書きしない。完成までは所有者だけが読める。
  const handle = await open(temp, "wx", 0o600);
  let closed = false;
  try {
    await handle.writeFile(text, "utf8");
    if (before) await handle.chmod(before.mode);
    await handle.sync();
    await handle.close();
    closed = true;
    assertUnchanged(await readCurrent(file));
    await rename(temp, file);
  } finally {
    try {
      if (!closed) await handle.close();
    } finally {
      await unlink(temp).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
};
