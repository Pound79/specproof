import { describe, expect, it } from "vitest";
import { parseScenarios } from "../feature-scan.js";
import { buildStats } from "../stats.js";

// Gherkin のタグは Feature / Rule / Examples から配下へ継承され、runner は継承したタグでも
// fixme / skip として扱う。静的集計が自身の直前タグしか見ないと、runner が実行しない
// シナリオを automated と数え、fixme=0 の完了条件を誤って満たす。
const census = (content: string, tags?: { fixmeTag: string; skipTag: string }) =>
  buildStats([{ domain: "features/demo.feature", scenarios: parseScenarios(content) }], tags)
    .totals;

describe("fixme / skip の集計はタグの継承に従う", () => {
  it("Feature の @fixme を配下の全シナリオに適用する", () => {
    const totals = census(`@fixme
Feature: 未完成
  Scenario: 一つ目
    Given 条件
  Scenario: 二つ目
    Given 条件
`);
    expect(totals).toMatchObject({ total: 2, fixme: 2, automated: 0 });
  });

  it("Feature の @fixme があれば fixmeClean にしない", () => {
    const report = buildStats([
      {
        domain: "features/demo.feature",
        scenarios: parseScenarios("@fixme\nFeature: 未完成\n  Scenario: 条件\n    Given 条件\n"),
      },
    ]);
    expect(report.fixmeClean).toBe(false);
  });

  it("Rule の @skip はその Rule の配下だけに適用し、次の Rule に漏らさない", () => {
    const totals = census(`Feature: 規則
  @skip
  Rule: 手動
    Scenario: 対象
      Given 条件
  Rule: 自動
    Scenario: 対象外
      Given 条件
`);
    expect(totals).toMatchObject({ total: 2, skip: 1, automated: 1 });
  });

  it("タグとシナリオの間に空行があってもタグを失わない", () => {
    const totals = census(`Feature: 空行
  @fixme

  Scenario: 離れたタグ
    Given 条件
`);
    expect(totals).toMatchObject({ fixme: 1, automated: 0 });
  });

  it("独自の fixme タグも継承する", () => {
    const totals = census("@todo\nFeature: 残件\n  Scenario: 条件\n    Given 条件\n", {
      fixmeTag: "@todo",
      skipTag: "@manual",
    });
    expect(totals).toMatchObject({ fixme: 1, automated: 0 });
  });

  it("Outline の一部の Examples だけが @fixme でも、残件として数える", () => {
    const totals = census(`Feature: 例
  Scenario Outline: 条件
    Given <値>
    Examples: 完成
      | 値 |
      | 1 |
    @fixme
    Examples: 未完成
      | 値 |
      | 2 |
`);
    expect(totals).toMatchObject({ total: 1, fixme: 1, automated: 0, cases: 2 });
  });

  it("継承した @skip と自身の @fixme が重なれば fixme を優先する", () => {
    const totals = census("@skip\nFeature: 重複\n  @fixme\n  Scenario: 条件\n    Given 条件\n");
    expect(totals).toMatchObject({ fixme: 1, skip: 0 });
  });

  it("次の Feature 要素へタグを持ち越さない", () => {
    const totals = census(`Feature: 単一
  @fixme
  Scenario: 残件
    Given 条件
  Scenario: 完成
    Given 条件
`);
    expect(totals).toMatchObject({ total: 2, fixme: 1, automated: 1 });
  });
});

describe("理由コメントの検査範囲は従来どおり", () => {
  it("Scenario 自身の直前タグだけを tags に残す", () => {
    const [scenario] = parseScenarios("@fixme\nFeature: 継承\n  Scenario: 条件\n    Given 条件\n");
    expect(scenario.tags).toEqual([]);
    expect(scenario.effectiveTags).toEqual(["@fixme"]);
  });
});
