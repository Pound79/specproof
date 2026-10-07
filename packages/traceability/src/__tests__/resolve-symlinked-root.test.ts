import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

  test("repo 外の絶対パスは、権限やループの有無にかかわらず同じ文言で拒否する", () =>
    withLinkedRepo(({ real, outside }) => {
      const locked = path.join(outside, "locked");
      mkdirSync(locked);
      symlinkSync("loop", path.join(outside, "loop"));
      chmodSync(locked, 0o000);
      try {
        const messageFor = (target: string): string => {
          try {
            resolveWithinRoot(real, target);
            return "resolved";
          } catch (error) {
            return (error as Error).message.replace(target, "<target>");
          }
        };
        const expected = messageFor(path.join(outside, "missing", "q.yaml"));
        assert.match(expected, /outside the repository root/);
        for (const target of [
          path.join(outside, "q.yaml"),
          path.join(locked, "q.yaml"),
          path.join(outside, "loop", "q.yaml"),
        ]) {
          assert.equal(messageFor(target), expected, target);
        }
      } finally {
        chmodSync(locked, 0o755);
      }
    }));

  // root は chmod 000 を通過できるので、EACCES の検証だけを除外する。
  test.skipIf(process.getuid?.() === 0)(
    "repo 内の実体パスのエラーは、root を論理パスで書いても物理パスと同じになる",
    () =>
      withLinkedRepo(({ real, link }) => {
        const locked = path.join(real, "locked");
        mkdirSync(locked);
        chmodSync(locked, 0o000);
        try {
          const errorFor = (root: string): string => {
            try {
              resolveWithinRoot(root, path.join(locked, "q.yaml"));
              return "resolved";
            } catch (error) {
              return String((error as NodeJS.ErrnoException).code ?? (error as Error).message);
            }
          };
          assert.equal(errorFor(link), errorFor(real));
          assert.equal(errorFor(real), "EACCES");
        } finally {
          chmodSync(locked, 0o755);
        }
      }),
  );

  test("repo 内のリンクが外を指すとき、リンク先の状態によらず同じ文言で拒否する", () =>
    withLinkedRepo(({ real, outside }) => {
      const locked = path.join(outside, "locked");
      mkdirSync(locked);
      symlinkSync("loop", path.join(outside, "loop"));
      const targets = {
        existing: path.join(outside, "q.yaml"),
        missing: path.join(outside, "missing.yaml"),
        locked: path.join(locked, "q.yaml"),
        loop: path.join(outside, "loop"),
      };
      for (const [name, target] of Object.entries(targets)) {
        symlinkSync(target, path.join(real, name));
      }
      chmodSync(locked, 0o000);
      try {
        const messages = Object.keys(targets).map((name) => {
          try {
            resolveWithinRoot(real, name);
            return `${name}: resolved`;
          } catch (error) {
            return (error as Error).message.replace(`"${name}"`, '"<ref>"');
          }
        });
        assert.match(messages[0], /dangling or resolves outside the repository root/);
        assert.deepEqual(new Set(messages).size, 1, messages.join("\n"));
      } finally {
        chmodSync(locked, 0o755);
      }
    }));
});
