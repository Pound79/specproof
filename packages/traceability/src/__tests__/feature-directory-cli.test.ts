import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

for (const command of ["check", "stats"]) {
  test(`${command} は x.feature ディレクトリで EISDIR にしない`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "feature-directory-cli-"));
    try {
      await mkdir(path.join(root, "features/x.feature"), { recursive: true });
      await writeFile(path.join(root, "specproof.config.yaml"), "layout:\n  featuresDir: features\n");
      await writeFile(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
      const cli = fileURLToPath(new URL(`../../dist/cli-${command}.js`, import.meta.url));
      const result = spawnSync(process.execPath, [cli, "--root", root, "--json"], { encoding: "utf8", timeout: 10_000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      if (command === "check") assert.equal(report.clean, true);
      else assert.equal(report.totals.total, 0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
