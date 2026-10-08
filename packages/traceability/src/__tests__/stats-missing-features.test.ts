import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";

// 登録済みの feature が読めないとき、その分の未実装シナリオごと集計から消える。
// 欠落を「シナリオ 0 件」と区別しないと、--strict の fixme=0 を誤って満たす。
const cli = fileURLToPath(new URL("../../dist/cli-stats.js", import.meta.url));

const withRepo = (
  files: Record<string, string>,
  config: string,
  run: (root: string) => void,
): void => {
  const root = mkdtempSync(path.join(os.tmpdir(), "stats-missing-"));
  try {
    writeFileSync(path.join(root, "specproof.config.yaml"), config);
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), text);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const stats = (root: string, ...flags: string[]) =>
  spawnSync(process.execPath, [cli, "--root", root, ...flags], { encoding: "utf8" });

const manifestFor = (...features: string[]): string =>
  [
    "version: 1",
    "links:",
    "  - id: a",
    "    label: A",
    "    spec: []",
    "    impl: []",
    "    features:",
    ...features.flatMap((feature) => [`      - path: ${feature}`, "        hash: PENDING"]),
    "",
  ].join("\n");

const DONE = "Feature: 完成\n  Scenario: 条件\n    Given 条件\n";
const MANIFEST_ONLY = "layout:\n  manifest: traceability.yaml\n";

describe("登録済み feature の欠落", () => {
  test("--strict は失敗させ、欠落したパスを示す", () =>
    withRepo(
      {
        "traceability.yaml": manifestFor("features/a.feature", "features/gone.feature"),
        "features/a.feature": DONE,
      },
      MANIFEST_ONLY,
      (root) => {
        const result = stats(root, "--strict");
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /features\/gone\.feature/);
      },
    ));

  test("--json は欠落を missingFeatures に出す", () =>
    withRepo(
      {
        "traceability.yaml": manifestFor("features/a.feature", "features/gone.feature"),
        "features/a.feature": DONE,
      },
      MANIFEST_ONLY,
      (root) => {
        const result = stats(root, "--json");
        assert.equal(result.status, 0, result.stderr);
        const report = JSON.parse(result.stdout);
        assert.deepEqual(report.missingFeatures, ["features/gone.feature"]);
        assert.equal(report.totals.total, 1);
      },
    ));

  test("--strict なしでは成功させるが、欠落を警告する", () =>
    withRepo(
      { "traceability.yaml": manifestFor("features/gone.feature") },
      MANIFEST_ONLY,
      (root) => {
        const result = stats(root);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /features\/gone\.feature/);
      },
    ));

  test("登録済みの全 feature が欠落しても --strict は成功しない", () =>
    withRepo(
      { "traceability.yaml": manifestFor("features/x.feature", "features/y.feature") },
      MANIFEST_ONLY,
      (root) => {
        assert.equal(stats(root, "--strict").status, 1);
      },
    ));

  test("feature のパスがディレクトリに置き換わっていても成功しない", () =>
    withRepo(
      {
        "traceability.yaml": manifestFor("features/a.feature"),
        "features/a.feature/inner.txt": "x\n",
      },
      MANIFEST_ONLY,
      (root) => {
        assert.notEqual(stats(root, "--strict").status, 0);
      },
    ));

  test("欠落が無ければ従来どおり --strict は成功する", () =>
    withRepo(
      { "traceability.yaml": manifestFor("features/a.feature"), "features/a.feature": DONE },
      MANIFEST_ONLY,
      (root) => {
        const result = stats(root, "--strict", "--json");
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout).missingFeatures, []);
      },
    ));
});

describe("設定した featuresDir の欠落", () => {
  test("--strict は失敗させる", () =>
    withRepo(
      { "traceability.yaml": manifestFor("features/a.feature"), "features/a.feature": DONE },
      "layout:\n  manifest: traceability.yaml\n  featuresDir: missing-dir\n",
      (root) => {
        const result = stats(root, "--strict");
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /missing-dir/);
      },
    ));
});
