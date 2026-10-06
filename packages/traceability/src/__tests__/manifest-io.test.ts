import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { readManifestFile } from "../manifest-io.js";

const withTemp = async (run: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "specproof-manifest-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

for (const bytes of [0, 64 * 1024 + 1, 8 * 1024 * 1024]) {
  test(`${bytes} バイトの通常ファイルを読み取る`, async () => {
    await withTemp(async (dir) => {
      const file = path.join(dir, "manifest.yaml");
      const text = "x".repeat(bytes);
      await writeFile(file, text);
      assert.equal(await readManifestFile(file), text);
    });
  });
}
test("8 MiB を超えるファイルを拒否する", async () => {
  await withTemp(async (dir) => {
    const file = path.join(dir, "manifest.yaml");
    await writeFile(file, "x".repeat(8 * 1024 * 1024 + 1));
    await assert.rejects(readManifestFile(file), /exceeds 8 MiB/);
  });
});
test("ディレクトリを manifest として読まない", async () => {
  await withTemp(async (dir) => {
    const file = path.join(dir, "manifest.yaml");
    await mkdir(file);
    await assert.rejects(readManifestFile(file), /regular file/);
  });
});
test("存在しない manifest の ENOENT を保持する", async () => {
  await withTemp(async (dir) => {
    await assert.rejects(readManifestFile(path.join(dir, "missing.yaml")), { code: "ENOENT" });
  });
});
if (process.platform !== "win32") {
  test("デバイスを manifest として読まない", async () => {
    await assert.rejects(readManifestFile("/dev/null"), /regular file/);
  });
  test("書き手のない FIFO でもブロックせず拒否する", async () => {
    await withTemp(async (dir) => {
      const fifo = path.join(dir, "manifest.yaml");
      const mkfifo = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
      assert.ifError(mkfifo.error);
      assert.equal(mkfifo.status, 0, mkfifo.stderr);
      // 子プロセスに隔離し、回帰時にもテスト全体がハングしないようにする。
      const reader = new URL("../../dist/manifest-io.js", import.meta.url).href;
      const script = `import { readManifestFile } from ${JSON.stringify(reader)};
        try { await readManifestFile(process.argv[1]); process.exitCode = 1; }
        catch (error) { if (!/regular file/.test(error.message)) throw error; }`;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, fifo], {
        encoding: "utf8", timeout: 3_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
    });
  });
}
