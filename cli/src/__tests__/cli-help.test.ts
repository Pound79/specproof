import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const cli = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

for (const args of [
  ["init", "--help"],
  ["init", "-h"],
  ["init", "--adapter", "playwright", "--help"],
  ["detect", "--help"],
  ["setup-agent", "--help"],
  ["setup-agent", "codex", "-h"],
]) {
  test(`サブコマンドの help は使い方を表示し何も書き込まない: ${args.join(" ")}`, () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "specproof-help-"));
    try {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Usage:/);
      assert.equal(result.stderr, "");
      assert.deepEqual(readdirSync(cwd), []);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
