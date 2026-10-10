import { describe, expect, it } from "vitest";
import { buildStats, formatStats, type FeatureScenarios } from "../stats.js";
import type { ScannedScenario } from "../feature-scan.js";

const scenario = (tags: string[]): ScannedScenario => ({
  line: 1,
  name: "s",
  tags,
  hasReasonComment: true,
});

describe("buildStats", () => {
  it("ドメインごとに対象外と使えないタグを数え、TOTAL に合算する", () => {
    const features: FeatureScenarios[] = [
      {
        domain: "features/a.feature",
        scenarios: [scenario([]), scenario(["@slow"]), scenario(["@fixme"])],
      },
      {
        domain: "features/b.feature",
        scenarios: [scenario(["@out-of-scope"]), scenario(["@fixme", "@skip"])],
      },
    ];

    const report = buildStats(features);

    expect(report.domains[0]).toMatchObject({
      domain: "features/a.feature",
      total: 3,
      outOfScope: 0,
      disallowed: 1,
    });
    expect(report.domains[1]).toMatchObject({
      domain: "features/b.feature",
      total: 2,
      outOfScope: 1,
      disallowed: 1, // @fixme と @skip が重なっても 1 条件として数える
    });
    expect(report.totals).toMatchObject({
      domain: "TOTAL",
      total: 5,
      outOfScope: 1,
      disallowed: 2,
    });
    expect(report.done).toBe(false);
  });

  it("実装待ちも使えないタグも無ければ done にする（対象外は妨げない）", () => {
    const report = buildStats([
      {
        domain: "features/a.feature",
        scenarios: [scenario([]), scenario(["@out-of-scope"]), scenario(["@human"])],
      },
    ]);

    expect(report.done).toBe(true);
    expect(report.totals).toMatchObject({
      total: 3,
      outOfScope: 1,
      disallowed: 0,
      verification: { machine: 2, human: 1 },
    });
  });
});

describe("formatStats", () => {
  it("集計と残件の行を出し、GREEN は実行が要ると明示する", () => {
    const out = formatStats(
      buildStats([
        {
          domain: "features/a.feature",
          scenarios: [scenario([]), scenario(["@red-contract"]), scenario(["@fixme"])],
        },
      ]),
    );

    expect(out).toContain(
      "features/a.feature: 3 conditions / 3 cases; phase: draft 0 / pending 1 / complete 2",
    );
    expect(out).toContain("@red-contract remaining: 1");
    expect(out).toContain("tags that switch scenarios off (@fixme / @skip / @fail) remaining: 1");
    expect(out).toContain("GREEN requires running");
  });

  it("残件が無ければ完了の行を出し、使えないタグの行は出さない", () => {
    const out = formatStats(
      buildStats([
        {
          domain: "features/a.feature",
          scenarios: [scenario([]), scenario(["@out-of-scope"])],
        },
      ]),
    );

    expect(out).toContain("@red-contract is 0");
    expect(out).toContain("out-of-scope 1");
    expect(out).not.toContain("tags that switch scenarios off");
  });
});
