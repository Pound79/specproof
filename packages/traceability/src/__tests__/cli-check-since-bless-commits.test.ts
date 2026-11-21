import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, test } from "vitest";

const checkCli = fileURLToPath(new URL("../../dist/cli-check.js", import.meta.url));
const updateCli = fileURLToPath(new URL("../../dist/cli-update.js", import.meta.url));

const run = (cli: string, cwd: string, args: string[] = []) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.ifError(result.error);
  return result;
};

// 利用者の git 設定（署名・フック）に左右されないように、空の設定でコミットする。
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
  - id: audit
    label: Audit
    spec: []
    impl:
      - path: src/a.ts
        hash: PENDING
    features: []
`;

interface GroupedRef {
  side: string;
  path: string;
  linkIds: string[];
}
interface ChangeCommit {
  commit: string;
  subject: string;
  entries: GroupedRef[];
}

// drift した参照を、bless の後にそれを変えたコミット（マージの PR）ごとにまとめて出す。
describe("specproof-check --since-bless のコミットごとのまとめ", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-since-bless-commits-")));
    mkdirSync(path.join(root, "docs"));
    mkdirSync(path.join(root, "src"));
    git(root, ["init", "-q"]);
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Rules\n\nAllowed.\n");
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(path.join(root, "src", "b.ts"), "export const b = 1;\n");
    writeFileSync(path.join(root, "traceability.yaml"), MANIFEST);
    commitAll(root, "v1");
    assert.equal(run(updateCli, root).status, 0);
    commitAll(root, "bless");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ブランチで 2 つのコミットを作り、--no-ff でマージする（PR のマージと同じ形）。
  const mergeBranch = (name: string, subject: string, edits: () => void): string => {
    git(root, ["switch", "-q", "-c", name]);
    edits();
    commitAll(root, `wip on ${name}`);
    writeFileSync(path.join(root, "docs", `${name}.md`), "note\n");
    commitAll(root, `notes on ${name}`);
    git(root, ["switch", "-q", "main"]);
    git(root, ["merge", "-q", "--no-ff", "-m", subject, name]);
    return git(root, ["rev-parse", "HEAD"]);
  };

  test("マージの PR と直接のコミットごとに、drift した参照とリンクをまとめ、新しい順に出す", () => {
    const merged = mergeBranch("feature-x", "Merge pull request #12 from org/feature-x", () => {
      writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    });
    writeFileSync(path.join(root, "src", "b.ts"), "export const b = 2;\n");
    const direct = commitAll(root, "Fix button label (#13)");

    const text = run(checkCli, root, ["--since-bless"]).stdout;
    assert.match(text, /Changes since bless, by commit \(first-parent, newest first\):/);
    const directAt = text.indexOf(`${direct.slice(0, 12)} Fix button label (#13)`);
    const mergedAt = text.indexOf(
      `${merged.slice(0, 12)} Merge pull request #12 from org/feature-x`,
    );
    assert.ok(directAt >= 0 && mergedAt > directAt, text);
    // マージに含まれる個々のコミット（first-parent の外）は出さない。
    assert.doesNotMatch(text, /wip on feature-x/);
    assert.match(text.slice(mergedAt), /impl {2}src\/a\.ts {2}links: perm, audit/);
    assert.match(text.slice(directAt, mergedAt), /impl {2}src\/b\.ts {2}links: perm/);

    const report = JSON.parse(run(checkCli, root, ["--since-bless", "--json"]).stdout);
    const commits: ChangeCommit[] = report.sinceBless.commits;
    assert.deepEqual(
      commits.map((change) => [change.commit, change.subject]),
      [
        [direct, "Fix button label (#13)"],
        [merged, "Merge pull request #12 from org/feature-x"],
      ],
    );
    assert.deepEqual(commits[1].entries, [
      { side: "impl", path: "src/a.ts", linkIds: ["perm", "audit"] },
    ]);
    assert.deepEqual(report.sinceBless.uncommitted, []);
    assert.deepEqual(report.sinceBless.notGrouped, {
      noBlessedVersion: 0,
      notSearched: 0,
      failed: 0,
    });
    assert.equal(report.sinceBless.incomplete, false);
    // 既存のフィールドは変えない。
    assert.equal(typeof report.entries[0].blessedCommit, "string");
  });

  test("コミットしていない変更は (uncommitted) にまとめる", () => {
    writeFileSync(path.join(root, "src", "b.ts"), "export const b = 3;\n");
    const text = run(checkCli, root, ["--since-bless"]).stdout;
    assert.match(text, /\(uncommitted\)\n {4}impl {2}src\/b\.ts {2}links: perm/);
    const report = JSON.parse(run(checkCli, root, ["--since-bless", "--json"]).stdout);
    assert.deepEqual(report.sinceBless.commits, []);
    assert.deepEqual(report.sinceBless.uncommitted, [
      { side: "impl", path: "src/b.ts", linkIds: ["perm"] },
    ]);
  });

  test("spec の drift も side を付けて同じコミットにまとめる", () => {
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Rules\n\nDenied.\n");
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    const both = commitAll(root, "Change rules and code (#14)");
    const report = JSON.parse(run(checkCli, root, ["--since-bless", "--json"]).stdout);
    const change: ChangeCommit = report.sinceBless.commits[0];
    assert.equal(change.commit, both);
    assert.deepEqual(change.entries, [
      { side: "spec", path: "docs/spec.md", linkIds: ["perm"] },
      { side: "impl", path: "src/a.ts", linkIds: ["perm", "audit"] },
    ]);
  });

  test("bless した版が見つからない参照はまとめず、その件数を出す", () => {
    // コミットしていない中身で bless し直してから、さらに変える。
    writeFileSync(path.join(root, "src", "b.ts"), "export const b = 9;\n");
    assert.equal(run(updateCli, root).status, 0);
    writeFileSync(path.join(root, "src", "b.ts"), "export const b = 10;\n");
    const text = run(checkCli, root, ["--since-bless"]).stdout;
    assert.match(text, /\(1 reference\(s\) not grouped: 1 without a blessed version\)/);
    const report = JSON.parse(run(checkCli, root, ["--since-bless", "--json"]).stdout);
    assert.deepEqual(report.sinceBless.notGrouped, {
      noBlessedVersion: 1,
      notSearched: 0,
      failed: 0,
    });
  });

  test("コミットの件名の制御文字は、テキストでは表示できる形にする", () => {
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    commitAll(root, "Evil \u001b[31mred\u001b[0m subject");
    const text = run(checkCli, root, ["--since-bless"]).stdout;
    assert.doesNotMatch(text, /\u001b/);
    assert.match(text, /Evil .*red.* subject/);
  });

  test("--since-bless が無ければ、まとめを出さず --json にも sinceBless を足さない", () => {
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    commitAll(root, "change");
    assert.doesNotMatch(run(checkCli, root).stdout, /Changes since bless/);
    const report = JSON.parse(run(checkCli, root, ["--json"]).stdout);
    assert.equal("sinceBless" in report, false);
  });

  test("ブランチで bless してからマージしても、bless を持ち込んだマージは変更として出さない", () => {
    git(root, ["switch", "-q", "-c", "feature-y"]);
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 5;\n");
    commitAll(root, "change a on branch");
    assert.equal(run(updateCli, root).status, 0);
    commitAll(root, "bless on branch");
    git(root, ["switch", "-q", "main"]);
    // ブランチの間に main が進む（マージの第 1 親が bless した版を含まない）。
    writeFileSync(path.join(root, "docs", "other.md"), "other\n");
    commitAll(root, "unrelated on main");
    git(root, [
      "merge",
      "-q",
      "--no-ff",
      "-m",
      "Merge pull request #20 from org/feature-y",
      "feature-y",
    ]);
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 6;\n");
    const later = commitAll(root, "Change a again (#21)");

    const report = JSON.parse(run(checkCli, root, ["--since-bless", "--json"]).stdout);
    const commits: ChangeCommit[] = report.sinceBless.commits;
    assert.deepEqual(
      commits.map((change) => change.subject),
      ["Change a again (#21)"],
    );
    assert.equal(commits[0].commit, later);
  });

  test("spec の見出しの参照は、その節を変えたコミットだけに割り当てる", () => {
    writeFileSync(
      path.join(root, "docs", "spec.md"),
      "# Spec\n\n## Rules\n\nAllowed.\n\n## Other\n\nAdded.\n",
    );
    commitAll(root, "Add other section (#22)");
    writeFileSync(
      path.join(root, "docs", "spec.md"),
      "# Spec\n\n## Rules\n\nDenied.\n\n## Other\n\nAdded.\n",
    );
    const rules = commitAll(root, "Change rules (#23)");
    // Rules を変えた後に、ほかの節だけを変える（Rules は bless した版とも、直前の版とも違うまま）。
    writeFileSync(
      path.join(root, "docs", "spec.md"),
      "# Spec\n\n## Rules\n\nDenied.\n\n## Other\n\nChanged.\n",
    );
    commitAll(root, "Change other section (#24)");
    const report = JSON.parse(run(checkCli, root, ["--since-bless", "--json"]).stdout);
    assert.deepEqual(
      report.sinceBless.commits.map((change: ChangeCommit) => [change.commit, change.subject]),
      [[rules, "Change rules (#23)"]],
    );
  });

  test("消したファイルもコミットしていない変更としてまとめる", () => {
    rmSync(path.join(root, "src", "b.ts"));
    const report = JSON.parse(run(checkCli, root, ["--since-bless", "--json"]).stdout);
    assert.deepEqual(report.sinceBless.uncommitted, [
      { side: "impl", path: "src/b.ts", linkIds: ["perm"] },
    ]);
  });

  test("リポジトリの設定の clean フィルタを起動しない", () => {
    writeFileSync(path.join(root, ".gitattributes"), "src/a.ts filter=probe\n");
    commitAll(root, "attributes");
    const marker = path.join(root, "filter-ran");
    git(root, ["config", "filter.probe.clean", `touch '${marker}'; cat`]);
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 7;\n");
    const report = JSON.parse(run(checkCli, root, ["--since-bless", "--json"]).stdout);
    assert.deepEqual(report.sinceBless.uncommitted, [
      { side: "impl", path: "src/a.ts", linkIds: ["perm", "audit"] },
    ]);
    assert.equal(existsSync(marker), false);
  });

  test("テキストは 20 コミットまでにし、長い件名は切る", () => {
    for (let i = 0; i < 21; i += 1) {
      writeFileSync(path.join(root, "src", "a.ts"), `export const a = ${100 + i};\n`);
      commitAll(root, `change ${i} ${"x".repeat(i === 20 ? 200 : 1)}`);
    }
    const text = run(checkCli, root, ["--since-bless"]).stdout;
    assert.match(text, /\.\.\.and 1 more commit\(s\)/);
    assert.match(text, /change 20 x{100,}\.\.\.\n/);
    assert.doesNotMatch(text, /x{200}/);
  });

  test("git の起動の上限に達したら、まとめを打ち切ったと示し、bless した版の探索の結果は変えない", async () => {
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    commitAll(root, "change a");
    const { checkDrift } = await import("../check.js");
    const { findBlessedCommits } = await import("../bless-history.js");
    const { groupChangesSinceBless } = await import("../bless-changes.js");
    const { createGitRunner } = await import("../git-runner.js");
    const { loadManifest } = await import("../manifest.js");
    const manifestPath = path.join(root, "traceability.yaml");
    const report = await checkDrift(manifestPath, root);
    const manifest = await loadManifest(manifestPath);
    // 探索（rev-parse・log・show）は終わり、まとめの途中で上限に達する回数にする。
    const runner = createGitRunner(root, { maxGitCalls: 4 });
    const history = await findBlessedCommits(root, report.entries, manifest, { runner });
    assert.equal(history.incomplete, false);
    const changes = await groupChangesSinceBless(runner, report.entries, history, manifest);
    assert.equal(changes.incomplete, true);
    // 打ち切りで手を付けなかった参照は「探していない」で、「辿れなかった」ではない。
    assert.equal(changes.notGrouped.failed, 0);
    assert.ok(changes.notGrouped.notSearched > 0);
    const { describeChangesSinceBless } = await import("../cli-check-changes-format.js");
    assert.ok(describeChangesSinceBless(changes).length > 0);
  });

  test("件名の見えない文字はテキストから消す", async () => {
    const { describeChangesSinceBless } = await import("../cli-check-changes-format.js");
    const lines = describeChangesSinceBless({
      commits: [
        {
          commit: "a".repeat(40),
          subject: "Fix\u200b label\u{E0041}\u202e (#1)",
          entries: [{ side: "impl", path: "src/a.ts", linkIds: ["perm"] }],
        },
      ],
      uncommitted: [],
      notGrouped: { noBlessedVersion: 0, notSearched: 0, failed: 0 },
      incomplete: false,
    });
    assert.equal(lines[1], `  ${"a".repeat(12)} Fix label (#1)`);
  });

  test("main が進まないままブランチをマージしても、bless の後にブランチで変えた中身はマージに割り当てる", () => {
    git(root, ["switch", "-q", "-c", "feature-z"]);
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 5;\n");
    commitAll(root, "change a on branch");
    assert.equal(run(updateCli, root).status, 0);
    commitAll(root, "bless on branch");
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 8;\n");
    commitAll(root, "change a again on branch");
    git(root, ["switch", "-q", "main"]);
    git(root, [
      "merge",
      "-q",
      "--no-ff",
      "-m",
      "Merge pull request #30 from org/feature-z",
      "feature-z",
    ]);
    const merged = git(root, ["rev-parse", "HEAD"]);

    const report = JSON.parse(run(checkCli, root, ["--since-bless", "--json"]).stdout);
    assert.deepEqual(
      report.sinceBless.commits.map((change: ChangeCommit) => [change.commit, change.subject]),
      [[merged, "Merge pull request #30 from org/feature-z"]],
    );
    assert.equal(report.sinceBless.notGrouped.failed, 0);
  });

  test("見出しの節を消したことは、コミット済みなら (uncommitted) に出さず、作業ツリーだけなら出す", () => {
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Other\n\nOnly.\n");
    const removed = commitAll(root, "Remove rules (#31)");
    let report = JSON.parse(run(checkCli, root, ["--since-bless", "--json"]).stdout);
    assert.deepEqual(report.sinceBless.uncommitted, []);
    assert.deepEqual(
      report.sinceBless.commits.map((change: ChangeCommit) => change.commit),
      [removed],
    );
    git(root, ["reset", "-q", "--hard", "HEAD~1"]);
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Other\n\nOnly.\n");
    report = JSON.parse(run(checkCli, root, ["--since-bless", "--json"]).stdout);
    assert.deepEqual(report.sinceBless.uncommitted, [
      { side: "spec", path: "docs/spec.md", linkIds: ["perm"] },
    ]);
  });
});
