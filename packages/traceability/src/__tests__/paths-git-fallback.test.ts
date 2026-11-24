import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
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

for (const marker of ["specproof.config.yaml", "traceability.yaml", "bdd-kit.config.yaml"]) {
  test(`独立した子リポジトリの外にある ${marker} は探索しない`, () => {
    withRepo((root) => {
      writeFileSync(path.join(root, marker), "{}");
      const nested = path.join(root, "service");
      const result = spawnSync("git", ["init", "-q", nested], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const src = path.join(nested, "src");
      mkdirSync(src);
      assert.equal(resolveRepoRoot(src), realpathSync(nested));
    });
  });
}
test(".git がファイル（gitdir: ...）の段でも、その外の設定ファイルは探索しない", () => {
  withRepo((root) => {
    writeFileSync(path.join(root, "specproof.config.yaml"), "{}");
    const nested = path.join(root, "module");
    const result = spawnSync(
      "git",
      ["init", "-q", "--separate-git-dir", path.join(root, "module.git"), nested],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(lstatSync(path.join(nested, ".git")).isFile());
    const src = path.join(nested, "src");
    mkdirSync(src);
    assert.equal(resolveRepoRoot(src), realpathSync(nested));
  });
});
test("検出不能時は --manifest 単独を回避策として案内しない", () => {
  withRepo((root) => {
    assert.throws(
      () => resolveRepoRoot(root),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Pass --root explicitly/);
        assert.doesNotMatch(error.message, /--root or --manifest/);
        return true;
      },
    );
  }, false);
});

for (const kind of ["empty-directory", "dangling-link"]) {
  test(`git が無視する .git 項目（${kind}）を越えて親の manifest を採らない`, () => {
    withRepo((root) => {
      writeFileSync(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
      const nested = path.join(root, "child");
      mkdirSync(nested);
      const marker = path.join(nested, ".git");
      if (kind === "empty-directory") mkdirSync(marker);
      else symlinkSync("missing-gitdir", marker, "dir");
      assert.throws(() => resolveRepoRoot(nested), /Could not resolve a repo root/);
    });
  });
}

test("親の Git 環境変数を引き継いでも子の実リポジトリを選ぶ", () => {
  withRepo((root) => {
    const nested = path.join(root, "child");
    assert.equal(spawnSync("git", ["init", "-q", nested]).status, 0);
    vi.stubEnv("GIT_DIR", path.join(root, ".git"));
    vi.stubEnv("GIT_WORK_TREE", root);
    try {
      assert.equal(resolveRepoRoot(nested), realpathSync(nested));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
