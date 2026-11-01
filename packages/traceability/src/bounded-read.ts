import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";

const CHUNK_BYTES = 64 * 1024;

export interface BoundedReadErrors {
  tooLarge: () => Error;
  notRegular: () => Error;
}

/**
 * 通常ファイルだけを読み、読み取り中に増大しても maxBytes を超えない。
 * 読む前に stat で FIFO やデバイスを拒否し、開いた後の差し替えには NONBLOCK と fstat で備える。
 * 無いファイルの ENOENT / ENOTDIR はそのまま投げる（呼び出し側が扱う）。
 */
export const readRegularFile = async (
  file: string,
  maxBytes: number,
  errors: BoundedReadErrors,
): Promise<Buffer> => {
  const before = await stat(file);
  if (!before.isFile()) throw errors.notRegular();
  if (before.size > maxBytes) throw errors.tooLarge();
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw errors.notRegular();
    if (opened.size > maxBytes) throw errors.tooLarge();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      // 上限を超えたか判定するための1バイトだけ余分に読む。
      const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw errors.tooLarge();
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
};
