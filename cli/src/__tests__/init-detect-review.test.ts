import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { collectSnapshot, detectAdapter, selectAdapterCandidate } from "../detect.js";

const cli = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const fixture = async (run: (root: string) => unknown): Promise<void> => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-detect-review-"));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const invoke = (root: string, ...args: string[]) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
};

test("単一の medium 候補は detect と init auto で同じ推薦になる", async () =>
  fixture(async (root) => {
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { react: "*" } }),
    );
    const before = readdirSync(root);
    const detected = invoke(root, "detect");
    assert.equal(detected.status, 0, detected.stderr);
    assert.match(detected.stdout, /Recommendation: specproof init --adapter playwright --dir e2e/);
    assert.doesNotMatch(detected.stdout, /Ambiguous/);
    assert.deepEqual(readdirSync(root), before);
    assert.equal(
      selectAdapterCandidate(detectAdapter(await collectSnapshot(root)))?.adapter,
      "playwright",
    );
    const initialized = invoke(root, "init", "--adapter", "auto");
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.match(initialized.stdout, /Auto-detected adapter: playwright/);
  }));

test("pnpm workspace を npm workspaces と誤表示しない", async () =>
  fixture((root) => {
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { react: "*" } }),
    );
    const result = invoke(root, "detect");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Monorepo detected/);
    assert.doesNotMatch(result.stdout, /npm workspaces/);
  }));

for (const eol of ["\n", "\r\n"]) {
  test(`Flutter SDK の間のコメント・空行を許容する (${JSON.stringify(eol)})`, async () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "pubspec.yaml"),
        [
          "name: example",
          "dependencies:",
          "  flutter: # SDK",
          "    # 説明",
          "",
          "    sdk: flutter # dependency",
          "",
        ].join(eol),
      );
      assert.equal((await collectSnapshot(root)).pubspecYaml?.hasFlutterSdk, true);
      assert.equal(invoke(root, "init", "--adapter", "auto").status, 0);
    }));
}

test("存在する非Flutter pubspec を無いと説明しない", async () =>
  fixture((root) => {
    writeFileSync(path.join(root, "pubspec.yaml"), "name: pure_dart\n");
    const result = invoke(root, "detect");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No supported framework detected/);
    assert.doesNotMatch(result.stdout, /No pubspec.yaml/);
  }));

for (const dir of ["..foo", "custom-bdd-tests"]) {
  test(`Flutter の配置 ${dir} は有効な pubspec 名と同じ手順を出す`, async () =>
    fixture((root) => {
      const result = invoke(root, "init", "--adapter", "flutter", "--dir", dir);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /--project-name bdd_tests \./);
      assert.match(
        readFileSync(path.join(root, dir, "pubspec.yaml"), "utf8"),
        /^name: bdd_tests$/m,
      );
    }));
}

test("本当の親ディレクトリへの --dir は引き続き拒否する", async () =>
  fixture((root) => {
    const result = invoke(root, "init", "--adapter", "flutter", "--dir", "../outside");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must stay within/);
    assert.deepEqual(readdirSync(root), []);
  }));
