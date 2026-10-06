import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const tooLarge = (): Error =>
  new Error("Invalid traceability manifest: file exceeds 8 MiB");
const notRegular = (): Error =>
  new Error("Invalid traceability manifest: expected a regular file");

/** 通常ファイルだけを読み、読み取り中に増大しても 8 MiB を超えない。 */
export const readManifestFile = async (manifestPath: string): Promise<string> => {
  // デバイスを開く前に拒否する。FIFO への差し替えには NONBLOCK と fstat で備える。
  const before = await stat(manifestPath);
  if (!before.isFile()) throw notRegular();
  if (before.size > MAX_MANIFEST_BYTES) throw tooLarge();
  const handle = await open(manifestPath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw notRegular();
    if (opened.size > MAX_MANIFEST_BYTES) throw tooLarge();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      // 上限を超えたか判定するための1バイトだけ余分に読む。
      const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, MAX_MANIFEST_BYTES + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_MANIFEST_BYTES) throw tooLarge();
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } finally {
    await handle.close();
  }
};
