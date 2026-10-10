import { describe, expect, it } from "vitest";
import { lintFeatureSet, parseScenarioSteps } from "../feature-lint.js";

const ja = (body: string): string => ["# language: ja", "機能: 配送", "", body].join("\n");

describe("parseScenarioSteps", () => {
  it("かつ・しかし・* は直前の主キーワードとして読む", () => {
    const [scenario] = parseScenarioSteps(
      ja(
        [
          "  シナリオ: 一覧",
          "    前提 ログインしている",
          "    かつ 配送が 3 件ある",
          "    もし 一覧を開く",
          "    ならば 3 件と表示される",
          "    しかし B 社の配送は表示されない",
          "    * 件数が青で表示される",
        ].join("\n"),
      ),
    );
    expect(scenario.steps.map((step) => step.type)).toEqual([
      "given",
      "given",
      "when",
      "then",
      "then",
      "then",
    ]);
  });

  it("docstring と表の行は step として数えない", () => {
    const [scenario] = parseScenarioSteps(
      ja(
        [
          "  シナリオ: 入力",
          "    もし 次の文を入力する",
          '      """',
          "      ならば これは本文",
          '      """',
          "    ならば 次の行が表示される",
          "      | ならば |",
        ].join("\n"),
      ),
    );
    expect(scenario.steps.map((step) => step.text)).toEqual([
      "次の文を入力する",
      "次の行が表示される",
    ]);
  });

  it("英語のキーワードも読む", () => {
    const [scenario] = parseScenarioSteps(
      [
        "Feature: Login",
        "  Scenario: ok",
        "    Given a user",
        "    When they log in",
        "    And wait",
        "    Then home is shown",
      ].join("\n"),
    );
    expect(scenario.steps.map((step) => step.type)).toEqual(["given", "when", "when", "then"]);
  });
});

