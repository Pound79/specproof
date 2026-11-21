import type { ScannedScenario } from "./feature-scan.js";
import { printable } from "./display-text.js";

// シナリオが仕様の未決の問いに依存していることを表すタグ。`@question:<ID>` の ID は仕様の側の問いの番号。
// 状態タグではないので、実行と完了の判定は変えない。答えが出たら、人がシナリオを見直してタグを外す。
export const QUESTION_TAG_PREFIX = "@question:";

const FEATURE_LIMIT = 3;
const QUESTION_LIMIT = 20;

export interface SpecQuestion {
  id: string;
  /** その問いに依存するシナリオ（条件）の数。Feature / Rule から継承したタグも数える。 */
  scenarios: number;
  /** そのシナリオを含む feature（パスの順）。 */
  features: string[];
}

const questionIdsOf = (scenario: ScannedScenario): string[] => [
  ...new Set(
    (scenario.effectiveTags ?? scenario.tags)
      .filter((tag) => tag.startsWith(QUESTION_TAG_PREFIX))
      .map((tag) => tag.slice(QUESTION_TAG_PREFIX.length))
      .filter((id) => id.length > 0),
  ),
];

/** 問いの ID ごとに、依存するシナリオの数と feature をまとめる（ID の順）。 */
export const collectSpecQuestions = (
  features: { domain: string; scenarios: ScannedScenario[] }[],
): SpecQuestion[] => {
  const byId = new Map<string, { scenarios: number; features: Set<string> }>();
  for (const feature of features) {
    for (const scenario of feature.scenarios) {
      for (const id of questionIdsOf(scenario)) {
        const current = byId.get(id) ?? { scenarios: 0, features: new Set<string>() };
        byId.set(id, {
          scenarios: current.scenarios + 1,
          features: new Set([...current.features, feature.domain]),
        });
      }
    }
  }
  return [...byId.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, entry]) => ({
      id,
      scenarios: entry.scenarios,
      features: [...entry.features].sort(),
    }));
};

/** テキストの節。問いが無ければ空。 */
export const formatSpecQuestions = (questions: SpecQuestion[]): string[] => {
  if (questions.length === 0) return [];
  const shown = questions.slice(0, QUESTION_LIMIT);
  const hidden = questions.length - shown.length;
  return [
    "",
    "Open spec questions (scenarios that depend on an unanswered spec question):",
    ...shown.map((question) => {
      const listed = question.features.slice(0, FEATURE_LIMIT).join(", ");
      const more = question.features.length - FEATURE_LIMIT;
      return printable(
        `  ${question.id}: ${question.scenarios} scenario(s) in ${listed}${more > 0 ? ` and ${more} more feature(s)` : ""}`,
      );
    }),
    ...(hidden > 0
      ? [`  ...and ${hidden} more question(s) (run with --json for every entry)`]
      : []),
  ];
};
