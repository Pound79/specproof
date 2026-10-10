// .feature の中身の静的 lint。受け入れ条件として壊れている・読みにくいものを決定的に判定する:
//   - missing-then: 確認（Then）が 1 つも無いシナリオ。何も確かめずに通る
//   - step-order: 前提・操作・確認の順番が戻る step
//   - duplicate-scenario-name: 同じファイル・同じ Rule の中で名前が同じシナリオ
//   - duplicate-scenario: 同じ背景で、step の並び（表・docstring の引数を含む）が同じシナリオ
//   - possible-contradiction: 前提と操作が同じなのに確認だけが違うシナリオの組（候補）
// runner の合否は扱わない。英語・日本語のキーワードを読む（feature-scan と同じ範囲）。
import { createHash } from "node:crypto";
import {
  BACKGROUND_RE,
  EXAMPLES_RE,
  FEATURE_RE,
  parseScenarios,
  RULE_RE,
  SCENARIO_RE,
} from "./feature-scan.js";

export type StepType = "given" | "when" | "then";

export interface ParsedStep {
  type: StepType;
  /** キーワードと前後の空白を除いた本文。引用符内などの空白は保持する。 */
  text: string;
  /** step に続く表の行と docstring の本文（無ければ空文字）。比較に含める。 */
  argument: string;
  /** Given / When / Then（前提・もし・ならば）で書かれた。And・But・* は直前の種類を引き継ぐ。 */
  explicit: boolean;
  /** 1 始まりの行番号。 */
  line: number;
}

export interface ParsedScenario {
  name: string;
  /** Scenario キーワードの 1 始まり行番号。 */
  line: number;
  /** 何番目の Rule の中か（Rule の外は 0）。 */
  rule: number;
  /** シナリオ自身の step（背景は含まない）。 */
  steps: readonly ParsedStep[];
  /** このシナリオに効く背景の step（Feature の背景、続いて Rule の背景）。同じ背景のシナリオで共有する。 */
  background: readonly ParsedStep[];
  /** Scenario Outline / Template、または Examples を持つ。値が行ごとに変わるので重複・矛盾の比較から外す。 */
  outline: boolean;
}

export type FeatureLintKind =
  | "missing-then"
  | "step-order"
  | "duplicate-scenario-name"
  | "duplicate-scenario"
  | "possible-contradiction";

export interface FeatureLintFinding {
  kind: FeatureLintKind;
  path: string;
  line: number;
  message: string;
}

// [キーワード, 種類, 本文との間に空白が要るか]。正規表現を使わず先頭一致と slice で読む
// （(.*)$ 型の正規表現は、行の途中に単独の \r などがあると長い行で二乗時間になる）。
const KEYWORDS: ReadonlyArray<readonly [string, StepType | "continue", boolean]> = [
  ["Given", "given", true],
  ["When", "when", true],
  ["Then", "then", true],
  ["And", "continue", true],
  ["But", "continue", true],
  ["*", "continue", true],
  // 日本語のキーワードは本文との間に空白を要しない（Gherkin の ja 辞書）。
  ["前提", "given", false],
  ["もし", "when", false],
  ["ならば", "then", false],
  ["かつ", "continue", false],
  ["且つ", "continue", false],
  ["しかし", "continue", false],
  ["但し", "continue", false],
  ["ただし", "continue", false],
  ["然し", "continue", false],
];

const matchStep = (trimmed: string): { kind: StepType | "continue"; text: string } | undefined => {
  for (const [keyword, kind, needsSpace] of KEYWORDS) {
    if (!trimmed.startsWith(keyword)) continue;
    const rest = trimmed.slice(keyword.length);
    if (needsSpace && !/^\s/.test(rest)) continue;
    return { kind, text: rest.trim() };
  }
  return undefined;
};

