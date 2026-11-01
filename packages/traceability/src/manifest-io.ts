import { readRegularFile } from "./bounded-read.js";

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const errors = {
  tooLarge: (): Error => new Error("Invalid traceability manifest: file exceeds 8 MiB"),
  notRegular: (): Error => new Error("Invalid traceability manifest: expected a regular file"),
};

/** 通常ファイルだけを読み、読み取り中に増大しても 8 MiB を超えない。 */
export const readManifestFile = async (manifestPath: string): Promise<string> =>
  (await readRegularFile(manifestPath, MAX_MANIFEST_BYTES, errors)).toString("utf8");
