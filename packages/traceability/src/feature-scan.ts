// 英語・日本語の静的センサス用scanner。runnerの合否やシナリオIDは扱わない。
export interface ScannedScenario {
  /** Scenario キーワードの1始まり行番号。 */
  line: number;
  /** キーワードとコロンより後のタイトル。 */
  name: string;
  /** Scenario自身の直前タグ（理由コメントの検査範囲）。集計は effectiveTags で行う。 */
  tags: string[];
  /** Scenario自身のタグの前に理由コメントがある（既存lintの境界）。 */
  hasReasonComment: boolean;
  /** phase/verificationだけに使う、Feature/Ruleから継承した状態タグ。 */
  effectiveStateTags?: string[];
  /**
   * Gherkin の継承規則で有効なすべてのタグ。Feature・Rule・自身（空行を挟んだものを含む）・
   * Examples のタグを合わせる。runner と同じく、fixme / skip の集計はこれで行う。
   * 旧API入力では省略可（その場合は tags で集計する）。
   */
  effectiveTags?: string[];
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
  // 空行で途切れない、次の要素に付くすべてのタグ（Gherkin の付与規則）。
  let pendingAllTags: string[] = [];
  let pendingComment = false;
  let featureTags: string[] = [];
  let ruleTags: string[] = [];
  let featureAllTags: string[] = [];
  let ruleAllTags: string[] = [];
  let current: ScannedScenario | undefined;
  let examples = false;
  let tableHeader = false;
  let docstring: string | undefined;

  // 完成したシナリオだけを返却用配列に追加し、公開する要素は後で変更しない。
  const finishCurrent = (): void => {
    if (current !== undefined) scenarios.push(current);
    current = undefined;
  };

  const clearPreamble = (): void => {
    pendingTags = [];
    pendingStateTags = [];
    pendingAllTags = [];
    pendingComment = false;
  };

  const union = (...groups: string[][]): string[] => [...new Set(groups.flat())];

  for (const [index, line] of content.split("\n").entries()) {
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
    if (trimmed === "") {
      // 集計と状態軸は Gherkin のタグ継承に従い（空行で途切れない）、
      // tags と理由コメントの検査は従来の空行境界を維持する。
      pendingTags = [];
      pendingComment = false;
      continue;
    }
    if (trimmed.startsWith("@")) {
      const tags = trimmed.split(/\s+/).filter((tag) => tag.startsWith("@"));
      pendingTags.push(...tags);
      pendingAllTags.push(...tags);
      pendingStateTags.push(
        ...tags.filter((tag) => ["@draft", "@red-contract", "@human"].includes(tag)),
      );
      continue;
    }
    if (trimmed.startsWith("#")) {
      pendingComment = true;
      continue;
    }
    if (FEATURE_RE.test(trimmed)) {
      featureTags = pendingStateTags;
      featureAllTags = pendingAllTags;
      ruleTags = [];
      ruleAllTags = [];
      finishCurrent();
      examples = false;
    } else if (RULE_RE.test(trimmed)) {
      ruleTags = pendingStateTags;
      ruleAllTags = pendingAllTags;
      finishCurrent();
      examples = false;
    } else if (BACKGROUND_RE.test(trimmed)) {
      finishCurrent();
      examples = false;
    } else {
      const match = trimmed.match(SCENARIO_RE);
      if (match) {
        finishCurrent();
        const outline = /Outline|Template|アウトライン|テンプレ/.test(match[1]);
        current = {
          line: index + 1,
          name: match[2].trim(),
          tags: pendingTags,
          effectiveStateTags: [...new Set([...featureTags, ...ruleTags, ...pendingStateTags])],
          effectiveTags: union(featureAllTags, ruleAllTags, pendingAllTags),
          hasReasonComment: pendingComment,
          caseCount: outline ? 0 : 1,
          exampleTags: [],
        };
        examples = false;
      } else if (current && EXAMPLES_RE.test(trimmed)) {
        // Scenario というキーワードでも、Examples があれば行ごとに展開される。
        current = {
          ...current,
          caseCount: current.exampleTags!.length === 0 ? 0 : current.caseCount,
          exampleTags: [...current.exampleTags!, pendingStateTags],
          // Examples のタグはその行だけに付くが、残件の有無を見落とさないよう条件全体に含める。
          effectiveTags: union(current.effectiveTags ?? [], pendingAllTags),
        };
        examples = true;
        tableHeader = true;
      } else if (examples && /^\|.*\|$/.test(trimmed)) {
        if (tableHeader) tableHeader = false;
        else current = { ...current!, caseCount: (current!.caseCount ?? 0) + 1 };
      } else if (examples && tableHeader) {
        // Examples見出しと表の間には説明文を置ける。
      } else {
        examples = false;
      }
    }
    clearPreamble();
  }
  if (docstring !== undefined) {
    throw new Error("Unclosed Gherkin docstring");
  }
  finishCurrent();
  return scenarios;
};
