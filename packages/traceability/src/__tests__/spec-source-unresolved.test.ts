import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
    impl: []
    features: []
`;

const config = (repo: string, ref: string): string => `adapter: playwright
bddRunner: playwright-bdd
bddGenTool: bddgen
language: en
layout:
  featuresDir: features
specSources:
  - name: permissions
    specDir: docs
    repo: ${repo}
    ref: ${ref}
    paths: [master]
`;

type Warning = { kind: string; message: string; failsUnderStrict: boolean };

// 取り込み元のディレクトリはあるのに確かめられないときは、黙って飛ばさず参考の warning を 1 行出す。
// 黙って飛ばすのは、取り込み元のディレクトリが無いとき（PR の CI など）だけ。
describe("取り込み元を確かめられないときの spec-source-unresolved", () => {
  let base: string;
  let root: string;
  let source: string;
  let recorded: string;

  const useConfig = (repo: string, ref: string): void => {
    writeFileSync(path.join(root, "specproof.config.yaml"), config(repo, ref));
  };

  const recordCommit = (commit: string): void => {
    const manifest = readFileSync(path.join(root, "traceability.yaml"), "utf8");
    writeFileSync(
      path.join(root, "traceability.yaml"),
      manifest.replace(/"permissions": "[0-9a-f]+"/, `"permissions": "${commit}"`),
    );
  };

  const unresolved = (warnings: Warning[]): Warning[] =>
    warnings.filter((warning) => warning.kind === "spec-source-unresolved");

  // テキストの出力・--strict の終了コード・--json を流し、warning と specSources を返す。
  const checkAll = () => {
    const text = run(checkCli, root, ["--spec-sources", "--strict"]);
    assert.equal(text.status, 0, text.stdout + text.stderr);
    const json = JSON.parse(run(checkCli, root, ["--spec-sources", "--strict", "--json"]).stdout);
    return { text: text.stdout, warnings: json.warnings as Warning[], result: json.specSources[0] };
  };

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-spec-unresolved-")));
    root = path.join(base, "e2e");
    source = path.join(base, "source");
    mkdirSync(path.join(root, "docs"), { recursive: true });
    mkdirSync(path.join(root, "features"), { recursive: true });
    mkdirSync(path.join(source, "master"), { recursive: true });
    git(source, ["init", "-q"]);
    writeFileSync(path.join(source, "master", "permissions.yml"), "viewer: read\n");
    commitAll(source, "v1");
    git(source, ["branch", "develop"]);
    git(root, ["init", "-q"]);
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Rules\n\nviewer: read\n");
    writeFileSync(path.join(root, "traceability.yaml"), MANIFEST);
    useConfig("../source", "develop");
    assert.equal(run(updateCli, root).status, 0);
    const recordedRun = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(recordedRun.status, 0, recordedRun.stdout + recordedRun.stderr);
    recorded = git(source, ["rev-parse", "develop"]);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  test("ref が短い名前のタグのとき、調べた ref とタグの書き方を warning に出す。--strict でも落とさない", () => {
    git(source, ["tag", "v-test", "develop"]);
    useConfig("../source", "v-test");
    const { text, warnings, result } = checkAll();
    assert.deepEqual(result, {
      name: "permissions",
      status: "unavailable",
      recorded,
      reason: "ref-unresolved",
    });
    const [warning] = unresolved(warnings);
    assert.equal(unresolved(warnings).length, 1);
    assert.equal(warning.failsUnderStrict, false);
    assert.match(warning.message, /refs\/remotes\/v-test, then refs\/heads\/v-test/);
    assert.match(warning.message, /refs\/tags\/<name>/);
    assert.match(warning.message, /"\.\.\/source"/);
    assert.equal(
      text.split("\n").filter((line) => line.includes("spec-source-unresolved")).length,
      1,
    );
    // パスは設定に書いた値で出し、解決した絶対パスを出さない。
    assert.ok(!text.includes(base), text);
  });

  test("ref の打ち間違い（どのブランチも無い名前）も warning を出す", () => {
    useConfig("../source", "develpo");
    const { warnings, result } = checkAll();
    assert.equal(result.reason, "ref-unresolved");
    assert.equal(unresolved(warnings).length, 1);
  });

  test("記録したコミットが取り込み元に無いとき、fetch するよう warning に出す。--strict でも落とさない", () => {
    const missing = "0123456789abcdef0123456789abcdef01234567";
    recordCommit(missing);
    const { text, warnings, result } = checkAll();
    assert.deepEqual(result, {
      name: "permissions",
      status: "unavailable",
      recorded: missing,
      reason: "recorded-missing",
    });
    const [warning] = unresolved(warnings);
    assert.equal(unresolved(warnings).length, 1);
    assert.match(warning.message, /0123456789ab/);
    assert.match(warning.message, /fetch/);
    assert.equal(
      text.split("\n").filter((line) => line.includes("spec-source-unresolved")).length,
      1,
    );
    assert.ok(!text.includes(base), text);
  });

  test("浅い clone で記録したコミットが手元に無いときも、記録したコミットが無いと warning に出す", () => {
    git(source, ["switch", "-q", "develop"]);
    writeFileSync(path.join(source, "master", "permissions.yml"), "viewer: none\n");
    commitAll(source, "v2");
    git(source, ["switch", "-q", "main"]);
    const shallow = path.join(base, "shallow");
    git(base, [
      "-c",
      "protocol.file.allow=always",
      "clone",
      "-q",
      "--depth",
      "1",
      "--branch",
      "develop",
      `file://${source}`,
      shallow,
    ]);
    useConfig("../shallow", "origin/develop");
    const { warnings, result } = checkAll();
    assert.equal(result.reason, "recorded-missing");
    assert.equal(unresolved(warnings).length, 1);
  });

  test("ディレクトリはあるが取り込み元として読まないとき（.git が無い）、docs の参照先を warning に出す", () => {
    const plain = path.join(base, "plain");
    mkdirSync(plain);
    useConfig("../plain", "develop");
    const { text, warnings, result } = checkAll();
    assert.deepEqual(result, {
      name: "permissions",
      status: "unavailable",
      recorded,
      reason: "source-unreadable",
    });
    const [warning] = unresolved(warnings);
    assert.equal(unresolved(warnings).length, 1);
    assert.match(warning.message, /"\.\.\/plain"/);
    assert.match(warning.message, /docs\/config-schema\.md/);
    assert.ok(!text.includes(base), text);
  });

  test("git worktree の作業ツリー（.git がファイル）も、読まない理由を warning に出す", () => {
    const worktree = path.join(base, "worktree");
    git(source, ["worktree", "add", "-q", worktree, "develop"]);
    useConfig("../worktree", "develop");
    const { warnings, result } = checkAll();
    assert.equal(result.reason, "source-unreadable");
    assert.equal(unresolved(warnings).length, 1);
  });

  test("取り込み元のディレクトリが無いときは、今と同じく warning を出さずに飛ばす（PR の CI）", () => {
    rmSync(source, { recursive: true, force: true });
    const { text, warnings, result } = checkAll();
    assert.equal(result.status, "unavailable");
    assert.ok(!warnings.some((warning) => warning.kind.startsWith("spec-source")));
    assert.doesNotMatch(text, /spec-source/);
    assert.doesNotMatch(text, /permissions/);
  });

  test("取り込み元のディレクトリが無いときも、--json の specSources には理由を出す", () => {
    rmSync(source, { recursive: true, force: true });
    assert.deepEqual(checkAll().result, {
      name: "permissions",
      status: "unavailable",
      recorded,
      reason: "source-missing",
    });
  });
});
