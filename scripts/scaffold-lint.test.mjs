import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(repo, "cli/dist/index.js");
const biome = path.join(repo, "node_modules/.bin/biome");
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 20_000 });
  assert.ifError(result.error);
  return result;
};

for (const parentName of [null, "biome.json", "biome.jsonc"]) {
  test(`scaffold lint は親設定 ${parentName ?? "なし"} でも実際に動く`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "specproof-scaffold-lint-"));
    try {
      if (parentName) writeFileSync(path.join(root, parentName), "{}\n");
      const initialized = run(process.execPath, [cli, "init", "--adapter", "playwright"], root);
      assert.equal(initialized.status, 0, initialized.stderr);
      const dir = path.join(root, "packages/e2e");
      const config = JSON.parse(readFileSync(path.join(dir, "biome.json"), "utf8"));
      assert.equal(config.root === false, parentName !== null);
      const result = run(biome, ["lint", "."], dir);
      assert.equal(result.status, 0, result.stderr);
      // echo / 空の対象で成功していないことも検査する。
      writeFileSync(path.join(dir, "steps/invalid.steps.ts"), "debugger;\n");
      const invalid = run(biome, ["lint", "."], dir);
      assert.notEqual(invalid.status, 0);
      assert.match(invalid.stdout + invalid.stderr, /noDebugger/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
