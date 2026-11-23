import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { parse } from "yaml";
import { compileGlob } from "../glob.js";

// specproof init が置く設定に、テストや生成物を unregistered-impl から外す glob を最初から書く。
// 利用者が毎回同じ設定を足さなくて済むように。外すのはテストや生成物だけで、製品のファイルは数え続ける。

const templateConfig = (adapter: string): { layout: { implExcludeGlobs?: unknown } } =>
  parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../../../templates/${adapter}/specproof.config.yaml`, import.meta.url),
      ),
      "utf8",
    ),
  );

const excluded = (globs: unknown, filePath: string): boolean =>
  Array.isArray(globs) && globs.some((glob) => compileGlob(String(glob)).test(filePath));

test("Playwright の雛形は、Web のテストとモックを unregistered-impl から外す", () => {
  const globs = templateConfig("playwright").layout.implExcludeGlobs;
  for (const filePath of [
    "src/__tests__/a.ts",
    "src/feature/__mocks__/b.ts",
    "src/c.test.ts",
    "src/d.spec.tsx",
  ]) {
    assert.ok(excluded(globs, filePath), filePath);
  }
  for (const filePath of ["src/app.ts", "src/test/helper.ts", "src/latest.tsx"]) {
    assert.ok(!excluded(globs, filePath), filePath);
  }
});

test("Flutter の雛形は、Dart のテストと生成物を unregistered-impl から外す", () => {
  const globs = templateConfig("flutter").layout.implExcludeGlobs;
  for (const filePath of [
    "lib/a.g.dart",
    "lib/b.freezed.dart",
    "lib/c.mocks.dart",
    "lib/d_test.dart",
  ]) {
    assert.ok(excluded(globs, filePath), filePath);
  }
  for (const filePath of ["lib/main.dart", "lib/latest.dart", "lib/test/page.dart"]) {
    assert.ok(!excluded(globs, filePath), filePath);
  }
});
