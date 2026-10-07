import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { discoverConfig } from "../config.js";

const withRepo = (run: (root: string, outside: string) => void): void => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "specproof-containment-"));
  const root = path.join(temp, "repo");
  const outside = path.join(temp, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  try {
    run(root, outside);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
};

for (const field of ["manifest", "pagesDir", "featuresDir"]) {
  for (const absolute of [false, true]) {
    test(`layout.${field} の${absolute ? "絶対" : "相対"}パスで外に出ない`, () => {
      withRepo((root, outside) => {
        writeFileSync(
          path.join(root, "specproof.config.yaml"),
          JSON.stringify({ layout: { [field]: absolute ? outside : "../outside" } }),
        );
        assert.throws(() => discoverConfig({ root }), /outside the repository root/);
      });
    });
  }
  if (process.platform !== "win32") {
    test(`layout.${field} の外向きシンボリックリンクを拒否する`, () => {
      withRepo((root, outside) => {
        symlinkSync(outside, path.join(root, "escape"));
        writeFileSync(
          path.join(root, "specproof.config.yaml"),
          JSON.stringify({ layout: { [field]: "escape/child" } }),
        );
        assert.throws(() => discoverConfig({ root }), /outside the repository root/);
      });
    });
  }
}
test("明示した --manifest でもリポジトリ外を許可しない", () => {
  withRepo((root, outside) => {
    assert.throws(
      () => discoverConfig({ root, manifest: path.join(outside, "traceability.yaml") }),
      /outside the repository root/,
    );
  });
});
test("明示した --pages-dir でもリポジトリ外を許可しない", () => {
  withRepo((root) => {
    assert.throws(() => discoverConfig({ root, pagesDir: ".." }), /outside the repository root/);
  });
});
if (process.platform !== "win32") {
  test("既定 manifest の外向きシンボリックリンクを拒否する", () => {
    withRepo((root, outside) => {
      const file = path.join(outside, "traceability.yaml");
      writeFileSync(file, "version: 1\nlinks: []\n");
      symlinkSync(file, path.join(root, "traceability.yaml"));
      assert.throws(() => discoverConfig({ root }), /outside the repository root/);
    });
  });
}
test("内部の明示 manifest と ..foo ディレクトリは引き続き利用できる", () => {
  withRepo((root) => {
    const manifest = path.join(root, "..foo", "traceability.yaml");
    const config = discoverConfig({ root, manifest, pagesDir: "..foo", featuresDir: "." });
    assert.equal(config.manifestPath, manifest);
    assert.equal(config.pagesDir, "..foo");
    assert.equal(config.featuresDir, ".");
  });
});
