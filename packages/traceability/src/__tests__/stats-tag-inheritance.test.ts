import { describe, expect, it } from "vitest";
import { parseScenarios } from "../feature-scan.js";
import { buildStats } from "../stats.js";

// Gherkin のタグは Feature / Rule / Examples から配下へ継承され、runner は継承したタグでも
// 同じように扱う。静的集計が自身の直前タグしか見ないと、使えないタグや @out-of-scope が残る
// シナリオを見落とし、完了条件を誤って満たす。
const census = (content: string) =>
  buildStats([{ domain: "features/demo.feature", scenarios: parseScenarios(content) }]).totals;

describe("使えないタグと対象外の集計はタグの継承に従う", () => {
  it("Feature の @fixme を配下の全シナリオに適用する", () => {
    const totals = census(`@fixme
Feature: 未完成
  Scenario: 一つ目
    Given 条件
  Scenario: 二つ目
    Given 条件
`);
    expect(totals).toMatchObject({ total: 2, disallowed: 2 });
  });

  it("Feature の @fixme があれば done にしない", () => {
    const report = buildStats([
      {
        domain: "features/demo.feature",
        scenarios: parseScenarios("@fixme\nFeature: 未完成\n  Scenario: 条件\n    Given 条件\n"),
      },
    ]);
    expect(report.done).toBe(false);
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
    expect(totals).toMatchObject({ total: 2, disallowed: 1 });
  });

  it("Rule の @out-of-scope はその Rule の配下だけに適用する", () => {
    const totals = census(`Feature: 規則
  @out-of-scope
  Rule: 外す
    Scenario: 対象
      Given 条件
  Rule: 残す
    Scenario: 対象外
      Given 条件
`);
    expect(totals).toMatchObject({ total: 2, outOfScope: 1 });
  });

  it("Feature の @out-of-scope を配下の全シナリオに適用する", () => {
    const totals = census("@out-of-scope\nFeature: 外す\n  Scenario: 条件\n    Given 条件\n");
    expect(totals).toMatchObject({ total: 1, outOfScope: 1 });
  });

  it("タグとシナリオの間に空行があってもタグを失わない", () => {
    const totals = census(`Feature: 空行
  @fixme

  Scenario: 離れたタグ
    Given 条件
`);
    expect(totals).toMatchObject({ disallowed: 1 });
  });

  it("Outline の一部の Examples だけが @fixme でも、使えないタグとして数える", () => {
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
    expect(totals).toMatchObject({ total: 1, disallowed: 1, cases: 2 });
  });

  it("継承した @skip と自身の @fixme が重なっても 1 条件として数える", () => {
    const totals = census("@skip\nFeature: 重複\n  @fixme\n  Scenario: 条件\n    Given 条件\n");
    expect(totals).toMatchObject({ total: 1, disallowed: 1 });
  });

  it("次の Feature 要素へタグを持ち越さない", () => {
    const totals = census(`Feature: 単一
  @fixme
  Scenario: 残件
    Given 条件
  Scenario: 完成
    Given 条件
`);
    expect(totals).toMatchObject({ total: 2, disallowed: 1 });
  });
});

describe("理由コメントの検査範囲は従来どおり", () => {
  it("Scenario 自身の直前タグだけを tags に残す", () => {
    const [scenario] = parseScenarios(
      "@out-of-scope\nFeature: 継承\n  Scenario: 条件\n    Given 条件\n",
    );
    expect(scenario.tags).toEqual([]);
    expect(scenario.effectiveTags).toEqual(["@out-of-scope"]);
  });
});
