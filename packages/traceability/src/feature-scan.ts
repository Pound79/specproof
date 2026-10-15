// 英語・日本語の静的センサス用scanner。runnerの合否やシナリオIDは扱わない。
import { parseDartFeature } from "./dart-gherkin.js";
import { printable } from "./display-text.js";
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

interface ElementPatterns {
  feature: RegExp;
  rule: RegExp;
  background: RegExp;
  /** 1 番目がキーワード、2 番目がタイトル。 */
  scenario: RegExp;
  examples: RegExp;
}

// runner はファイルの言語のキーワードだけを要素とし、キーワードの直後にコロンを要求する。
// 物理行は LF で分割済み。名前の内部にある CR / Unicode 区切り文字は Gherkin と同じく残す。
const EN_SCENARIO = "Scenario Outline|Scenario Template|Scenario|Example";
const JA_SCENARIO = "シナリオアウトライン|シナリオテンプレート|シナリオテンプレ|テンプレ|シナリオ";
const ELEMENT_PATTERNS: Record<StepLanguage | "both", ElementPatterns> = {
  en: {
    feature: /^(Feature|Business Need|Ability):/,
    rule: /^Rule:/,
    background: /^Background:/,
    scenario: new RegExp(`^(${EN_SCENARIO}):([^\\n]*)$`),
    examples: /^(Examples|Scenarios):/,
  },
  ja: {
    feature: /^(フィーチャ|機能):/,
    // runner の Gherkin（現行の辞書）で ja の Rule は ルール だけ。Rule: は説明文。
    rule: /^ルール:/,
    background: /^背景:/,
    scenario: new RegExp(`^(${JA_SCENARIO}):([^\\n]*)$`),
    examples: /^(例|サンプル):/,
  },
  // Feature 行が無く言語を決められないときは両方の言語を読む。
  both: {
    feature: /^(Feature|Business Need|Ability|フィーチャ|機能):/,
    rule: /^(Rule|ルール):/,
    background: /^(Background|背景):/,
    scenario: new RegExp(`^(${JA_SCENARIO}|${EN_SCENARIO}):([^\\n]*)$`),
    examples: /^(Examples|Scenarios|例|サンプル):/,
  },
};

/** ファイルの言語（featureLanguage）の要素キーワード。決まらなければ両方の言語。 */
export const elementPatterns = (language: StepLanguage | undefined): ElementPatterns =>
  ELEMENT_PATTERNS[language ?? "both"];

// Gherkin と同じ言語指定の書式。キーワードを持たない言語を読むと、全シナリオが 0 件に化ける。
// Dart の gherkin は大文字小文字を区別しないため、`# Language:` も宣言として検査する。
const LANGUAGE_RE = /^#\s*language\s*:\s*([a-zA-Z\-_]+)\s*$/i;
const SUPPORTED_LANGUAGES = new Set(["en", "ja"]);

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
    if (ELEMENT_PATTERNS.en.feature.test(trimmed)) return "en";
    if (ELEMENT_PATTERNS.ja.feature.test(trimmed)) return "ja";
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

/** feature を読む規則。js は Playwright の runner（Gherkin）、dart は Flutter の runner（Dart の gherkin）。 */
export type GherkinFlavor = "js" | "dart";

export interface ParseOptions {
  gherkin?: GherkinFlavor;
  /** runner の既定の言語（設定の `language`）。dart の規則で、宣言の無い feature に使う。 */
  language?: string;
}

const STATE_TAGS = ["@draft", "@red-contract", "@human", "@out-of-scope"];
const stateTagsOf = (tags: readonly string[]): string[] =>
  tags.filter((tag) => STATE_TAGS.includes(tag));

/**
 * シナリオの直前の、空行で区切られていないタグ行とコメント行を読む（JS の規則と同じ範囲）。
 * tags と理由コメントの検査は、どちらの runner の規則でも同じ境界で行う。
 */
