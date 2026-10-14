import assert from "node:assert/strict";
import { test } from "vitest";
import { parseScenarios } from "../feature-scan.js";

for (const keyword of [
  "シナリオアウトライン",
  "シナリオテンプレート",
  "シナリオテンプレ",
  "テンプレ",
  "Scenario Outline",
  "Scenario Template",
]) {
  test(`${keyword} の fixme・理由・ケースを取りこぼさない`, () => {
    // runner はファイルの言語のキーワードだけを読むので、Feature と Examples も同じ言語にする。
    const [feature, step, examples] = /^[A-Za-z]/.test(keyword)
      ? ["Feature", "Given", "Examples"]
      : ["機能", "前提", "例"];
    const scanned = parseScenarios(
      `${feature}: 集計\n@fixme\n${keyword}: 未実装\n  ${step} <値>\n  ${examples}:\n    | 値 |\n    | 1 |\n    | 2 |\n    | 3 |\n`,
    );
    assert.equal(scanned.length, 1);
    assert.equal(scanned[0].line, 3);
    assert.equal(scanned[0].name, "未実装");
    assert.deepEqual(scanned[0].tags, ["@fixme"]);
    assert.equal(scanned[0].hasReasonComment, false);
    assert.equal(scanned[0].caseCount, 3);
  });
}
for (const keyword of ["Scenario", "Example", "シナリオ"]) {
  test(`${keyword} も複数 Examples のデータ行数で集計する`, () => {
    const [feature, step, examples] =
      keyword === "シナリオ" ? ["機能", "前提", "例"] : ["Feature", "Given", "Examples"];
    const scanned = parseScenarios(
      `${feature}: counts\n${keyword}: rows\n  ${step} <value>\n  ${examples}: first\n    | value |\n    | 1 |\n    | 2 |\n  @human\n  ${examples}: second\n    | value |\n    | 3 |\n`,
    );
    assert.equal(scanned.length, 1);
    assert.equal(scanned[0].caseCount, 3);
    assert.deepEqual(scanned[0].exampleTags, [[], ["@human"]]);
  });
}
test("Examples のない通常 Scenario は引き続き1ケース", () => {
  assert.equal(parseScenarios("Feature: f\nScenario: one\n Given x\n")[0].caseCount, 1);
});
for (const keyword of ["Scenario", "Scenario Outline"]) {
  test(`${keyword} の空の Examples は実行ケースを作らない`, () => {
    assert.equal(
      parseScenarios(`Feature: f\n${keyword}: none\n Examples:\n  | value |\n`)[0].caseCount,
      0,
    );
  });
}
test("短縮キーワードでも理由コメントを維持し、docstring 中の見出しを無視する", () => {
  const scanned = parseScenarios(
    '機能: f\n# 実装待ち\n@fixme\nテンプレ: 有効\n  前提 ドキュメント\n  """\n  テンプレ: シナリオではない\n  """\n  例:\n    | 値 |\n    | 1 |\n',
  );
  assert.equal(scanned.length, 1);
  assert.equal(scanned[0].hasReasonComment, true);
  assert.equal(scanned[0].caseCount, 1);
});
