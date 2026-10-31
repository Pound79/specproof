import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const dist = (name: string): string =>
  fileURLToPath(new URL(`../../dist/cli-${name}.js`, import.meta.url));

const run = (name: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-usage-"));
  try {
    writeFileSync(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
    const { SPECPROOF_DEBUG: _ignored, ...inherited } = process.env;
    const result = spawnSync(process.execPath, [dist(name), "--root", root, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: { ...inherited, ...env },
    });
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

for (const [name, args, message] of [
  ["check", ["--stric"], "Unknown option or argument: --stric"],
  ["update", ["--json"], "Unknown option or argument: --json"],
  ["list", ["--pages-dir"], "--pages-dir requires a value"],
  ["stats", ["--manifest", "--json"], "--manifest requires a value"],
] as const) {
  test(`${name}: 引数の誤りはスタックを出さず 1 行で知らせる`, () => {
    const result = run(name, [...args]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `traceability ${name} failed: ${message}\n`);
  });
}

// 出口（runCli）でも改行・制御文字を潰し、入口がどのメッセージを作っても行頭にワークフロー
// コマンドや偽の行を作らせない。引数はメッセージにそのまま入る入力の代表として使う。
test("失敗のメッセージに入った改行と制御文字は ? に置き換えて 1 行にする", () => {
  const result = run("check", ["x\n::warning::INJ\r y"]);
  assert.equal(result.status, 2);
  assert.equal(
    result.stderr,
    "traceability check failed: Unknown option or argument: x?::warning::INJ??y\n",
  );
});

// 公開リポジトリの CI ログは誰でも読めるので、既定ではスタックを出さない。
test("想定外のエラーも既定ではスタックを出さず 1 行で知らせる", () => {
  const result = run("check", ["--manifest", "missing.yaml"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^traceability check failed: .*ENOENT/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
  assert.equal(result.stderr.split("\n").length, 2);
});

test("SPECPROOF_DEBUG=1 のときだけ調査用にスタックを出す", () => {
  const result = run("check", ["--manifest", "missing.yaml"], { SPECPROOF_DEBUG: "1" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /traceability check failed:/);
  assert.match(result.stderr, /ENOENT/);
  assert.match(result.stderr, /\n\s+at /);
});
