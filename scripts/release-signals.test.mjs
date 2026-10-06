import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// 実際の rollback / cleanup / trap 部分だけを抽出する。
// リリース本体・npm・commit・tag・push は実行しない。
const source = readFileSync(new URL("./release.sh", import.meta.url), "utf8");
const start = source.indexOf('SNAP_DIR="$(mktemp -d)"');
const end = source.indexOf('\nfor f in "${RELEASE_FILES[@]}"; do', start);
assert.ok(start >= 0 && end > start, "release.sh の後始末ブロックが見つからない");
const cleanup = source.slice(start, end).replace("cleanup() {", "original_cleanup() {");

for (const [signal, status] of [["INT", 130], ["TERM", 143]]) {
  for (const finalized of [false, true]) {
    test(`${signal}: finalized=${finalized} でも後続処理へ進まず一度だけ後始末する`, () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "release-signal-"));
      try {
        writeFileSync(path.join(dir, "release.txt"), "before\n");
        const script = `set -euo pipefail
RELEASE_FILES=(release.txt)
${cleanup}
cleanup() { echo cleanup >> cleanup-count.txt; original_cleanup; }
cp -p release.txt "$SNAP_DIR/release.txt"
echo "$SNAP_DIR" > snapshot-path.txt
SNAPSHOT_TAKEN=true
printf 'changed\\n' > release.txt
MUTATION_FINALIZED=${finalized}
kill -s ${signal} "$$"
echo continued > continued.txt
`;
        const result = spawnSync("bash", ["-c", script], {
          cwd: dir, encoding: "utf8", timeout: 5_000,
          env: { ...process.env, TMPDIR: dir },
        });
        assert.ifError(result.error);
        assert.equal(result.status, status, result.stderr);
        assert.equal(existsSync(path.join(dir, "continued.txt")), false);
        assert.equal(readFileSync(path.join(dir, "cleanup-count.txt"), "utf8"), "cleanup\n");
        assert.equal(readFileSync(path.join(dir, "release.txt"), "utf8"), finalized ? "changed\n" : "before\n");
        const snapshot = readFileSync(path.join(dir, "snapshot-path.txt"), "utf8").trim();
        assert.equal(existsSync(snapshot), false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}
