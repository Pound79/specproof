import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { groupChangesSinceBless } from "../bless-changes.js";
import { findBlessedCommits } from "../bless-history.js";
import { checkDrift } from "../check.js";
import { describeChangesSinceBless } from "../cli-check-changes-format.js";
import { createGitRunner } from "../git-runner.js";
import { loadManifest } from "../manifest.js";

const checkCli = fileURLToPath(new URL("../../dist/cli-check.js", import.meta.url));

// v1 の保存値は、コメント内の見出しで節が切れた範囲の hash のことがある。そうした過去の版は、
// 本文がコメントの後ろで変わっても同じ hash になるので、どの版を bless したかを決められない。
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

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const manifestWith = (hash: string): string =>
  [
    "version: 1",
    "links:",
    "  - id: card",
    "    label: 支払い",
    "    spec:",
    "      - path: spec.md",
    "        heading: 支払い",
    `        hash: ${hash}`,
    "    impl: []",
    "    features: []",
    "",
  ].join("\n");

const AMBIGUOUS = (fee: string): string => `## 支払い\n<!--\n## 古い仕様\n-->\n手数料は${fee}。\n`;

describe("--since-bless: コメント内の見出しで節が切れた過去の版", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-bless-comment-")));
    git(root, ["init", "-q"]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // drift があるので終了コードは 0 でない。出力だけを見る。
  const runCli = (args: string[]): string =>
    spawnSync(process.execPath, [checkCli, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
    }).stdout;

  const run = async () => {
    const manifestPath = path.join(root, "traceability.yaml");
    const report = await checkDrift(manifestPath, root);
    const manifest = await loadManifest(manifestPath);
    const runner = createGitRunner(root);
    const history = await findBlessedCommits(root, report.entries, manifest, { runner });
    const changes = await groupChangesSinceBless(runner, report.entries, history, manifest);
    return { report, history, changes };
  };

  it("一致した版の境界がコメントで曖昧なら、bless した版を特定できないとして返す", async () => {
    // 従来の規則の hash（コメント内の見出しで節が切れる）で bless した。
    writeFileSync(path.join(root, "spec.md"), AMBIGUOUS("0円"));
    writeFileSync(path.join(root, "traceability.yaml"), manifestWith(sha256("## 支払い\n<!--")));
    commitAll(root, "c1");
    writeFileSync(path.join(root, "spec.md"), AMBIGUOUS("500円"));
    const c2 = commitAll(root, "c2");
    writeFileSync(
      path.join(root, "spec.md"),
      AMBIGUOUS("500円").replace("## 古い仕様", "    ## 古い仕様"),
    );
    commitAll(root, "c3");

    const { report, history, changes } = await run();
    expect(report.entries).toHaveLength(1);
    expect(history.commits[0]).not.toBe(c2);
    expect(history.commits).toEqual([null]);
    expect(history.unidentified).toEqual(["html-comment-boundary"]);
    expect(changes.commits).toEqual([]);
    expect(changes.notGrouped).toEqual({
      noBlessedVersion: 0,
      notSearched: 0,
      failed: 0,
      unidentifiedBlessedVersion: 1,
    });
    expect(describeChangesSinceBless(changes).join("\n")).toMatch(
      /1 whose blessed version cannot be identified because of an HTML comment/,
    );
  });

  it("CLI はテキストと --json で、bless した版を特定できない理由を示し、誤った起点を出さない", () => {
    writeFileSync(path.join(root, "spec.md"), AMBIGUOUS("0円"));
    writeFileSync(path.join(root, "traceability.yaml"), manifestWith(sha256("## 支払い\n<!--")));
    commitAll(root, "c1");
    writeFileSync(path.join(root, "spec.md"), AMBIGUOUS("500円"));
    const c2 = commitAll(root, "c2");
    writeFileSync(
      path.join(root, "spec.md"),
      AMBIGUOUS("500円").replace("## 古い仕様", "    ## 古い仕様"),
    );
    commitAll(root, "c3");

    const text = runCli(["--since-bless"]);
    expect(text).not.toContain(c2);
    expect(text).toMatch(/blessed version: cannot be identified .*HTML comment/);
    expect(text).toMatch(/Review the history of "spec\.md" by hand/);
    expect(text).toMatch(/1 whose blessed version cannot be identified because of an HTML comment/);
    const report = JSON.parse(runCli(["--since-bless", "--json"]));
    expect(report.entries[0].blessedCommit).toBeNull();
    expect(report.entries[0].blessedCommitUnidentified).toBe("html-comment-boundary");
    expect(report.sinceBless.commits).toEqual([]);
    expect(report.sinceBless.notGrouped.unidentifiedBlessedVersion).toBe(1);
  });

  it("bless の後の途中の版の境界がコメントで曖昧でも、隠れた本文を変えたコミットを漏らさない", async () => {
    writeFileSync(path.join(root, "spec.md"), "## 支払い\n手数料は0円。\n");
    writeFileSync(
      path.join(root, "traceability.yaml"),
      manifestWith(sha256("## 支払い\n手数料は0円。\n")),
    );
    const c1 = commitAll(root, "c1");
    writeFileSync(path.join(root, "spec.md"), AMBIGUOUS("0円"));
    const c2 = commitAll(root, "c2");
    writeFileSync(path.join(root, "spec.md"), AMBIGUOUS("500円"));
    const c3 = commitAll(root, "c3");
    writeFileSync(
      path.join(root, "spec.md"),
      AMBIGUOUS("500円").replace("## 古い仕様", "    ## 古い仕様"),
    );
    const c4 = commitAll(root, "c4");

    const { history, changes } = await run();
    expect(history.commits).toEqual([c1]);
    expect(changes.commits.map((change) => change.commit)).toEqual([c4, c3, c2]);
  });

  it("境界がコメントで変わらない版は、従来どおり bless した版として返す", async () => {
    writeFileSync(path.join(root, "spec.md"), "## 支払い\n<!-- 注記 -->\n手数料は0円。\n");
    writeFileSync(
      path.join(root, "traceability.yaml"),
      manifestWith(sha256("## 支払い\n<!-- 注記 -->\n手数料は0円。\n")),
    );
    const c1 = commitAll(root, "c1");
    writeFileSync(path.join(root, "spec.md"), "## 支払い\n<!-- 注記 -->\n手数料は500円。\n");
    const c2 = commitAll(root, "c2");

    const { history, changes } = await run();
    expect(history.commits).toEqual([c1]);
    expect(history.unidentified).toEqual([undefined]);
    expect(changes.commits.map((change) => change.commit)).toEqual([c2]);
    expect(changes.notGrouped).toEqual({
      noBlessedVersion: 0,
      notSearched: 0,
      failed: 0,
      unidentifiedBlessedVersion: 0,
    });
  });
});
