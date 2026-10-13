import { describe, expect, it } from "vitest";
import { parseScenarioSteps } from "../feature-lint.js";
import { parseScenarios } from "../feature-scan.js";
import { buildStats } from "../stats.js";

// Gherkin は Scenario / Background の step の直後だけで docstring を開く。
// 説明文の区切りを docstring と読むと、後続の条件が黙って集計から消える。
const descriptions = [
  {
    label: "Feature の説明文",
    content: [
      "Feature: f",
      '  """',
      "",
      "@red-contract @skip",
      "Scenario: hidden",
      "  Given g",
      "",
      "Scenario: b",
      '  """',
      "  Given g",
    ],
    names: ["hidden", "b"],
  },
  {
    label: "Scenario の説明文",
    content: [
      "Feature: f",
      "Scenario: a",
      '  """',
      "  text",
      "@red-contract @skip",
      "Scenario: hidden",
      "  Given g",
    ],
    names: ["a", "hidden"],
  },
  {
    label: "Rule の説明文",
    content: [
      "Feature: f",
      "Rule: r",
      "  ```",
      "@red-contract @skip",
      "Scenario: hidden",
      "  Given g",
    ],
    names: ["hidden"],
  },
  {
    label: "step に見える Feature の説明文",
    content: [
      "Feature: f",
      "  Given not a step",
      '  """',
      "@red-contract @skip",
      "Scenario: hidden",
      "  Given g",
    ],
    names: ["hidden"],
  },
  // Gherkin のキーワードは ASCII の空白 1 文字までを含む（"Given "）。他の空白なら説明文。
  ...[
    { label: "タブ", separator: "\t" },
    { label: "NBSP", separator: "\u00a0" },
    { label: "U+3000", separator: "\u3000" },
  ].flatMap(({ label, separator }) =>
    ["Given", "*"].map((keyword) => ({
      label: `${keyword} の後が${label}の Scenario の説明文`,
      content: [
        "Feature: f",
        "Scenario: a",
        `  ${keyword}${separator}x`,
        '  """',
        "@red-contract @skip",
        "Scenario: hidden",
        '  """',
        "  Given g",
      ],
      names: ["a", "hidden"],
    })),
  ),
  {
    label: "Examples の説明文",
    content: [
      "Feature: f",
      "Scenario Outline: a",
      "  Given <v>",
      "Examples:",
      '  """',
      "  | v |",
      "  | 1 |",
      "@red-contract @skip",
      "Scenario: hidden",
      "  Given g",
    ],
    names: ["a", "hidden"],
  },
  // 言語を明示したファイルでは、その言語の step キーワードだけが step になる。
  {
    label: "en と明示したファイルの日本語キーワードで始まる説明文",
    content: [
      "# language: en",
      "Feature: f",
      "Scenario: a",
      "  前提として",
      '  """',
      "@red-contract @skip",
      "Scenario: hidden",
      "  Given g",
    ],
    names: ["a", "hidden"],
  },
  {
    label: "ja と明示したファイルの英語キーワードで始まる説明文",
    content: [
      "# language: ja",
      "機能: f",
      "シナリオ: a",
      "  Given x",
      '  """',
      "@red-contract @skip",
      "シナリオ: hidden",
      "  前提 g",
    ],
    names: ["a", "hidden"],
  },
];

describe("説明文にある docstring の区切り", () => {
  it.each(descriptions)(
    "$label では docstring を開かず、後続の条件を数える",
    ({ content, names }) => {
      const scenarios = parseScenarios(content.join("\n"));
      expect(scenarios.map(({ name }) => name)).toEqual(names);
      expect(scenarios.find(({ name }) => name === "hidden")?.effectiveTags).toEqual([
        "@red-contract",
        "@skip",
      ]);
      expect(buildStats([{ domain: "f", scenarios }])).toMatchObject({
        totals: { phase: { pending: 1 }, disallowed: 1 },
        done: false,
      });
    },
  );

  it.each(descriptions)("feature lint も $label で docstring を開かない", ({ content, names }) => {
    expect(parseScenarioSteps(content.join("\n")).map(({ name }) => name)).toEqual(names);
  });
});

describe("step の引数の docstring", () => {
  const steps = [
    {
      label: "空行とコメントを挟んだ Scenario の step",
      content: [
        "Feature: f",
        "Scenario: a",
        "  Given g",
        "",
        "  # c",
        '  """',
        "  Scenario: fake",
        '  """',
        "@skip",
        "Scenario: b",
        "  Given g",
      ],
      names: ["a", "b"],
    },
    {
      label: "Background の step",
      content: [
        "Feature: f",
        "Background:",
        "  もし g",
        "  ```",
        "  Scenario: fake",
        "  ```",
        "@skip",
        "Scenario: b",
        "  Given g",
      ],
      names: ["b"],
    },
    // Gherkin は行頭だけを除いて "And " と照合するため、本文が空の step も step になる。
    ...["And ", "* ", "Then \t"].map((keyword) => ({
      label: `本文が空の「${keyword.trim()}」の step`,
      content: [
        "Feature: f",
        "Scenario: a",
        "  Given x",
        `  ${keyword}`,
        '  """',
        "  @red-contract",
        "  Scenario: smuggled",
        '  """',
      ],
      names: ["a"],
    })),
    {
      label: "ja と明示したファイルの日本語の step",
      content: [
        "# language: ja",
        "機能: f",
        "シナリオ: a",
        "  前提 g",
        '  """',
        "  シナリオ: fake",
        '  """',
      ],
      names: ["a"],
    },
    // Gherkin は要素とタグより前の最初の言語宣言だけを使う。後の宣言はコメント。
    {
      label: "タグの後の言語宣言を使わない ja キーワード以外の step",
      content: [
        "@x",
        "# language: ja",
        "Feature: f",
        "Scenario: a",
        "  Given g",
        '  """',
        "  Scenario: inner",
        '  """',
        "Scenario: b",
        "  Given h",
      ],
      names: ["a", "b"],
    },
    {
      label: "2 つ目の言語宣言を使わない ja の step",
      content: [
        "# language: ja",
        "# language: en",
        "機能: f",
        "シナリオ: a",
        "  前提g",
        '  """',
        "  シナリオ: inner",
        '  """',
        "シナリオ: b",
        "  前提h",
      ],
      names: ["a", "b"],
    },
  ];

  it.each(steps)("$label では docstring を開き、本文を条件と読まない", ({ content, names }) => {
    expect(parseScenarios(content.join("\n")).map(({ name }) => name)).toEqual(names);
    expect(parseScenarioSteps(content.join("\n")).map(({ name }) => name)).toEqual(names);
  });

  it("step の後の閉じていない docstring は従来どおり拒否する", () => {
    expect(() => parseScenarios('Feature: f\nScenario: a\n  Given g\n  """\n  text\n')).toThrow(
      "Unclosed Gherkin docstring",
    );
  });

  it("feature lint は step の docstring を引数として保持する", () => {
    const [scenario] = parseScenarioSteps(
      ["Feature: f", "Scenario: a", "  Given g", "", '  """json', "  {}", '  """'].join("\n"),
    );
    expect(scenario.steps[0].argument).toBe(`docstring:${JSON.stringify(["json", "{}"])}`);
  });
});
