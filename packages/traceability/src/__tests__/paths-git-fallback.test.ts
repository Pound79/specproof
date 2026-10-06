import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { resolveRepoRoot } from "../paths.js";

const withRepo = (run: (root: string) => void, git = true): void => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-git-root-"));
  try {
    if (git) {
      const result = spawnSync("git", ["init", "-q", root], { encoding: "utf8" });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
for (const child of [".", "cli/src", "folder with spaces/nested"]) {
  test(`マーカーのない Git 作業ツリーの ${child} から root を見つける`, () => {
    withRepo((root) => {
      const start = path.join(root, child);
      mkdirSync(start, { recursive: true });
      assert.equal(resolveRepoRoot(start), realpathSync(root));
    });
  });
}
test("Git root より近い明示マーカーの優先順位は変えない", () => {
  withRepo((root) => {
    const project = path.join(root, "project");
    mkdirSync(path.join(project, "src"), { recursive: true });
    writeFileSync(path.join(project, "specproof.config.yaml"), "{}");
    assert.equal(resolveRepoRoot(path.join(project, "src")), project);
  });
});
test("検出不能時は --manifest 単独を回避策として案内しない", () => {
  withRepo((root) => {
    assert.throws(() => resolveRepoRoot(root), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Pass --root explicitly/);
      assert.doesNotMatch(error.message, /--root or --manifest/);
      return true;
    });
  }, false);
});