// エスケープされていない | だけでセルを区切る。空白列を正規表現で探すと
// セル内の長い空白列で二乗時間になるため、境界は一度だけ走査する。
const tableArgument = (row: string): string => {
  const cells: string[] = [];
  let start = 1;
  for (let index = 1; index < row.length; index += 1) {
    if (row[index] === "\\") {
      index += 1;
    } else if (row[index] === "|") {
      // 整形用空白を除いてから復号する。\n で渡すセル先頭・末尾の改行は残す。
      const cell = row.slice(start, index).trim();
      const value = cell.replace(/\\([\\|n])/g, (_, c: string) => (c === "n" ? "\n" : c));
      cells.push(value);
      start = index + 1;
    }
  }
  return `table:${JSON.stringify(cells)}`;
};

interface DraftDocstring {
  delimiter: string;
  indent: number;
  mediaType: string;
  lines: string[];
}

// 開始区切りの字下げだけを除く。本文の相対インデント・末尾空白は入力値。
const docstringLine = (line: string, docstring: DraftDocstring): string => {
  const text = line.endsWith("\r") ? line.slice(0, -1) : line;
  let start = 0;
  while (start < docstring.indent && (text[start] === " " || text[start] === "\t")) start += 1;
  const escapedDelimiter = [...docstring.delimiter].map((char) => `\\${char}`).join("");
  return text.slice(start).split(escapedDelimiter).join(docstring.delimiter);
};

const OUTLINE_RE = /Outline|Template|アウトライン|テンプレ/;

type Container = "none" | "feature-background" | "rule-background" | "scenario";

// 読み取り中の step。引数（表・docstring）を後から足すので、確定するまで凍結しない。
interface DraftStep {
  type: StepType;
  text: string;
  explicit: boolean;
  line: number;
  argument: string[];
}

const freezeStep = (step: DraftStep): ParsedStep =>
  Object.freeze({
    type: step.type,
    text: step.text,
    explicit: step.explicit,
    line: step.line,
    argument: step.argument.join("\n"),
  });

