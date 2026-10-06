// 英語・日本語の静的センサス用scanner。runnerの合否やシナリオIDは扱わない。
export interface ScannedScenario {
  /** Scenario キーワードの1始まり行番号。 */
  line: number;
  /** キーワードとコロンより後のタイトル。 */
  name: string;
  /** Scenario自身の直前タグ（従来のfixme/skip・理由lint契約）。 */
  tags: string[];
  /** Scenario自身のタグの前に理由コメントがある（既存lintの境界）。 */
  hasReasonComment: boolean;
  /** phase/verificationだけに使う、Feature/Ruleから継承した状態タグ。 */
  effectiveStateTags?: string[];
  /** 通常Scenarioは1、Examplesがあれば全データ行数。Outlineの初期値は0。旧API入力では省略可。 */
  caseCount?: number;
  /** 条件全体の状態へ投影できないExamplesタグを検査するための情報。 */
  exampleTags?: string[][];
}

const SCENARIO_RE =
  /^(シナリオアウトライン|シナリオテンプレート|シナリオテンプレ|テンプレ|シナリオ|Scenario Outline|Scenario Template|Scenario|Example)\s*:(.*)$/;
const FEATURE_RE = /^(Feature|Business Need|Ability|フィーチャ|機能)\s*:/;
const RULE_RE = /^(Rule|ルール)\s*:/;
const BACKGROUND_RE = /^(Background|背景)\s*:/;
const EXAMPLES_RE = /^(Examples|Scenarios|例|サンプル)\s*:/;

export const parseScenarios = (content: string): ScannedScenario[] => {
  const scenarios: ScannedScenario[] = [];
  let pendingTags: string[] = [];
  let pendingStateTags: string[] = [];
  let pendingComment = false;
  let featureTags: string[] = [];
  let ruleTags: string[] = [];
  let current: ScannedScenario | undefined;
  let outline = false;
  let examples = false;
  let tableHeader = false;
  let docstring: string | undefined;

  const clearPreamble = (): void => {
    pendingTags = [];
    pendingStateTags = [];
    pendingComment = false;
  };

  for (const [index, line] of content.split('\n').entries()) {
    const trimmed = line.trim();
    if (docstring !== undefined) {
      if (trimmed === docstring) docstring = undefined;
      continue;
    }
    const fence = trimmed.match(/^("""|```)/);
    if (fence) {
      docstring = fence[1];
      examples = false;
      clearPreamble();
      continue;
    }
    if (trimmed === '') {
      // 新しい状態軸はGherkinのタグ継承に従い、旧tags/理由lintの空行境界は維持する。
      pendingTags = [];
      pendingComment = false;
      continue;
    }
    if (trimmed.startsWith('@')) {
      const tags = trimmed.split(/\s+/).filter(tag => tag.startsWith('@'));
      pendingTags.push(...tags);
      pendingStateTags.push(...tags.filter(tag => ['@draft', '@red-contract', '@human'].includes(tag)));
      continue;
    }
    if (trimmed.startsWith('#')) {
      pendingComment = true;
      continue;
    }
    if (FEATURE_RE.test(trimmed)) {
      featureTags = pendingStateTags;
      ruleTags = [];
      current = undefined;
      examples = false;
    } else if (RULE_RE.test(trimmed)) {
      ruleTags = pendingStateTags;
      current = undefined;
      examples = false;
    } else if (BACKGROUND_RE.test(trimmed)) {
      current = undefined;
      examples = false;
    } else {
      const match = trimmed.match(SCENARIO_RE);
      if (match) {
        outline = /Outline|Template|アウトライン|テンプレ/.test(match[1]);
        current = {
          line: index + 1,
          name: match[2].trim(),
          tags: pendingTags,
          effectiveStateTags: [...new Set([...featureTags, ...ruleTags, ...pendingStateTags])],
          hasReasonComment: pendingComment,
          caseCount: outline ? 0 : 1,
          exampleTags: [],
        };
        scenarios.push(current);
        examples = false;
      } else if (current && EXAMPLES_RE.test(trimmed)) {
        // Scenario というキーワードでも、Examples があれば行ごとに展開される。
        if (current.exampleTags!.length === 0) current.caseCount = 0;
        current.exampleTags!.push(pendingStateTags);
        examples = true;
        tableHeader = true;
      } else if (examples && /^\|.*\|$/.test(trimmed)) {
        if (tableHeader) tableHeader = false;
        else current!.caseCount! += 1;
      } else if (examples && tableHeader) {
        // Examples見出しと表の間には説明文を置ける。
      } else {
        examples = false;
      }
    }
    clearPreamble();
  }
  if (docstring !== undefined) {
    throw new Error('閉じていないdocstringがあります');
  }
  return scenarios;
};
