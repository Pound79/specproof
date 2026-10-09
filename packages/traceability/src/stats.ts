import type { ScannedScenario } from "./feature-scan.js";
import { OUT_OF_SCOPE_TAG, RETIRED_TAGS } from "./config.js";

// A static scenario census per domain (feature file). Whether a scenario is
// actually GREEN is a runner concern this static engine cannot know.
export interface DomainStats {
  domain: string;
  total: number;
  /** total は条件数。Outline の展開行を別に数える。 */
  cases: number;
  phase: { draft: number; pending: number; complete: number };
  verification: { machine: number; human: number };
  /** @out-of-scope（受け入れ条件から外す宣言）の付いた条件。 */
  outOfScope: number;
  /** 退役した @fixme / @skip が（継承を含めて）付いたままの条件。 */
  retired: number;
}

export interface StatsReport {
  domains: DomainStats[];
  totals: DomainStats;
  // The static half of the done definition: no @red-contract (not implemented
  // yet) remains and no retired tag is left. GREEN runs and human
  // confirmation records are outside this static engine.
  done: boolean;
}

export interface FeatureScenarios {
  domain: string;
  scenarios: ScannedScenario[];
}

const emptyStats = (domain: string): DomainStats => ({
  domain,
  total: 0,
  cases: 0,
  phase: { draft: 0, pending: 0, complete: 0 },
  verification: { machine: 0, human: 0 },
  outOfScope: 0,
  retired: 0,
});

const statsFor = (domain: string, scenarios: ScannedScenario[]): DomainStats => {
  return scenarios.reduce<DomainStats>((stats, scenario) => {
    const stateTags = scenario.effectiveStateTags ?? scenario.tags;
    if (stateTags.includes("@draft") && stateTags.includes("@red-contract")) {
      throw new Error(
        `@draft and @red-contract cannot be combined: ${JSON.stringify(domain)}:${scenario.line}`,
      );
    }
    if (stateTags.includes(OUT_OF_SCOPE_TAG) && stateTags.includes("@red-contract")) {
      throw new Error(
        `${OUT_OF_SCOPE_TAG} and @red-contract cannot be combined (it never runs but blocks done): ${JSON.stringify(domain)}:${scenario.line}`,
      );
    }
    if (
      scenario.exampleTags?.some((example) =>
        example.some((tag) =>
          ["@draft", "@red-contract", "@human", OUT_OF_SCOPE_TAG].includes(tag),
        ),
      )
    ) {
      throw new Error(
        `Put Examples state tags on the scenario instead: ${JSON.stringify(domain)}:${scenario.line}`,
      );
    }
    const phase = stateTags.includes("@draft")
      ? "draft"
      : stateTags.includes("@red-contract")
        ? "pending"
        : "complete";
    const verification = stateTags.includes("@human") ? "human" : "machine";
    // runner と同じく、Feature / Rule / Examples から継承したタグも含めて数える。
    const effective = scenario.effectiveTags ?? scenario.tags;
    return {
      ...stats,
      total: stats.total + 1,
      cases: stats.cases + (scenario.caseCount ?? 1),
      phase: { ...stats.phase, [phase]: stats.phase[phase] + 1 },
      verification: { ...stats.verification, [verification]: stats.verification[verification] + 1 },
      outOfScope: stats.outOfScope + (effective.includes(OUT_OF_SCOPE_TAG) ? 1 : 0),
      retired: stats.retired + (effective.some((tag) => RETIRED_TAGS.includes(tag)) ? 1 : 0),
    };
  }, emptyStats(domain));
};

export const buildStats = (features: FeatureScenarios[]): StatsReport => {
  const domains = features.map((feature) => statsFor(feature.domain, feature.scenarios));
  const totals = domains.reduce<DomainStats>(
    (acc, domain) => ({
      domain: "TOTAL",
      total: acc.total + domain.total,
      cases: acc.cases + domain.cases,
      phase: {
        draft: acc.phase.draft + domain.phase.draft,
        pending: acc.phase.pending + domain.phase.pending,
        complete: acc.phase.complete + domain.phase.complete,
      },
      verification: {
        machine: acc.verification.machine + domain.verification.machine,
        human: acc.verification.human + domain.verification.human,
      },
      outOfScope: acc.outOfScope + domain.outOfScope,
      retired: acc.retired + domain.retired,
    }),
    emptyStats("TOTAL"),
  );
  return { domains, totals, done: totals.phase.pending === 0 && totals.retired === 0 };
};

export const formatStats = (report: StatsReport): string => {
  const row = (stats: DomainStats): string =>
    `  ${stats.domain}: ${stats.total} conditions / ${stats.cases} cases; phase: draft ${stats.phase.draft} / pending ${stats.phase.pending} / complete ${stats.phase.complete}; verification: machine ${stats.verification.machine} / human ${stats.verification.human}; out-of-scope ${stats.outOfScope}`;

  const { totals } = report;
  const pendingLine =
    totals.phase.pending === 0
      ? '@red-contract is 0 — the static half of "done" is met. GREEN runs and human confirmation records are still needed.'
      : `@red-contract remaining: ${totals.phase.pending} — implement them to reach done.`;
  const retiredLine =
    totals.retired === 0
      ? []
      : [
          `retired tags (@fixme / @skip / @fail) remaining: ${totals.retired} — remove them; use @red-contract, @human or @out-of-scope instead.`,
        ];

  return [
    "Scenario census (static). GREEN requires running the suite.",
    "",
    ...report.domains.map(row),
    "",
    row(totals),
    "",
    pendingLine,
    ...retiredLine,
  ].join("\n");
};
