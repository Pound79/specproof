import type { ScannedScenario } from "./feature-scan.js";
import { DEFAULT_FIXME_TAG, DEFAULT_SKIP_TAG } from "./config.js";

// A static scenario census per domain (feature file). "automated" means the
// scenario carries neither the fixme nor the skip tag — i.e. it is meant to
// run. Whether it is actually GREEN is a runner concern this static engine
// cannot know.
export interface DomainStats {
  domain: string;
  total: number;
  automated: number;
  fixme: number;
  skip: number;
  /** total は条件数。Outline の展開行を別に数える。 */
  cases: number;
  phase: { draft: number; pending: number; complete: number };
  verification: { machine: number; human: number };
}

// The reason-required tags this census classifies by. A repo that renames them
// via `tags.fixme` / `tags.skip` passes its own values here; otherwise the
// canonical "@fixme" / "@skip" defaults apply.
export interface StatsTags {
  fixmeTag: string;
  skipTag: string;
}

export interface StatsReport {
  domains: DomainStats[];
  totals: DomainStats;
  // The machine-checkable half of the done definition (ADR 0002): no fixme-
  // tagged scenarios remain. Remaining skip-tagged ones still require human
  // sign-off, which is not static.
  fixmeClean: boolean;
  // Echoed so formatStats and any consumer render the repo's actual tag names
  // (not the defaults) and classification + labelling never disagree.
  fixmeTag: string;
  skipTag: string;
}

export interface FeatureScenarios {
  domain: string;
  scenarios: ScannedScenario[];
}

// The fixme tag takes priority over the skip tag because fixme is the dimension
// that gates "done" (it must reach 0); a scenario carrying both is counted as
// fixme.
const classify = (scenario: ScannedScenario, tags: StatsTags): "fixme" | "skip" | "automated" => {
  if (scenario.tags.includes(tags.fixmeTag)) {
    return "fixme";
  }
  if (scenario.tags.includes(tags.skipTag)) {
    return "skip";
  }
  return "automated";
};

const emptyStats = (domain: string): DomainStats => ({
  domain,
  total: 0,
  automated: 0,
  fixme: 0,
  skip: 0,
  cases: 0,
  phase: { draft: 0, pending: 0, complete: 0 },
  verification: { machine: 0, human: 0 },
});

const statsFor = (domain: string, scenarios: ScannedScenario[], tags: StatsTags): DomainStats => {
  return scenarios.reduce<DomainStats>((stats, scenario) => {
    const stateTags = scenario.effectiveStateTags ?? scenario.tags;
    if (stateTags.includes("@draft") && stateTags.includes("@red-contract")) {
      throw new Error(
        `@draft and @red-contract cannot be combined: ${JSON.stringify(domain)}:${scenario.line}`,
      );
    }
    if (
      scenario.exampleTags?.some((example) =>
        example.some((tag) => ["@draft", "@red-contract", "@human"].includes(tag)),
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
    const kind = classify(scenario, tags);
    return {
      ...stats,
      total: stats.total + 1,
      [kind]: stats[kind] + 1,
      cases: stats.cases + (scenario.caseCount ?? 1),
      phase: { ...stats.phase, [phase]: stats.phase[phase] + 1 },
      verification: { ...stats.verification, [verification]: stats.verification[verification] + 1 },
    };
  }, emptyStats(domain));
};

export const buildStats = (
  features: FeatureScenarios[],
  tags: Partial<StatsTags> = {},
): StatsReport => {
  const resolved: StatsTags = {
    fixmeTag: tags.fixmeTag ?? DEFAULT_FIXME_TAG,
    skipTag: tags.skipTag ?? DEFAULT_SKIP_TAG,
  };
  const domains = features.map((feature) => statsFor(feature.domain, feature.scenarios, resolved));
  const totals = domains.reduce<DomainStats>(
    (acc, domain) => ({
      domain: "TOTAL",
      total: acc.total + domain.total,
      automated: acc.automated + domain.automated,
      fixme: acc.fixme + domain.fixme,
      skip: acc.skip + domain.skip,
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
    }),
    emptyStats("TOTAL"),
  );
  return {
    domains,
    totals,
    fixmeClean: totals.fixme === 0,
    fixmeTag: resolved.fixmeTag,
    skipTag: resolved.skipTag,
  };
};

export const formatStats = (report: StatsReport): string => {
  const { fixmeTag, skipTag } = report;
  const row = (stats: DomainStats): string =>
    `  ${stats.domain}: ${stats.total} total / ${stats.automated} automated / ${fixmeTag} ${stats.fixme} / ${skipTag} ${stats.skip}`;

  const axes = (stats: DomainStats): string =>
    `    ${stats.total} conditions / ${stats.cases} cases; phase: draft ${stats.phase.draft} / pending ${stats.phase.pending} / complete ${stats.phase.complete}; verification: machine ${stats.verification.machine} / human ${stats.verification.human}`;

  const doneLine = report.fixmeClean
    ? `${fixmeTag} is 0 — the ${fixmeTag} half of "done" is met. Remaining ${skipTag} need human sign-off.`
    : `${fixmeTag} remaining: ${report.totals.fixme} — automate them or demote to ${skipTag} (with a reason) to reach done.`;

  return [
    `Scenario census (static). "automated" = no ${fixmeTag}/${skipTag} tag; GREEN still requires running the suite.`,
    "",
    ...report.domains.flatMap((stats) => [row(stats), axes(stats)]),
    "",
    row(report.totals),
    axes(report.totals),
    "",
    "complete = static classification without a phase tag. GREEN requires an actual suite run.",
    doneLine,
  ].join("\n");
};
