import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// release.sh の公開入口を scratch fixture で実行する。npm version は実 npm を
// offline / ignore-scripts で使い、git は全操作を記録する stub のみに差し替える。
// 実 checkout の release、tag、push、npm publish は呼ばない。
const npmPath = spawnSync("which", ["npm"], { encoding: "utf8" }).stdout.trim();
assert.ok(npmPath, "実 npm の実行ファイルが必要");

function fixture({ version = "0.3.0", branch = "main", corruptLock = "", existingTag = "", dirty = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "specproof-release-script-"));
  const json = (file, value) => writeFileSync(join(root, file), JSON.stringify(value, null, 2) + "\n");
  for (const dir of ["scripts", "cli", "packages/traceability", ".claude-plugin", "plugins/specproof/.claude-plugin", "templates/playwright/github-workflows", "templates/flutter/github-workflows", "bin"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  json("package.json", { name: "release-fixture", private: true, version: "0.0.0", workspaces: ["packages/*", "cli"] });
  json("cli/package.json", { name: "@fixture/cli", version });
  json("packages/traceability/package.json", { name: "@fixture/traceability", version });
  json(".claude-plugin/marketplace.json", { metadata: { version } });
  json("plugins/specproof/.claude-plugin/plugin.json", { version });
  for (const adapter of ["playwright", "flutter"]) {
    writeFileSync(join(root, `templates/${adapter}/specproof.config.yaml`), `command: npx @pound79/specproof-traceability@${version}\n`);
    writeFileSync(join(root, `templates/${adapter}/github-workflows/specproof-drift-check.yml`), `run: npx @pound79/specproof-traceability@${version}\n`);
  }
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n- 同版候補を公開する。\n\n## [0.2.2] - 2026-09-02\n\n- 前版。\n\n[Unreleased]: https://example.com/compare/v0.2.2...HEAD\n");
  for (const name of ["empty-user-config", "empty-global-config"]) writeFileSync(join(root, name), "");
  const env = {
    ...process.env,
    npm_config_userconfig: join(root, "empty-user-config"),
    npm_config_globalconfig: join(root, "empty-global-config"),
    npm_config_cache: join(root, "cache"),
    npm_config_offline: "true",
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    FIXTURE_ROOT: root,
    FIXTURE_BRANCH: branch,
    FIXTURE_EXISTING_TAG: existingTag,
    FIXTURE_CORRUPT_LOCK: corruptLock,
    FIXTURE_DIRTY: dirty ? "true" : "false",
    FIXTURE_NPM_PATH: npmPath,
    FIXTURE_REAL_PATH: process.env.PATH,
  };
  const setup = spawnSync(npmPath, ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root, env, encoding: "utf8" });
  assert.equal(setup.status, 0, setup.stderr);
  copyFileSync(new URL("./release.sh", import.meta.url), join(root, "scripts/release.sh"));
  copyFileSync(new URL("./check-versions.mjs", import.meta.url), join(root, "scripts/check-versions.mjs"));
  writeFileSync(join(root, "bin/git"), String.raw`#!${process.execPath}
const fs=require('node:fs');
const a=process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_ROOT+'/git-calls.jsonl',JSON.stringify(a)+'\n');
if(a[0]==='rev-parse'&&a[1]==='--show-toplevel') console.log(process.env.FIXTURE_ROOT);
else if(a[0]==='rev-parse'&&a[1]==='--abbrev-ref') console.log(process.env.FIXTURE_BRANCH);
else if(a[0]==='rev-parse') process.exit(process.env.FIXTURE_EXISTING_TAG==='local'?0:1);
else if(a[0]==='ls-remote') process.exit(process.env.FIXTURE_EXISTING_TAG==='remote'?0:2);
else if(a[0]==='status'&&process.env.FIXTURE_DIRTY==='true') console.log(' M cli/package.json');
else if(a[0]==='diff'&&a[1]==='--name-only') {
 const lock=fs.readFileSync(process.env.FIXTURE_ROOT+'/package-lock.json','utf8');
 if(lock!==fs.readFileSync(process.env.FIXTURE_ROOT+'/initial-lock.json','utf8')) console.log('package-lock.json');
}
else if(!['status','pull','reset','--no-pager','add','commit','tag','push'].includes(a[0])) {
 console.error('fixture: 想定外の git 呼出'); process.exit(95);
}
`, { mode: 0o755 });
  writeFileSync(join(root, "bin/npm"), String.raw`#!${process.execPath}
const fs=require('node:fs');
const cp=require('node:child_process');
const a=process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_ROOT+'/npm-calls.jsonl',JSON.stringify(a)+'\n');
if(a[0]!=='version') { console.error('fixture: 想定外の npm 呼出'); process.exit(91); }
const r=cp.spawnSync(process.env.FIXTURE_NPM_PATH,a,{env:{...process.env,PATH:process.env.FIXTURE_REAL_PATH},encoding:'utf8'});
process.stdout.write(r.stdout||''); process.stderr.write(r.stderr||'');
if(r.status===0&&process.env.FIXTURE_CORRUPT_LOCK) {
 const path=process.env.FIXTURE_ROOT+'/package-lock.json';
 const lock=JSON.parse(fs.readFileSync(path,'utf8'));
 if(process.env.FIXTURE_CORRUPT_LOCK==='package') {
  const pkgPath=process.env.FIXTURE_ROOT+'/cli/package.json';
  const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
  pkg.version='0.2.2'; fs.writeFileSync(pkgPath,JSON.stringify(pkg,null,2)+'\n');
 }
 else if(process.env.FIXTURE_CORRUPT_LOCK==='missing') delete lock.packages.cli;
 else lock.packages.cli.version='0.2.2';
 fs.writeFileSync(path,JSON.stringify(lock,null,2)+'\n');
}
process.exit(r.status??92);
`, { mode: 0o755 });
  copyFileSync(join(root, "package-lock.json"), join(root, "initial-lock.json"));
  env.PATH = join(root, "bin") + ":" + process.env.PATH;
  const managed = ["package-lock.json", "cli/package.json", "packages/traceability/package.json", "CHANGELOG.md", ".claude-plugin/marketplace.json", "plugins/specproof/.claude-plugin/plugin.json", ...["playwright", "flutter"].flatMap((adapter) => [`templates/${adapter}/specproof.config.yaml`, `templates/${adapter}/github-workflows/specproof-drift-check.yml`])];
  const before = Object.fromEntries(managed.map((file) => [file, readFileSync(join(root, file), "utf8")]));
  const calls = (file) => existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8").trim().split("\n").map(JSON.parse) : [];
  return {
    root,
    before,
    run(args = ["0.3.0", "--skip-checks", "--yes"], input = "") {
      const r = spawnSync("bash", [join(root, "scripts/release.sh"), ...args], { cwd: root, env, input, encoding: "utf8" });
      if (r.error) throw r.error;
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    gitCalls() { return calls("git-calls.jsonl"); },
    npmCalls() { return calls("npm-calls.jsonl"); },
    read(file) { return readFileSync(join(root, file), "utf8"); },
  };
}

test("同版 0.3.0 の候補を lock 無変更でも公開確認後の commit/tag/push へ進める", () => {
  const f = fixture();
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.read("package-lock.json"), f.before["package-lock.json"]);
  assert.match(f.read("CHANGELOG.md"), /## \[0\.3\.0\] - \d{4}-\d{2}-\d{2}/);
  assert.deepEqual(f.gitCalls().filter((a) => ["commit", "tag", "push"].includes(a[0])).map((a) => a[0]), ["commit", "tag", "push"]);
});

function assertNotPublished(f) {
  assert.deepEqual(f.gitCalls().filter((a) => ["commit", "tag", "push"].includes(a[0])), []);
  assert.equal(f.npmCalls().some((a) => a[0] === "publish"), false);
}

function assertUnchanged(f) {
  for (const [file, text] of Object.entries(f.before)) assert.equal(f.read(file), text, file);
}

test("0.2.2 から 0.3.0 へ更新し全 workspace と lock を対象版に揃える", () => {
  const f = fixture({ version: "0.2.2" });
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const lock = JSON.parse(f.read("package-lock.json"));
  for (const workspace of ["cli", "packages/traceability"]) {
    assert.equal(JSON.parse(f.read(`${workspace}/package.json`)).version, "0.3.0");
    assert.equal(lock.packages[workspace].version, "0.3.0");
  }
  assert.equal(JSON.parse(f.read(".claude-plugin/marketplace.json")).metadata.version, "0.3.0");
  assert.equal(JSON.parse(f.read("plugins/specproof/.claude-plugin/plugin.json")).version, "0.3.0");
  for (const adapter of ["playwright", "flutter"]) {
    assert.match(f.read(`templates/${adapter}/specproof.config.yaml`), /@pound79\/specproof-traceability@0\.3\.0/);
    assert.match(f.read(`templates/${adapter}/github-workflows/specproof-drift-check.yml`), /@pound79\/specproof-traceability@0\.3\.0/);
  }
  assert.deepEqual(f.gitCalls().find((a) => a[0] === "push"), ["push", "--atomic", "origin", "main", "v0.3.0"]);
});

for (const corruptLock of ["stale", "missing", "package"]) {
  test(`更新後の workspace/lock が ${corruptLock} なら commit 前に拒否して全 release ファイルを復元する`, () => {
    const f = fixture({ version: "0.2.2", corruptLock });
    const r = f.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /workspace\/lock version mismatch/);
    assertUnchanged(f);
    assertNotPublished(f);
  });
}

