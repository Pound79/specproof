import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// 実際の rollback / cleanup / trap 部分だけを抽出する。
// リリース本体・npm・commit・tag・push は実行しない。
const source = readFileSync(new URL("./release.sh", import.meta.url), "utf8");
const start = source.indexOf('SNAP_DIR="$(mktemp -d)"');
const end = source.indexOf('\nfor f in "${RELEASE_FILES[@]}"; do', start);
assert.ok(start >= 0 && end > start, "release.sh の後始末ブロックが見つからない");
// ラッパーの echo は $? を 0 にしてしまう。製品が終了状態を保存した後に計測する。
const cleanup = source.slice(start, end)
  .replace('  local original_status=$?', '  local original_status=$?\n  echo cleanup >> cleanup-count.txt')
  .replace('  return "$original_status"', '  echo done >> cleanup-done.txt\n  return "$original_status"');

const retainSnapshot = (bin) => writeFileSync(path.join(bin, "rm"), '#!/bin/sh\nset -eu\nfor file in "$@"; do\ncase "$file" in -*) continue ;; esac\nmv "$file" "$file-retained"\ndone\n', { mode: 0o755 });

// シグナル試験では Git 操作を記録し、index の複製・反映と作業ファイルは実物を使う。
// Git による内容の復元は release-index-transaction.test.mjs で別途検証する。
const recordGit = (bin, second) => writeFileSync(path.join(bin, "git"), `#!/bin/sh
set -eu
printf "%s\\n" "$@" >> "$SIGNAL_GIT_CALLS"
case "$1" in
  rev-parse) printf '%s\\n' "$SIGNAL_INDEX" ;;
  reset)
    [ "$GIT_INDEX_FILE" = "$SIGNAL_INDEX.lock" ]
    ${second ? `kill -s ${second} "$SIGNAL_RELEASE_PID" "$PPID"\nsleep 0.2` : ":"}
    ;;
  *) exit 97 ;;
esac
`, { mode: 0o755 });

const expectedGitCalls = "rev-parse\n--path-format=absolute\n--git-path\nindex\nreset\n-q\n--\nrelease.txt\n";

for (const [signal, status] of [["INT", 130], ["TERM", 143]]) {
  for (const finalized of [false, true]) {
    test(`${signal}: finalized=${finalized} でも後続処理へ進まず一度だけ後始末する`, () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "release-signal-"));
      try {
        const bin = path.join(dir, "bin");
        const gitCalls = path.join(dir, "git-calls.txt");
        const index = path.join(dir, "index");
        mkdirSync(bin);
        retainSnapshot(bin);
        recordGit(bin);
        writeFileSync(index, "index fixture\n");
        writeFileSync(path.join(dir, "release.txt"), "before\n");
        const script = `set -euo pipefail
RELEASE_FILES=(release.txt)
${cleanup}
cp -p release.txt "$SNAP_DIR/release.txt"
echo "$SNAP_DIR" > snapshot-path.txt
SNAPSHOT_TAKEN=true
STAGING_STARTED=true
printf 'changed\\n' > release.txt
MUTATION_FINALIZED=${finalized}
kill -s ${signal} "$$"
echo continued > continued.txt
`;
        const result = spawnSync("bash", ["-c", script], {
          cwd: dir, encoding: "utf8", timeout: 5_000,
          env: { ...process.env, TMPDIR: dir, PATH: `${bin}${path.delimiter}${process.env.PATH}`, SIGNAL_GIT_CALLS: gitCalls, SIGNAL_INDEX: index },
        });
        assert.ifError(result.error);
        assert.equal(result.status, status, result.stderr);
        assert.equal(existsSync(path.join(dir, "continued.txt")), false);
        assert.equal(readFileSync(path.join(dir, "cleanup-count.txt"), "utf8"), "cleanup\n");
        assert.equal(readFileSync(path.join(dir, "cleanup-done.txt"), "utf8"), "done\n");
        assert.equal(readFileSync(path.join(dir, "release.txt"), "utf8"), finalized ? "changed\n" : "before\n");
        if (finalized) assert.equal(existsSync(gitCalls), false);
        else assert.equal(readFileSync(gitCalls, "utf8"), expectedGitCalls);
        assert.equal(readFileSync(index, "utf8"), "index fixture\n");
        assert.equal(existsSync(`${index}.lock`), false);
        const snapshot = readFileSync(path.join(dir, "snapshot-path.txt"), "utf8").trim();
        assert.equal(existsSync(snapshot), false);
      } finally {
        renameSync(dir, `${dir}-retained`);
      }
    });
  }
}

// 後始末の途中（rollback の git reset 中）に 2 回目のシグナルが届いても、
// 復元とスナップショットの削除を最後まで終えてから最初のシグナルの終了コードで止まる。
// 本体と復元用 subshell の両方に送り、どちらも処理が中断しないことを見る。
for (const [first, status] of [["INT", 130], ["TERM", 143]]) {
  for (const second of ["INT", "TERM"]) {
    test(`${first} の後始末中に ${second} が届いても後始末を完了する`, () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "release-signal-twice-"));
      try {
        const bin = path.join(dir, "bin");
        const gitCalls = path.join(dir, "git-calls.txt");
        const index = path.join(dir, "index");
        mkdirSync(bin);
        retainSnapshot(bin);
        recordGit(bin, second);
        writeFileSync(index, "index fixture\n");
        writeFileSync(path.join(dir, "release.txt"), "before\n");
        const script = `set -euo pipefail
RELEASE_FILES=(release.txt)
export SIGNAL_RELEASE_PID=$$
${cleanup}
cp -p release.txt "$SNAP_DIR/release.txt"
echo "$SNAP_DIR" > snapshot-path.txt
SNAPSHOT_TAKEN=true
STAGING_STARTED=true
printf 'changed\\n' > release.txt
kill -s ${first} "$$"
echo continued > continued.txt
`;
        const result = spawnSync("bash", ["-c", script], {
          cwd: dir, encoding: "utf8", timeout: 5_000,
          env: { ...process.env, TMPDIR: dir, PATH: `${bin}${path.delimiter}${process.env.PATH}`, SIGNAL_GIT_CALLS: gitCalls, SIGNAL_INDEX: index },
        });
        assert.ifError(result.error);
        assert.equal(result.status, status, result.stderr);
        assert.equal(existsSync(path.join(dir, "continued.txt")), false);
        assert.equal(readFileSync(path.join(dir, "cleanup-count.txt"), "utf8"), "cleanup\n");
        assert.equal(readFileSync(path.join(dir, "cleanup-done.txt"), "utf8"), "done\n");
        assert.equal(readFileSync(path.join(dir, "release.txt"), "utf8"), "before\n");
        assert.equal(readFileSync(gitCalls, "utf8"), expectedGitCalls);
        assert.equal(readFileSync(index, "utf8"), "index fixture\n");
        assert.equal(existsSync(`${index}.lock`), false);
        const snapshot = readFileSync(path.join(dir, "snapshot-path.txt"), "utf8").trim();
        assert.equal(existsSync(snapshot), false);
      } finally {
        renameSync(dir, `${dir}-retained`);
      }
    });
  }
}
