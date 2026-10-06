import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { scaffoldTemplate } from "../init.js";

for (const [adapter, defaultDir] of [
  ["playwright", "packages/e2e"],
  ["flutter", "bdd_tests"],
]) {
  for (const target of [".", defaultDir, "tests/bdd"]) {
    test(`${adapter}: ${target} の生成先と設定パスが一致する`, () => {
      const temp = mkdtempSync(path.join(os.tmpdir(), "specproof-root-"));
      try {
        const repoRoot = path.join(temp, "repo");
        const tplDir = path.join(temp, "template");
        mkdirSync(repoRoot);
        mkdirSync(tplDir);
        writeFileSync(
          path.join(tplDir, "specproof.config.yaml"),
          `layout:\n  featuresDir: ${defaultDir}/features\n  manifest: ${defaultDir}/traceability.yaml\ncommands:\n  generate: cd ${defaultDir} && echo generate\n`,
        );
        writeFileSync(path.join(tplDir, "traceability.yaml"), "version: 1\nlinks: []\n");
        mkdirSync(path.join(tplDir, "features"));
        writeFileSync(path.join(tplDir, "features", "example.feature"), "Feature: example\n");
        const result = scaffoldTemplate({
          tplDir,
          repoRoot,
          e2eDir: path.resolve(repoRoot, target),
          templateDefaultDir: defaultDir,
          force: false,
        });
        const config = readFileSync(path.join(repoRoot, "specproof.config.yaml"), "utf8");
        assert.ok(config.includes(`featuresDir: ${target}/features`));
        assert.ok(config.includes(`manifest: ${target}/traceability.yaml`));
        assert.ok(config.includes(`generate: cd ${target} && echo generate`));
        assert.ok(existsSync(path.resolve(repoRoot, target, "traceability.yaml")));
        assert.ok(existsSync(path.resolve(repoRoot, target, "features/example.feature")));
        assert.equal(result.layoutRewritten, target !== defaultDir);
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });
  }
}
