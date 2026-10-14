import { describe, expect, it } from "vitest";
import { parseScenarios } from "../feature-scan.js";

describe("parseScenarios", () => {
  // runner はファイルの言語のキーワードだけを読むため、言語ごとのファイルで確かめる。
  it.each([
    [
      "ja",
      "# language: ja\n機能: 例\n\n  @admin\n  シナリオ: 管理者が見える\n    前提 ログイン済み\n",
      "管理者が見える",
      ["@admin"],
    ],
    [
      "en",
      "Feature: example\n\n  @slow @generate\n  Scenario: english one\n    Given a thing\n",
      "english one",
      ["@slow", "@generate"],
    ],
  ])("extracts scenarios with their attached tags (%s keywords)", (_, content, name, tags) => {
    const scenarios = parseScenarios(content);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]).toMatchObject({ name, tags });
  });

  it("marks hasReasonComment when a # comment precedes the scenario block", () => {
    const content = [
      "機能: 例",
      "",
      "# メール確認コードが要るため受け入れ条件から外す",
      "@out-of-scope",
      "シナリオ: リセット完了",
      "  前提 未ログイン",
      "",
      "@out-of-scope",
      "シナリオ: 理由なし",
      "  前提 未ログイン",
    ].join("\n");

    const scenarios = parseScenarios(content);

    expect(scenarios).toHaveLength(2);
    expect(scenarios[0]).toMatchObject({
      tags: ["@out-of-scope"],
      hasReasonComment: true,
    });
    expect(scenarios[1]).toMatchObject({
      tags: ["@out-of-scope"],
      hasReasonComment: false,
    });
  });

  it("handles Scenario Outline and matches neither Examples nor steps", () => {
    const content = [
      "Feature: x",
      "  Scenario Outline: param",
      "    Given <a>",
      "    Examples:",
      "      | a |",
      "      | 1 |",
    ].join("\n");

    const scenarios = parseScenarios(content);

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]).toMatchObject({ name: "param", tags: [] });
  });

  it("returns an empty list for a feature with no scenarios", () => {
    expect(parseScenarios("# language: ja\n機能: 例\n")).toEqual([]);
  });
});
