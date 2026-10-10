import { describe, expect, it } from "vitest";
import { parseScenarios } from "../feature-scan.js";
import { buildStats, formatStats } from "../stats.js";

const census = (content: string) =>
  buildStats([{ domain: "features/demo.feature", scenarios: parseScenarios(content) }]);
describe("S1 静的統計", () => {
  it("英語・日本語とRule/Backgroundの3条件・5ケースを数える", () => {
    const features = [
      {
        domain: "english.feature",
        scenarios: parseScenarios(`Feature: Native contract
  Background:
    Given shared state
      """text/plain
      shared text
      """

  @smoke
  Rule: Values
    Background:
      Given rule state
        | key | value |
        | a   | b     |

    @AC-001 @red-contract
    Scenario Outline: value <input>
      Given input <input>
      When it is read
        """text/plain
        request <input>
        """
      Then result is <output>

      @slow
      Examples: first
        | input | output |
        | one   | yes    |

      Examples: second
        | input | output |
        | two   | no     |
        | three | yes    |

    @AC-002
    Scenario: unchanged condition
      Given input fixed
      Then result is yes
`),
      },
      {
        domain: "japanese.feature",
        scenarios: parseScenarios(`# language: ja
機能: 日本語の正本
  背景:
    前提 共通の状態

  @AC-003
  シナリオ: 日本語の条件
    前提 入力がある
    もし 実行する
    ならば 結果が表示される
`),
      },
    ];
    expect(buildStats(features).totals).toMatchObject({
      total: 3,
      cases: 5,
      phase: { draft: 0, pending: 1, complete: 2 },
      verification: { machine: 3, human: 0 },
    });
  });

  it("phase と verification を別軸にし、条件と展開ケースを分ける", () => {
    const report = census(`Feature: 静的な分類
  @draft
  Scenario: 機械ドラフト
    Given 条件
  @draft @human
  Scenario: 人のドラフト
    Given 条件
  @red-contract
  Scenario: 機械pending
    Given 条件
  @red-contract @human
  Scenario: 人のpending
    Given 条件
  Scenario: 機械complete
    Given 条件
  @human
  Scenario: 人のcomplete
    Given 条件
  @red-contract
  Scenario Outline: 展開
    Given <値>
    Examples: 一つ目
      | 値 |
      | 1 |
      | 2 |
    Examples: 二つ目
      | 値 |
      | 3 |
`);
    expect(report.totals).toMatchObject({
      total: 7,
      cases: 9,
      phase: { draft: 2, pending: 3, complete: 2 },
      verification: { machine: 4, human: 3 },
    });
    const output = formatStats(report);
    expect(output.split("\n")).toContain(
      "  TOTAL: 7 conditions / 9 cases; phase: draft 2 / pending 3 / complete 2; verification: machine 4 / human 3; out-of-scope 0",
    );
    expect(output).toContain("7 conditions / 9 cases");
    expect(output).toContain("draft 2 / pending 3 / complete 2");
    expect(output).toContain("machine 4 / human 3");
    expect(output).toContain("GREEN");
  });

  it("Feature/Rule の状態を継承し、次の Rule に漏らさない", () => {
    const report = census(`@human
Feature: 継承
  Scenario: 直下
    Given 条件
  @red-contract
  Rule: 未実装
    Scenario: pending
      Given 条件
  Rule: 完了分類
    Scenario: complete
      Given 条件
`);
    expect(report.totals.phase).toEqual({ draft: 0, pending: 1, complete: 2 });
    expect(report.totals.verification).toEqual({ machine: 0, human: 3 });
  });

  it.each([
    "@draft @red-contract\nScenario: 直接併記",
    "@draft\nFeature: 継承\n@red-contract\nScenario: 継承併記",
    "@draft\nFeature: 継承\n@red-contract\nRule: 継承併記\nScenario: 条件",
  ])("状態の不正併記を成功した集計にしない: %s", (content) => {
    expect(() => census(content)).toThrow(/@draft.*@red-contract/);
  });

  it.each(["@draft", "@red-contract", "@human"])("Examples の %s を条件状態へ変換しない", (tag) => {
    expect(() =>
      census(`Feature: 例
Scenario Outline: 条件
 Given <値>
 ${tag}
 Examples:
  | 値 |
  | 1 |
`),
    ).toThrow(/Examples/);
  });

  it("docstring と step DataTable をケースやシナリオに数えない", () => {
    const scenarios = parseScenarios(`Feature: 構造
Scenario Outline: 実際の条件
 Given 本文
  """
  Scenario: 偽の条件
  Examples:
   | 値 |
   | 99 |
  """
 And 表
  | 値 |
  | 88 |
 Examples:
  | 値 |
  | 1 |
  | 2 |
Scenario Outline: 空のOutline
 Given 条件
`);
    expect(scenarios.map((s) => [s.name, s.caseCount])).toEqual([
      ["実際の条件", 2],
      ["空のOutline", 0],
    ]);
  });

  it("日本語 Outline と複数 Examples を数える", () => {
    expect(
      census(`機能: 日本語
シナリオアウトライン: 条件
 前提 <値>
 例:
  | 値 |
  | 1 |
 例:
  | 値 |
  | 2 |
  | 3 |
`).totals,
    ).toMatchObject({ total: 1, cases: 3 });
  });

  it("Examplesの説明文を挟んだ有効な表のケースを数える", () => {
    expect(
      census(`Feature: 例の説明
Scenario Outline: 条件
 Given <値>
 Examples: 先頭
  この説明は有効なGherkinの記述。
  | 値 |
  | 1 |
  | 2 |
 Examples: 追加
  別の説明。
  | 値 |
  | 3 |
`).totals,
    ).toMatchObject({ total: 1, cases: 3 });
  });

  it("閉じていないdocstringで後続の実装待ちを隠して成功しない", () => {
    expect(() =>
      census(`Feature: 不正な本文
Scenario: 条件
 Given 本文
  """
 @red-contract
 Scenario: 残件
`),
    ).toThrow(/docstring/);
  });

  it("無関係なFeatureコメントでScenarioの対象外理由検査を迂回しない", () => {
    const [scenario] = parseScenarios(`# Featureの一般説明
Feature: 理由の境界
 @out-of-scope
 Scenario: 理由なしの対象外
  Given 条件
`);
    expect(scenario.hasReasonComment).toBe(false);
  });

  it("tags は自身だけ、集計と状態軸は Feature/Rule から継承する", () => {
    const [scenario] = parseScenarios(`@fixme @human
Feature: 互換
 @red-contract
 Rule: 状態
  @slow
  Scenario: 自身のタグ
   Given 条件
`);
    expect(scenario.tags).toEqual(["@slow"]);
    expect(scenario.effectiveStateTags).toEqual(["@human", "@red-contract"]);
    // Feature から継承した @fixme も使えないタグとして数える。
    expect(buildStats([{ domain: "互換.feature", scenarios: [scenario] }]).totals).toMatchObject({
      disallowed: 1,
      outOfScope: 0,
      phase: { pending: 1 },
      verification: { human: 1 },
    });
  });
});
