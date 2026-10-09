import { describe, expect, it } from "vitest";
import { lintFeatureSet, parseScenarioSteps } from "../feature-lint.js";

const scenario = (name: string, input: string, argument: string[] = []): string =>
  [`  Scenario: ${name}`, `    When ${input}`, ...argument, "    Then it is saved"].join("\n");

const lint = (...scenarios: string[]) =>
  lintFeatureSet([{ path: "input.feature", content: ["Feature: input", ...scenarios].join("\n") }]);

const doc = (body: string[], indent = 6, fence = '"""', mediaType = ""): string[] => {
  const padding = " ".repeat(indent);
  return [`${padding}${fence}${mediaType}`, ...body.map((line) => padding + line), padding + fence];
};

describe("feature lint の入力値を保持する", () => {
  it("step 本文の引用符内の連続空白を同一視しない", () => {
    expect(lint(scenario("a", 'I submit "a  b"'), scenario("b", 'I submit "a b"'))).toEqual([]);
  });

  it("確認文の空白だけが異なる場合も重複ではなく矛盾の候補にする", () => {
    const a = scenario("a", "I submit").replace("it is saved", 'I see "a  b"');
    const b = scenario("b", "I submit").replace("it is saved", 'I see "a b"');
    expect(lint(a, b).map((finding) => finding.kind)).toEqual(["possible-contradiction"]);
  });

  it("docstring の相対インデントが異なる入力を同一視しない", () => {
    expect(
      lint(
        scenario("a", "I submit:", doc(["key:", "  value: 1"])),
        scenario("b", "I submit:", doc(["key:", "value: 1"])),
      ),
    ).toEqual([]);
  });

  it("docstring の末尾空白を保持する", () => {
    expect(
      lint(scenario("a", "I submit:", doc(["value "])), scenario("b", "I submit:", doc(["value"]))),
    ).toEqual([]);
  });

  it("docstring 全体の字下げと区切りだけが違う同じ入力は重複にする", () => {
    expect(
      lint(
        scenario("a", "I submit:", doc(["key:", "  value: 1"])),
        scenario("b", "I submit:", doc(["key:", "  value: 1"], 8, "```")),
      ).map((finding) => finding.kind),
    ).toEqual(["duplicate-scenario"]);
  });

  it("docstring の media type は比較に含める", () => {
    expect(
      lint(
        scenario("a", "I submit:", doc(["value"], 6, '"""', "text/plain")),
        scenario("b", "I submit:", doc(["value"], 6, '"""', "text/markdown")),
      ),
    ).toEqual([]);
  });

  it("docstring の空行を保持し、CRLF と LF のみを同一視する", () => {
    const a = ["Feature: input", scenario("a", "I submit:", doc(["key", "", "value"]))].join("\n");
    const b = a.replace("Scenario: a", "Scenario: b").replaceAll("\n", "\r\n");
    expect(
      lintFeatureSet([
        { path: "a.feature", content: a },
        { path: "b.feature", content: b },
      ]).map((finding) => finding.kind),
    ).toEqual(["duplicate-scenario"]);
    expect(
      lint(
        scenario("a", "I submit:", doc(["key", "", "value"])),
        scenario("b", "I submit:", doc(["key", "value"])),
      ),
    ).toEqual([]);
  });

  it("表のエスケープされたパイプの隣の空白はセル値として保持する", () => {
    expect(
      lint(
        scenario("a", "I submit:", [String.raw`      | a\| b |`]),
        scenario("b", "I submit:", [String.raw`      | a\|b |`]),
      ),
    ).toEqual([]);
  });

  it("表の区切りの周囲の整形用空白だけは無視する", () => {
    expect(
      lint(
        scenario("a", "I submit:", [String.raw`      | a\| b | value |`]),
        scenario("b", "I submit:", [String.raw`      |a\| b|value|`]),
      ).map((finding) => finding.kind),
    ).toEqual(["duplicate-scenario"]);
  });

  it("表の二重バックスラッシュの直後のパイプは区切りとして読む", () => {
    expect(
      lint(
        scenario("a", "I submit:", [String.raw`      | a\\| b |`]),
        scenario("b", "I submit:", [String.raw`      |a\\ |b|`]),
      ).map((finding) => finding.kind),
    ).toEqual(["duplicate-scenario"]);
  });

  it("表の改行エスケープとリテラルのバックスラッシュを同一視しない", () => {
    expect(
      lint(
        scenario("a", "I submit:", [String.raw`      | a\nb |`]),
        scenario("b", "I submit:", [String.raw`      | a\\nb |`]),
      ),
    ).toEqual([]);
  });

  it("背景の引数についても意味のある空白を保持する", () => {
    const content = (body: string) =>
      [
        "Feature: input",
        "  Background:",
        "    Given a document:",
        ...doc([body]),
        scenario("save", "I submit"),
      ].join("\n");
    expect(
      lintFeatureSet([
        { path: "a.feature", content: content("key: value") },
        { path: "b.feature", content: content("  key: value") },
      ]),
    ).toEqual([]);
  });

  it("引数内の改行や制御文字を step の区切りと混同しない", () => {
    const a = [
      "  Scenario: a",
      "    When I submit:",
      ...doc(["body", 'then:extra\u0000"""', "tail"]),
      "    Then it is saved",
    ].join("\n");
    const b = [
      "  Scenario: b",
      "    When I submit:",
      ...doc(["body"]),
      "    Then extra",
      ...doc(["tail"]),
      "    Then it is saved",
    ].join("\n");
    expect(lint(a, b)).toEqual([]);
  });
});

describe("feature lint の確認漏れと計算量", () => {
  it("step が一つもない通常シナリオは確認漏れにする", () => {
    expect(lint("  Scenario: empty").map((finding) => finding.kind)).toEqual(["missing-then"]);
  });

  it("空のシナリオでも除外タグを尊重し、* だけのシナリオは判定しない", () => {
    expect(
      lintFeatureSet(
        [{ path: "input.feature", content: "@skip\nFeature: input\n  Scenario: empty" }],
        { exemptTags: ["@skip"] },
      ),
    ).toEqual([]);
    expect(lint("  Scenario: untyped\n    * I submit\n    * it is saved")).toEqual([]);
  });

  it("表セル内の長い空白列を線形時間で読む", () => {
    const content = [
      "Feature: input",
      scenario("long", "I submit:", [`      | x${" ".repeat(100_000)}y |`]),
    ].join("\n");
    const start = performance.now();
    const [parsed] = parseScenarioSteps(content);
    expect(parsed.steps).toHaveLength(2);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
