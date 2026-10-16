import { describe, expect, it } from "vitest";
import { parseScenarios } from "../feature-scan.js";
import { buildStats } from "../stats.js";

describe("Gherkin の Outline のケース数", () => {
  // JS の Gherkin は Examples が無い Outline を通常シナリオとして 1 ケース生成する。
  // Examples が存在してデータ行が無い場合の 0 ケースとは区別する。
  it.each([
    ["英語", "Feature: f\nScenario Outline: s\n  Given x\n  Then y\n"],
    ["日本語", "機能: f\nシナリオアウトライン: s\n  前提 x\n  ならば y\n"],
    ["step が無い Outline", "Feature: f\nScenario Template: s\n"],
  ])("%sの Examples が無い Outline を 1 ケースと数える", (_, content) => {
    const scenarios = parseScenarios(content);
    expect(scenarios).toMatchObject([{ name: "s", caseCount: 1 }]);
    expect(buildStats([{ domain: "f", scenarios }]).totals.cases).toBe(1);
  });

  it.each([
    ["表が無い", "Examples:\n"],
    ["見出しだけ", "Examples:\n  | v |\n"],
    ["複数の空の Examples", "Examples:\n  | v |\nExamples:\n  | v |\n"],
  ])("%s Examples がある Outline は 0 ケースのままにする", (_, examples) => {
    const content = `Feature: f\nScenario Outline: s\n  Given <v>\n${examples}`;
    expect(parseScenarios(content)).toMatchObject([{ name: "s", caseCount: 0 }]);
  });

  it("Examples がある Outline は各 Examples の全データ行を数える", () => {
    const content = [
      "Feature: f",
      "Scenario Outline: s",
      "  Given <v>",
      "Examples:",
      "  | v |",
      "Examples:",
      "  | v |",
      "  | 1 |",
      "  | 2 |",
      "Examples:",
      "  | v |",
      "  | 3 |",
    ].join("\n");
    expect(parseScenarios(content)).toMatchObject([{ name: "s", caseCount: 3 }]);
  });
});