describe("lintFeatureSet", () => {
  it("確認（ならば）が無いシナリオを missing-then にする", () => {
    const findings = lintFeatureSet([
      {
        path: "features/a.feature",
        content: ja(
          [
            "  シナリオ: 確認が無い",
            "    前提 ログインしている",
            "    もし 一覧を開く",
            "",
            "  シナリオ: 確認がある",
            "    もし 一覧を開く",
            "    ならば 一覧が表示される",
          ].join("\n"),
        ),
      },
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ kind: "missing-then", path: "features/a.feature", line: 4 }),
    ]);
  });

  it("背景の確認はシナリオの確認に数えない", () => {
    const findings = lintFeatureSet([
      {
        path: "a.feature",
        content: ja(
          [
            "  背景:",
            "    ならば トップが表示される",
            "",
            "  シナリオ: 操作だけ",
            "    もし 一覧を開く",
          ].join("\n"),
        ),
      },
    ]);
    expect(findings.map((finding) => finding.kind)).toEqual(["missing-then"]);
  });

  it("名前が違っても step の並びが同じシナリオを、ファイルをまたいで duplicate-scenario にする", () => {
    const body = (name: string): string =>
      [
        `  シナリオ: ${name}`,
        "    もし B 社の配送を開く",
        "    ならば  拒否のメッセージが表示される",
      ].join("\n");
    const findings = lintFeatureSet([
      { path: "a.feature", content: ja(body("他社の配送は開けない")) },
      {
        path: "b.feature",
        content: ja(body("他社のデータは見えない").replace("ならば  ", "ならば ")),
      },
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ kind: "duplicate-scenario", path: "b.feature", line: 4 }),
    ]);
    expect(findings[0].message).toContain("a.feature:4");
  });

  it("背景が違えば同じ step でも重複にしない", () => {
    const withBackground = (given: string): string =>
      ja(
        [
          "  背景:",
          `    前提 ${given}`,
          "",
          "  シナリオ: 開く",
          "    もし 一覧を開く",
          "    ならば 一覧が表示される",
        ].join("\n"),
      );
    const findings = lintFeatureSet([
      { path: "a.feature", content: withBackground("管理者でログインしている") },
      { path: "b.feature", content: withBackground("一般ユーザーでログインしている") },
    ]);
    expect(findings).toEqual([]);
  });

  it("Examples を持つシナリオは重複と矛盾の比較から外す", () => {
    const outline = (name: string, value: string): string =>
      [
        `  シナリオアウトライン: ${name}`,
        "    もし <件数> 件ある一覧を開く",
        "    ならば <件数> 件と表示される",
        "    例:",
        "      | 件数 |",
        `      | ${value} |`,
      ].join("\n");
    const findings = lintFeatureSet([
      { path: "a.feature", content: ja(`${outline("少ない", "1")}\n\n${outline("多い", "99")}`) },
    ]);
    expect(findings).toEqual([]);
  });

  it("前提と操作が同じで確認だけが違う組を possible-contradiction にする", () => {
    const findings = lintFeatureSet([
      {
        path: "a.feature",
        content: ja(
          [
            "  シナリオ: 他社の配送は開けない",
            "    前提 A 社でログインしている",
            "    もし B 社の配送を開く",
            "    ならば B 社の項目は表示されない",
            "",
            "  シナリオ: 他社の配送が見える",
            "    前提 A 社でログインしている",
            "    もし B 社の配送を開く",
            "    ならば B 社の項目が表示される",
            "",
            "  シナリオ: 自社の配送は開ける",
            "    前提 A 社でログインしている",
            "    もし A 社の配送を開く",
            "    ならば A 社の項目が表示される",
          ].join("\n"),
        ),
      },
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ kind: "possible-contradiction", path: "a.feature", line: 9 }),
    ]);
    expect(findings[0].message).toContain("a.feature:4");
  });

  it("操作が無いシナリオ同士は矛盾の候補にしない", () => {
    const findings = lintFeatureSet([
      {
        path: "a.feature",
        content: ja(
          [
            "  シナリオ: 初期表示 1",
            "    前提 ログインしている",
            "    ならば 一覧が表示される",
            "",
            "  シナリオ: 初期表示 2",
            "    前提 ログインしている",
            "    ならば 件数が表示される",
          ].join("\n"),
        ),
      },
    ]);
    expect(findings).toEqual([]);
  });

  it("前提・操作・確認の順番が戻る step を step-order にする", () => {
    const findings = lintFeatureSet([
      {
        path: "a.feature",
        content: ja(
          [
            "  シナリオ: 確認のあとに操作",
            "    前提 ログインしている",
            "    ならば 件数が表示される",
            "    もし 一覧を開く",
            "    ならば 一覧が表示される",
            "",
            "  シナリオ: 正しい順番",
            "    前提 ログインしている",
            "    かつ 3 件ある",
            "    もし 一覧を開く",
            "    ならば 3 件と表示される",
            "    かつ 並び順が新しい順になる",
          ].join("\n"),
        ),
      },
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ kind: "step-order", path: "a.feature", line: 7 }),
    ]);
  });

  it("同じファイルの中で名前が同じシナリオを duplicate-scenario-name にする", () => {
    const findings = lintFeatureSet([
      {
        path: "a.feature",
        content: ja(
          [
            "  シナリオ: 件数",
            "    もし 一覧を開く",
            "    ならば 3 件と表示される",
            "",
            "  シナリオ: 件数",
            "    もし 検索する",
            "    ならば 1 件と表示される",
          ].join("\n"),
        ),
      },
      {
        path: "b.feature",
        content: ja(
          ["  シナリオ: 件数", "    もし 絞り込む", "    ならば 2 件と表示される"].join("\n"),
        ),
      },
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ kind: "duplicate-scenario-name", path: "a.feature", line: 8 }),
    ]);
  });

  it("同じパスを 2 回渡しても、自分自身との重複にしない", () => {
    const content = ja(
      ["  シナリオ: 開く", "    もし 一覧を開く", "    ならば 一覧が表示される"].join("\n"),
    );
    expect(
      lintFeatureSet([
        { path: "a.feature", content },
        { path: "a.feature", content },
      ]),
    ).toEqual([]);
  });

  it("報告に引用する名前から制御文字を落とし、長さを切る", () => {
    // 単独の \r を含む行は feature-scan と同じくシナリオとして読まないので、ここでは使わない。
    const name = `\u001b[31m赤\u0007${"長".repeat(500)}`;
    const [finding] = lintFeatureSet([
      { path: "a.feature", content: ja([`  シナリオ: ${name}`, "    もし 一覧を開く"].join("\n")) },
    ]);
    expect(finding.kind).toBe("missing-then");
    expect(finding.message).not.toMatch(/[\u0000-\u001f]/);
    expect(finding.message.length).toBeLessThan(400);
  });
});

