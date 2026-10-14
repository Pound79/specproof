import { describe, expect, it } from "vitest";
import { parseScenarios } from "../feature-scan.js";

// scanner の字句解析が runner の Gherkin とずれると、runner が skip するシナリオを
// gate が自動化済みとして数える。タグの区切りと言語指定は Gherkin に合わせる。
describe("タグ行の分割", () => {
  it("空白なしで続けたタグを別々のタグとして読む", () => {
    const [scenario] = parseScenarios("Feature: f\n@smoke@fixme\nScenario: a\n  Given x\n");
    expect(scenario.tags).toEqual(["@smoke", "@fixme"]);
    expect(scenario.effectiveTags).toEqual(["@smoke", "@fixme"]);
  });

  it("行内の空白 + # 以降はコメントとして読まない", () => {
    const [scenario] = parseScenarios("Feature: f\n@smoke #@fixme\nScenario: a\n  Given x\n");
    expect(scenario.effectiveTags).toEqual(["@smoke"]);
  });

  it("Feature に付けた連結タグも継承する", () => {
    const [scenario] = parseScenarios("@a@fixme\nFeature: f\nScenario: a\n  Given x\n");
    expect(scenario.effectiveTags).toEqual(["@a", "@fixme"]);
  });
});

describe("# language: の扱い", () => {
  it.each(["en", "ja", " ja "])("%s は従来どおり読む", (code) => {
    const text = `# language:${code}\nFeature: f\nScenario: a\n  Given x\n`;
    expect(parseScenarios(text)).toHaveLength(1);
  });

  it.each(["fr", "en-pirate", "JA"])("未対応の %s は 0 件にせず止める", (code) => {
    expect(() => parseScenarios(`# language: ${code}\nFonctionnalité: f\n`)).toThrow(
      new RegExp(`Unsupported Gherkin language "${code}"`),
    );
  });

  it("Feature より後のコメントは言語指定として扱わない", () => {
    const text = "Feature: f\n# language: fr\nScenario: a\n  Given x\n";
    expect(parseScenarios(text)).toHaveLength(1);
  });

  // Dart の gherkin は宣言を大文字小文字を区別せずに読む。見逃すと 0 件に化けるので止める。
  it("大文字の Language で書いた未対応の宣言も止める", () => {
    expect(() => parseScenarios("# Language: fr\nFonctionnalité: f\n")).toThrow(
      /Unsupported Gherkin language "fr"/,
    );
  });

  // Dart の gherkin はタグの後と 2 つ目以降の宣言も有効にする。見逃すと 0 件に化けるので止める。
  it.each([
    ["タグの後", "@x\n# language: fr\n"],
    ["2 つ目", "# language: en\n# language: fr\n"],
  ])("%sの未対応の宣言も 0 件にせず止める", (_, header) => {
    expect(() => parseScenarios(`${header}Fonctionnalité: f\n`)).toThrow(
      /Unsupported Gherkin language "fr"/,
    );
  });
});
