import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const dist = (name: string): string =>
  fileURLToPath(new URL(`../../dist/cli-${name}.js`, import.meta.url));

for (const name of ["check", "update", "list", "stats"] as const) {
  test.skipIf(process.platform === "win32")(
    `${name}: repo 外リンクの状態は stderr 全体でも区別できない`,
    () => {
      const temp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-path-errors-")));
      const root = path.join(temp, "repo");
      const outside = path.join(temp, "outside");
      const locked = path.join(outside, "locked");
      mkdirSync(root);
      mkdirSync(locked, { recursive: true });
      const manifest = path.join(root, "traceability.yaml");
      const existing = path.join(outside, "existing.yaml");
      const loop = path.join(outside, "loop");
      writeFileSync(existing, "version: 1\nlinks: []\n");
      symlinkSync("loop", loop);
      chmodSync(locked, 0o000);
      try {
        const outputs: string[] = [];
        // 同じ参照名のリンク先だけを差し替え、メッセージだけでなくスタックも比べる。
        for (const target of [
          existing,
          path.join(outside, "missing.yaml"),
          path.join(locked, "q.yaml"),
          loop,
        ]) {
          symlinkSync(target, manifest);
          try {
            const result = spawnSync(
              process.execPath,
              [dist(name), "--root", root, "--manifest", manifest],
              { encoding: "utf8", timeout: 10_000 },
            );
            assert.ifError(result.error);
            assert.equal(result.status, 2);
            assert.equal(result.stdout, "");
            assert.match(result.stderr, /is dangling or resolves outside the repository root/);
            outputs.push(result.stderr);
          } finally {
            unlinkSync(manifest);
          }
        }
        assert.equal(new Set(outputs).size, 1, outputs.join("\n---\n"));
      } finally {
        chmodSync(locked, 0o755);
        rmSync(temp, { recursive: true, force: true });
      }
    },
  );
}
