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

const config = (ref: string): string => `adapter: playwright
bddRunner: playwright-bdd
bddGenTool: bddgen
language: en
layout:
  featuresDir: features
specSources:
  - name: permissions
    repo: ../source
    ref: ${ref}
    paths: [master]
`;

// 取り込み元の ref は、短い名前のまま git に渡すと refs/tags/<名前> が refs/heads・refs/remotes より先に読まれる
// （gitrevisions(7)）。取り込み元に push できる人が同じ名前のタグを置くと、記録も比べもタグのコミットになる。
describe("specSources の ref はブランチを読み、同じ名前のタグに隠されない", () => {
  let base: string;
  let root: string;
  let source: string;
  // master/ の中身が同じで、ほかの場所だけが違う 2 つのコミット（HEAD との比べに掛からない）。
  let tagged: string;
  let branch: string;

  const useRef = (ref: string): void => {
    writeFileSync(path.join(root, "specproof.config.yaml"), config(ref));
  };

  const recordedIn = (): string => readFileSync(path.join(root, "traceability.yaml"), "utf8");

  const checkReport = () => {
    const result = run(checkCli, root, ["--spec-sources", "--json"]);
    return JSON.parse(result.stdout).specSources[0];
  };

  // master/ を変えたコミットを作り、HEAD（main）は動かさない。
  const commitMasterChange = (content: string): string => {
    git(source, ["switch", "-q", "--detach", branch]);
    writeFileSync(path.join(source, "master", "permissions.yml"), content);
    const commit = commitAll(source, "master change");
    git(source, ["switch", "-q", "main"]);
    return commit;
  };

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-spec-source-ref-")));
    root = path.join(base, "e2e");
    source = path.join(base, "source");
    mkdirSync(path.join(root, "docs"), { recursive: true });
    mkdirSync(path.join(root, "features"), { recursive: true });
    mkdirSync(path.join(source, "master"), { recursive: true });
    mkdirSync(path.join(source, "other"), { recursive: true });
    git(source, ["init", "-q"]);
    writeFileSync(path.join(source, "master", "permissions.yml"), "viewer: read\n");
    writeFileSync(path.join(source, "other", "notes.md"), "v1\n");
    tagged = commitAll(source, "v1");
    writeFileSync(path.join(source, "other", "notes.md"), "v2\n");
    branch = commitAll(source, "v2");
    git(root, ["init", "-q"]);
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Rules\n\nviewer: read\n");
    writeFileSync(path.join(root, "traceability.yaml"), MANIFEST);
    useRef("origin/develop");
    assert.equal(run(updateCli, root).status, 0);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  test("リモートのブランチと同じ名前のタグがあっても、記録するのはブランチのコミット", () => {
    git(source, ["update-ref", "refs/remotes/origin/develop", branch]);
    git(source, ["tag", "origin/develop", tagged]);
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(recordedIn(), new RegExp(`"permissions": "${branch}"`));
  });

  test("ローカルのブランチと同じ名前のタグがあっても、記録するのはブランチのコミット", () => {
    useRef("develop");
    git(source, ["branch", "develop", branch]);
    git(source, ["tag", "develop", tagged]);
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(recordedIn(), new RegExp(`"permissions": "${branch}"`));
  });

  test("ブランチが先に進んだら、同じ名前のタグが止まっていても outdated と言う", () => {
    git(source, ["update-ref", "refs/remotes/origin/develop", branch]);
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 0);
    // 記録の後に、記録したコミットへタグを置き、ブランチだけを進める。
    git(source, ["tag", "origin/develop", branch]);
    const advanced = commitMasterChange("viewer: none\n");
    git(source, ["update-ref", "refs/remotes/origin/develop", advanced]);
    assert.deepEqual(checkReport(), {
      name: "permissions",
      status: "outdated",
      recorded: branch,
      current: advanced,
    });
  });

  test("リモートのブランチがローカルのブランチより先に読まれる", () => {
    git(source, ["update-ref", "refs/remotes/origin/develop", branch]);
    git(source, ["branch", "origin/develop", tagged]);
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(recordedIn(), new RegExp(`"permissions": "${branch}"`));
  });

  test("ブランチが無く、完全な ref 名を名前に持つタグだけがあるときは解決できない", () => {
    // refs/tags/refs/remotes/origin/develop と refs/tags/refs/heads/origin/develop。
    // 完全な名前を git の名前の探索に渡すと、その ref が無いときにこれらへ落ちる。
    git(source, ["tag", "refs/remotes/origin/develop", tagged]);
    git(source, ["tag", "refs/heads/origin/develop", tagged]);
    const before = recordedIn();
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(recordedIn(), before);
  });

  test("大文字の commit id は、同じ名前のタグやブランチがあってもそのコミットを読む", () => {
    // 小文字にそろえた id を rev-parse に渡しても、同じ名前の ref に落ちないことを確かめる。
    git(source, ["tag", branch, tagged]);
    git(source, ["branch", branch.toUpperCase(), tagged]);
    useRef(branch.toUpperCase());
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(recordedIn(), new RegExp(`"permissions": "${branch}"`));
  });

  test("形式と桁数の合わない大文字の id は、同じ名前のタグがあっても解決しない", () => {
    const wrongLength = `${branch}${"0".repeat(24)}`;
    git(source, ["tag", wrongLength, tagged]);
    useRef(wrongLength.toUpperCase());
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
  });

  test("短い名前のタグは読まず、refs/tags/ での書き方を案内して失敗する", () => {
    useRef("v1");
    git(source, ["tag", "v1", branch]);
    const before = recordedIn();
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /refs\/remotes\/v1, then refs\/heads\/v1/);
    assert.match(result.stderr, /refs\/tags\/<name>/);
    assert.equal(recordedIn(), before);
  });

  test("check も短い名前のタグを読まず、今の ref を解決できないものとする", () => {
    useRef(branch);
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 0);
    useRef("v1");
    git(source, ["tag", "v1", tagged]);
    assert.deepEqual(checkReport(), {
      name: "permissions",
      status: "unavailable",
      recorded: branch,
      reason: "ref-unresolved",
    });
  });

  test("完全な commit id はそのまま使う", () => {
    useRef(branch);
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(recordedIn(), new RegExp(`"permissions": "${branch}"`));
  });

  test("大文字や大小混在の完全な commit id も、そのコミットとして記録し比べる", () => {
    const mixed = (id: string): string =>
      [...id].map((char, index) => (index % 2 === 0 ? char.toUpperCase() : char)).join("");
    for (const ref of [branch.toUpperCase(), mixed(branch)]) {
      writeFileSync(path.join(root, "traceability.yaml"), MANIFEST);
      useRef(ref);
      const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      // 記録は git が返す小文字の id にそろえる。
      assert.match(recordedIn(), new RegExp(`"permissions": "${branch}"`));
      assert.equal(checkReport().status, "current", ref);
      // 記録の後に ref を別のコミット（master/ が違う）の大文字の id にすると outdated と言う。
      useRef(commitMasterChange(`viewer: ${ref}\n`).toUpperCase());
      assert.equal(checkReport().status, "outdated", ref);
    }
  });

  test("リポジトリの形式と桁数の合わない id は、同じ名前のタグがあっても解決しない", () => {
    // SHA-1 のリポジトリでは 64 桁の hex を git が名前として探し、同じ名前のタグを読む。
    const wrongLength = `${branch}${"0".repeat(24)}`;
    useRef(wrongLength);
    git(source, ["tag", wrongLength, tagged]);
    const before = recordedIn();
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(recordedIn(), before);
  });

  test("manifest の記録が形式と桁数の合わない id なら、同じ名前のタグがあっても check は比べない", () => {
    git(source, ["update-ref", "refs/remotes/origin/develop", branch]);
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 0);
    const wrongLength = `${branch}${"0".repeat(24)}`;
    writeFileSync(
      path.join(root, "traceability.yaml"),
      recordedIn().replace(`"permissions": "${branch}"`, `"permissions": "${wrongLength}"`),
    );
    git(source, ["tag", wrongLength, tagged]);
    assert.deepEqual(checkReport(), {
      name: "permissions",
      status: "unavailable",
      recorded: wrongLength,
      reason: "recorded-missing",
    });
  });

  test("名前が前方一致するだけの ref は読まない", () => {
    git(source, ["update-ref", "refs/remotes/origin/develop/x", branch]);
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
  });

  test("refs/ で始まる完全な名前はそれだけを読む（タグは refs/tags/ と書いたときだけ）", () => {
    useRef("refs/tags/v1");
    git(source, ["tag", "v1", tagged]);
    git(source, ["branch", "v1", branch]);
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(recordedIn(), new RegExp(`"permissions": "${tagged}"`));
  });
});
