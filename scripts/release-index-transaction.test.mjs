import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const gitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const source = readFileSync(new URL("./release.sh", import.meta.url), "utf8");
// 製品の snapshot / rollback / EXIT trap をそのまま実行する。公開操作は含めない。
const start = source.indexOf('SNAP_DIR="$(mktemp -d)"');
const end = source.indexOf("# --- mutate: bump versions", start);
assert.ok(start >= 0 && end > start);
const safetyNet = source.slice(start, end);
const INITIAL = "# Changelog\n\n## [Unreleased]\n\n- 既存。\n";
const STAGED = `${INITIAL}\n- index だけの変更。\n`;
const WORKING = `${INITIAL}\n- 作業ツリーだけの変更。\n`;

const fixture = (options = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-transaction-"));
  const write = (name, content) => writeFileSync(path.join(root, name), content);
  const git = (...args) => execFileSync(gitPath, args, { cwd: root, encoding: "utf8" });
  git("init", "-b", "main");
  write("CHANGELOG.md", INITIAL);
  write("managed.json", '{"version":"1.0.0"}\n');
  write("unrelated.txt", "before\n");
  git("add", ".");
  const tree = git("write-tree").trim();
  const commit = execFileSync(gitPath, ["hash-object", "-t", "commit", "-w", "--stdin"], {
    cwd: root, encoding: "utf8",
    input: `tree ${tree}\nauthor Pound79 <fixture@example.com> 0 +0000\ncommitter Pound79 <fixture@example.com> 0 +0000\n\nfixture\n`,
  }).trim();
  git("update-ref", "refs/heads/main", commit);
  if (options.staged !== false) {
    write("CHANGELOG.md", STAGED);
    git("add", "CHANGELOG.md");
  }
  write("CHANGELOG.md", WORKING);
  if (options.splitIndex) git("update-index", "--split-index");
  mkdirSync(path.join(root, "bin"));
  // 空白を含む snapshot パスでも案内の復旧コマンドをそのまま実行できることを見る。
  mkdirSync(path.join(root, "scratch space"));
  write("bin/git", `#!/bin/sh
set -eu
if [ "$1" = "$FAIL_COMMAND" ]; then exit 95; fi
exec ${quote(gitPath)} "$@"
`);
  write("bin/mv", '#!/bin/sh\n[ "$FAIL_COMMAND" != "publish" ] || exit 96\nexec /bin/mv "$@"\n');
  chmodSync(path.join(root, "bin/git"), 0o755);
  chmodSync(path.join(root, "bin/mv"), 0o755);
  write("driver.sh", `set -euo pipefail
RELEASE_FILES=(CHANGELOG.md managed.json)
${safetyNet}
printf '%s\\n' '{"version":"2.0.0"}' > managed.json
printf '%s\\n' 'release content' > CHANGELOG.md
STAGING_STARTED=true
git add -- "\${RELEASE_FILES[@]}"
printf 'parallel stage\\n' > unrelated.txt
git add unrelated.txt
cp .git/index before-rollback.index
${options.locked ? "printf 'other owner\\n' > .git/index.lock" : ""}
${options.signal ? `kill -${options.signal} $$` : `exit ${options.status ?? 7}`}
`);
  const env = { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`, TMPDIR: path.join(root, "scratch space"), FAIL_COMMAND: options.fail ?? "" };
  return {
    run() {
      const result = spawnSync("bash", ["driver.sh"], { cwd: root, env, encoding: "utf8", timeout: 10_000 });
      assert.ifError(result.error);
      return result;
    },
    assertUnchanged() {
      assert.deepEqual(readFileSync(path.join(root, ".git/index")), readFileSync(path.join(root, "before-rollback.index")));
      assert.equal(git("show", ":unrelated.txt"), "parallel stage\n");
      assert.equal(existsSync(path.join(root, ".git/index.lock")), Boolean(options.locked));
      if (options.locked) assert.equal(readFileSync(path.join(root, ".git/index.lock"), "utf8"), "other owner\n");
    },
    assertRestored() {
      assert.equal(git("show", ":CHANGELOG.md"), options.staged === false ? INITIAL : STAGED);
      assert.equal(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), WORKING);
      assert.equal(git("show", ":managed.json"), '{"version":"1.0.0"}\n');
      assert.equal(git("show", ":unrelated.txt"), "parallel stage\n");
      assert.equal(existsSync(path.join(root, ".git/index.lock")), false);
    },
    recover(stderr) {
      const match = stderr.match(/スナップショットを保持しています: (.+)$/m);
      assert.ok(match, stderr);
      const snapshot = match[1];
      assert.equal(readFileSync(path.join(snapshot, "CHANGELOG.md"), "utf8"), WORKING);
      assert.match(readFileSync(path.join(snapshot, "index.patch"), "utf8"), /index だけの変更/);
      const command = stderr.split("\n").find((line) => line.trimStart().startsWith("bash "));
      assert.ok(command, stderr);
      const result = spawnSync("bash", ["-c", command.trim()], { cwd: root, encoding: "utf8", timeout: 10_000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
    },
    retain() { renameSync(root, `${root}-retained`); },
  };
};

for (const fail of ["reset", "apply", "publish"]) {
  test(`${fail} 失敗でも本番 index の byte と対象外 stage を保持し、案内から復旧できる`, () => {
    const f = fixture({ fail });
    try {
      const result = f.run();
      assert.equal(result.status, 7, result.stderr);
      f.assertUnchanged();
      f.recover(result.stderr);
      f.assertRestored();
    } finally { f.retain(); }
  });
}

test("正常終了中の復元失敗は EXIT trap から非 0 で終了する", () => {
  const f = fixture({ fail: "apply", status: 0 });
  try {
    const result = f.run();
    assert.equal(result.status, 1, result.stderr);
    f.assertUnchanged();
  } finally { f.retain(); }
});

test("他プロセスの index.lock があれば本番 index とその lock を触らない", () => {
  const f = fixture({ locked: true });
  try {
    const result = f.run();
    assert.equal(result.status, 7, result.stderr);
    assert.match(result.stderr, /復元に失敗/);
    f.assertUnchanged();
  } finally { f.retain(); }
});

for (const options of [{}, { staged: false }, { splitIndex: true }, { signal: "INT" }, { signal: "TERM" }]) {
  test(`index の復元成功時は独立した stage と元の終了状態を保つ: ${JSON.stringify(options)}`, () => {
    const f = fixture(options);
    try {
      const result = f.run();
      assert.equal(result.status, options.signal === "INT" ? 130 : options.signal === "TERM" ? 143 : 7, result.stderr);
      f.assertRestored();
    } finally { f.retain(); }
  });
}
