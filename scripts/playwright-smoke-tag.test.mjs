import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as config from "../templates/playwright/src/config/specproof-config.ts";

const template = fileURLToPath(new URL("../templates/playwright/", import.meta.url));

test("smoke だけが設定で指定したタグを Gherkin 式で除外する", () => {
  const projects = [{ name: "guest", tags: "not @admin" }];
  const env = { name: "local", excludeTags: ["@remote"] };
  const cfg = { tags: { slow: "@長時間" }, projects, environments: [env] };
  assert.deepEqual(config.runnerExclusions(cfg, env, false), ["@remote"]);
  assert.deepEqual(config.runnerExclusions(cfg, env, true), ["@remote", "@長時間"]);
  assert.deepEqual(config.runnerExclusions({ projects, environments: [env] }, env, true), ["@remote", "@slow"]);
  for (const slow of ["@red-contract", "@first or @second", "@unfinished\\", "", 1]) {
    for (const smoke of [true, false]) {
      assert.throws(
        () => config.runnerExclusions({ ...cfg, tags: { slow } }, env, smoke),
        /tags\.slow/,
        `${JSON.stringify(slow)} smoke=${smoke}`,
      );
    }
  }
});

// 本物の bddgen / playwright の代わりに、受け取った環境変数と引数を記録するだけの package を置く。
// package.json の test:smoke を npm を介さずに実行し（npm_lifecycle_event が無い起動経路）、
// 両方のコマンドに SPECPROOF_SMOKE=1 が届くかを確かめる。
const stubPackage = (root, name, binName, entry, exportsCli) => {
  const dir = path.join(root, "node_modules", ...name.split("/"));
  mkdirSync(dir, { recursive: true });
  const exportsField = { "./package.json": "./package.json", ...(exportsCli ? { "./cli": `./${entry}` } : {}) };
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version: "0.0.0", bin: { [binName]: entry }, exports: exportsField }),
  );
  writeFileSync(
    path.join(dir, entry),
    [
      'const fs = require("node:fs");',
      `fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ bin: ${JSON.stringify(binName)}, smoke: process.env.SPECPROOF_SMOKE ?? null, args: process.argv.slice(2) }) + "\\n");`,
      `if (process.env.STUB_FAIL === ${JSON.stringify(binName)}) process.exit(3);`,
      "",
    ].join("\n"),
  );
  // npm が作る .bin のシム（POSIX）。旧来の "bddgen && playwright test" はこちらを PATH から呼ぶ。
  const bin = path.join(root, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  const shim = path.join(bin, binName);
  writeFileSync(shim, `#!/bin/sh\nexec node "${path.join(dir, entry)}" "$@"\n`);
  chmodSync(shim, 0o755);
};

const smokeWorkspace = () => {
  const root = mkdtempSync(path.join(tmpdir(), "specproof-smoke-"));
  copyFileSync(path.join(template, "package.json"), path.join(root, "package.json"));
  const launcher = path.join(template, "scripts", "smoke.mjs");
  if (existsSync(launcher)) {
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    copyFileSync(launcher, path.join(root, "scripts", "smoke.mjs"));
  }
  stubPackage(root, "playwright-bdd", "bddgen", "bddgen-cli.js", false);
  stubPackage(root, "@playwright/test", "playwright", "cli.js", true);
  return root;
};

const runSmokeScript = (root, extraArgs = "", extraEnv = {}) => {
  const script = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts["test:smoke"];
  const log = path.join(root, "calls.jsonl");
  writeFileSync(log, "");
  const env = { ...process.env, STUB_LOG: log, ...extraEnv };
  delete env.SPECPROOF_SMOKE;
  delete env.npm_lifecycle_event;
  env.PATH = `${path.join(root, "node_modules", ".bin")}${path.delimiter}${env.PATH}`;
  let status = 0;
  try {
    execSync(`${script}${extraArgs}`, { cwd: root, env, stdio: "pipe" });
  } catch (error) {
    status = error.status;
  }
  const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { status, calls };
};

test("test:smoke は npm を介さない起動でも bddgen と playwright test の両方に SPECPROOF_SMOKE=1 を渡す", {
  skip: process.platform === "win32" && "POSIX の .bin シムを使う",
}, () => {
  const root = smokeWorkspace();
  const { status, calls } = runSmokeScript(root, " --project guest");
  assert.equal(status, 0);
  assert.deepEqual(calls, [
    { bin: "bddgen", smoke: "1", args: [] },
    { bin: "playwright", smoke: "1", args: ["test", "--project", "guest"] },
  ]);
});

test("test:smoke は bddgen が失敗したら playwright test を起動せず、終了コードを返す", {
  skip: process.platform === "win32" && "POSIX の .bin シムを使う",
}, () => {
  const root = smokeWorkspace();
  const failed = runSmokeScript(root, "", { STUB_FAIL: "bddgen" });
  assert.equal(failed.status, 3);
  assert.deepEqual(failed.calls.map((call) => call.bin), ["bddgen"]);
  const testFailed = runSmokeScript(root, "", { STUB_FAIL: "playwright" });
  assert.equal(testFailed.status, 3);
  assert.deepEqual(testFailed.calls.map((call) => call.bin), ["bddgen", "playwright"]);
});