describe("誤検知を避ける", () => {
  it("表や docstring の引数だけが違うシナリオは重複・矛盾にしない", () => {
    const withTable = (name: string, value: string, result: string): string =>
      [
        `  Scenario: ${name}`,
        "    When I submit:",
        `      | name | ${value} |`,
        "    Then I see:",
        `      | ${result} |`,
      ].join("\n");
    const withDoc = (name: string, body: string): string =>
      [
        `  Scenario: ${name}`,
        "    When I post:",
        '      """',
        `      ${body}`,
        '      """',
        "    Then it is saved",
      ].join("\n");
    const content = [
      "Feature: f",
      withTable("a", "a", "ok"),
      withTable("b", "b", "error"),
      withDoc("c", '{"a":1}'),
      withDoc("d", '{"a":2}'),
    ].join("\n\n");
    expect(lintFeatureSet([{ path: "a.feature", content }])).toEqual([]);
  });

  it("表まで同じなら重複にする", () => {
    const body = [
      "  Scenario: NAME",
      "    When I submit:",
      "      | name | a |",
      "    Then I see it",
    ].join("\n");
    const content = ["Feature: f", body.replace("NAME", "a"), body.replace("NAME", "b")].join(
      "\n\n",
    );
    expect(lintFeatureSet([{ path: "a.feature", content }]).map((finding) => finding.kind)).toEqual(
      ["duplicate-scenario"],
    );
  });

  it("* だけで書いたシナリオは種類が分からないので missing-then と step-order にしない", () => {
    const content = [
      "Feature: f",
      "  Scenario: s",
      "    * I open the page",
      "    * I see the title",
    ].join("\n");
    expect(lintFeatureSet([{ path: "a.feature", content }])).toEqual([]);
  });

  it("除外タグ（継承を含む）の付いたシナリオは missing-then にしない", () => {
    const content = [
      "@skip",
      "Feature: f",
      "  # reason: external system",
      "  Scenario: parked",
      "    Given something",
    ].join("\n");
    const other = ["Feature: g", "  @fixme", "  Scenario: later", "    Given other"].join("\n");
    expect(
      lintFeatureSet(
        [
          { path: "a.feature", content },
          { path: "b.feature", content: other },
        ],
        { exemptTags: ["@fixme", "@skip"] },
      ),
    ).toEqual([]);
  });

  it("シナリオ名の重複は Rule ごとに見る", () => {
    const content = [
      "Feature: f",
      "  Rule: r1",
      "    Scenario: happy",
      "      When a",
      "      Then b",
      "    Scenario: happy",
      "      When c",
      "      Then d",
      "  Rule: r2",
      "    Scenario: happy",
      "      When e",
      "      Then f",
    ].join("\n");
    expect(lintFeatureSet([{ path: "a.feature", content }])).toEqual([
      expect.objectContaining({ kind: "duplicate-scenario-name", line: 6 }),
    ]);
  });

  it("Examples の無い Scenario Outline も重複の比較から外す", () => {
    const outline = (name: string): string =>
      [`  Scenario Outline: ${name}`, "    When I open <page>", "    Then it is shown"].join("\n");
    const content = ["Feature: f", outline("a"), outline("b")].join("\n\n");
    expect(lintFeatureSet([{ path: "a.feature", content }])).toEqual([]);
  });
});

describe("悪意のある入力でも時間とメモリが増えすぎない", () => {
  it("途中に単独の \\r がある長い step 行を線形時間で読む", () => {
    const line = `    Given${" ".repeat(200_000)}x\ry`;
    const started = performance.now();
    parseScenarioSteps(["Feature: f", "  Scenario: s", line, "    Then ok"].join("\n"));
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("1 シナリオに大量の step があっても線形時間で読む", () => {
    const steps = Array.from({ length: 40_000 }, (_, i) => `    Given step ${i}`);
    const started = performance.now();
    const [scenario] = parseScenarioSteps(["Feature: f", "  Scenario: s", ...steps].join("\n"));
    expect(scenario.steps).toHaveLength(40_000);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("長い背景 × 多数のシナリオでも、背景をシナリオごとに複製しない", () => {
    const background = Array.from({ length: 2000 }, (_, i) => `    Given precondition ${i}`);
    const scenarios = Array.from({ length: 2000 }, (_, i) =>
      [`  Scenario: s${i}`, `    When action ${i}`, `    Then result ${i}`].join("\n"),
    );
    const content = ["Feature: f", "  Background:", ...background, "", ...scenarios].join("\n");
    const parsed = parseScenarioSteps(content);
    expect(new Set(parsed.map((scenario) => scenario.background)).size).toBe(1);
    const started = performance.now();
    expect(lintFeatureSet([{ path: "a.feature", content }])).toEqual([]);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
