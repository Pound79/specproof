import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { isScaffoldExcluded, scaffoldTemplate } from "../init.js";
import { bundle, includeInBundle } from "../../scripts/prepack-lib.mjs";

const withTemp = (run: (dir: string) => void): void => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "specproof-secrets-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const files = [".env", ".env.dev", ".env.production.local", ".env.example", ".npmrc"];
const dirs = [".auth", "test-results", "playwright-report", ".features-gen", "build", "coverage"];

for (const [names, isDirectory] of [
  [files, false],
  [dirs, true],
] as const) {
  for (const name of names) {
    test(`scaffold と pack が同じ機密・生成物を除外する: ${name}`, () => {
      withTemp((dir) => {
        const source = path.join(dir, name);
        if (isDirectory) mkdirSync(source);
        else writeFileSync(source, "dummy fixture; not a credential");
        assert.equal(isScaffoldExcluded(name, isDirectory), true);
        assert.equal(includeInBundle(source), false);
      });
    });
  }
}
for (const mode of ["scaffold", "bundle"] as const) {
  test(`${mode} は認証状態をコピーせず、安全な見本を残す`, () => {
    withTemp((dir) => {
      const source = path.join(dir, "source");
      const repoRoot = path.join(dir, "repo");
      const target = path.join(repoRoot, "e2e");
      mkdirSync(source);
      mkdirSync(repoRoot);
      for (const name of files) writeFileSync(path.join(source, name), "dummy fixture");
      mkdirSync(path.join(source, "playwright", ".auth"), { recursive: true });
      writeFileSync(path.join(source, "playwright", ".auth", "user.json"), "{}");
      mkdirSync(path.join(source, "test-results"));
      writeFileSync(path.join(source, "test-results", "trace.zip"), "dummy trace");
      writeFileSync(path.join(source, "env.example"), "DUMMY_VALUE=\n");
      writeFileSync(path.join(source, "gitignore"), ".env\n.env.*\n!.env.example\n");
      if (mode === "scaffold") {
        scaffoldTemplate({
          tplDir: source,
          repoRoot,
          e2eDir: target,
          templateDefaultDir: "packages/e2e",
          force: false,
        });
      } else {
        bundle([[source, target]]);
      }
      for (const name of files.filter((file) => file !== ".env.example")) {
        assert.equal(existsSync(path.join(target, name)), false, name);
      }
      assert.equal(existsSync(path.join(target, "playwright", ".auth")), false);
      assert.equal(existsSync(path.join(target, "test-results")), false);
      assert.equal(
        existsSync(path.join(target, mode === "scaffold" ? ".env.example" : "env.example")),
        true,
      );
      assert.equal(
        existsSync(path.join(target, mode === "scaffold" ? ".gitignore" : "gitignore")),
        true,
      );
    });
  });
}
if (process.platform !== "win32") {
  test("pack は別名のシンボリックリンク経由でもコピーしない", () => {
    withTemp((dir) => {
      const source = path.join(dir, "source");
      mkdirSync(source);
      const outside = path.join(dir, "outside.txt");
      writeFileSync(outside, "dummy fixture");
      symlinkSync(outside, path.join(source, "innocent.txt"));
      assert.throws(() => bundle([[source, path.join(dir, "bundle")]]), /symbolic link/);
    });
  });
}
for (const adapter of ["playwright", "flutter"]) {
  test(`${adapter} の gitignore は環境別 dotenv を隠し見本は許可する`, () => {
    withTemp((dir) => {
      const init = spawnSync("git", ["init", "-q", dir], { encoding: "utf8" });
      assert.ifError(init.error);
      assert.equal(init.status, 0, init.stderr);
      const source = fileURLToPath(
        new URL(`../../../templates/${adapter}/gitignore`, import.meta.url),
      );
      copyFileSync(source, path.join(dir, ".gitignore"));
      for (const name of [".env", ".env.dev", "nested/.env.production.local"]) {
        const result = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", name], {
          cwd: dir,
        });
        assert.ifError(result.error);
        assert.equal(result.status, 0, name);
      }
      const example = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", ".env.example"], {
        cwd: dir,
      });
      assert.ifError(example.error);
      assert.equal(example.status, 1);
    });
  });
}
