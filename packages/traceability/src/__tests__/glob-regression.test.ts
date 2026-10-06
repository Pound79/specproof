import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { globBaseDir, globToRegExp } from "../glob.js";
import { findImplCandidates } from "../impl-audit.js";

test("未サポートの ? は regex 演算子ではなくリテラルとして一致する", () => {
  const re = globToRegExp("src/file?.ts");
  assert.equal(re.test("src/file?.ts"), true);
  assert.equal(re.test("src/fil.ts"), false);
  assert.equal(re.test("src/file.ts"), false);
});

test("ワイルドカードのない pattern は親ディレクトリから探索する", () => {
  assert.equal(globBaseDir("src/main.ts"), "src");
  assert.equal(globBaseDir("main.ts"), ".");
});

test("./ で始まる glob も repo 相対パスに一致する", () => {
  assert.equal(globToRegExp("././src/**/*.ts").test("src/main.ts"), true);
});

for (const patterns of [["src/main.ts"], ["./src/**/*.ts"], ["./src/main.ts", "src/**/*.ts"]]) {
  test(`実ファイル探索: ${patterns.join(", ")}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "glob-regression-"));
    try {
      await mkdir(path.join(root, "src"));
      await writeFile(path.join(root, "src/main.ts"), "export {};\n");
      assert.deepEqual(await findImplCandidates(root, patterns), ["src/main.ts"]);
      await assert.rejects(findImplCandidates(root, ["../outside/**/*.ts"]), /outside the repository root/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
