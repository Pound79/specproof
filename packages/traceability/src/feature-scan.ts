// A small, locale-aware Gherkin scanner. It is intentionally NOT a full parser:
// it only needs to enumerate scenarios with their attached tags and whether a
// reason comment precedes them — enough for the skip-reason lint and the stats
// census. Supports the keyword sets bdd-kit ships adapters for (English + 日本語).

export interface ScannedScenario {
  /** 1-based line number of the scenario keyword. */
  line: number;
  /** Scenario title (text after the keyword and colon). */
  name: string;
  /** Tags attached to the scenario, e.g. ['@skip', '@admin']. */
  tags: string[];
  /** True when a `#` comment line sits in the scenario's preamble block. */
  hasReasonComment: boolean;
}

// Longer alternatives first so `シナリオアウトライン` wins over `シナリオ` and
// `Scenario Outline` over `Scenario`. `Examples:` (the data table) is not in the
// alternation, so it never matches. Known limitation of this line-level scanner:
// a step whose text starts with `Example:` would be miscounted as a scenario; in
// practice steps start with Given/When/Then/And/But (前提/もし/ならば/かつ).
const SCENARIO_RE =
  /^(シナリオアウトライン|シナリオテンプレート|シナリオ|Scenario Outline|Scenario Template|Scenario|Example)\s*:(.*)$/;

const isTagLine = (line: string): boolean => line.startsWith('@');
const isCommentLine = (line: string): boolean => line.startsWith('#');

export const parseScenarios = (content: string): ScannedScenario[] => {
  const lines = content.split('\n');
  const scenarios: ScannedScenario[] = [];

  // Preamble block: the run of contiguous tag/comment lines directly above a
  // scenario. A blank line (or any other line) breaks it.
  let pendingTags: string[] = [];
  let pendingComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();

    if (trimmed === '') {
      pendingTags = [];
      pendingComment = false;
      continue;
    }
    if (isTagLine(trimmed)) {
      pendingTags = [
        ...pendingTags,
        ...trimmed.split(/\s+/).filter((token) => token.startsWith('@')),
      ];
      continue;
    }
    if (isCommentLine(trimmed)) {
      pendingComment = true;
      continue;
    }

    const match = trimmed.match(SCENARIO_RE);
    if (match) {
      scenarios.push({
        line: index + 1,
        name: match[2].trim(),
        tags: pendingTags,
        hasReasonComment: pendingComment,
      });
    }
    // Any non-blank, non-tag, non-comment line (the scenario itself, a step,
    // Feature:, Background:, …) ends the preamble block.
    pendingTags = [];
    pendingComment = false;
  }

  return scenarios;
};
