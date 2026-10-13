import { describe, expect, it } from "vitest";
import { parseScenarioSteps } from "../feature-lint.js";
import { parseScenarios } from "../feature-scan.js";
import { buildStats } from "../stats.js";

// Gherkin は区切りで始まる行で docstring を閉じ、`|` で始まる行を表の行とする。
// 完全一致で判定すると、後続の条件や実行ケースが黙って集計から消える。
const closingLines = [
  { label: "NEL が続く閉じ行", value: '    """\u0085' },
  { label: "ZWSP が続く閉じ行", value: '    """\u200b' },
  { label: "文字が続く閉じ行", value: '    """ end' },
];

describe("docstring の閉じ行", () => {
  const contentFor = (closing: string): string =>
    [
      "Feature: f",
      "Scenario: a",
      "  Given g",
      '    """',
      "    body",
      closing,
      "@red-contract @skip",
      "Scenario: hidden",
      "  Given g",
      '    """json',
      "    {}",
      '    """',
      "",
    ].join("\n");

  it.each(closingLines)("$label で閉じ、後続の条件を数える", ({ value }) => {
    const scenarios = parseScenarios(contentFor(value));
    expect(scenarios.map(({ name, effectiveTags }) => ({ name, effectiveTags }))).toEqual([
      { name: "a", effectiveTags: [] },
      { name: "hidden", effectiveTags: ["@red-contract", "@skip"] },
    ]);
    expect(buildStats([{ domain: "f", scenarios }])).toMatchObject({
      totals: { total: 2, phase: { pending: 1 }, disallowed: 1 },
      done: false,
    });
  });

  it.each(closingLines)("feature lint も $label で閉じる", ({ value }) => {
    expect(parseScenarioSteps(contentFor(value)).map(({ name }) => name)).toEqual(["a", "hidden"]);
  });
});

describe("Examples の表の行", () => {
  const outline = (rows: string[]): string =>
    [
      "Feature: f",
      "Scenario Outline: a",
      "  Given <v>",
      "  Examples:",
      ...rows.map((row) => `    ${row}`),
      "",
    ].join("\n");

  it.each([
    { label: "本体セル内の単独 CR", rows: ["| v |", "| 1\rx |", "| 2 |", "| 3 |"], cases: 3 },
    { label: "本体セル内の U+2028", rows: ["| v |", "| 1\u2028x |", "| 2 |"], cases: 2 },
    { label: "見出しセル内の単独 CR", rows: ["| v\rw |", "| 1 |", "| 2 |"], cases: 2 },
    { label: "行末に続く NEL", rows: ["| v |", "| 1 |\u0085", "| 2 |"], cases: 2 },
  ])("$label があっても実行ケースを数える", ({ rows, cases }) => {
    expect(parseScenarios(outline(rows))).toMatchObject([{ name: "a", caseCount: cases }]);
  });
});
