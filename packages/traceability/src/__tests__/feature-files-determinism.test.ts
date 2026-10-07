import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test, vi } from "vitest";
import { findFeatureFiles } from "../feature-files.js";

const directoryOrder = vi.hoisted(() => ({ reverse: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    readdir: async (...args: Parameters<typeof original.readdir>) => {
      const entries = await original.readdir(...args);
      return directoryOrder.reverse ? entries.reverse() : entries;
    },
  };
});

afterEach(() => {
  directoryOrder.reverse = false;
});

const fixture = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "feature-determinism-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe.skipIf(process.platform === "win32")("feature 探索の境界と代表パス", () => {
  test(".. で始まる通常の配置先でも祖先リンクから探索範囲を広げない", async () =>
    fixture(async (root) => {
      await mkdir(path.join(root, "..features"));
      await mkdir(path.join(root, "unrelated"));
      await writeFile(path.join(root, "..features/a.feature"), "Feature: a\n");
      await writeFile(path.join(root, "unrelated/b.feature"), "Feature: b\n");
      await symlink("..", path.join(root, "..features/loop"));
      assert.deepEqual(await findFeatureFiles(root, "..features"), ["..features/a.feature"]);
    }));

  for (const directory of ["features", "features/nested"]) {
    test(`ディレクトリリンクの代表パスは読み取り順に依存しない: ${directory}`, async () =>
      fixture(async (root) => {
        await mkdir(path.join(root, directory), { recursive: true });
        await mkdir(path.join(root, "shared"));
        await writeFile(path.join(root, "shared/c.feature"), "Feature: c\n");
        for (const name of ["a-shared", "z-shared"]) {
          await symlink(path.join(root, "shared"), path.join(root, directory, name));
        }
        const expected = [`${directory}/a-shared/c.feature`];
        assert.deepEqual(await findFeatureFiles(root, "features"), expected);
        directoryOrder.reverse = true;
        assert.deepEqual(await findFeatureFiles(root, "features"), expected);
      }));
  }

  test("ファイルリンクの代表パスも読み取り順に依存しない", async () =>
    fixture(async (root) => {
      await mkdir(path.join(root, "features"));
      await writeFile(path.join(root, "shared.feature"), "Feature: shared\n");
      for (const name of ["a.feature", "z.feature"]) {
        await symlink("../shared.feature", path.join(root, "features", name));
      }
      const expected = ["features/a.feature"];
      assert.deepEqual(await findFeatureFiles(root, "features"), expected);
      directoryOrder.reverse = true;
      assert.deepEqual(await findFeatureFiles(root, "features"), expected);
    }));
});
