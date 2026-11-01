import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectSnapshot, detectAdapter } from "../detect.js";

// detect と init --adapter auto は、実行したディレクトリの package.json・pubspec.yaml・
// .env.example を読む。巨大なファイルや FIFO で止まらないよう、上限と通常ファイルの確認をする。
const withDir = async (run: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "specproof-detect-limits-"));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("collectSnapshot の読み込みの上限", () => {
  for (const name of ["package.json", "pubspec.yaml", ".env.example"]) {
    it(`${name} が 1 MiB を超えれば読まずに止まる`, () =>
      withDir(async (dir) => {
        const file = path.join(dir, name);
        writeFileSync(file, "");
        truncateSync(file, 1024 * 1024 + 1);
        await expect(collectSnapshot(dir)).rejects.toThrow(/exceeds 1 MiB/);
      }));

    it.skipIf(process.platform === "win32")(`${name} が FIFO なら待たずに止まる`, () =>
      withDir(async (dir) => {
        execFileSync("mkfifo", [path.join(dir, name)]);
        await expect(collectSnapshot(dir)).rejects.toThrow(/regular file/);
      }),
    );
  }

  it("長すぎる .env.example のキーは名前として扱わず、判定が線形の時間で終わる", () =>
    withDir(async (dir) => {
      // 環境の接尾辞を判定する正規表現は、長いキーで二乗の時間がかかる。
      writeFileSync(
        path.join(dir, ".env.example"),
        `A${"_DEV".repeat(100_000)}!=x\nE2E_URL_DEV=\n`,
      );
      const snapshot = await collectSnapshot(dir);
      expect(snapshot.envExampleKeys).toEqual(["E2E_URL_DEV"]);
      const started = performance.now();
      detectAdapter(snapshot);
      expect(performance.now() - started).toBeLessThan(1_000);
    }));

  it("通常の大きさのファイルは従来どおり読む", () =>
    withDir(async (dir) => {
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }),
      );
      writeFileSync(path.join(dir, ".env.example"), "E2E_BASE_URL=\n# comment\nE2E_USERNAME=x\n");
      const snapshot = await collectSnapshot(dir);
      expect(snapshot.packageJson?.devDependencies).toEqual({ "@playwright/test": "^1.0.0" });
      expect(snapshot.envExampleKeys).toEqual(["E2E_BASE_URL", "E2E_USERNAME"]);
    }));
});
