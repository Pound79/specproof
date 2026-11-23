import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, test } from "vitest";

// テストや生成物に見える unregistered-impl が数百件あると、drift などの見るべき出力が埋もれる。
// テキスト出力では既定で一覧から外して件数だけを出し、--include-tests で一覧に戻す。
// --json と終了コードは変えない。--strict で失敗の理由になるときは隠さない。

const checkCli = fileURLToPath(new URL("../../dist/cli-check.js", import.meta.url));

const TEST_LIKE = [
  "src/a.test.ts",
  "src/b.spec.ts",
  "src/__tests__/c.ts",
  "src/d.test.ts",
  "src/e.spec.ts",
];

describe("check のテキスト出力は、テストや生成物に見える unregistered-impl を既定で一覧に出さない", () => {
  let root: string;

  const writeConfig = (extra = ""): void => {
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      `${extra}layout:\n  manifest: traceability.yaml\n  implGlobs:\n    - "src/**/*.ts"\n`,
    );
  };

  const run = (args: string[] = []) => {
    const result = spawnSync(process.execPath, [checkCli, "--root", root, ...args], {
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.ifError(result.error);
    return result;
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "specproof-hide-test-like-"));
    mkdirSync(path.join(root, "src", "__tests__"), { recursive: true });
    for (const file of [...TEST_LIKE, "src/app.ts"]) {
      writeFileSync(path.join(root, file), "export {};\n");
    }
    writeFileSync(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
    writeConfig();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("既定では一覧に出さず、件数と戻し方を 1 行で出す。終了コードは変えない", () => {
    const result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /src\/app\.ts/);
    for (const file of TEST_LIKE) assert.doesNotMatch(result.stdout, new RegExp(file));
    assert.match(
      result.stdout,
      /5 unregistered-impl item\(s\) that look like tests or generated files are not listed/,
    );
    assert.match(result.stdout, /--include-tests/);
    assert.match(result.stdout, /layout\.implExcludeGlobs/);
    // 件数のまとめも、一覧に出したものだけを数える。
    assert.match(result.stdout, /^Warnings: .*1 for reference \(unregistered-impl 1\)$/m);
  });

  test("--include-tests を付けると、これまでどおり一覧に出す", () => {
    const result = run(["--include-tests"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const file of TEST_LIKE) assert.match(result.stdout, new RegExp(file));
    assert.doesNotMatch(result.stdout, /are not listed/);
  });

  test("注釈でも一覧から外し、外した件数を 1 件の注釈で出す（--json と一緒に使うワークフローでも見える）", () => {
    const result = run(["--json", "--github-annotations"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const file of TEST_LIKE) assert.doesNotMatch(result.stderr, new RegExp(file));
    assert.match(result.stderr, /src\/app\.ts/);
    assert.match(result.stderr, /^::warning.*5 unregistered-impl item\(s\) that look like tests/m);
  });

  test("--json の warnings は変えない", () => {
    const report = JSON.parse(run(["--json"]).stdout);
    const paths = report.warnings
      .filter((warning: { kind: string }) => warning.kind === "unregistered-impl")
      .map((warning: { path: string }) => warning.path)
      .sort();
    assert.deepEqual(paths, [...TEST_LIKE, "src/app.ts"].sort());
  });

  test("全部が外れて一覧が空でも、件数の行は出す", () => {
    rmSync(path.join(root, "src", "app.ts"));
    const result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /For reference:/);
    assert.match(result.stdout, /5 unregistered-impl item\(s\) that look like tests/);
  });

  test("implExcludeGlobs を設定済みなら、その範囲を広げるよう案内する", () => {
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      'layout:\n  manifest: traceability.yaml\n  implGlobs:\n    - "src/**/*.ts"\n  implExcludeGlobs:\n    - "**/__tests__/**"\n',
    );
    const result = run();
    assert.match(result.stdout, /4 unregistered-impl item\(s\) that look like tests/);
    assert.match(result.stdout, /widen layout\.implExcludeGlobs/);
  });

  test("strictUnregisteredImpl なら --strict を付けない実行でも隠さない", () => {
    writeConfig("strictUnregisteredImpl: true\n");
    const result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const file of TEST_LIKE) assert.match(result.stdout, new RegExp(file));
    assert.doesNotMatch(result.stdout, /are not listed/);
  });

  test("strictUnregisteredImpl で --strict の失敗の理由になるときは隠さない", () => {
    writeConfig("strictUnregisteredImpl: true\n");
    const result = run(["--strict"]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    for (const file of TEST_LIKE) assert.match(result.stdout, new RegExp(file));
    assert.doesNotMatch(result.stdout, /are not listed/);
  });
});
