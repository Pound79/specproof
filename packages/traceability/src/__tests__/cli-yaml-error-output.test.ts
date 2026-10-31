import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const dist = (name: string): string =>
  fileURLToPath(new URL(`../../dist/cli-${name}.js`, import.meta.url));

// GitHub Actions は行頭の `::` をワークフローコマンドとして読む。YAML の構文エラーで
// ファイルの行をそのまま stderr に写すと、PR の内容が CI のログに注記や偽の行を作れる。
const FORGED = "::warning title=forged::injected";

const run = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-yaml-error-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(root, name), content);
    }
    const { SPECPROOF_DEBUG: _ignored, ...env } = process.env;
    const result = spawnSync(process.execPath, [dist("check"), "--root", root], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env,
    });
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const assertSingleSafeLine = (stderr: string, name: string): void => {
  assert.equal(stderr.split("\n").length, 2, `stderr must be one line: ${JSON.stringify(stderr)}`);
  assert.match(stderr, new RegExp(`^traceability check failed: .*${name.replaceAll(".", "\\.")}`));
  assert.match(stderr, /line \d+, column \d+/);
  assert.doesNotMatch(stderr, /injected/);
};

test("設定の YAML 構文エラーはファイルの行を写さず 1 行で位置だけを知らせる", () => {
  const result = run({
    "specproof.config.yaml": `layout:\n  manifest: [\n${FORGED}: {\n`,
    "traceability.yaml": "version: 1\nlinks: []\n",
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assertSingleSafeLine(result.stderr, "specproof.config.yaml");
});

test("manifest の YAML 構文エラーはファイルの行を写さず 1 行で位置だけを知らせる", () => {
  const result = run({ "traceability.yaml": `version: 1\nlinks: [\n${FORGED}: {\n` });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assertSingleSafeLine(result.stderr, "traceability.yaml");
});
