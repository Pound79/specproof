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

// 中身の無い .git（空のディレクトリ・リンク切れ）だけは取り除く案内を出してよい。
// 中身のある .git は原因を決めつけず、git の終了コードと理由を示す（取り除くと履歴を失いうる）。
const brokenGitEntries: Record<string, { create: (marker: string) => void; hollow: boolean }> = {
  "empty-directory": { create: (marker) => mkdirSync(marker), hollow: true },
  "dangling-link": {
    create: (marker) => symlinkSync("missing-gitdir", marker, "dir"),
    hollow: true,
  },
  "garbage-file": {
    create: (marker) => writeFileSync(marker, "not a git entry\n"),
    hollow: false,
  },
  "gitdir-to-missing": {
    create: (marker) => writeFileSync(marker, "gitdir: ../missing.git\n"),
    hollow: false,
  },
};
for (const [kind, { create, hollow }] of Object.entries(brokenGitEntries)) {
  test(`壊れた .git 項目（${kind}）を越えて親の manifest を採らず、その場所を示す`, () => {
    withRepo((root) => {
      writeFileSync(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
      const nested = path.join(root, "child");
      mkdirSync(nested);
      const marker = path.join(nested, ".git");
      create(marker);
      assert.throws(
        () => resolveRepoRoot(nested),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          const { message } = error;
          assert.match(message, /Could not resolve a repo root/);
          assert.ok(message.includes(`"${marker}"`), message);
          assert.match(message, /up to the Git boundary/);
          assert.doesNotMatch(message, /in any ancestor directory/);
          assert.match(message, /pass --root explicitly/);
          if (hollow) {
            assert.ok(message.includes(`"${marker}" is empty or a broken link`), message);
            assert.match(message, /fix or remove it/);
          } else {
            assert.ok(message.includes(`git rejected "${marker}" (exit 128): `), message);
            assert.doesNotMatch(message, /remove/);
          }
          return true;
        },
      );
    });
  });
}

test("正常な .git でも git の設定のせいで失敗したときは、.git を取り除く案内をしない", () => {
  withRepo((root) => {
    const badConfig = path.join(root, "broken-global.gitconfig");
    writeFileSync(badConfig, "[[[ not a config\n");
    vi.stubEnv("GIT_CONFIG_GLOBAL", badConfig);
    try {
      assert.throws(
        () => resolveRepoRoot(root),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          const { message } = error;
          assert.ok(message.includes(`git rejected "${path.join(root, ".git")}"`), message);
          assert.match(message, /\(exit \d+\): fatal: bad config line 1/);
          assert.match(message, /check the repository and your Git config/);
          assert.doesNotMatch(message, /remove|not a usable/);
          return true;
        },
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

test("git を実行できないときは、正常な .git を壊れていると案内しない", () => {
  withRepo((root) => {
    const emptyBin = path.join(root, "empty-bin");
    mkdirSync(emptyBin);
    vi.stubEnv("PATH", emptyBin);
    try {
      assert.throws(
        () => resolveRepoRoot(root),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(
            error.message.includes(
              `could not get an answer from git to verify "${path.join(root, ".git")}"`,
            ),
            error.message,
          );
          assert.doesNotMatch(error.message, /not a usable Git repository|remove|rejected/);
          assert.match(error.message, /pass --root explicitly/);
          return true;
        },
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

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
