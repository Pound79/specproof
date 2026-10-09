import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScenarios } from "../feature-scan.js";
import { buildStats, formatStats } from "../stats.js";

// watch packages/core/test/fixtures/native-contract と同じ bytes を消費する。
// scannerは英語・日本語の静的統計だけを扱う。own IDの解決・pickle・step・
// 背景/引数の投影・runnerタイトル・実行済みGREENは未対応で、ここでは追加しない。
const materials = ["english", "japanese"].map((name) => ({
  name,
  bytes: readFileSync(new URL(`./fixtures/native-contract/${name}.feature`, import.meta.url)),
}));
const features = () =>
  materials.map(({ name, bytes }) => ({
    domain: name,
    scenarios: parseScenarios(bytes.toString("utf8")),
  }));

describe("3リポジトリの共通 native 材料を静的scannerで読む", () => {
  it("英語・日本語の原文 bytes は共有した版と一致する", () => {
    expect(materials.map(({ bytes }) => createHash("sha256").update(bytes).digest("hex"))).toEqual([
      "5c79f6f851660ed0a799661576ae27ecadd047e1fdea610e5a432cde53c547b5",
      "18385b5b24358a4ac2683ee1b06710b68c67a1cc34210c081fdcd649c0603b35",
    ]);
  });

  it("元Scenarioの位置・ownタグと複数Examplesのケース数を読む", () => {
    expect(features()).toEqual([
      {
        domain: "english",
        scenarios: [
          {
            line: 16,
            name: "value <input>",
            tags: ["@AC-001", "@red-contract"],
            hasReasonComment: false,
            effectiveStateTags: ["@red-contract"],
            effectiveTags: ["@smoke", "@AC-001", "@red-contract", "@slow"],
            caseCount: 3,
            exampleTags: [[], []],
          },
          {
            line: 35,
            name: "unchanged condition",
            tags: ["@AC-002"],
            hasReasonComment: false,
            effectiveStateTags: [],
            effectiveTags: ["@smoke", "@AC-002"],
            caseCount: 1,
            exampleTags: [],
          },
        ],
      },
      {
        domain: "japanese",
        scenarios: [
          {
            line: 7,
            name: "日本語の条件",
            tags: ["@AC-003"],
            hasReasonComment: false,
            effectiveStateTags: [],
            effectiveTags: ["@AC-003"],
            caseCount: 1,
            exampleTags: [],
          },
        ],
      },
    ]);
  });

  it("3条件と5ケース、phaseとverificationを別の軸で集計する", () => {
    const stats = buildStats(features());
    expect(stats.totals).toEqual({
      domain: "TOTAL",
      total: 3,
      cases: 5,
      phase: { draft: 0, pending: 1, complete: 2 },
      verification: { machine: 3, human: 0 },
      outOfScope: 0,
      retired: 0,
    });
    expect(stats.domains.map((row) => [row.domain, row.total, row.cases, row.phase])).toEqual([
      ["english", 2, 4, { draft: 0, pending: 1, complete: 1 }],
      ["japanese", 1, 1, { draft: 0, pending: 0, complete: 1 }],
    ]);
    expect(formatStats(stats)).toContain("3 conditions / 5 cases");
    expect(formatStats(stats)).toContain("GREEN requires running the suite");
  });

  it("共通材料のExamples状態タグを条件全体へ投影しない", () => {
    const english = materials[0]!.bytes.toString("utf8");
    for (const tag of ["@draft", "@red-contract", "@human"]) {
      const scanned = parseScenarios(english.replace("@slow", tag));
      expect(() => buildStats([{ domain: "english", scenarios: scanned }])).toThrow("Examples");
    }
  });
});
