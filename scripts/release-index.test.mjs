import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  lstatSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const gitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const INITIAL = "# Changelog\n\n## [Unreleased]\n\n- 既存の内容。\n";
const STAGED = `${INITIAL}\n- ステージした変更。\n`;
const UNSTAGED = `${STAGED}\n- 未ステージの変更。\n`;

// Git index は隔離した実物を使い、公開操作はすべて stub に限定する。
const fixture = (staged, workingTree, commitFailure = false, parallelStage = false, options = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-index-"));
  const write = (name, content) => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const json = (name, value) => write(name, `${JSON.stringify(value, null, 2)}\n`);
  const git = (...args) => execFileSync(gitPath, args, { cwd: root, encoding: "utf8" });

  json("package.json", { private: true, workspaces: ["packages/*", "cli"] });
  json("cli/package.json", { name: "fixture-cli", version: "0.3.0" });
  json("packages/traceability/package.json", { name: "fixture-engine", version: "0.3.0" });
  json("package-lock.json", {
    packages: { cli: { version: "0.3.0" }, "packages/traceability": { version: "0.3.0" } },
  });
  json(".claude-plugin/marketplace.json", { metadata: { version: "0.3.0" } });
  json("plugins/specproof/.claude-plugin/plugin.json", { version: "0.3.0" });
  for (const adapter of ["playwright", "flutter"]) {
    for (const name of ["specproof.config.yaml", "github-workflows/specproof-drift-check.yml"]) {
      write(`templates/${adapter}/${name}`, "command: npx @pound79/specproof-traceability@0.3.0\n");
    }
  }
  write("CHANGELOG.md", options.initialChangelog ?? INITIAL);
  write("unrelated.txt", "before\n");
  for (const name of ["release.sh", "check-versions.mjs"]) {
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    copyFileSync(new URL(`./${name}`, import.meta.url), path.join(root, "scripts", name));
  }
  // commit コマンドや hook を実行せず、fixture の初期 HEAD だけを Git object で作る。
  git("init", "-b", "main");
  git("add", ".");
  const tree = git("write-tree").trim();
  const commit = execFileSync(gitPath, ["hash-object", "-t", "commit", "-w", "--stdin"], {
    cwd: root,
    encoding: "utf8",
    input: `tree ${tree}\nauthor Pound79 <fixture@example.com> 0 +0000\ncommitter Pound79 <fixture@example.com> 0 +0000\n\n初期状態\n`,
  }).trim();
  git("update-ref", "refs/heads/main", commit);
  if (options.color) git("config", "color.ui", "always");
  if (options.prefix) git("config", "diff.noprefix", "true");
  if (options.context !== undefined) git("config", "diff.context", String(options.context));
  if (staged !== undefined) {
    write("CHANGELOG.md", staged);
    git("add", "CHANGELOG.md");
  }
  write("CHANGELOG.md", workingTree);
  mkdirSync(path.join(root, "node_modules"));
  mkdirSync(path.join(root, "scratch"));
  write("bin/git", `#!/bin/sh
set -eu
printf '%s\\n' "$1" >> "$INDEX_FIXTURE_ROOT/git-calls.txt"
case "$1" in
  pull) exit 0 ;;
  ls-remote) exit 2 ;;
  commit)
    [ "$INDEX_FIXTURE_COMMIT_SUCCESS" = "true" ] || exit 1
    exec ${shellQuote(gitPath)} -c core.hooksPath=/dev/null -c commit.gpgSign=false \\
      -c user.name=Pound79 -c user.email=fixture@example.com "$@" ;;
  tag|push)
    [ "$INDEX_FIXTURE_COMMIT_SUCCESS" = "true" ] && exit 0
    exit 94 ;;
esac
if [ "$INDEX_FIXTURE_ROLLBACK_FAILURE" = "$1" ]; then exit 95; fi
if [ "$1" = "--no-pager" ] && [ "$INDEX_FIXTURE_PARALLEL_STAGE" = "true" ]; then
  printf 'parallel stage\\n' > "$INDEX_FIXTURE_ROOT/unrelated.txt"
  ${shellQuote(gitPath)} add unrelated.txt
fi
exec ${shellQuote(gitPath)} "$@"
`);
  write("bin/npm", '#!/bin/sh\n[ "$1" = "version" ] || exit 91\n');
  // 既存 cleanup の削除コマンドも、この試験では退避に置き換える。
  write("bin/rm", '#!/bin/sh\nset -eu\nfor file in "$@"; do\ncase "$file" in -*) continue ;; esac\nmv "$file" "$file-retained"\ndone\n');
  for (const name of ["git", "npm", "rm"]) {
    chmodSync(path.join(root, "bin", name), 0o755);
  }
  const before = {
    status: git("status", "--porcelain", "--untracked-files=no"),
    index: git("show", ":CHANGELOG.md"),
    staged: git("diff", "--cached", "--binary", "--", "CHANGELOG.md"),
    workingTree,
  };
  return {
    run() {
      const result = spawnSync("bash", ["scripts/release.sh", "0.3.0", "--skip-checks"], {
        cwd: root,
        encoding: "utf8",
        input: commitFailure || options.commitSuccess ? "y\n" : "n\n",
        timeout: 45_000,
        env: {
          ...process.env,
          PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`,
          TMPDIR: path.join(root, "scratch"),
          INDEX_FIXTURE_ROOT: root,
          INDEX_FIXTURE_PARALLEL_STAGE: String(parallelStage),
          INDEX_FIXTURE_ROLLBACK_FAILURE: options.rollbackFailure ?? "",
          INDEX_FIXTURE_COMMIT_SUCCESS: String(options.commitSuccess ?? false),
        },
      });
      assert.ifError(result.error);
      return result;
    },
    assertRestored() {
      const status = git("status", "--porcelain", "--untracked-files=no");
      assert.equal(status, before.status + (parallelStage ? "M  unrelated.txt\n" : ""));
      assert.equal(git("show", ":CHANGELOG.md"), before.index);
      assert.equal(git("diff", "--cached", "--binary", "--", "CHANGELOG.md"), before.staged);
      assert.equal(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), before.workingTree);
      if (parallelStage) assert.equal(git("show", ":unrelated.txt"), "parallel stage\n");
      const calls = readFileSync(path.join(root, "git-calls.txt"), "utf8").trim().split("\n");
      assert.equal(calls.some(command => ["tag", "push"].includes(command)), false);
    },
    retain() { renameSync(root, `${root}-retained`); },
    assertCommittedOnlyRelease() {
      assert.equal(git("show", "HEAD:unrelated.txt"), "before\n");
      assert.equal(git("show", ":unrelated.txt"), "parallel stage\n");
      assert.equal(git("diff", "--cached", "--name-only"), "unrelated.txt\n");
      assert.match(git("show", "HEAD:CHANGELOG.md"), /## \[0\.3\.0\]/);
      assert.equal(git("show", "HEAD:CHANGELOG.md"), readFileSync(path.join(root, "CHANGELOG.md"), "utf8"));
      const files = git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").trim().split("\n");
      assert.ok(files.includes("CHANGELOG.md"), files.join(", "));
      assert.ok(!files.includes("unrelated.txt"), files.join(", "));
    },
    assertSnapshotRetained(stderr) {
      // mktemp の既定置場は OS ごとに違うため、復旧案内の実際の場所を検証する。
      const match = stderr.match(/スナップショットを保持しています: (.+)$/m);
      assert.ok(match, stderr);
      const snapshot = match[1];
      assert.equal(lstatSync(snapshot).isDirectory(), true);
      assert.equal(snapshot.endsWith("-retained"), false);
      assert.equal(readFileSync(path.join(snapshot, "index.patch"), "utf8"), before.staged);
      assert.equal(readFileSync(path.join(snapshot, "CHANGELOG.md"), "utf8"), before.workingTree);
    },
  };
};

for (const [name, staged, workingTree] of [
  ["未ステージ", undefined, INITIAL],
  ["部分 stage", STAGED, UNSTAGED],
]) {
  test(`release 成功時も対象外の並行 stage を commit せず保つ: ${name}`, () => {
    const f = fixture(staged, workingTree, false, true, { commitSuccess: true });
    try {
      const result = f.run();
      assert.equal(result.status, 0, result.stderr);
      f.assertCommittedOnlyRelease();
    } finally {
      f.retain();
    }
  });
}

test("release の確認を拒否しても CHANGELOG の既存ステージを保つ", () => {
  const f = fixture(STAGED, STAGED);
  try {
    const result = f.run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /aborted by user/);
    f.assertRestored();
  } finally {
    f.retain();
  }
});

test("release の commit が失敗しても CHANGELOG の部分 stage を復元する", () => {
  const f = fixture(STAGED, UNSTAGED, true);
  try {
    const result = f.run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Committing release/);
    f.assertRestored();
  } finally {
    f.retain();
  }
});

for (const [name, staged, workingTree] of [
  ["未ステージ", undefined, UNSTAGED],
  ["部分 stage", STAGED, UNSTAGED],
]) {
  test(`release の確認を拒否しても CHANGELOG の${name}を保つ`, () => {
    const f = fixture(staged, workingTree);
    try {
      const result = f.run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /aborted by user/);
      f.assertRestored();
    } finally {
      f.retain();
    }
  });
}

test("commit 失敗で release 対象の stage を復元しても、対象外の並行 stage を保つ", () => {
  const f = fixture(STAGED, UNSTAGED, true, true);
  try {
    const result = f.run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Committing release/);
    f.assertRestored();
  } finally {
    f.retain();
  }
});

test("Git の色・prefix 設定があっても commit 失敗で部分 stage を復元する", () => {
  const f = fixture(STAGED, UNSTAGED, true, false, { color: true, prefix: true });
  try {
    const result = f.run();
    f.assertRestored();
    assert.equal(result.status, 1, result.stderr);
  } finally { f.retain(); }
});

test("Git の diff.context=0 設定でも文中の部分 stage を復元する", () => {
  const initial = `${INITIAL}\n- 後続の項目。\n\n## [0.2.0]\n\n- 以前の変更。\n`;
  const staged = initial.replace("既存の内容", "ステージした内容");
  const workingTree = staged.replace("後続の項目", "未ステージの後続項目");
  const f = fixture(staged, workingTree, true, false, { context: 0, initialChangelog: initial });
  try {
    const result = f.run();
    f.assertRestored();
    assert.equal(result.status, 1, result.stderr);
  } finally { f.retain(); }
});

for (const rollbackFailure of ["reset", "apply"]) {
  test(`復元時の ${rollbackFailure} 失敗では snapshot を保持し復旧を案内する`, () => {
    const f = fixture(STAGED, UNSTAGED, true, false, { rollbackFailure });
    try {
      const result = f.run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /復元に失敗/);
      assert.match(result.stderr, /スナップショットを保持/);
      f.assertSnapshotRetained(result.stderr);
    } finally { f.retain(); }
  });
}