const preambleOf = (lines: readonly string[], index: number) => {
  const tags: string[][] = [];
  let comment = false;
  for (let i = index - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    // 後ろから集めて最後に逆順にする（unshift はタグ行の数の二乗時間になる）。
    if (trimmed.startsWith("@")) tags.push(splitTags(trimmed));
    else if (trimmed.startsWith("#")) comment = true;
    else break;
  }
  return { tags: tags.reverse().flat(), comment };
};

// Flutter の runner と同じ規則で読む（dart-gherkin.ts）。Rule は Dart の gherkin に無い。
const parseDartScenarios = (content: string, language?: string): ScannedScenario[] => {
  const feature = parseDartFeature(content, language);
  if (feature === undefined) return [];
  const lines = content.split(/\r\n|\r|\n/);
  return feature.scenarios.map((scenario) => {
    const preamble = preambleOf(lines, scenario.line - 1);
    const exampleTags = scenario.examples.map(({ tags }) => stateTagsOf(tags));
    return {
      line: scenario.line,
      name: scenario.name.trim(),
      tags: preamble.tags,
      effectiveStateTags: [...new Set(stateTagsOf([...feature.tags, ...scenario.assignedTags]))],
      effectiveTags: [
        ...new Set([
          ...feature.tags,
          ...scenario.assignedTags,
          ...scenario.examples.flatMap(({ tags }) => tags),
        ]),
      ],
      hasReasonComment: preamble.comment,
      caseCount: scenario.outline
        ? scenario.examples.reduce((sum, { cases }) => sum + cases, 0)
        : 1,
      exampleTags: scenario.outline ? exampleTags : [],
    };
  });
};

export const parseScenarios = (content: string, options: ParseOptions = {}): ScannedScenario[] => {
  if (options.gherkin === "dart") return parseDartScenarios(content, options.language);
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
  const patterns = elementPatterns(language);
  // 2 つ目以降の Feature 行は説明文（Gherkin は 1 ファイル 1 Feature）。
  let featureSeen = false;
  // Background は Feature・Rule ごとに最初の Scenario より前で 1 回だけ要素になる。
  let backgroundAllowed = false;

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
      for (const tag of tags) {
        pendingTags.push(tag);
        pendingAllTags.push(tag);
      }
      for (const tag of tags) {
        if (["@draft", "@red-contract", "@human", "@out-of-scope"].includes(tag)) {
          pendingStateTags.push(tag);
        }
      }
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
    if (!featureSeen && patterns.feature.test(trimmed)) {
      featureSeen = true;
      featureTags = pendingStateTags;
      featureAllTags = pendingAllTags;
      ruleTags = [];
      ruleAllTags = [];
      finishCurrent();
      examples = false;
      inSteps = false;
      backgroundAllowed = true;
    } else if (patterns.rule.test(trimmed)) {
      ruleTags = pendingStateTags;
      ruleAllTags = pendingAllTags;
      finishCurrent();
      examples = false;
      inSteps = false;
      backgroundAllowed = true;
    } else if (backgroundAllowed && patterns.background.test(trimmed)) {
      finishCurrent();
      examples = false;
      inSteps = true;
      backgroundAllowed = false;
    } else {
      const match = trimmed.match(patterns.scenario);
      if (match) {
        finishCurrent();
        backgroundAllowed = false;
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
      } else if (current && patterns.examples.test(trimmed)) {
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
    // step の表の行の後も docstring を開ける（Gherkin は 1 つの step に表と docstring を付けられる）。
    stepOpen =
      inSteps &&
      (matchStep(line.trimStart(), language) !== undefined ||
        (stepOpen && trimmed.startsWith("|")));
    clearPreamble();
  }
  if (docstring !== undefined) {
    throw new Error("Unclosed Gherkin docstring");
  }
  finishCurrent();
  return scenarios;
};

/** parseScenarios の失敗に、どの feature かを付ける。パスは改行を含みうるので JSON 文字列で示す。 */
export const parseFeatureScenarios = (
  relPath: string,
  content: string,
  options: ParseOptions = {},
): ScannedScenario[] => {
  try {
    return parseScenarios(content, options);
  } catch (error) {
    throw new Error(`${printable(JSON.stringify(relPath))}: ${(error as Error).message}`);
  }
};
