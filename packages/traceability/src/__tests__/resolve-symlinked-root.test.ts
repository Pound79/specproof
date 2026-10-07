import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "vitest";
import { discoverConfig } from "../config.js";
import { resolveWithinRoot } from "../resolve.js";

/**
 * real/ が実体、link/ がそれを指す symlink。cwd は常に物理パスを返すため、
 * 相対の --manifest は物理パスに、--root "$PWD" は論理パスになりうる。
 */
const withLinkedRepo = (
  run: (paths: { real: string; link: string; outside: string }) => void,
): void => {
  const temp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-linked-root-")));
  const real = path.join(temp, "real");
  const link = path.join(temp, "link");
  const outside = path.join(temp, "outside");
  mkdirSync(real);
  mkdirSync(outside);
  symlinkSync(real, link);
  writeFileSync(path.join(real, "q.yaml"), "version: 1\nlinks: []\n");
  writeFileSync(path.join(outside, "q.yaml"), "version: 1\nlinks: []\n");
  try {
    run({ real, link, outside });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
};

describe.skipIf(process.platform === "win32")("symlink 経由の repo root", () => {
  test("論理パスの root と物理パスの manifest を同じ repo として扱う", () =>
    withLinkedRepo(({ real, link }) => {
      assert.equal(resolveWithinRoot(link, path.join(real, "q.yaml")), path.join(link, "q.yaml"));
    }));

  test("物理パスの root と論理パスの manifest を同じ repo として扱う", () =>
    withLinkedRepo(({ real, link }) => {
      assert.equal(resolveWithinRoot(real, path.join(link, "q.yaml")), path.join(real, "q.yaml"));
    }));

  test("未作成の manifest も実体の親ディレクトリで比べる", () =>
    withLinkedRepo(({ real, link }) => {
      assert.equal(
        resolveWithinRoot(link, path.join(real, "new", "q.yaml")),
        path.join(link, "new", "q.yaml"),
      );
    }));

  test("--root と相対 --manifest の組み合わせで discoverConfig が通る", () =>
    withLinkedRepo(({ real, link }) => {
      const config = discoverConfig({ root: link, manifest: path.join(real, "q.yaml") });
      assert.equal(config.manifestPath, path.join(link, "q.yaml"));
    }));

  test("実体が外にある絶対パスは引き続き拒否する", () =>
    withLinkedRepo(({ link, outside }) => {
      assert.throws(
        () => resolveWithinRoot(link, path.join(outside, "q.yaml")),
        /outside the repository root/,
      );
    }));

  test("相対の ../ 参照は実体が repo 内でも従来どおり拒否する", () =>
    withLinkedRepo(({ real }) => {
      assert.throws(() => resolveWithinRoot(real, "../link/q.yaml"), /outside the repository root/);
    }));
});
