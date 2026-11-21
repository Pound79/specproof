import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { groupChangesSinceBless } from "../bless-changes.js";
import { findBlessedCommits } from "../bless-history.js";
import { checkDrift } from "../check.js";
import { describeChangesSinceBless } from "../cli-check-changes-format.js";
import { createGitRunner } from "../git-runner.js";
import { loadManifest } from "../manifest.js";
import { updateManifestHashes } from "../update.js";

// CLI のテスト（cli-check-since-bless-commits）と同じ場面を、ライブラリを直接呼んで確かめる。
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
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } },
  ).trim();

const commitAll = (cwd: string, message: string): string => {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
};

const MANIFEST = `version: 1
links:
  - id: perm
    label: Permissions
    spec:
      - path: docs/spec.md
        heading: "Rules"
        hash: PENDING
    impl:
      - path: src/a.ts
        hash: PENDING
      - path: src/b.ts
        hash: PENDING
    features: []
`;

describe("groupChangesSinceBless（ライブラリ）", () => {
  let root: string;
  const manifestPath = () => path.join(root, "traceability.yaml");

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-bless-changes-")));
    mkdirSync(path.join(root, "docs"));
    mkdirSync(path.join(root, "src"));
    git(root, ["init", "-q"]);
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Rules\n\nAllowed.\n");
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(path.join(root, "src", "b.ts"), "export const b = 1;\n");
    writeFileSync(manifestPath(), MANIFEST);
    commitAll(root, "v1");
    await updateManifestHashes(manifestPath(), root);
    commitAll(root, "bless");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const group = async (options: { maxGitCalls?: number } = {}) => {
    const report = await checkDrift(manifestPath(), root);
    const manifest = await loadManifest(manifestPath());
    const runner = createGitRunner(root, options);
    const history = await findBlessedCommits(root, report.entries, manifest, { runner });
    return groupChangesSinceBless(runner, report.entries, history, manifest);
  };

  it("マージと直接のコミットに割り当て、マージに含まれる個々のコミットは出さない", async () => {
    git(root, ["switch", "-q", "-c", "feature-x"]);
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    commitAll(root, "wip");
    git(root, ["switch", "-q", "main"]);
    git(root, ["merge", "-q", "--no-ff", "-m", "Merge pull request #12", "feature-x"]);
    writeFileSync(path.join(root, "src", "b.ts"), "export const b = 2;\n");
    commitAll(root, "Fix (#13)");
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Rules\n\nDenied.\n");

    const changes = await group();
    expect(changes.commits.map((change) => change.subject)).toEqual([
      "Fix (#13)",
      "Merge pull request #12",
    ]);
    expect(changes.uncommitted).toEqual([
      { side: "spec", path: "docs/spec.md", linkIds: ["perm"] },
    ]);
    expect(changes.notGrouped).toEqual({ noBlessedVersion: 0, notSearched: 0, failed: 0 });
    expect(changes.incomplete).toBe(false);
    const lines = describeChangesSinceBless(changes);
    expect(lines[0]).toMatch(/Changes since bless/);
    expect(lines).toContain("  (uncommitted)");
  });

  it("ブランチで bless した版を持ち込んだだけのマージは外し、その後の変更に割り当てる", async () => {
    git(root, ["switch", "-q", "-c", "feature-y"]);
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 5;\n");
    commitAll(root, "change on branch");
    await updateManifestHashes(manifestPath(), root);
    commitAll(root, "bless on branch");
    git(root, ["switch", "-q", "main"]);
    writeFileSync(path.join(root, "docs", "other.md"), "other\n");
    commitAll(root, "unrelated");
    git(root, ["merge", "-q", "--no-ff", "-m", "Merge #20", "feature-y"]);
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 6;\n");
    commitAll(root, "Change again (#21)");

    const changes = await group();
    expect(changes.commits.map((change) => change.subject)).toEqual(["Change again (#21)"]);
  });

  it("spec の見出しの参照は、その節を変えたコミットだけに割り当てる", async () => {
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Rules\n\nDenied.\n");
    commitAll(root, "Rules (#30)");
    writeFileSync(
      path.join(root, "docs", "spec.md"),
      "# Spec\n\n## Rules\n\nDenied.\n\n## Other\n\nAdded.\n",
    );
    commitAll(root, "Other (#31)");
    const changes = await group();
    expect(changes.commits.map((change) => change.subject)).toEqual(["Rules (#30)"]);
  });

  it("bless した版が見つからない参照は、理由ごとに数える", async () => {
    writeFileSync(path.join(root, "src", "b.ts"), "export const b = 9;\n");
    await updateManifestHashes(manifestPath(), root);
    writeFileSync(path.join(root, "src", "b.ts"), "export const b = 10;\n");
    const changes = await group();
    expect(changes.notGrouped.noBlessedVersion).toBe(1);
    expect(describeChangesSinceBless(changes).at(-1)).toMatch(
      /1 reference\(s\) not grouped: 1 without a blessed version/,
    );
  });

  it("消したファイルと、コミット済みの削除を区別する", async () => {
    rmSync(path.join(root, "src", "b.ts"));
    let changes = await group();
    expect(changes.uncommitted).toEqual([{ side: "impl", path: "src/b.ts", linkIds: ["perm"] }]);
    const removed = commitAll(root, "Remove b (#40)");
    changes = await group();
    expect(changes.uncommitted).toEqual([]);
    expect(changes.commits.map((change) => change.commit)).toEqual([removed]);
  });

  it("git の起動の上限に達したら、打ち切ったとし、手を付けなかった参照は探していないと数える", async () => {
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    writeFileSync(path.join(root, "src", "b.ts"), "export const b = 2;\n");
    commitAll(root, "change both");
    const changes = await group({ maxGitCalls: 6 });
    expect(changes.incomplete).toBe(true);
    expect(changes.notGrouped.failed).toBe(0);
  });

  it("テキストは 20 コミットまでにし、長い件名を切り、見えない文字を除く", async () => {
    for (let i = 0; i < 21; i += 1) {
      writeFileSync(path.join(root, "src", "a.ts"), `export const a = ${100 + i};\n`);
      commitAll(root, i === 20 ? `long​ ${"x".repeat(200)}` : `change ${i}`);
    }
    const lines = describeChangesSinceBless(await group());
    expect(lines.join("\n")).toMatch(/\.\.\.and 1 more commit\(s\)/);
    expect(lines[1]).toMatch(/ long x+\.\.\.$/);
    expect(lines[1]).not.toMatch(/​/);
  });
});
