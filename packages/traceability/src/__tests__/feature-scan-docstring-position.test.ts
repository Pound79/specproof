import { describe, expect, it } from "vitest";
import { parseScenarioSteps } from "../feature-lint.js";
import { parseScenarios } from "../feature-scan.js";
import { buildStats } from "../stats.js";

// Gherkin は Scenario / Background の step の直後だけで docstring を開く。
// 説明文の区切りを docstring と読むと、後続の条件が黙って集計から消える。
interface DescriptionCase {
  label: string;
  content: string[];
  names: string[];
  /** hidden に効くタグ。既定は @red-contract と @skip。 */
  tags?: string[];
}

const descriptions: DescriptionCase[] = [
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
  // 言語の宣言が無ければ、runner は既定の言語で Feature 行を読めたときだけ解析できる。
  // そのため Feature 行のキーワードの言語が runner の言語で、その言語の step だけが step になる。
  {
    label: "宣言の無い英語のファイルの日本語キーワードで始まる説明文",
    content: [
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
    label: "宣言の無い日本語のファイルの英語キーワードで始まる説明文",
    content: [
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
  {
    label: "タグの後の宣言を使わず Feature 行で決まる日本語のファイル",
    content: [
      "@x",
      "# language: en",
      "機能: f",
      "シナリオ: a",
      "  Given x",
      '  """',
      "@red-contract @skip",
      "シナリオ: hidden",
      "  前提 g",
    ],
    names: ["a", "hidden"],
    tags: ["@x", "@red-contract", "@skip"],
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
    ({ content, names, tags }) => {
      const scenarios = parseScenarios(content.join("\n"));
      expect(scenarios.map(({ name }) => name)).toEqual(names);
      expect(scenarios.find(({ name }) => name === "hidden")?.effectiveTags).toEqual(
        tags ?? ["@red-contract", "@skip"],
      );
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
        "機能: f",
        "背景:",
        "  もし g",
        "  ```",
        "  シナリオ: fake",
        "  ```",
        "@skip",
        "シナリオ: b",
        "  前提 g",
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
    {
      label: "英語の Background の step",
      content: [
        "Feature: f",
        "Background:",
        "  Given g",
        "  ```",
        "  Scenario: fake",
        "  ```",
        "@skip",
        "Scenario: b",
        "  Given g",
      ],
      names: ["b"],
    },
    // Dart の gherkin は宣言を後勝ちで読み、`# language :` を宣言と見なさない。どの runner でも
    // 解析できれば Feature 行の言語が使われた言語なので、宣言の解釈によらず step を判定できる。
    {
      label: "後の宣言が Feature 行と合う英語のファイルの step",
      content: [
        "# language: ja",
        "# language: en",
        "Feature: f",
        "Scenario: a",
        "  Given x",
        '  """',
        "  Scenario: fake",
        '  """',
      ],
      names: ["a"],
    },
    {
      label: "宣言でない言語コメントがある日本語のファイルの step",
      content: [
        "# language : en",
        "機能: f",
        "シナリオ: a",
        "  前提 x",
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

  // 現行の Gherkin は 1 つの step に表と docstring の両方を付けられる。表の後の区切りも
  // docstring として開かないと、本文を構文として読み、後続の未完了の条件を読み飛ばす。
  it("step の表の後の docstring を開き、後続の未完了の条件を数える", () => {
    const text = [
      "Feature: f",
      "Scenario: a",
      "  Given g",
      "    | x |",
      "",
      "    # c",
      '    """',
      "    Given y",
      '    """',
      "@red-contract @skip",
      "Scenario: hidden",
      "  Given h",
      '    """',
      "    z",
      '    """',
    ].join("\n");
    const scenarios = parseScenarios(text);
    expect(scenarios.map(({ name }) => name)).toEqual(["a", "hidden"]);
    expect(buildStats([{ domain: "f", scenarios }])).toMatchObject({
      totals: { phase: { pending: 1 }, disallowed: 1 },
      done: false,
    });
    const [first] = parseScenarioSteps(text);
    expect(first.steps.map(({ text, argument }) => [text, argument])).toEqual([
      ["g", `table:${JSON.stringify(["x"])}\ndocstring:${JSON.stringify(["", "Given y"])}`],
    ]);
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
