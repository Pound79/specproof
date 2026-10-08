import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverConfig } from "../config.js";
import { parseScenarios } from "../feature-scan.js";

const withTag = (key: string, value: string, run: (root: string) => void): void => {
  const root = mkdtempSync(path.join(os.tmpdir(), "config-tag-lexing-"));
  try {
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      JSON.stringify({ tags: { [key]: value } }),
    );
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

for (const key of ["fixme", "skip"] as const) {
  describe(`tags.${key} は scanner と同じ単一タグに限定する`, () => {
    it.each(["@todo@later", "todo@later", "@@todo", "@todo@", "@@"])(
      "%s を設定エラーにする",
      (value) =>
        withTag(key, value, (root) => {
          expect(() => discoverConfig({ root })).toThrow(
            new RegExp(`tags\\.${key} must be a single Gherkin tag`),
          );
        }),
    );

    it.each(["todo", "@todo", "@todo#ticket", "@要確認"])(
      "%s は scanner のタグと一致する",
      (value) =>
        withTag(key, value, (root) => {
          const config = discoverConfig({ root });
          const tag = key === "fixme" ? config.fixmeTag : config.skipTag;
          const [scenario] = parseScenarios(`${tag}\nFeature: f\n  Scenario: s\n`);
          expect(scenario.effectiveTags).toEqual([tag]);
        }),
    );
  });
}
