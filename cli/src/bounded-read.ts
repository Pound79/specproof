import { closeSync, constants, fstatSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 通常ファイルだけを読み、読み取り中に増大しても maxBytes を超えない（同期版）。
 * 読む前に stat で FIFO やデバイスを拒否し、開いた後の差し替えには NONBLOCK と fstat で備える。
 * 同期の読み込みは FIFO で止まるとタイムアウトでも割り込めないので、開く前に必ず確かめる。
 */
export const readSmallTextFile = (file: string, maxBytes: number): string => {
  const name = path.basename(file);
  const tooLarge = (): Error => new Error(`${name} exceeds ${maxBytes / (1024 * 1024)} MiB`);
  const notRegular = (): Error => new Error(`${name} must be a regular file`);
  const before = statSync(file);
  if (!before.isFile()) throw notRegular();
  if (before.size > maxBytes) throw tooLarge();
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw notRegular();
    if (opened.size > maxBytes) throw tooLarge();
    // 上限を超えたか判定するための1バイトだけ余分に読む。
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    for (;;) {
      const read = readSync(fd, buffer, total, buffer.length - total, null);
      if (read === 0) break;
      total += read;
      if (total > maxBytes) throw tooLarge();
    }
    return buffer.subarray(0, total).toString("utf8");
  } finally {
    closeSync(fd);
  }
};
