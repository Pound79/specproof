import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { findFeatureFiles } from "../feature-files.js";

const fixture = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "feature-files-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
};

test(".feature という名前のディレクトリをファイルと間違えない", async () => fixture(async (root) => {
  await mkdir(path.join(root, "features/x.feature"), { recursive: true });
  await writeFile(path.join(root, "features/x.feature/nested.feature"), "Feature: nested\n");
  await writeFile(path.join(root, "features/a.feature"), "Feature: a\n");
  assert.deepEqual(await findFeatureFiles(root, "./features"), ["features/a.feature", "features/x.feature/nested.feature"]);
}));

test("存在しない探索先は呼出側の fallback 用に ENOENT を保つ", async () => fixture(async (root) => {
  await assert.rejects(findFeatureFiles(root, "missing"), { code: "ENOENT" });
}));

if (process.platform !== "win32") {
  test("内部の feature file symlink は検査し、外部リンクは拒否する", async () => fixture(async (root) => {
    await mkdir(path.join(root, "features"));
    await writeFile(path.join(root, "source.txt"), "Feature: source\n");
    await symlink(path.join(root, "source.txt"), path.join(root, "features/inside.feature"));
    assert.deepEqual(await findFeatureFiles(root, "features"), ["features/inside.feature"]);
    await symlink(os.tmpdir(), path.join(root, "features/outside.feature"));
    await assert.rejects(findFeatureFiles(root, "features"), /outside the repository root/);
  }));
}
