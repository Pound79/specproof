import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, test } from "vitest";

const updateCli = fileURLToPath(new URL("../../dist/cli-update.js", import.meta.url));

const run = (cwd: string, args: string[] = []) => {
  const result = spawnSync(process.execPath, [updateCli, ...args], {
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

const config = (paths: string): string => `adapter: playwright
bddRunner: playwright-bdd
bddGenTool: bddgen
language: en
layout:
  featuresDir: features
specSources:
  - name: permissions
    repo: ../source
    ref: develop
${paths}`;

// 取り込みのスクリプトが取り込み元の作業ツリー（HEAD）から写していると、HEAD が ref と違うブランチのときに、
// ref のコミットを記録しても写した中身と食い違う。記録の前に、paths の中で HEAD と ref が同じかを確かめる。
describe("--record-spec-source は、取り込み元の HEAD が paths の中で ref と違えば記録しない", () => {
  let base: string;
  let root: string;
  let source: string;
  const manifestPath = () => path.join(root, "traceability.yaml");

  const setup = (paths: string) => {
    writeFileSync(path.join(root, "specproof.config.yaml"), config(paths));
    assert.equal(run(root).status, 0);
  };

  // HEAD を作業ブランチに移し、そこで file を変えてコミットする（ref の develop は変えない）。
  const workOnTopic = (file: string, content: string): string => {
    git(source, ["switch", "-q", "-c", "topic"]);
    writeFileSync(path.join(source, file), content);
    return commitAll(source, "topic change");
  };

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-spec-source-head-")));
    root = path.join(base, "e2e");
    source = path.join(base, "source");
    mkdirSync(path.join(root, "docs"), { recursive: true });
    mkdirSync(path.join(root, "features"), { recursive: true });
    mkdirSync(path.join(source, "master"), { recursive: true });
    mkdirSync(path.join(source, "other"), { recursive: true });
    git(source, ["init", "-q"]);
    writeFileSync(path.join(source, "master", "permissions.yml"), "viewer: read\n");
    writeFileSync(path.join(source, "other", "notes.md"), "notes\n");
    commitAll(source, "v1");
    git(source, ["branch", "develop"]);
    git(root, ["init", "-q"]);
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Rules\n\nviewer: read\n");
    writeFileSync(manifestPath(), MANIFEST);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  test("HEAD の paths の中身が ref と違えば、何も書かずに失敗し、違うパスと逃げ道を示す", () => {
    setup("    paths: [master]\n");
    const before = readFileSync(manifestPath(), "utf8");
    const head = workOnTopic("master/permissions.yml", "viewer: none\n");
    for (const args of [
      ["--record-spec-source", "permissions"],
      ["--record-spec-source", "permissions", "--dry-run"],
    ]) {
      const result = run(root, args);
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /HEAD/);
      assert.match(result.stderr, new RegExp(head));
      assert.match(result.stderr, /"master"/);
      assert.match(result.stderr, /--allow-head-mismatch/);
    }
    assert.equal(readFileSync(manifestPath(), "utf8"), before);
  });

  test("--allow-head-mismatch を付ければ ref のコミットを記録し、違うことを知らせる", () => {
    setup("    paths: [master]\n");
    workOnTopic("master/permissions.yml", "viewer: none\n");
    const develop = git(source, ["rev-parse", "develop"]);
    const result = run(root, ["--record-spec-source", "permissions", "--allow-head-mismatch"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(
      result.stdout,
      /differs from develop in "master" \(recorded anyway: --allow-head-mismatch\)/,
    );
    assert.match(readFileSync(manifestPath(), "utf8"), new RegExp(`"permissions": "${develop}"`));
  });

  test("HEAD が別のブランチでも、paths の中身が同じなら記録する", () => {
    setup("    paths: [master]\n");
    workOnTopic("other/notes.md", "changed\n");
    const develop = git(source, ["rev-parse", "develop"]);
    const result = run(root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /differs from/);
    assert.match(readFileSync(manifestPath(), "utf8"), new RegExp(`"permissions": "${develop}"`));
  });

  test("paths を省くとリポジトリ全体で比べる", () => {
    setup("");
    workOnTopic("other/notes.md", "changed\n");
    const result = run(root, ["--record-spec-source", "permissions"]);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /--allow-head-mismatch/);
  });

  test("paths が上限の 64 件でも、git の起動の上限の内で最後の 1 件の違いを見つける", () => {
    const names = Array.from({ length: 64 }, (_, index) => `f${index + 1}`);
    git(source, ["switch", "-q", "develop"]);
    for (const name of names) writeFileSync(path.join(source, name), `${name}\n`);
    commitAll(source, "many paths");
    git(source, ["switch", "-q", "-c", "topic"]);
    setup(`    paths: [${names.join(", ")}]\n`);
    writeFileSync(path.join(source, "f64"), "changed\n");
    commitAll(source, "change the last path");
    const result = run(root, ["--record-spec-source", "permissions"]);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /differs from develop in "f64"/);
    assert.doesNotMatch(result.stderr, /could not read/);
  });

  test("HEAD を解決できない（unborn）ときは記録せず、--allow-head-mismatch なら記録する", () => {
    setup("    paths: [master]\n");
    git(source, ["switch", "-q", "--orphan", "empty"]);
    const refused = run(root, ["--record-spec-source", "permissions"]);
    assert.notEqual(refused.status, 0, refused.stdout);
    assert.match(refused.stderr, /HEAD in .* could not be resolved/);
    const allowed = run(root, ["--record-spec-source", "permissions", "--allow-head-mismatch"]);
    assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
    assert.match(allowed.stdout, /recorded anyway: --allow-head-mismatch/);
  });

  test("--allow-head-mismatch は --record-spec-source と一緒にだけ使える", () => {
    setup("    paths: [master]\n");
    const result = run(root, ["--allow-head-mismatch"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--allow-head-mismatch can only be used with --record-spec-source/);
  });

  test("作業ツリーのコミットしていない変更は見ない（git の作業ツリーを読む操作をしない）", () => {
    setup("    paths: [master]\n");
    writeFileSync(path.join(source, "master", "permissions.yml"), "viewer: none\n");
    const result = run(root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});
