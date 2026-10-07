import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "vitest";
import { findFeatureFiles } from "../feature-files.js";

const fixture = async (run: (root: string, outside: string) => Promise<void>): Promise<void> => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "feature-dir-links-"));
  const root = path.join(temp, "repo");
  const outside = path.join(temp, "outside");
  await mkdir(path.join(root, "features/sub"), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(root, "features/a.feature"), "Feature: a\n");
  await writeFile(path.join(root, "features/sub/b.feature"), "Feature: b\n");
  try {
    await run(root, outside);
  } finally {
    await chmod(outside, 0o755).catch(() => undefined);
    await rm(temp, { recursive: true, force: true });
  }
};

const BASE = ["features/a.feature", "features/sub/b.feature"];

describe.skipIf(process.platform === "win32")("featuresDir 内のディレクトリリンク", () => {
  test("祖先を指すループは辿らず、同じファイルを重複して返さない", async () =>
    fixture(async (root) => {
      await symlink("..", path.join(root, "features/loop"));
      assert.deepEqual(await findFeatureFiles(root, "features"), BASE);
    }));

  test("featuresDir 配下を指すリンクで同じファイルを重複して返さない", async () =>
    fixture(async (root) => {
      await symlink("sub", path.join(root, "features/alias"));
      assert.deepEqual(await findFeatureFiles(root, "features"), BASE);
    }));

  test("repo 内の別ディレクトリへのリンクは一度だけ辿る", async () =>
    fixture(async (root) => {
      await mkdir(path.join(root, "shared"));
      await writeFile(path.join(root, "shared/c.feature"), "Feature: c\n");
      await symlink("../shared", path.join(root, "features/shared"));
      await symlink("../shared", path.join(root, "features/shared-again"));
      assert.deepEqual(await findFeatureFiles(root, "features"), [
        "features/a.feature",
        "features/shared/c.feature",
        "features/sub/b.feature",
      ]);
    }));

  test("子孫へのリンクを先に辿っても、後から来る祖先へのリンクの feature を落とさない", async () =>
    fixture(async (root) => {
      await mkdir(path.join(root, "shared/inner"), { recursive: true });
      await writeFile(path.join(root, "shared/top.feature"), "Feature: top\n");
      await writeFile(path.join(root, "shared/inner/in.feature"), "Feature: in\n");
      // 名前順で a-inner（子孫）が b-shared（祖先）より先に読まれる。
      await symlink("../shared/inner", path.join(root, "features/a-inner"));
      await symlink("../shared", path.join(root, "features/b-shared"));
      assert.deepEqual(await findFeatureFiles(root, "features"), [
        "features/a-inner/in.feature",
        "features/a.feature",
        "features/b-shared/top.feature",
        "features/sub/b.feature",
      ]);
    }));

  test(".feature 以外の名前で repo 外を指すリンクは、中を読まずに無視する", async () =>
    fixture(async (root, outside) => {
      // 走査すれば読めないサブディレクトリで EACCES になる配置。
      await mkdir(path.join(outside, "locked"));
      await chmod(path.join(outside, "locked"), 0o000);
      await writeFile(path.join(outside, "hosts"), "x\n");
      await symlink(outside, path.join(root, "features/vendor"));
      await symlink(path.join(outside, "hosts"), path.join(root, "features/README"));
      assert.deepEqual(await findFeatureFiles(root, "features"), BASE);
    }));

  test("リンク切れは .feature 名なら拒否し、それ以外は無視する", async () =>
    fixture(async (root) => {
      await symlink("../missing-dir", path.join(root, "features/stale"));
      assert.deepEqual(await findFeatureFiles(root, "features"), BASE);
      await symlink("../missing.feature", path.join(root, "features/gone.feature"));
      await assert.rejects(findFeatureFiles(root, "features"));
    }));

  test(".feature 名のリンクは、repo 外の実体の有無にかかわらず同じ文言で拒否する", async () =>
    fixture(async (root, outside) => {
      await writeFile(path.join(outside, "exists.feature"), "Feature: x\n");
      const messageFor = async (target: string): Promise<string> => {
        const link = path.join(root, "features/probe.feature");
        await symlink(target, link);
        try {
          await findFeatureFiles(root, "features");
          return "resolved";
        } catch (error) {
          return (error as Error).message;
        } finally {
          await rm(link);
        }
      };
      const existing = await messageFor(path.join(outside, "exists.feature"));
      const missing = await messageFor(path.join(outside, "missing.feature"));
      assert.match(existing, /outside the repository root/);
      assert.equal(missing, existing);
    }));
});
