import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { writeFileAtomic } from "../atomic-write.js";

const fixture = async (run: (dir: string, file: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atomic-manifest-"));
  try {
    await run(dir, path.join(dir, "manifest.yaml"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test("通常ファイルを完成後に置換し一時ファイルを残さない", async () =>
  fixture(async (dir, file) => {
    await writeFile(file, "old", { mode: 0o640 });
    await writeFileAtomic(file, "new", "old");
    assert.equal(await readFile(file, "utf8"), "new");
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o640);
    assert.deepEqual(await readdir(dir), ["manifest.yaml"]);
  }));

test("新規 manifest を作成できる", async () =>
  fixture(async (dir, file) => {
    await writeFileAtomic(file, "new");
    assert.equal(await readFile(file, "utf8"), "new");
    assert.deepEqual(await readdir(dir), ["manifest.yaml"]);
  }));

test("内容が同じなら inode と mtime も変えない", async () =>
  fixture(async (_dir, file) => {
    await writeFile(file, "old");
    const before = await stat(file);
    await writeFileAtomic(file, "old", "old");
    const after = await stat(file);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
  }));

test("古い snapshot の保存を拒否して元ファイルを保持する", async () =>
  fixture(async (dir, file) => {
    await writeFile(file, "user edit");
    await assert.rejects(writeFileAtomic(file, "new", "old"), /changed during update/);
    assert.equal(await readFile(file, "utf8"), "user edit");
    assert.deepEqual(await readdir(dir), ["manifest.yaml"]);
  }));

test("書き込みサイズ超過を拒否して元ファイルを保持する", async () =>
  fixture(async (dir, file) => {
    await writeFile(file, "old");
    await assert.rejects(writeFileAtomic(file, "x".repeat(8 * 1024 * 1024 + 1)), /exceeds 8 MiB/);
    assert.equal(await readFile(file, "utf8"), "old");
    assert.deepEqual(await readdir(dir), ["manifest.yaml"]);
  }));

if (process.platform !== "win32") {
  test("manifest のリンクを辿って書き込まない", async () =>
    fixture(async (dir, file) => {
      const target = path.join(dir, "target.yaml");
      await writeFile(target, "old");
      await symlink(target, file);
      await assert.rejects(writeFileAtomic(file, "new"), /regular file/);
      assert.equal(await readFile(target, "utf8"), "old");
    }));
}
