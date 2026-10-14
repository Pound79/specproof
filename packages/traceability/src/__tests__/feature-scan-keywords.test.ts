import { describe, expect, it } from "vitest";
import { parseScenarioSteps } from "../feature-lint.js";
import { parseScenarios } from "../feature-scan.js";
import { buildStats } from "../stats.js";

// runner はファイルの言語のキーワードだけを要素とし、キーワードの直後にコロンを要求する。
// それ以外は説明文なので、要素と読むと後続の step で docstring を開き、条件が消える。
const tail = ['  """', "@red-contract @skip", "Scenario: hidden", "  Given g", '  """', '  """'];
const jaTail = ['  """', "@red-contract @skip", "シナリオ: hidden", "  前提 g", '  """', '  """'];

const descriptions = [
  {
    label: "英語のファイルの説明文にある日本語の Scenario",
    content: ["Feature: f", "  シナリオ: x", "  Given y", ...tail],
  },
  {
    label: "英語のファイルの説明文にある日本語の Background",
    content: ["Feature: f", "  背景: x", "  Given y", ...tail],
  },
  {
    label: "コロンの前に空白がある Background",
    content: ["Feature: f", "  Background : x", "  Given y", ...tail],
  },
  {
    label: "コロンの前に空白がある Scenario",
    content: ["Feature: f", "  Scenario : x", "  Given y", ...tail],
  },
  {
    label: "日本語のファイルの説明文にある英語の Scenario",
    content: ["機能: f", "  Scenario: x", "  前提 y", ...jaTail],
  },
];

describe("ファイルの言語の要素キーワード", () => {
  it.each(descriptions)("$label を要素と読まず、後続の条件を数える", ({ content }) => {
    const scenarios = parseScenarios(content.join("\n"));
    expect(scenarios.map(({ name, effectiveTags }) => ({ name, effectiveTags }))).toEqual([
      { name: "hidden", effectiveTags: ["@red-contract", "@skip"] },
    ]);
  });

  it.each(descriptions)("feature lint も $label を要素と読まない", ({ content }) => {
    expect(parseScenarioSteps(content.join("\n")).map(({ name }) => name)).toEqual(["hidden"]);
  });

  it("英語のファイルの説明文にある 機能: で Feature のタグを外さない", () => {
    const [scenario] = parseScenarios("@skip\nFeature: f\n  機能: x\nScenario: a\n  Given g\n");
    expect(scenario.effectiveTags).toEqual(["@skip"]);
  });

  // 2 つ目の Feature 行は説明文。Feature と読むと Feature のタグを上書きして外す。
  it.each([
    ["英語", "@skip\nFeature: f\n  Feature: x\nScenario: a\n  Given g\n"],
    ["日本語", "@skip\n機能: f\n  機能: x\nシナリオ: a\n  前提 g\n"],
  ])("%sのファイルの説明文にある同じ Feature キーワードでタグを外さない", (_, text) => {
    expect(parseScenarios(text).map(({ effectiveTags }) => effectiveTags)).toEqual([["@skip"]]);
  });

  // Rule と読むと、継承されていた Rule のタグを空で上書きし、Examples の表も読み止める。
  it.each([
    ["別の言語の Rule", "ルール: x"],
    ["コロンの前に空白がある Rule", "Rule : x"],
  ])("Examples の説明文にある%sで実行ケースを落とさない", (_, line) => {
    const text = `Feature: f\nScenario Outline: a\n  Given <v>\nExamples:\n  ${line}\n  | v |\n  | 1 |\n  | 2 |\n`;
    expect(parseScenarios(text)).toMatchObject([{ name: "a", caseCount: 2 }]);
  });

  // Scenario の説明文を要素と読むと、step の後の本物の docstring を開けない。本文を構文として
  // 読み、閉じ区切りを開始区切りと取り違えて、後続の未完了の条件を読み飛ばす。
  it.each(["機能: this line is description, not a Feature header", "Feature : x", "Rule : x"])(
    "Scenario の説明文「%s」で後続の未完了の条件を落とさない",
    (line) => {
      const text = [
        "# language: en",
        "Feature: f",
        "Scenario: real",
        `  ${line}`,
        "  Given a document",
        '    """',
        "    Scenario: fake",
        "      Given a fake step",
        '    """',
        "  Then ok",
        "",
        "@red-contract @skip",
        "Scenario: hidden",
        "  Given another document",
        '    """',
        "    text",
        '    """',
        "  Then not implemented",
      ].join("\n");
      const scenarios = parseScenarios(text);
      expect(scenarios.map(({ name }) => name)).toEqual(["real", "hidden"]);
      expect(buildStats([{ domain: "f", scenarios }])).toMatchObject({
        totals: { phase: { pending: 1 }, disallowed: 1 },
        done: false,
      });
      expect(parseScenarioSteps(text).map(({ name }) => name)).toEqual(["real", "hidden"]);
    },
  );

  // 現行の Gherkin の ja 辞書で Rule は「ルール」だけ。「Rule:」は説明文で、見出しと読むと同じく
  // 本物の docstring を開けず、後続の未完了の条件を読み飛ばす。
  it("日本語のファイルの説明文にある Rule: で後続の未完了の条件を落とさない", () => {
    const text = [
      "# language: ja",
      "機能: f",
      "シナリオ: real",
      "  Rule: 説明文",
      "  前提 a document",
      '    """',
      "    シナリオ: fake",
      "      前提 a fake step",
      '    """',
      "  ならば ok",
      "",
      "@red-contract @skip",
      "シナリオ: hidden",
      "  前提 another document",
      '    """',
      "    text",
      '    """',
      "  ならば not implemented",
    ].join("\n");
    const scenarios = parseScenarios(text);
    expect(scenarios.map(({ name }) => name)).toEqual(["real", "hidden"]);
    expect(buildStats([{ domain: "f", scenarios }])).toMatchObject({
      totals: { phase: { pending: 1 }, disallowed: 1 },
      done: false,
    });
    expect(parseScenarioSteps(text).map(({ name }) => name)).toEqual(["real", "hidden"]);
  });

  it("日本語のファイルの ルール: は Rule として読み、タグを継承する", () => {
    const [scenario] = parseScenarios(
      "# language: ja\n機能: f\n@x\nルール: r\nシナリオ: a\n  前提 g\n",
    );
    expect(scenario.effectiveTags).toEqual(["@x"]);
  });

  it.each([
    ["英語", "Feature: f\nScenario Outline: a\n  Given <v>\nExamples:\n  | v |\n  | 1 |\n"],
    ["日本語", "機能: f\nシナリオテンプレ: a\n  前提 <v>\n例:\n  | v |\n  | 1 |\n"],
  ])("%sのファイルの要素は従来どおり読む", (_, text) => {
    expect(parseScenarios(text)).toMatchObject([{ name: "a", caseCount: 1 }]);
  });
});
