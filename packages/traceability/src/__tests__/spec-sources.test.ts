import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

const config = (fields: string): string => `adapter: playwright
bddRunner: playwright-bdd
bddGenTool: bddgen
language: en
layout:
  featuresDir: features
specSources:
  - name: permissions
${fields}`;

const SOURCE_FIELDS = `    specDir: docs
    repo: ../source
    ref: develop
    paths: [master]
    importCommand: scripts/import.sh
`;

// 写した仕様の取り込み元（別のリポジトリ）と、取り込んだコミットを記録し、取り込み元が先に進んだら知らせる。
describe("写した仕様の取り込み元（specSources）", () => {
  let base: string;
  let root: string;
  let source: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-spec-sources-")));
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
    writeFileSync(path.join(root, "traceability.yaml"), MANIFEST);
    writeFileSync(path.join(root, "specproof.config.yaml"), config(SOURCE_FIELDS));
    assert.equal(run(updateCli, root).status, 0);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const advanceDevelop = (file: string, content: string): string => {
    git(source, ["switch", "-q", "develop"]);
    writeFileSync(path.join(source, file), content);
    const commit = commitAll(source, "change");
    git(source, ["switch", "-q", "main"]);
    return commit;
  };

  test("update --record-spec-source は ref が指すコミットを manifest に記録する", () => {
    const develop = git(source, ["rev-parse", "develop"]);
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(`permissions.*${develop}`));
    const manifest = readFileSync(path.join(root, "traceability.yaml"), "utf8");
    assert.match(manifest, new RegExp(`specSources:\\n {2}"permissions": "${develop}"`));
    // links の hash などはそのまま。
    assert.match(manifest, /hash: [0-9a-f]{64}/);
    const report = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    assert.deepEqual(report.specSources, [
      { name: "permissions", status: "current", recorded: develop, current: develop },
    ]);
  });

  test("取り込み元の ref が paths の中で進んだら spec-source-outdated を出す。--strict でも落とさない", () => {
    const recorded = git(source, ["rev-parse", "develop"]);
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 0);
    const advanced = advanceDevelop("master/permissions.yml", "viewer: none\n");

    const text = run(checkCli, root, ["--spec-sources", "--strict"]);
    assert.equal(text.status, 0, text.stdout + text.stderr);
    assert.match(text.stdout, /spec-source-outdated/);
    assert.match(text.stdout, /permissions/);
    assert.match(text.stdout, /specproof-update --record-spec-source permissions/);
    const report = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    assert.deepEqual(report.specSources, [
      { name: "permissions", status: "outdated", recorded, current: advanced },
    ]);
    assert.ok(
      report.warnings.some(
        (warning: { kind: string; failsUnderStrict: boolean }) =>
          warning.kind === "spec-source-outdated" && warning.failsUnderStrict === false,
      ),
    );
  });

  test("paths の外だけが進んだときは古いと言わない", () => {
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 0);
    advanceDevelop("other/notes.md", "changed\n");
    const report = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    assert.equal(report.specSources[0].status, "current");
    assert.ok(
      !report.warnings.some((warning: { kind: string }) => warning.kind.startsWith("spec-source")),
    );
  });

  test("記録が無ければ spec-source-unrecorded を出す", () => {
    const text = run(checkCli, root, ["--spec-sources"]).stdout;
    assert.match(text, /spec-source-unrecorded/);
    const report = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    assert.equal(report.specSources[0].status, "unrecorded");
  });

  test("取り込み元が手元に無い・ref が無いときは、警告を出さずに飛ばす", () => {
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 0);
    rmSync(source, { recursive: true, force: true });
    let result = run(checkCli, root, ["--spec-sources", "--strict", "--json"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    let report = JSON.parse(result.stdout);
    assert.equal(report.specSources[0].status, "unavailable");
    assert.ok(
      !report.warnings.some((warning: { kind: string }) => warning.kind.startsWith("spec-source")),
    );

    mkdirSync(source);
    git(source, ["init", "-q"]);
    result = run(checkCli, root, ["--spec-sources", "--json"]);
    report = JSON.parse(result.stdout);
    assert.equal(report.specSources[0].status, "unavailable");
  });

  test("記録するときに取り込み元が無ければ、何も書かずに失敗する", () => {
    rmSync(source, { recursive: true, force: true });
    const before = readFileSync(path.join(root, "traceability.yaml"), "utf8");
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /permissions/);
    assert.equal(readFileSync(path.join(root, "traceability.yaml"), "utf8"), before);
    // 設定に無い名前も失敗する。
    const unknown = run(updateCli, root, ["--record-spec-source", "nope"]);
    assert.equal(unknown.status, 2);
  });

  test("設定の誤りは止める。オプションに見える ref や、名前の形を確かめる", () => {
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      config(SOURCE_FIELDS.replace("ref: develop", "ref: --output=/tmp/x")),
    );
    const badRef = run(checkCli, root, ["--spec-sources"]);
    assert.equal(badRef.status, 2);
    assert.match(badRef.stderr, /specSources\[0\]\.ref/);
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      config(SOURCE_FIELDS).replace("name: permissions", "name: bad name"),
    );
    assert.equal(run(checkCli, root, ["--spec-sources"]).status, 2);
  });

  test("CLI は importCommand を実行しない", () => {
    mkdirSync(path.join(root, "scripts"));
    const marker = path.join(base, "imported");
    writeFileSync(path.join(root, "scripts", "import.sh"), `#!/bin/sh\ntouch '${marker}'\n`, {
      mode: 0o755,
    });
    run(updateCli, root, ["--record-spec-source", "permissions"]);
    run(checkCli, root, ["--spec-sources", "--json"]);
    assert.equal(existsSync(marker), false);
  });

  test("specSources が無ければ check の出力に specSources を足さない", () => {
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      "adapter: playwright\nbddRunner: playwright-bdd\nbddGenTool: bddgen\nlanguage: en\n",
    );
    const report = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    assert.equal("specSources" in report, false);
  });

  test("記録し直すと値だけを置き換え、2 つ目の取り込み元は同じ mapping に足す", () => {
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      `${config(SOURCE_FIELDS)}  - name: glossary\n    repo: ../source\n    ref: main\n`,
    );
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 0);
    const advanced = advanceDevelop("master/permissions.yml", "viewer: none\n");
    const rerecord = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(rerecord.status, 0, rerecord.stderr);
    assert.match(rerecord.stdout, /\(was [0-9a-f]{40}\)/);
    assert.equal(run(updateCli, root, ["--record-spec-source", "glossary"]).status, 0);
    const manifest = readFileSync(path.join(root, "traceability.yaml"), "utf8");
    const main = git(source, ["rev-parse", "main"]);
    assert.ok(
      manifest.endsWith(`specSources:\n  "permissions": "${advanced}"\n  "glossary": "${main}"\n`),
      manifest,
    );
    const report = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    assert.deepEqual(
      report.specSources.map((result: { status: string }) => result.status),
      ["current", "current"],
    );
    // --dry-run は書かない。
    advanceDevelop("master/permissions.yml", "viewer: write\n");
    const before = readFileSync(path.join(root, "traceability.yaml"), "utf8");
    assert.equal(
      run(updateCli, root, ["--record-spec-source", "permissions", "--dry-run"]).status,
      0,
    );
    assert.equal(readFileSync(path.join(root, "traceability.yaml"), "utf8"), before);
  });

  test("--spec-sources を付けなければ取り込み元を読まず、出力も変えない", () => {
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 0);
    advanceDevelop("master/permissions.yml", "viewer: none\n");
    const report = JSON.parse(run(checkCli, root, ["--json"]).stdout);
    assert.equal("specSources" in report, false);
    assert.ok(
      !report.warnings.some((warning: { kind: string }) => warning.kind.startsWith("spec-source")),
    );
  });

  test("paths の書き誤り（今の ref に無いパス）は current にせず知らせる", () => {
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 0);
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      config(SOURCE_FIELDS.replace("paths: [master]", "paths: [master, mastr]")),
    );
    const report = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    assert.equal(report.specSources[0].status, "path-missing");
    assert.deepEqual(report.specSources[0].missingPaths, ["mastr"]);
    assert.match(run(checkCli, root, ["--spec-sources"]).stdout, /has no "mastr"/);
  });

  test("repo が取り込み元のルートでない（親のリポジトリの中のディレクトリ）ときは、親を読まずに飛ばす", () => {
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      config(SOURCE_FIELDS.replace("repo: ../source", "repo: ../source/master")),
    );
    const update = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(update.status, 2);
    writeFileSync(
      path.join(root, "traceability.yaml"),
      `${readFileSync(path.join(root, "traceability.yaml"), "utf8")}specSources:\n  permissions: "${git(source, ["rev-parse", "develop"])}"\n`,
    );
    const report = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    assert.equal(report.specSources[0].status, "unavailable");
  });

  test("受け継いだ GIT_DIR に引きずられない", () => {
    const result = spawnSync(process.execPath, [updateCli, "--record-spec-source", "permissions"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_DIR: path.join(root, ".git") },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(git(source, ["rev-parse", "develop"])));
  });

  test("数値・真偽値・プロトタイプのキーに見える名前も、文字列として記録し直せる", () => {
    const names = ["2024", "true", "toString"];
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      `${config(SOURCE_FIELDS)}${names.map((name) => `  - name: "${name}"\n    repo: ../source\n    ref: main\n`).join("")}`,
    );
    const report0 = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    assert.equal(
      report0.specSources.find((r: { name: string }) => r.name === "toString").status,
      "unrecorded",
    );
    for (const name of names) {
      assert.equal(run(updateCli, root, ["--record-spec-source", name]).status, 0, name);
      const again = run(updateCli, root, ["--record-spec-source", name]);
      assert.equal(again.status, 0, again.stderr);
      assert.match(again.stdout, /\(unchanged\)/);
    }
    const report = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    for (const name of names) {
      assert.equal(
        report.specSources.find((r: { name: string }) => r.name === name).status,
        "current",
      );
    }
  });

  test("CRLF の manifest は改行を保って記録する", () => {
    const manifestPath = path.join(root, "traceability.yaml");
    writeFileSync(manifestPath, readFileSync(manifestPath, "utf8").replace(/\n/g, "\r\n"));
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 0);
    const text = readFileSync(manifestPath, "utf8");
    assert.doesNotMatch(text.replace(/\r\n/g, ""), /\n/);
  });

  test("部分 clone の設定を持つ取り込み元は読まず、設定のコマンドも起動しない", () => {
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 0);
    const marker = path.join(base, "uploadpack-ran");
    git(source, ["config", "core.repositoryformatversion", "1"]);
    git(source, ["config", "extensions.partialClone", "origin"]);
    git(source, ["config", "remote.origin.url", path.join(base, "nowhere")]);
    git(source, ["config", "remote.origin.promisor", "true"]);
    git(source, ["config", "protocol.file.allow", "always"]);
    git(source, ["config", "remote.origin.uploadpack", `touch '${marker}'; false`]);
    const report = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    assert.equal(report.specSources[0].status, "unavailable");
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 2);
    assert.equal(existsSync(marker), false);
  });

  test("末尾が / の paths はそのディレクトリとして比べる", () => {
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      config(SOURCE_FIELDS.replace("paths: [master]", "paths: [master/, ./]")),
    );
    assert.equal(run(updateCli, root, ["--record-spec-source", "permissions"]).status, 0);
    let report = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    assert.equal(report.specSources[0].status, "current");
    advanceDevelop("master/permissions.yml", "viewer: none\n");
    report = JSON.parse(run(checkCli, root, ["--spec-sources", "--json"]).stdout);
    assert.equal(report.specSources[0].status, "outdated");
  });

  test("今の ref に無い paths があれば記録しない", () => {
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      config(SOURCE_FIELDS.replace("paths: [master]", "paths: [mastr]")),
    );
    const result = run(updateCli, root, ["--record-spec-source", "permissions"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /has no "mastr"/);
  });
});
