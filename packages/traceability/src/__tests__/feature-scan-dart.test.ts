import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseScenarioSteps } from "../feature-lint.js";
import { parseScenarios } from "../feature-scan.js";
import { computeFileHash } from "../hash.js";
import { buildStats } from "../stats.js";

// Flutter の runner（Dart の gherkin）はキーワードの大文字小文字を区別せず、step のキーワードの
// 後の空白も要らない。JS の Gherkin の規則で読むと step の docstring を開けず、本文を構文として
// 読んで後続の未完了の条件を落とすため、adapter: flutter では Dart と同じ規則で読む。
const documents = (step: string): string =>
  [
    "# language: en",
    "Feature: Documents",
    "  Scenario: Render Markdown",
    `    ${step} a markdown document`,
    '      """',
    "      * item",
    '      """',
    "    Then it is rendered",
    "",
    "  @red-contract",
    "  Scenario: Pending renderer",
    "    Given another document",
    '      """',
    "      pending payload",
    '      """',
    "    Then it is rendered",
    "",
  ].join("\n");

const steps = [
  { label: "小文字の given", value: "given" },
  { label: "タブが続く Given", value: "Given\t" },
  { label: "NBSP が続く Given", value: "Given\u00a0" },
];

describe("adapter: flutter の feature", () => {
  it.each(steps)("$label の docstring を開き、後続の未完了の条件を数える", ({ value }) => {
    const text = documents(value);
    const scenarios = parseScenarios(text, { gherkin: "dart" });
    expect(scenarios.map(({ name }) => name)).toEqual(["Render Markdown", "Pending renderer"]);
    expect(buildStats([{ domain: "f", scenarios }])).toMatchObject({
      totals: { total: 2, phase: { pending: 1 } },
      done: false,
    });
    expect(parseScenarioSteps(text, { gherkin: "dart" }).map(({ name }) => name)).toEqual([
      "Render Markdown",
      "Pending renderer",
    ]);
  });

  it("大文字小文字の異なる Scenario も条件として数える", () => {
    const text = "Feature: f\n  @red-contract\n  scenario: lower\n    Given x\n";
    expect(parseScenarios(text, { gherkin: "dart" })).toMatchObject([
      { name: "lower", effectiveTags: ["@red-contract"] },
    ]);
  });

  it("Outline は Examples の行ごとにケースを数え、Examples のタグを集計に含める", () => {
    const text = [
      "機能: f",
      "  @human",
      "  シナリオアウトライン: o",
      "    前提 <v>",
      "    @red-contract",
      "    例:",
      "      | v |",
      "      | 1 |",
      "      | 2 |",
      "",
    ].join("\n");
    expect(parseScenarios(text, { gherkin: "dart" })).toMatchObject([
      {
        name: "o",
        tags: ["@human"],
        caseCount: 2,
        effectiveStateTags: ["@human"],
        effectiveTags: ["@human", "@red-contract"],
        exampleTags: [["@red-contract"]],
      },
    ]);
  });

  it("runner が解析できない feature は 0 件にせず止める", () => {
    const text =
      'Feature: f\n  Scenario: a\n    Given x\n      """\n      Scenario: fake\n      """\n';
    expect(() => parseScenarios(text, { gherkin: "dart" })).toThrow();
  });

  it("未対応の言語の宣言は止める", () => {
    expect(() =>
      parseScenarios("# language: fr\nFonctionnalité: f\n", { gherkin: "dart" }),
    ).toThrow(/Unsupported Gherkin language "fr"/);
  });

  it("理由コメントとタグを JS の規則と同じく読む", () => {
    const text = "機能: f\n\n  # 理由\n  @out-of-scope\n  シナリオ: a\n    前提 x\n";
    expect(parseScenarios(text, { gherkin: "dart" })).toMatchObject([
      { name: "a", tags: ["@out-of-scope"], hasReasonComment: true },
    ]);
  });

  // Dart の gherkin は `@` だけで区切るので、`@out-of-scope # 理由` は 1 つのタグになり、
  // 状態タグとして働かない。runner と scanner の両方で無効になるため、黙って通さず止める。
  it.each([
    ["コメント付きの状態タグ", "  @out-of-scope # reason"],
    ["空白を含むタグ", "  @red-contract note"],
  ])("%sは止める", (_, tagLine) => {
    const text = `Feature: f\n  # reason\n${tagLine}\n  Scenario: s\n    Given x\n`;
    expect(() => parseScenarios(text, { gherkin: "dart" })).toThrow(/tag contains whitespace/);
  });

  it("空白の無い # を含むタグは runner と同じく 1 つのタグとして読む", () => {
    const text = "Feature: f\n  @issue#42\n  Scenario: s\n    Given x\n";
    expect(parseScenarios(text, { gherkin: "dart" })).toMatchObject([{ tags: ["@issue#42"] }]);
  });

  it("例外の行番号は先頭の空行を含めて数える", () => {
    const text = "\n\nFeature: f\n  Scenario Outline: o\n    Given x\n";
    expect(() => parseScenarios(text, { gherkin: "dart" })).toThrow(/^line 4: /);
  });

  it("docstring の本文が開始区切りより浅いと runner と同じく止める", () => {
    const text = 'Feature: f\n  Scenario: s\n    Given x\n    """\nabc\n    """\n';
    expect(() => parseScenarios(text, { gherkin: "dart" })).toThrow(/shorter than/);
  });

  it("Examples の見出しに空のセルがあると runner と同じく止める", () => {
    const text =
      "Feature: f\n  Scenario Outline: o\n    Given <v>\n    Examples:\n      | v | |\n      | 1 | 2 |\n";
    expect(() => parseScenarios(text, { gherkin: "dart" })).toThrow(/empty cell/);
  });

  it("lint は Dart の step の種類と本文、引数を読む", () => {
    const text = [
      "機能: f",
      "  シナリオ: s",
      "    前提 a",
      "      | x |",
      "    ただし b",
      '      """',
      "      本文",
      '      """',
      "    ならばc",
      "",
    ].join("\n");
    const [scenario] = parseScenarioSteps(text, { gherkin: "dart" });
    expect(
      scenario.steps.map(({ type, text: step, explicit, argument }) => [
        type,
        step,
        explicit,
        argument,
      ]),
    ).toEqual([
      ["given", "a", true, `table:${JSON.stringify(["x"])}`],
      ["given", "b", false, `docstring:${JSON.stringify(["", "本文"])}`],
      ["then", "c", true, ""],
    ]);
  });

  // 空白・行終端・`|` の長い連続で、照合が二乗時間にならない。
  it.each([
    ["step の行", `Feature: f\n  Scenario: s\n    Given a${" ".repeat(200_000)}b\n`],
    ["行終端を含む Scenario の見出し", `Feature: f\n  Scenario: a${" ".repeat(200_000)}\u2028x\n`],
    [
      "多数の | を含む表の行",
      `Feature: f\n  Scenario: s\n    Given x\n      ${"|".repeat(200_000)}x\n`,
    ],
    [
      "空白の続く表の行",
      `Feature: f\n  Scenario: s\n    Given x\n      |a|${" ".repeat(200_000)}x\n`,
    ],
    ["連続するタグ行", `Feature: f\n${"  @a\n".repeat(80_000)}  Scenario: s\n    Given x\n`],
  ])("%sでも線形の時間で読む", (_, text) => {
    const started = performance.now();
    try {
      parseScenarios(text, { gherkin: "dart" });
    } catch {
      // runner が解析できない入力は例外になる。時間だけを見る。
    }
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  // runner は宣言の無い feature を既定の言語（設定の language）で読み、Feature 行を読めなければ
  // 解析できない。scanner も同じ既定の言語で読み、数えずに止める。
  it("設定の既定の言語で Feature 行を読めない feature は止める", () => {
    const text = "Feature: f\n  Scenario: s\n    Given x\n";
    expect(() => parseScenarios(text, { gherkin: "dart", language: "ja" })).toThrow();
    expect(parseScenarios(text, { gherkin: "dart", language: "en" })).toHaveLength(1);
  });

  it("既定の言語が未対応なら止める", () => {
    expect(() => parseScenarios("Feature: f\n", { gherkin: "dart", language: "fr" })).toThrow(
      /Unsupported Gherkin language/,
    );
  });

  it("大きな Examples でもスタックを溢れさせずに数える", () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => `      | ${i} |`);
    const text = [
      "Feature: f",
      "  Scenario Outline: o",
      "    Given <v>",
      "    Examples:",
      "      | v |",
      ...rows,
      "",
    ].join("\n");
    expect(parseScenarios(text, { gherkin: "dart" })).toMatchObject([{ caseCount: 20_000 }]);
  });

  it.each(["js", "dart"] as const)(
    "%s の規則で 1 行に大量のタグがあってもスタックを溢れさせない",
    (gherkin) => {
      const text = `Feature: f\n  ${"@red-contract".repeat(240_000)}\n  Scenario: s\n    Given x\n`;
      expect(parseScenarios(text, { gherkin })[0].effectiveTags).toHaveLength(1);
    },
  );

  it("adapter: flutter の設定では stats の strict 検査が失敗する", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dart-gherkin-"));
    try {
      await mkdir(path.join(root, "features"));
      const feature = path.join(root, "features/documents.feature");
      await writeFile(feature, documents("given"));
      const hash = await computeFileHash(feature);
      await writeFile(
        path.join(root, "specproof.config.yaml"),
        "adapter: flutter\nlayout:\n  featuresDir: features\n",
      );
      await writeFile(
        path.join(root, "traceability.yaml"),
        JSON.stringify({
          version: 1,
          links: [
            {
              id: "documents",
              label: "Documents",
              spec: [],
              impl: [],
              features: [{ path: "features/documents.feature", hash }],
            },
          ],
        }),
      );
      const stats = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("../../dist/cli-stats.js", import.meta.url)),
          "--root",
          root,
          "--strict",
          "--json",
        ],
        { encoding: "utf8" },
      );
      expect.soft(JSON.parse(stats.stdout)).toMatchObject({
        totals: { total: 2, phase: { pending: 1 } },
        done: false,
      });
      expect.soft(stats.status, stats.stderr).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