test("公開確認を拒否すると同版候補の CHANGELOG を含む全差分を復元する", () => {
  const f = fixture();
  const r = f.run(["0.3.0", "--skip-checks"], "n\n");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /aborted by user/);
  assertUnchanged(f);
  assertNotPublished(f);
});

test("dry-run は npm version を実行せず release ファイルを変更しない", () => {
  const f = fixture();
  const r = f.run(["0.3.0", "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.npmCalls(), []);
  assertUnchanged(f);
  assertNotPublished(f);
  assert.equal(f.gitCalls().some((a) => a[0] === "pull"), false);
});

test("main 以外では同版候補の release を拒否する", () => {
  const f = fixture({ branch: "chore/release-fixture" });
  const r = f.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must be on 'main'/);
  assertUnchanged(f);
  assertNotPublished(f);
  assert.deepEqual(f.npmCalls(), []);
});

for (const existingTag of ["local", "remote"]) {
  test(`${existingTag} に同じ tag があれば同版候補を公開し直さない`, () => {
    const f = fixture({ existingTag });
    const r = f.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /tag v0\.3\.0 already exists/);
    assertUnchanged(f);
    assertNotPublished(f);
    assert.deepEqual(f.npmCalls(), []);
  });
}

test("CHANGELOG 以外の未コミット変更があれば release を拒否する", () => {
  const f = fixture({ dirty: true });
  const r = f.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /uncommitted changes other than CHANGELOG/);
  assertUnchanged(f);
  assertNotPublished(f);
  assert.deepEqual(f.npmCalls(), []);
});

test("存在しない prepare-only flag は公開入口で拒否する", () => {
  const f = fixture();
  const r = f.run(["0.3.0", "--prepare-only"]);
  assert.equal(r.status, 64);
  assert.match(r.stderr, /unknown option/);
  assertUnchanged(f);
  assertNotPublished(f);
  assert.deepEqual(f.gitCalls(), []);
});
