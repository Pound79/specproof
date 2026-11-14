import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "vitest";
import { findBlessedCommits } from "../bless-history.js";
import type { DriftEntry } from "../check.js";
import { computeFileHash, computeHeadingSectionHash } from "../hash.js";
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

const commitAll = (cwd: string, message: string): string => {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
};

const implEntry = (refPath: string, storedHash: string): DriftEntry => ({
  linkId: "l",
  side: "impl",
  path: refPath,
  storedHash,
  currentHash: "f".repeat(64),
  status: "changed",
});

const manifestOf = (spec: TraceabilityManifest["links"][number]["spec"] = []) =>
  ({
    version: 1,
    links: [{ id: "l", label: "l", spec, impl: [], features: [] }],
  }) as TraceabilityManifest;

describe("findBlessedCommits", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-bless-history-")));
    mkdirSync(path.join(root, "src"));
    mkdirSync(path.join(root, "docs"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("git の管理下でなければ探さず、available を false にする", async () => {
    writeFileSync(path.join(root, "src", "a.ts"), "export {};\n");
    const history = await findBlessedCommits(
      root,
      [implEntry("src/a.ts", "a".repeat(64))],
      manifestOf(),
    );
    assert.deepEqual(history, {
      available: false,
      incomplete: false,
      prefix: "",
      commits: [undefined],
      paths: [undefined],
    });
  });

  test("hash が仮の値（PENDING）の参照は探さない", async () => {
    git(root, ["init", "-q"]);
    writeFileSync(path.join(root, "src", "a.ts"), "export {};\n");
    commitAll(root, "v1");
    const history = await findBlessedCommits(
      root,
      [implEntry("src/a.ts", "PENDING")],
      manifestOf(),
    );
    assert.equal(history.available, true);
    assert.deepEqual(history.commits, [undefined]);
  });

  test("spec は manifest の見出しの段で節を照合する", async () => {
    git(root, ["init", "-q"]);
    writeFileSync(
      path.join(root, "docs", "spec.md"),
      "# S\n\n### Rules\n\nA.\n\n### Other\n\nB.\n",
    );
    const blessed = commitAll(root, "v1");
    const storedHash = await computeHeadingSectionHash(
      path.join(root, "docs", "spec.md"),
      "Rules",
      3,
    );
    writeFileSync(path.join(root, "docs", "spec.md"), "# S\n\n### Rules\n\nChanged.\n");
    commitAll(root, "v2");
    const entry: DriftEntry = {
      ...implEntry("docs/spec.md", storedHash),
      side: "spec",
      heading: "Rules",
    };
    const history = await findBlessedCommits(
      root,
      [entry],
      manifestOf([{ path: "docs/spec.md", heading: "Rules", headingLevel: 3, hash: storedHash }]),
    );
    assert.deepEqual(history.commits, [blessed]);
  });

  // update と check はリポジトリ内のリンクを辿り、実体の中身を hash にする。履歴も実体で辿る。
  test("リポジトリ内のシンボリックリンクの参照は、リンク先の実体の履歴で探し、実体のパスを返す", async () => {
    git(root, ["init", "-q"]);
    writeFileSync(path.join(root, "src", "real.ts"), "export const v = 1;\n");
    symlinkSync("real.ts", path.join(root, "src", "alias.ts"));
    const blessed = commitAll(root, "v1");
    const storedHash = await computeFileHash(path.join(root, "src", "alias.ts"));
    writeFileSync(path.join(root, "src", "real.ts"), "export const v = 2;\n");
    commitAll(root, "v2");

    const history = await findBlessedCommits(
      root,
      [implEntry("src/alias.ts", storedHash), implEntry("src/real.ts", storedHash)],
      manifestOf(),
    );
    assert.deepEqual(history.commits, [blessed, blessed]);
    assert.deepEqual(history.paths, ["src/real.ts", "src/real.ts"]);
    // 示すパスで実際に差分が出る（リンクのパスでは、リンク先の文字列が変わらず空になる）。
    assert.match(git(root, ["diff", blessed, "--", "src/real.ts"]), /export const v = 2/);
  });

  test("リンクのディレクトリの下で消えたファイルも、実体のディレクトリの履歴で探す", async () => {
    git(root, ["init", "-q"]);
    mkdirSync(path.join(root, "lib"));
    writeFileSync(path.join(root, "lib", "a.ts"), "export {};\n");
    // ディレクトリごと消えるとリンク切れになり、参照は check の時点で拒否される。残るファイルを置く。
    writeFileSync(path.join(root, "lib", "keep.ts"), "export {};\n");
    symlinkSync("lib", path.join(root, "pkg"));
    const blessed = commitAll(root, "v1");
    const storedHash = await computeFileHash(path.join(root, "pkg", "a.ts"));
    git(root, ["rm", "-q", "lib/a.ts"]);
    commitAll(root, "remove");
    const history = await findBlessedCommits(
      root,
      [implEntry("pkg/a.ts", storedHash)],
      manifestOf(),
    );
    assert.deepEqual(history.commits, [blessed]);
    assert.deepEqual(history.paths, ["lib/a.ts"]);
  });

  test("ファイルが消えていれば、manifest のパスのまま履歴を探す", async () => {
    git(root, ["init", "-q"]);
    writeFileSync(path.join(root, "src", "gone.ts"), "export {};\n");
    const blessed = commitAll(root, "v1");
    const storedHash = await computeFileHash(path.join(root, "src", "gone.ts"));
    git(root, ["rm", "-q", "src/gone.ts"]);
    commitAll(root, "remove");
    const history = await findBlessedCommits(
      root,
      [implEntry("src/gone.ts", storedHash)],
      manifestOf(),
    );
    assert.deepEqual(history.commits, [blessed]);
    assert.deepEqual(history.paths, ["src/gone.ts"]);
  });
});
