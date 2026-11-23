import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import type { DriftWarning } from "../check.js";
import { describeImplExcludeHint, looksLikeTestOrGenerated } from "../impl-exclude-hint.js";

// 版を上げて layout.implExcludeGlobs が使えるようになっても、設定に足さなければテストのファイルが
// unregistered-impl に並び続ける。テストや生成物らしいファイルが多いときに、設定を 1 行で案内する。

const impl = (filePath: string): DriftWarning => ({
  kind: "unregistered-impl",
  path: filePath,
  message: `unregistered ${filePath}`,
});

const testLike = [
  "src/a.test.ts",
  "src/b.spec.tsx",
  "src/__tests__/c.ts",
  "lib/d.g.dart",
  "lib/e.freezed.dart",
];

test("テストや生成物らしい unregistered-impl が 5 件以上で、implExcludeGlobs が未設定なら案内する", () => {
  const hint = describeImplExcludeHint([...testLike.map(impl), impl("src/app.ts")], undefined);
  assert.match(hint ?? "", /^\(5 unregistered-impl item\(s\) look like tests or generated files/);
  assert.match(hint ?? "", /layout\.implExcludeGlobs/);
  // パスは埋め込まない（PR の作者が書けるファイル名を案内に載せない）。
  assert.doesNotMatch(hint ?? "", /src\//);
});

test("4 件以下、設定済み、ほかの種類だけ、のときは案内しない", () => {
  assert.equal(describeImplExcludeHint(testLike.slice(0, 4).map(impl), undefined), undefined);
  assert.equal(describeImplExcludeHint(testLike.map(impl), []), undefined);
  assert.equal(
    describeImplExcludeHint(
      testLike.map((filePath) => ({
        ...impl(filePath),
        kind: "unregistered-spec-heading" as const,
      })),
      undefined,
    ),
    undefined,
  );
  assert.equal(
    describeImplExcludeHint(
      ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"].map(impl),
      undefined,
    ),
    undefined,
  );
});

const checkCli = fileURLToPath(new URL("../../dist/cli-check.js", import.meta.url));

test("check のテキストにだけ案内を出し、--json には足さない", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-impl-hint-"));
  try {
    mkdirSync(path.join(root, "src"), { recursive: true });
    for (const name of ["a", "b", "c", "d", "e"]) {
      writeFileSync(path.join(root, `src/${name}.test.ts`), "export {};\n");
    }
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      'layout:\n  manifest: traceability.yaml\n  implGlobs:\n    - "src/**/*.ts"\n',
    );
    writeFileSync(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
    const run = (args: string[]) =>
      spawnSync(process.execPath, [checkCli, "--root", root, ...args], {
        encoding: "utf8",
        timeout: 10_000,
      });
    // 既定ではテストらしいものを一覧から外すので、この案内は一覧に出す --include-tests のときに出る。
    assert.match(run(["--include-tests"]).stdout, /to keep them out of this list/);
    assert.doesNotMatch(run(["--include-tests", "--json"]).stdout, /look like tests/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("パターンごとに 1 件ずつ当たり、境界では当たらない", () => {
  for (const filePath of [
    "src/a.test.ts",
    "src/b.spec.tsx",
    "__tests__/c.ts",
    "src/__mocks__/d.ts",
    "test/e_test.dart",
    "lib/f.g.dart",
    "lib/g.freezed.dart",
    "test/h.mocks.dart",
  ]) {
    assert.equal(looksLikeTestOrGenerated(filePath), true, filePath);
  }
  for (const filePath of ["src/foo.test/a.ts", "src/test/a.ts", "src/latest.ts", "lib/a.dart"]) {
    assert.equal(looksLikeTestOrGenerated(filePath), false, filePath);
  }
});

test("空でない implExcludeGlobs を設定していれば案内しない", () => {
  assert.equal(describeImplExcludeHint(testLike.map(impl), ["**/__tests__/**"]), undefined);
});

test("長いパスでも照合が入力の長さに線形で終わる", () => {
  const longPath = `${".test.".repeat(20_000)}/a.ts`;
  const started = performance.now();
  looksLikeTestOrGenerated(longPath);
  assert.ok(performance.now() - started < 200);
});
