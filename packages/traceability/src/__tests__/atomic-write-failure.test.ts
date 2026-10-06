import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { writeFileAtomic } from "../atomic-write.js";

test("rename の失敗時も元ファイルを保持し一時ファイルを回収する", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-failure-"));
  const file = path.join(dir, "manifest.yaml");
  await fs.writeFile(file, "old");
  const spy = vi.spyOn(fs, "rename").mockRejectedValue(new Error("injected rename failure"));
  try {
    await assert.rejects(writeFileAtomic(file, "new", "old"), /injected rename failure/);
    assert.equal(await fs.readFile(file, "utf8"), "old");
    assert.deepEqual(await fs.readdir(dir), ["manifest.yaml"]);
  } finally {
    spy.mockRestore();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
