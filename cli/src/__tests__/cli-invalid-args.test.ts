import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const cli = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
for (const args of [
  ["init", "--adapter", "playwright", "--dry-run"],
  ["init", "--adapter", "playwright", "--dir", "--force"],
  ["init", "--adapter", "playwright", "--force", "false"],
  ["init", "--adapter", "playwright", "--json"],
  ["detect", "--force"],
  ["setup-agent", "codex", "--dry-run"],
]) {
  test(`CLI は書き込み前に不正な引数を拒否する: ${args.join(" ")}`, () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "specproof-argv-"));
    try {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Unknown option or argument|requires a value/);
      assert.deepEqual(readdirSync(cwd), []);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
