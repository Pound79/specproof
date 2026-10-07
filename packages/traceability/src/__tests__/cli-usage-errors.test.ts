import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const dist = (name: string): string =>
  fileURLToPath(new URL(`../../dist/cli-${name}.js`, import.meta.url));

const run = (name: string, args: string[]) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-usage-"));
  try {
    writeFileSync(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
    const result = spawnSync(process.execPath, [dist(name), "--root", root, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

for (const [name, args, message] of [
  ["check", ["--stric"], "Unknown option or argument: --stric"],
  ["update", ["--json"], "Unknown option or argument: --json"],
  ["list", ["--pages-dir"], "--pages-dir requires a value"],
  ["stats", ["--manifest", "--json"], "--manifest requires a value"],
] as const) {
  test(`${name}: 引数の誤りはスタックを出さず 1 行で知らせる`, () => {
    const result = run(name, [...args]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `traceability ${name} failed: ${message}\n`);
  });
}

test("想定外のエラーは調査用にスタックを残す", () => {
  const result = run("check", ["--manifest", "missing.yaml"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /traceability check failed:/);
  assert.match(result.stderr, /ENOENT/);
  assert.match(result.stderr, /\n\s+at /);
});
