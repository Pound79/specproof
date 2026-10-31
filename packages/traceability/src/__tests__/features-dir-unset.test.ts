import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const dist = fileURLToPath(new URL("../../dist/cli-check.js", import.meta.url));

// 登録していない feature のドラフトマーカーは featuresDir を走査して見つける。設定ファイルが
// あるのに featuresDir が無いと、その検査が黙って働かないので知らせる。
const run = (files: Record<string, string>, args: string[]) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-features-dir-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), content);
    }
    const result = spawnSync(process.execPath, [dist, "--root", root, ...args], {
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

const MANIFEST = "version: 1\nlinks: []\n";
// 登録していないドラフト。featuresDir を走査しないと見つからない。
const DRAFT = "# specproof: draft\nFeature: draft\n  Scenario: s\n    Then it works\n";

const kinds = (stdout: string): string[] =>
  (JSON.parse(stdout) as { warnings: { kind: string }[] }).warnings.map((w) => w.kind);

test("設定ファイルに featuresDir が無ければ features-dir-unset を出し、--strict で失敗する", () => {
  const files = {
    "specproof.config.yaml": "layout:\n  manifest: traceability.yaml\n",
    "traceability.yaml": MANIFEST,
    "features/draft.feature": DRAFT,
  };
  const json = run(files, ["--json"]);
  assert.equal(json.status, 0);
  const report = JSON.parse(json.stdout) as {
    warnings: { kind: string; path?: string; failsUnderStrict: boolean; message: string }[];
  };
  const warning = report.warnings.find((w) => w.kind === "features-dir-unset");
  assert.ok(warning, json.stdout);
  assert.equal(warning.failsUnderStrict, true);
  assert.equal(warning.path, "specproof.config.yaml");
  assert.match(warning.message, /layout\.featuresDir/);

  const strict = run(files, ["--strict"]);
  assert.equal(strict.status, 1);
  assert.match(strict.stdout + strict.stderr, /layout\.featuresDir/);
});

test("設定ファイルが無ければ（engine 単体の利用）features-dir-unset を出さない", () => {
  const result = run({ "traceability.yaml": MANIFEST }, ["--json"]);
  assert.equal(result.status, 0);
  assert.ok(!kinds(result.stdout).includes("features-dir-unset"), result.stdout);
});

// 書いてあっても指す先が無ければ同じく検査が外れる。PR で別名に書き換えるだけで
// ゲートを素通りさせないよう、黙って登録済みだけに戻さず知らせる。
for (const [label, extra] of [
  ["存在しないディレクトリ", {}],
  ["通常のファイル", { nope: "not a directory\n" }],
] as const) {
  test(`featuresDir が${label}を指せば features-dir-missing を出し、--strict で失敗する`, () => {
    const files = {
      "specproof.config.yaml": "layout:\n  manifest: traceability.yaml\n  featuresDir: nope\n",
      "traceability.yaml": MANIFEST,
      "features/draft.feature": DRAFT,
      ...extra,
    };
    const json = run(files, ["--json"]);
    assert.equal(json.status, 0);
    const report = JSON.parse(json.stdout) as {
      warnings: { kind: string; path?: string; failsUnderStrict: boolean }[];
    };
    const warning = report.warnings.find((w) => w.kind === "features-dir-missing");
    assert.ok(warning, json.stdout);
    assert.equal(warning.path, "nope");
    assert.equal(warning.failsUnderStrict, true);
    assert.equal(run(files, ["--strict"]).status, 1);
  });
}

test("featuresDir を書いていれば features-dir-unset を出さず、未登録のドラフトを見つける", () => {
  const result = run(
    {
      "specproof.config.yaml": "layout:\n  manifest: traceability.yaml\n  featuresDir: features\n",
      "traceability.yaml": MANIFEST,
      "features/draft.feature": DRAFT,
    },
    ["--json"],
  );
  assert.equal(result.status, 0);
  const found = kinds(result.stdout);
  assert.ok(!found.includes("features-dir-unset"), result.stdout);
  assert.ok(found.includes("unreviewed-draft"), result.stdout);
});
