// 英語・日本語の静的センサス用scanner。runnerの合否やシナリオIDは扱わない。
import { matchStep, type StepLanguage } from "./step-keywords.js";

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

// 物理行は LF で分割済み。名前の内部にある CR / Unicode 区切り文字は Gherkin と同じく残す。
export const SCENARIO_RE =
  /^(シナリオアウトライン|シナリオテンプレート|シナリオテンプレ|テンプレ|シナリオ|Scenario Outline|Scenario Template|Scenario|Example)\s*:([^\n]*)$/;
export const FEATURE_RE = /^(Feature|Business Need|Ability|フィーチャ|機能)\s*:/;
export const RULE_RE = /^(Rule|ルール)\s*:/;
export const BACKGROUND_RE = /^(Background|背景)\s*:/;
export const EXAMPLES_RE = /^(Examples|Scenarios|例|サンプル)\s*:/;
// Gherkin と同じ言語指定の書式。キーワードを持たない言語を読むと、全シナリオが 0 件に化ける。
const LANGUAGE_RE = /^#\s*language\s*:\s*([a-zA-Z\-_]+)\s*$/;
const SUPPORTED_LANGUAGES = new Set(["en", "ja"]);

const EN_FEATURE_RE = /^(Feature|Business Need|Ability)\s*:/;
const JA_FEATURE_RE = /^(フィーチャ|機能)\s*:/;

/**
 * runner が読む言語を Feature 行のキーワードで決める。en と ja の Feature キーワードは重ならず、
 * runner は自分の言語（宣言または既定）で Feature 行を読めたときだけ解析できる。`# language:` の
 * 解釈（JS は先勝ち、Dart は後勝ちで書式も異なる）によらず、解析できるファイルでは runner と
 * 同じ言語になる。Feature 行が無ければ undefined。
 */
export const featureLanguage = (content: string): StepLanguage | undefined => {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("@")) continue;
    if (EN_FEATURE_RE.test(trimmed)) return "en";
    if (JA_FEATURE_RE.test(trimmed)) return "ja";
    return undefined;
  }
  return undefined;
};

// Gherkin と同じく、空白に続く # 以降を除き "@" で区切る（"@a@b" は 2 つのタグ）。
const splitTags = (line: string): string[] =>
  line
    .split(/\s#/, 1)[0]
    .split(/\s+/)
    .filter((token) => token.startsWith("@"))
    .flatMap((token) => token.split("@").filter((name) => name !== ""))
    .map((name) => `@${name}`);

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
  // Scenario / Background の step を読める位置か、直前の意味のある行が step か。
  let inSteps = false;
  let stepOpen = false;
  // 言語指定は最初の要素より前のコメントだけが有効。runner によってはタグの後や 2 つ目の
  // 宣言も有効にするため、要素より前の宣言はすべて検査する（見逃すと 0 件に化ける）。
  let inHeader = true;
  // step の判定は lint と同じ規則で決めた言語を使う。
  const language = featureLanguage(content);

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
      // Gherkin と同じく、区切りで始まる行なら後続の文字があっても閉じる。
      if (trimmed.startsWith(docstring)) docstring = undefined;
      continue;
    }
    // Gherkin は step の直後（空行・コメントは挟める）だけで docstring を開く。他は説明文。
    const fence = stepOpen ? trimmed.match(/^("""|```)/) : null;
    if (fence) {
      docstring = fence[1];
      stepOpen = false;
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
      stepOpen = false;
      const tags = splitTags(trimmed);
      pendingTags.push(...tags);
      pendingAllTags.push(...tags);
      pendingStateTags.push(
        ...tags.filter((tag) =>
          ["@draft", "@red-contract", "@human", "@out-of-scope"].includes(tag),
        ),
      );
      continue;
    }
    if (trimmed.startsWith("#")) {
      const declared = inHeader ? trimmed.match(LANGUAGE_RE)?.[1] : undefined;
      if (declared !== undefined && !SUPPORTED_LANGUAGES.has(declared)) {
        throw new Error(`Unsupported Gherkin language "${declared}" (the scanner reads en / ja)`);
      }
      pendingComment = true;
      continue;
    }
    inHeader = false;
    if (FEATURE_RE.test(trimmed)) {
      featureTags = pendingStateTags;
      featureAllTags = pendingAllTags;
      ruleTags = [];
      ruleAllTags = [];
      finishCurrent();
      examples = false;
      inSteps = false;
    } else if (RULE_RE.test(trimmed)) {
      ruleTags = pendingStateTags;
      ruleAllTags = pendingAllTags;
      finishCurrent();
      examples = false;
      inSteps = false;
    } else if (BACKGROUND_RE.test(trimmed)) {
      finishCurrent();
      examples = false;
      inSteps = true;
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
        inSteps = true;
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
        inSteps = false;
      } else if (examples && trimmed.startsWith("|")) {
        if (tableHeader) tableHeader = false;
        else current = { ...current!, caseCount: (current!.caseCount ?? 0) + 1 };
      } else if (examples && tableHeader) {
        // Examples見出しと表の間には説明文を置ける。
      } else {
        examples = false;
      }
    }
    stepOpen = inSteps && matchStep(line.trimStart(), language) !== undefined;
    clearPreamble();
  }
  if (docstring !== undefined) {
    throw new Error("Unclosed Gherkin docstring");
  }
  finishCurrent();
  return scenarios;
};

/** parseScenarios の失敗に、どの feature かを付ける。パスは改行を含みうるので JSON 文字列で示す。 */
export const parseFeatureScenarios = (relPath: string, content: string): ScannedScenario[] => {
  try {
    return parseScenarios(content);
  } catch (error) {
    throw new Error(`${JSON.stringify(relPath)}: ${(error as Error).message}`);
  }
};
