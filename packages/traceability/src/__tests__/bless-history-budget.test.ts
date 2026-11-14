import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "vitest";
import { findBlessedCommits } from "../bless-history.js";
import type { DriftEntry } from "../check.js";
import type { TraceabilityManifest } from "../manifest.js";

const git = (cwd: string, args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=specproof-test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } },
  ).trim();

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-bless-budget-")));
  mkdirSync(path.join(root, "src"));
  git(root, ["init", "-q"]);
  for (let index = 0; index < 5; index += 1) {
    writeFileSync(path.join(root, "src", "a.ts"), `export const a = ${index};\n`);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", `v${index}`]);
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const manifest: TraceabilityManifest = {
  version: 1,
  links: [{ id: "l", label: "l", spec: [], impl: [{ path: "src/a.ts", hash: "x" }], features: [] }],
};

// どの版にも一致しない hash。PR が書ける manifest で、探索を延々と続けさせない。
const neverMatching = (linkId: string): DriftEntry => ({
  linkId,
  side: "impl",
  path: "src/a.ts",
  storedHash: "0".repeat(64),
  currentHash: "1".repeat(64),
  status: "changed",
});

test("git の起動回数の上限に達したら探索を止め、打ち切ったと示す", async () => {
  const history = await findBlessedCommits(root, [neverMatching("l")], manifest, {
    maxGitCalls: 3,
  });
  assert.equal(history.available, true);
  assert.equal(history.incomplete, true);
  assert.deepEqual(history.commits, [undefined]);
});

test("同じパスの参照が何件あっても、履歴と各版は 1 回ずつしか読まない", async () => {
  const entries = Array.from({ length: 50 }, (_, index) => neverMatching(`l${index}`));
  // rev-parse 2 回 + log 1 回 + show 5 回 = 8 回で、50 件すべてを「見つからない」と判定できる。
  const history = await findBlessedCommits(root, entries, manifest, { maxGitCalls: 8 });
  assert.equal(history.incomplete, false);
  assert.ok(history.commits.every((commit) => commit === null));
});
