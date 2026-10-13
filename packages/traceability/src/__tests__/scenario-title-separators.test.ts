import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseScenarios } from "../feature-scan.js";
import { computeFileHash } from "../hash.js";
import { buildStats } from "../stats.js";

const dialects = [
  { language: "en", feature: "Feature", scenario: "Scenario", outline: "Scenario Outline" },
  { language: "ja", feature: "機能", scenario: "シナリオ", outline: "シナリオアウトライン" },
] as const;
const separators = [
  { label: "単独 CR", value: "\r" },
  { label: "U+2028", value: "\u2028" },
  { label: "U+2029", value: "\u2029" },
];

// Gherkin は LF / CRLF で物理行を区切り、名前の内部にあるこれらの文字は保持する。
// 条件を落とすと、pending と使えないタグがともに 0 件に化けて strict を通過する。
for (const dialect of dialects) {
  const contentFor = (name: string): string =>
    [
      `# language: ${dialect.language}`,
      `${dialect.feature}: 条件`,
      "@red-contract @skip",
      `${dialect.scenario}: ${name}`,
      dialect.language === "en" ? "  Given a condition" : "  前提 条件",
      dialect.language === "en" ? "  Then a result" : "  ならば 結果",
      "",
    ].join("\n");

  describe(`${dialect.language} のシナリオ名の区切り文字`, () => {
    it.each(separators)("$label を名前の内部に保持して条件を数える", ({ value }) => {
      const name = `条件${value}継続`;
      const scenarios = parseScenarios(contentFor(name));
      expect(scenarios).toHaveLength(1);
      expect(scenarios[0]).toMatchObject({
        line: 4,
        name,
        effectiveStateTags: ["@red-contract"],
        effectiveTags: ["@red-contract", "@skip"],
      });
      expect(buildStats([{ domain: "conditions", scenarios }])).toMatchObject({
        totals: { total: 1, cases: 1, phase: { pending: 1 }, disallowed: 1 },
        done: false,
      });
    });

    it("CRLF の行末を名前に残さず、次のシナリオを独立に読む", () => {
      const content = `${contentFor("一つ目")}${dialect.scenario}: 二つ目\n`;
      const scenarios = parseScenarios(content.replaceAll("\n", "\r\n"));
      expect(scenarios.map(({ name, effectiveTags }) => ({ name, effectiveTags }))).toEqual([
        { name: "一つ目", effectiveTags: ["@red-contract", "@skip"] },
        { name: "二つ目", effectiveTags: [] },
      ]);
    });

    it("Outline の名前と Feature / Rule のタグ継承を保持する", () => {
      const name = "条件\u2028継続";
      const content = [
        `# language: ${dialect.language}`,
        "@skip",
        `${dialect.feature}: 条件`,
        "@red-contract",
        "Rule: 規則",
        "@human",
        `${dialect.outline}: ${name}`,
        dialect.language === "en" ? "  Given <value>" : "  前提 <value>",
        dialect.language === "en" ? "  Examples:" : "  例:",
        "    | value |",
        "    | first |",
        "    | second |",
      ].join("\n");
      const scenarios = parseScenarios(content);
      expect(scenarios).toHaveLength(1);
      expect(scenarios[0]).toMatchObject({
        name,
        tags: ["@human"],
        effectiveStateTags: ["@red-contract", "@human"],
        effectiveTags: ["@skip", "@red-contract", "@human"],
        caseCount: 2,
      });
    });

    it.each(separators)("$label があっても両 CLI の strict 検査が失敗する", async ({ value }) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "scenario-title-"));
      try {
        await mkdir(path.join(root, "features"));
        const feature = path.join(root, "features/conditions.feature");
        await writeFile(feature, contentFor(`条件${value}継続`));
        const hash = await computeFileHash(feature);
        await writeFile(
          path.join(root, "specproof.config.yaml"),
          "layout:\n  featuresDir: features\n",
        );
        await writeFile(
          path.join(root, "traceability.yaml"),
          JSON.stringify({
            version: 1,
            links: [
              {
                id: "conditions",
                label: "Conditions",
                spec: [],
                impl: [],
                features: [{ path: "features/conditions.feature", hash }],
              },
            ],
          }),
        );
        const cli = (command: string) =>
          spawnSync(
            process.execPath,
            [
              fileURLToPath(new URL(`../../dist/cli-${command}.js`, import.meta.url)),
              "--root",
              root,
              "--strict",
              "--json",
            ],
            { encoding: "utf8" },
          );
        const check = cli("check");
        const stats = cli("stats");
        expect.soft(JSON.parse(check.stdout)).toMatchObject({
          clean: true,
          driftCount: 0,
          warnings: [{ kind: "disallowed-tag", failsUnderStrict: true }],
        });
        expect.soft(check.status, check.stderr).toBe(1);
        expect.soft(JSON.parse(stats.stdout)).toMatchObject({
          totals: { total: 1, cases: 1, phase: { pending: 1 }, disallowed: 1 },
          done: false,
        });
        expect.soft(stats.status, stats.stderr).toBe(1);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
}
