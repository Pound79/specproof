import { describe, expect, it } from "vitest";
import { parseScenarios } from "../feature-scan.js";
import { buildStats, formatStats } from "../stats.js";

const reportFor = (tags: string) =>
  buildStats([
    {
      domain: "a.feature",
      scenarios: parseScenarios(
        [tags, "Feature: f", "  Scenario: s", "    When a", "    Then b"].join("\n"),
      ),
    },
  ]);

describe("stats の完了表示と done の整合性", () => {
  for (const tag of ["@fixme", "@skip", "@fail"]) {
    it(`${tag} が継承されて残る場合は完了条件達成を表示しない`, () => {
      const report = reportFor(tag);
      const text = formatStats(report);
      expect(report.done).toBe(false);
      expect(report.totals.phase.pending).toBe(0);
      expect(report.totals.disallowed).toBe(1);
      expect(text).not.toContain('the static half of "done" is met');
      expect(text).toContain('the static half of "done" is not met');
      expect(text).toContain("tags that switch scenarios off");
      expect(text).toContain("remaining: 1");
    });
  }

  it("実装待ちと禁止タグが無い場合は完了条件達成を表示する", () => {
    const report = reportFor("");
    expect(report.done).toBe(true);
    expect(formatStats(report)).toContain('the static half of "done" is met');
  });

  it("実装待ちが残る場合は従来どおり残件を表示する", () => {
    const report = reportFor("@red-contract");
    expect(report.done).toBe(false);
    expect(formatStats(report)).toContain("@red-contract remaining: 1");
    expect(formatStats(report)).not.toContain('the static half of "done" is met');
  });
});
