import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const cli = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const original = "変更前の内容\n";

const cases = [
  {
    name: "init の scaffold ファイル",
    args: ["init", "--adapter", "playwright", "--dir", "e2e"],
    target: "e2e/README.md",
    expected: "# specproof Playwright Scaffold",
  },
  {
    name: "init の設定ファイル",
    args: ["init", "--adapter", "playwright", "--dir", "e2e"],
    target: "specproof.config.yaml",
    expected: "adapter: playwright",
  },
  {
    name: "setup-agent の skill ファイル",
    args: ["setup-agent", "codex"],
    target: ".agents/skills/specproof/SKILL.md",
    expected: "name: specproof",
  },
] as const;

const withRepo = (run: (repo: string, outside: string) => void): void => {
  const root = mkdtempSync(path.join(tmpdir(), "specproof-write-boundary-"));
  const repo = path.join(root, "repo");
  const outside = path.join(root, "outside.txt");
  try {
    mkdirSync(repo);
    run(repo, outside);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const invoke = (repo: string, args: readonly string[]) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: repo,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
};

for (const entry of cases) {
  for (const link of [
    { name: "hardlink", create: linkSync, error: /hard links/i },
    { name: "symlink", create: symlinkSync, error: /symbolic link/i },
  ]) {
    test(`${entry.name}: --force でも ${link.name} の外部ファイルを変更しない`, () =>
      withRepo((repo, outside) => {
        const target = path.join(repo, entry.target);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(outside, original);
        link.create(outside, target);

        const result = invoke(repo, [...entry.args, "--force"]);
        assert.equal(readFileSync(outside, "utf8"), original);
        assert.equal(readFileSync(target, "utf8"), original);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, link.error);
      }));
  }

  test(`${entry.name}: 通常ファイルは --force の指定時だけ上書きする`, () =>
    withRepo((repo) => {
      const target = path.join(repo, entry.target);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, original);

      const skipped = invoke(repo, entry.args);
      assert.equal(skipped.status, 0, skipped.stderr);
      assert.equal(readFileSync(target, "utf8"), original);

      const overwritten = invoke(repo, [...entry.args, "--force"]);
      assert.equal(overwritten.status, 0, overwritten.stderr);
      assert.ok(readFileSync(target, "utf8").includes(entry.expected));
    }));
}