export const parseScenarioSteps = (content: string): ParsedScenario[] => {
  const scenarios: ParsedScenario[] = [];
  // 読み取り中だけ配列に追記する（毎回コピーすると step 数の二乗になる）。返す値は凍結する。
  let featureBackground: DraftStep[] = [];
  let ruleBackground: DraftStep[] = [];
  // 背景は同じ Feature / Rule のシナリオで共有する。シナリオごとに複製しない。
  let sharedBackground: readonly ParsedStep[] | undefined;
  let rule = 0;
  let container: Container = "none";
  let current: { name: string; line: number; rule: number; outline: boolean } | undefined;
  let currentSteps: DraftStep[] = [];
  let lastStep: DraftStep | undefined;
  let docstring: DraftDocstring | undefined;

  const background = (): readonly ParsedStep[] => {
    sharedBackground ??= Object.freeze([...featureBackground, ...ruleBackground].map(freezeStep));
    return sharedBackground;
  };

  const finish = (): void => {
    if (current !== undefined) {
      scenarios.push({
        ...current,
        steps: Object.freeze(currentSteps.map(freezeStep)),
        background: background(),
      });
    }
    current = undefined;
    currentSteps = [];
    lastStep = undefined;
  };

  for (const [index, line] of content.split("\n").entries()) {
    const trimmed = line.trim();
    if (docstring !== undefined) {
      if (trimmed === docstring.delimiter) {
        lastStep?.argument.push(
          `docstring:${JSON.stringify([docstring.mediaType, docstring.lines.join("\n")])}`,
        );
        docstring = undefined;
      } else {
        docstring.lines.push(docstringLine(line, docstring));
      }
      continue;
    }
    const fence = trimmed.match(/^("""|```)/);
    if (fence) {
      docstring = {
        delimiter: fence[1],
        indent: line.length - line.trimStart().length,
        mediaType: trimmed.slice(fence[1].length).trim(),
        lines: [],
      };
      continue;
    }
    if (trimmed.startsWith("|")) {
      if (lastStep !== undefined) lastStep.argument.push(tableArgument(trimmed));
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("@")) {
      continue;
    }
    if (FEATURE_RE.test(trimmed)) {
      finish();
      featureBackground = [];
      ruleBackground = [];
      sharedBackground = undefined;
      rule = 0;
      container = "none";
      continue;
    }
    if (RULE_RE.test(trimmed)) {
      finish();
      ruleBackground = [];
      sharedBackground = undefined;
      rule += 1;
      container = "none";
      continue;
    }
    if (BACKGROUND_RE.test(trimmed)) {
      finish();
      container = rule > 0 ? "rule-background" : "feature-background";
      continue;
    }
    const scenario = trimmed.match(SCENARIO_RE);
    if (scenario) {
      finish();
      current = {
        name: scenario[2].trim(),
        line: index + 1,
        rule,
        outline: OUTLINE_RE.test(scenario[1]),
      };
      container = "scenario";
      continue;
    }
    if (EXAMPLES_RE.test(trimmed)) {
      if (current !== undefined) current = { ...current, outline: true };
      // Examples の後に step は来ない。表は値の行なので、step の引数にしない。
      container = "none";
      lastStep = undefined;
      continue;
    }
    if (container === "none") continue;
    const step = matchStep(trimmed);
    if (step === undefined) continue; // シナリオ・背景の説明文
    const explicit = step.kind !== "continue";
    const type: StepType = explicit ? (step.kind as StepType) : (lastStep?.type ?? "given");
    const draft: DraftStep = { type, text: step.text, explicit, line: index + 1, argument: [] };
    lastStep = draft;
    if (container === "scenario") {
      currentSteps.push(draft);
    } else {
      (container === "feature-background" ? featureBackground : ruleBackground).push(draft);
      sharedBackground = undefined;
    }
  }
  finish();
  return scenarios;
};

const ORDER: Record<StepType, number> = { given: 0, when: 1, then: 2 };

/** 前提 → 操作 → 確認 の順番が戻る最初の step。かつ・しかしは直前の種類として読む。 */
const outOfOrderStep = (steps: readonly ParsedStep[]): ParsedStep | undefined => {
  let highest = 0;
  for (const step of steps) {
    if (ORDER[step.type] < highest) return step;
    highest = Math.max(highest, ORDER[step.type]);
  }
  return undefined;
};

// JSON の組で区切る。本文や引数の改行・NUL が step の境界に化けないようにする。
const signature = (steps: readonly ParsedStep[]): string =>
  JSON.stringify(steps.map((step) => [step.type, step.text, step.argument]));

// 比較の鍵は全文でなく hash にする。背景の全文をシナリオごとに鍵へ入れると、
// 背景の長さ × シナリオ数でメモリと時間が増える。
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");

interface BackgroundKeys {
  full: string;
  setup: string;
  hasWhen: boolean;
}

const backgroundKeys = (
  cache: WeakMap<readonly ParsedStep[], BackgroundKeys>,
  background: readonly ParsedStep[],
): BackgroundKeys => {
  const cached = cache.get(background);
  if (cached !== undefined) return cached;
  const keys = {
    full: digest(signature(background)),
    setup: digest(signature(background.filter((step) => step.type !== "then"))),
    hasWhen: background.some((step) => step.type === "when"),
  };
  cache.set(background, keys);
  return keys;
};

const MAX_QUOTED = 200;

/** 報告に引用する本文。制御文字（ANSI エスケープ・単独の \r など）を落とし、長さを切る。 */
const quote = (text: string): string => {
  const printable = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "?");
  return printable.length > MAX_QUOTED ? `${printable.slice(0, MAX_QUOTED)}…` : printable;
};

/** シナリオの行番号 → 継承を含むタグ。feature-scan と同じ規則で読む。読めなければ空。 */
const tagsByLine = (content: string): Map<number, readonly string[]> => {
  try {
    return new Map(
      parseScenarios(content).map((scenario) => [
        scenario.line,
        scenario.effectiveTags ?? scenario.tags,
      ]),
    );
  } catch {
    return new Map();
  }
};

export interface FeatureSource {
  /** repo 相対パス。報告にそのまま使う。 */
  path: string;
  content: string;
}

export interface FeatureLintOptions {
  /** このタグ（継承を含む）が付いたシナリオは missing-then にしない（自動化しない印のシナリオ）。 */
  exemptTags?: readonly string[];
}

/**
 * 与えた feature 群をまとめて lint する。重複と矛盾の候補はファイルをまたいで比べ、
 * 後に現れたシナリオの位置で報告する（先のシナリオの位置をメッセージに含める）。
 * 同じパスが複数回渡されたら最初の 1 回だけを読む（自分自身との重複にしない）。
 */
export const lintFeatureSet = (
  sources: readonly FeatureSource[],
  options: FeatureLintOptions = {},
): FeatureLintFinding[] => {
  const exemptTags = options.exemptTags ?? [];
  const findings: FeatureLintFinding[] = [];
  const firstByFull = new Map<string, string>();
  const firstBySetup = new Map<string, { at: string; full: string }>();
  const backgroundCache = new WeakMap<readonly ParsedStep[], BackgroundKeys>();
  const seenPaths = new Set<string>();

  for (const source of sources) {
    if (seenPaths.has(source.path)) continue;
    seenPaths.add(source.path);
    const firstByName = new Map<string, number>();
    const tags = exemptTags.length > 0 ? tagsByLine(source.content) : new Map();
    for (const scenario of parseScenarioSteps(source.content)) {
      const at = `${quote(source.path)}:${scenario.line}`;
      const name = quote(scenario.name);
      const nameKey = `${scenario.rule}\u0000${scenario.name}`;
      const sameName = firstByName.get(nameKey);
      if (sameName === undefined) {
        firstByName.set(nameKey, scenario.line);
      } else {
        findings.push({
          kind: "duplicate-scenario-name",
          path: source.path,
          line: scenario.line,
          message: `scenario "${name}" (${at}) has the same name as ${quote(source.path)}:${sameName}`,
        });
      }
      // * や And だけで書いたシナリオは、step の種類が書かれていないので順番と確認を判定しない。
      const typed = scenario.steps.some((step) => step.explicit);
      const backward = typed ? outOfOrderStep(scenario.steps) : undefined;
      if (backward !== undefined) {
        findings.push({
          kind: "step-order",
          path: source.path,
          line: backward.line,
          message: `step "${quote(backward.text)}" (${quote(source.path)}:${backward.line}) in scenario "${name}" goes back to ${backward.type} after a later keyword — keep Given, When, Then in this order`,
        });
      }
      const hasThen = scenario.steps.some((step) => step.type === "then");
      const exempt = (tags.get(scenario.line) ?? []).some((tag: string) =>
        exemptTags.includes(tag),
      );
      if (!hasThen && (typed || scenario.steps.length === 0) && !exempt) {
        findings.push({
          kind: "missing-then",
          path: source.path,
          line: scenario.line,
          message: `scenario "${name}" (${at}) has no Then step — it passes without checking anything`,
        });
      }
      if (!hasThen || scenario.outline) continue;
      const background = backgroundKeys(backgroundCache, scenario.background);
      const full = digest(`${background.full}\n${signature(scenario.steps)}`);
      const duplicateOf = firstByFull.get(full);
      if (duplicateOf !== undefined) {
        findings.push({
          kind: "duplicate-scenario",
          path: source.path,
          line: scenario.line,
          message: `scenario "${name}" (${at}) has the same Background and steps as ${duplicateOf}`,
        });
        continue;
      }
      firstByFull.set(full, at);
      const ownSetup = scenario.steps.filter((step) => step.type !== "then");
      if (!background.hasWhen && !ownSetup.some((step) => step.type === "when")) continue;
      const setup = digest(`${background.setup}\n${signature(ownSetup)}`);
      const first = firstBySetup.get(setup);
      if (first === undefined) {
        firstBySetup.set(setup, { at, full });
      } else if (first.full !== full) {
        findings.push({
          kind: "possible-contradiction",
          path: source.path,
          line: scenario.line,
          message: `scenario "${name}" (${at}) has the same Given/When as ${first.at} but different Then steps — if they check the same behavior, make sure they do not contradict`,
        });
      }
    }
  }
  return findings;
};
