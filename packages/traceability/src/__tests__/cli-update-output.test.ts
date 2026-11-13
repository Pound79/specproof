import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const cli = fileURLToPath(new URL("../../dist/cli-update.js", import.meta.url));

const runUpdate = (manifest: string, args: string[] = []) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-update-output-"));
  try {
    writeFileSync(path.join(root, "a.ts"), "export {};\n");
    writeFileSync(path.join(root, "b.ts"), "export const b = 1;\n");
    writeFileSync(path.join(root, "traceability.yaml"), manifest);
    const result = spawnSync(process.execPath, [cli, "--root", root, ...args], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const manifestWith = (hash: string): string =>
  `version: 1\nlinks:\n  - id: a\n    label: A\n    spec: []\n    impl:\n      - path: a.ts\n        hash: ${hash}\n    features: []\n`;

test("変更が無いときは更新したと表示しない", () => {
  const first = runUpdate("version: 1\nlinks: []\n");
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /No hash changes/);
  assert.doesNotMatch(first.stdout, /manifest updated/);
});

test("変更があるときは更新した件数を表示する", () => {
  const result = runUpdate(manifestWith("PENDING"));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /a impl a\.ts: PENDING -> /);
  assert.match(result.stdout, /manifest updated/);
});

test("更新したリンクの数は、hash が変わったリンクだけを数える", () => {
  // 2 リンクのうち、hash が変わるのは a だけ。b は参照が無く何も変わらない。
  const manifest = `${manifestWith("PENDING")}  - id: b\n    label: B\n    spec: []\n    impl: []\n    features: []\n`;
  const result = runUpdate(manifest);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /manifest updated: 1 link\(s\) refreshed/);
});

const implLink = (id: string, paths: string[]): string =>
  `  - id: ${id}\n    label: ${id}\n    spec: []\n    impl:\n${paths
    .map((ref) => `      - path: ${ref}\n        hash: PENDING\n`)
    .join("")}    features: []\n`;

test("同じリンクの複数の参照が変わっても、リンクは 1 件と数え、参照の数も出す", () => {
  const result = runUpdate(`version: 1\nlinks:\n${implLink("a", ["a.ts", "b.ts"])}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /manifest updated: 1 link\(s\) refreshed \(2 hash\(es\) changed\)/);
});

test("--link-id では、指定したリンクの参照の数だけを出す", () => {
  // b も PENDING だが、--link-id a では対象外なので数えない。
  const manifest = `version: 1\nlinks:\n${implLink("a", ["a.ts"])}${implLink("b", ["b.ts"])}`;
  const result = runUpdate(manifest, ["--link-id", "a"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /manifest updated: link "a" refreshed \(1 hash\(es\) changed\)/);
});

test("dry-run は変更があっても更新したと表示しない", () => {
  const result = runUpdate(manifestWith("PENDING"), ["--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run/);
  assert.doesNotMatch(result.stdout, /manifest updated/);
});
