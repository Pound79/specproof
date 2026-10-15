// Flutter テンプレートの runner（flutter_gherkin が使う Dart の gherkin 3.1.0）と同じ規則で
// feature を読む。JS の Gherkin とは、キーワードの大文字小文字・step の書式・docstring の区切り・
// Rule の有無・ブロックの終わり方が異なるため、parser.dart と syntax/*.dart・runnables/*.dart を
// 行単位で移植する。runner が例外にする入力は同じく例外にする（黙って 0 件にしない）。

import { printable } from "./display-text.js";

export type DartLanguage = "en" | "ja";

interface Dialect {
  feature: string;
  background: string;
  scenario: string;
  scenarioOutline: string;
  examples: string;
  given: readonly string[];
  when: readonly string[];
  then: readonly string[];
  and: readonly string[];
  but: readonly string[];
}

// languages.dart の en / ja。`*` は Dart の正規表現から除かれる（getMultiDialectRegexPattern）。
const DIALECTS: Record<DartLanguage, Dialect> = {
  en: {
    feature: "Feature|Business Need|Ability",
    background: "Background",
    scenario: "Example|Scenario",
    scenarioOutline: "Scenario Outline|Scenario Template",
    examples: "Examples|Scenarios",
    given: ["Given"],
    when: ["When"],
    then: ["Then"],
    and: ["And"],
    but: ["But"],
  },
  ja: {
    feature: "フィーチャ|機能",
    background: "背景",
    scenario: "シナリオ",
    scenarioOutline: "シナリオアウトライン|シナリオテンプレート|テンプレ|シナリオテンプレ",
    examples: "例|サンプル",
    given: ["前提"],
    when: ["もし"],
    then: ["ならば"],
    and: ["かつ"],
    but: ["しかし", "但し", "ただし"],
  },
};

const stepKeywords = (dialect: Dialect): string[] => [
  ...dialect.given,
  ...dialect.when,
  ...dialect.then,
  ...dialect.and,
  ...dialect.but,
];

// Dart の String.trim は Unicode の White_Space と BOM を除く（JS の trim と違い U+0085 も除く）。
// 正規表現の `^X+|X+$` は空白の連続で二乗時間になるため、両端から添字で走査する。
const isDartSpace = (code: number): boolean =>
  (code >= 0x09 && code <= 0x0d) ||
  code === 0x20 ||
  code === 0x85 ||
  code === 0xa0 ||
  code === 0x1680 ||
  (code >= 0x2000 && code <= 0x200a) ||
  code === 0x2028 ||
  code === 0x2029 ||
  code === 0x202f ||
  code === 0x205f ||
  code === 0x3000 ||
  code === 0xfeff;
const trimBounds = (text: string): [number, number] => {
  let start = 0;
  let end = text.length;
  while (start < end && isDartSpace(text.charCodeAt(start))) start += 1;
  while (end > start && isDartSpace(text.charCodeAt(end - 1))) end -= 1;
  return [start, end];
};
const dartTrim = (text: string): string => text.slice(...trimBounds(text));

// JS の `\s` と `.` が除く行終端。Dart の正規表現も同じ。
const isJsSpace = (char: string): boolean => /\s/.test(char);
const TERMINATOR = /[\n\r\u2028\u2029]/;

// 行の位置を持つ例外。先頭の空行を除いた位置で投げ、parseDartFeature が元の行番号にして文にする。
class LineError extends Error {
  constructor(
    readonly index: number,
    readonly detail: string,
  ) {
    super(detail);
  }
}

// エラーの文に feature の行をそのまま入れない（端末制御文字・長い行）。
const shown = (text: string): string =>
  printable(JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text));

type Kind =
  | "file"
  | "language"
  | "comment"
  | "feature"
  | "background"
  | "tag"
  | "outline"
  | "scenario"
  | "step"
  | "multiline"
  | "empty"
  | "table"
  | "example"
  | "text";

// parser.dart の syntaxMatchers と同じ順序で照合する。
const ORDER: readonly Exclude<Kind, "file">[] = [
  "language",
  "comment",
  "feature",
  "background",
  "tag",
  "outline",
  "scenario",
  "step",
  "multiline",
  "empty",
  "table",
  "example",
  "text",
];

const LANGUAGE = /^\s*#\s*language:\s*([a-z-]{2,16})\s*$/i;

/**
 * `^\s*(?:keyword):\s*(.+)\s*$` と同じ判定を線形で行う（`(.+)\s*$` は空白と行終端で二乗時間になる）。
 * 照合する行は trim 済みで、`.` は行終端に一致しない。見出しが合わなければ undefined、
 * 名前が無ければ name は undefined。
 */
const title = (line: string, prefix: RegExp): { name?: string } | undefined => {
  const head = prefix.exec(line);
  if (head === null) return undefined;
  const rest = line.slice(head[0].length);
  if (rest === "") return {};
  let first = 0;
  while (first < rest.length && isJsSpace(rest[first])) first += 1;
  // trim 済みなので rest の末尾は空白でない。空白でない部分に行終端があれば `.+` が届かない。
  if (first === rest.length || TERMINATOR.test(rest.slice(first))) return undefined;
  return { name: rest.slice(first) };
};

/**
 * `^\s*(\|.*\|)\s*(?:\s*#\s*.*)?$` と同じ判定を線形で行い、表の行（group 1）を返す。
 * `.*` が最も長く取れる `|` を選ぶ（貪欲）。合わなければ undefined。
 */
const tableRow = (line: string): string | undefined => {
  let start = 0;
  while (start < line.length && isJsSpace(line[start])) start += 1;
  if (line[start] !== "|") return undefined;
  const n = line.length;
  // nextNonSpace[i]: i 以降で最初の空白でない位置。lastTerminator: 最後の行終端。
  const nextNonSpace = new Int32Array(n + 1);
  nextNonSpace[n] = n;
  for (let i = n - 1; i >= 0; i -= 1)
    nextNonSpace[i] = isJsSpace(line[i]) ? nextNonSpace[i + 1] : i;
  let lastTerminator = -1;
  let firstTerminator = n;
  for (let i = 0; i < n; i += 1) {
    if (TERMINATOR.test(line[i])) {
      lastTerminator = i;
      if (firstTerminator === n && i > start) firstTerminator = i;
    }
  }
  // `.*` は行終端を越えないので、閉じる `|` は最初の行終端より前に限る。
  for (let j = Math.min(firstTerminator, n) - 1; j > start; j -= 1) {
    if (line[j] !== "|") continue;
    const after = nextNonSpace[j + 1];
    if (after === n) return line.slice(start, j + 1);
    // `# 以降` は空白に続く行終端を許し、それより後の `.*` は行終端を含まない。
    if (
      line[after] === "#" &&
      (lastTerminator <= after || nextNonSpace[after + 1] > lastTerminator)
    ) {
      return line.slice(start, j + 1);
    }
  }
  return undefined;
};

const titlePrefix = (keywords: string): RegExp => new RegExp(`^\\s*(?:${keywords}):`, "i");

const patterns = (dialect: Dialect) => ({
  language: LANGUAGE,
  comment: /^#/i,
  feature: new RegExp(`^(?:${dialect.feature}):\\s*(.+)\\s*`, "i"),
  background: new RegExp(`^\\s*${dialect.background}:(\\s*(.+)\\s*)?`, "i"),
  tag: /^@/i,
  outline: titlePrefix(dialect.scenarioOutline),
  scenario: titlePrefix(dialect.scenario),
  step: new RegExp(`^(${stepKeywords(dialect).join("|")})\\s?.*`, "i"),
  multiline: /^\s*("""|'''|```)\s*$/i,
  empty: /^\s*$/i,
  table: /^/,
  example: titlePrefix(dialect.examples),
  text: /^\s*(?!(\s*#\s*.+)|(\s+)).+$/i,
});

type Patterns = ReturnType<typeof patterns>;

const PATTERNS: Record<DartLanguage, Patterns> = {
  en: patterns(DIALECTS.en),
  ja: patterns(DIALECTS.ja),
};

type Annotating = "examples" | "feature" | "outline" | "scenario" | undefined;

// tag_syntax.dart: 次の行（trim 前）が何の見出しかを、大文字小文字を区別して判定する。
const annotations = (dialect: Dialect): [Annotating, RegExp][] =>
  (
    [
      ["examples", dialect.examples],
      ["feature", dialect.feature],
      ["outline", dialect.scenarioOutline],
      ["scenario", dialect.scenario],
    ] as const
  ).map(([label, keywords]) => [label, new RegExp(`^\\s*(?:${keywords})`)]);
const ANNOTATIONS: Record<DartLanguage, [Annotating, RegExp][]> = {
  en: annotations(DIALECTS.en),
  ja: annotations(DIALECTS.ja),
};
const annotationOf = (nextLine: string, language: DartLanguage): Annotating =>
  ANNOTATIONS[language].find(([, pattern]) => pattern.test(nextLine))?.[0];

const BLOCKS: ReadonlySet<Kind> = new Set([
  "feature",
  "background",
  "outline",
  "scenario",
  "step",
  "multiline",
  "table",
  "example",
]);

/** 各 syntax の hasBlockEnded。親のブロックが、この行の種類で終わるか。 */
const hasBlockEnded = (parent: Kind, kind: Kind, annotating: Annotating): boolean => {
  switch (parent) {
    case "file":
    case "feature":
      return false;
    case "background":
      return kind === "scenario" || kind === "empty" || kind === "tag";
    case "scenario":
      return kind === "scenario" || kind === "outline" || kind === "tag";
    case "outline":
      return (
        kind === "outline" || kind === "scenario" || (kind === "tag" && annotating !== "examples")
      );
    case "step":
      return !(kind === "multiline" || kind === "table");
    case "multiline":
      if (kind === "multiline") return true;
      if (!(kind === "text" || kind === "comment" || kind === "empty")) {
        throw new Error(`Multiline string block does not expect ${kind} syntax`);
      }
      return false;
    case "example":
      return kind !== "table";
    case "table":
      return !(kind === "table" || kind === "comment");
    default:
      return true;
  }
};

export interface DartStep {
  /** 1 始まりの行番号。 */
  line: number;
  /** trim した行全体（キーワードを含む）。 */
  text: string;
  /** 表の行（`|...|`）と docstring の本文を、現れた順に並べる。 */
  args: ({ table: string } | { docstring: string })[];
}

export interface DartScenario {
  /** Scenario / Scenario Outline キーワードの 1 始まり行番号。 */
  line: number;
  name: string;
  outline: boolean;
  /** Feature で保留され、このシナリオ（Outline なら展開した各ケース）に付いたタグ。 */
  assignedTags: string[];
  steps: DartStep[];
  /** Examples ごとのタグと、展開されるケース数。 */
  examples: { tags: string[]; cases: number }[];
}

export interface DartFeature {
  /** Feature 行のキーワードの言語。step の分類に使う。 */
  language: DartLanguage;
  tags: string[];
  background: DartStep[];
  scenarios: DartScenario[];
}

interface Runnable {
  kind: Kind;
  index: number;
  line: string;
  // kind ごとの状態
  name?: string;
  language?: string;
  tags?: string[];
  leading?: number;
  lines?: string[];
  rows?: string[];
  children?: Runnable[];
}

// 各 syntax の isMatch。見出しと表は線形の判定（title / tableRow）を使う。
const isMatch = (kind: Exclude<Kind, "file">, line: string, p: Patterns): boolean => {
  switch (kind) {
    case "outline":
    case "example":
      return title(line, p[kind]) !== undefined;
    case "scenario":
      return title(line, p.scenario)?.name !== undefined;
    case "table":
      return tableRow(line) !== undefined;
    default:
      return p[kind].test(line);
  }
};

const toRunnable = (kind: Kind, line: string, index: number, p: Patterns): Runnable => {
  switch (kind) {
    case "language":
      return { kind, index, line, language: line.match(LANGUAGE)![1] };
    case "feature":
      return { kind, index, line, name: line.match(p.feature)?.[1], children: [] };
    case "background":
      return { kind, index, line, children: [] };
    case "tag": {
      const tags = dartTrim(line)
        .split("@")
        .filter((t) => t !== "")
        .map((t) => `@${dartTrim(t)}`);
      // Dart は `@` だけで区切るので、`@out-of-scope # 理由` は空白を含む 1 つのタグになり状態タグ
      // として働かない。runner と scanner の両方で無効になるため、黙って通さず止める。
      if (tags.some((tag) => /\s/.test(tag))) {
        throw new LineError(
          index,
          "a tag contains whitespace; the Flutter runner reads it as one tag",
        );
      }
      return { kind, index, line, tags };
    }
    case "outline": {
      const name = title(line, p.outline)?.name;
      if (name === undefined) throw new LineError(index, `Scenario outline without a name`);
      return { kind, index, line, name: dartTrim(name), children: [] };
    }
    case "scenario":
      return { kind, index, line, name: title(line, p.scenario)!.name, children: [] };
    case "multiline":
      return { kind, index, line, leading: line.match(/^(\s*)/)![1].length, lines: [] };
    case "table":
      return { kind, index, line, rows: [dartTrim(tableRow(dartTrim(line))!)] };
    default:
      return { kind, index, line, children: [] };
  }
};

/** runnables/*.dart の addChild で受け付ける子。受け付けない子は runner と同じく例外にする。 */
const ACCEPTS: Partial<Record<Kind, ReadonlySet<Kind>>> = {
  file: new Set(["language", "tag", "feature", "comment", "empty"]),
  feature: new Set(["text", "tag", "scenario", "outline", "background", "empty", "comment"]),
  scenario: new Set(["step", "text", "comment", "empty"]),
  background: new Set(["step", "text", "comment", "empty"]),
  outline: new Set(["example", "tag", "step", "text", "comment", "empty"]),
  step: new Set(["multiline", "table"]),
  multiline: new Set(["text", "empty", "comment"]),
  example: new Set(["table", "tag"]),
  table: new Set(["table", "comment"]),
};

const addChild = (parent: Runnable, child: Runnable): void => {
  if (!ACCEPTS[parent.kind]?.has(child.kind)) {
    throw new Error(`Unknown runnable child ${child.kind} given to ${parent.kind}`);
  }
  if (parent.kind === "multiline") {
    if (child.kind === "text") {
      // 開始区切りの字下げの文字数だけ、本文の各行の先頭を削る（multi_line_string.dart）。
      // 行がそれより短いと Dart の substring は範囲外の例外になる。
      if (child.line.length < parent.leading!) {
        throw new LineError(
          child.index,
          `multiline string line is shorter than its delimiter's indentation`,
        );
      }
      parent.lines!.push(child.line.slice(parent.leading));
    } else if (child.kind === "empty") {
      parent.lines!.push("");
    }
    return;
  }
  if (parent.kind === "table") {
    if (child.kind === "table") for (const row of child.rows!) parent.rows!.push(row);
    return;
  }
  if (parent.kind === "step" && child.kind === "table") {
    if (parent.children!.some((c) => c.kind === "table")) {
      throw new Error("Only a single table can be added to a step");
    }
  }
  if (parent.kind === "example" && child.kind === "table") {
    if (parent.children!.some((c) => c.kind === "table")) {
      throw new Error("Only a single table can be added to an example");
    }
  }
  if (parent.kind === "feature" && child.kind === "background") {
    if (parent.children!.some((c) => c.kind === "background")) {
      throw new Error("Feature file can only contain one background block");
    }
  }
  parent.children!.push(child);
};

interface Classified {
  line: string;
  p: Patterns;
  kind: Exclude<Kind, "file">;
  annotating: Annotating;
}

// parser.dart: trim した行に syntaxMatchers を順に当てる。タグは次の行（trim 前）も読む。
const classify = (lines: readonly string[], i: number, language: DartLanguage): Classified => {
  const line = dartTrim(lines[i]);
  const p = PATTERNS[language];
  const kind = ORDER.find((k) => isMatch(k, line, p));
  if (kind === undefined) {
    throw new LineError(i, `unknown or un-implemented syntax ${shown(line)}`);
  }
  let annotating: Annotating;
  if (kind === "tag") {
    // Dart は次の行を無条件に読む。最終行のタグは範囲外で例外になる。
    if (i + 1 >= lines.length) throw new LineError(i, `a tag on the last line`);
    annotating = annotationOf(lines[i + 1], language);
  }
  return { line, p, kind, annotating };
};

// parser.dart の _parseBlock。言語の宣言はこの呼び出しの中だけで効く（値で子へ渡す）。
const parseBlock = (
  language: DartLanguage,
  parentKind: Kind,
  parent: Runnable,
  lines: readonly string[],
  start: number,
): number => {
  let current = language;
  for (let i = start; i < lines.length; i += 1) {
    const { line, p, kind, annotating } = classify(lines, i, current);
    if (hasBlockEnded(parentKind, kind, annotating)) {
      return parentKind === "multiline" && kind === "multiline" ? i : i - 1;
    }
    const untrimmed = kind === "multiline" || parent.kind === "multiline";
    const runnable = toRunnable(kind, untrimmed ? lines[i] : line, i, p);
    if (runnable.kind === "language") {
      const code = runnable.language!;
      if (code !== "en" && code !== "ja") {
        throw new Error(`Unsupported Gherkin language "${code}" (the scanner reads en / ja)`);
      }
      current = code;
    }
    if (kind === "table") {
      // Dart は表の行ごとに入れ子のブロックを作るが、結果は続く表とコメントの行を順に集めるのと
      // 同じ。大きな表で再帰が深くならないよう、反復で集める。
      let next = i + 1;
      for (; next < lines.length; next += 1) {
        const row = classify(lines, next, current);
        if (row.kind !== "table" && row.kind !== "comment") break;
        if (row.kind === "table")
          runnable.rows!.push(toRunnable("table", row.line, next, row.p).rows![0]);
      }
      i = next - 1;
    } else if (BLOCKS.has(kind)) {
      i = parseBlock(current, kind, runnable, lines, i + 1);
    }
    addChild(parent, runnable);
  }
  return lines.length;
};

const stepOf = (step: Runnable, offset: number): DartStep => ({
  line: step.index + offset + 1,
  text: step.line,
  args: step.children!.map((c) =>
    c.kind === "table" ? { table: c.rows!.join("\n") } : { docstring: c.lines!.join("\n") },
  ),
});

// table.dart の _toRow: エスケープされていない `|` で区切り、前後の空白を除き、空のセルを null にする。
const cellsOf = (row: string): (string | null)[] => {
  const columns = dartTrim(row)
    .split(/(?<!\\)\|/)
    .map((cell) => dartTrim(cell).replaceAll("\\|", "|"))
    .map((cell) => (cell === "" ? null : cell))
    .slice(1);
  return columns.slice(0, columns.length - 1);
};

const casesOf = (example: Runnable): number => {
  const table = example.children!.find((c) => c.kind === "table");
  if (table === undefined) throw new LineError(example.index, `Examples without a table`);
  if (table.rows!.length === 1) return 1;
  // 見出しに空のセルがあると、Dart の asMap は null を参照して例外になる。
  if (cellsOf(table.rows![0]).some((cell) => cell === null)) {
    throw new LineError(table.index, `an Examples header has an empty cell`);
  }
  return table.rows!.length - 1;
};

/**
 * Dart の gherkin と同じ規則で feature を読む。Feature が無ければ undefined。
 * runner が例外にする入力は例外にする。行番号は元の内容の 1 始まり。
 */
export const parseDartFeature = (
  content: string,
  configuredLanguage?: string,
): DartFeature | undefined => {
  const [from, to] = trimBounds(content);
  // trim で除いた先頭の行数だけ、行番号をずらす。
  const leading = content.slice(0, from).split(/\r\n|\r|\n/).length - 1;
  const lines = content.slice(from, to).split(/\r\n|\r|\n/);
  // runner は宣言が無ければ既定の言語（設定の language）で読む。設定が無ければ、Feature 行の
  // キーワードの言語とする（runner は既定の言語で Feature 行を読めたときだけ解析できる）。
  let defaultLanguage: DartLanguage;
  if (configuredLanguage === undefined) {
    const firstElement = lines.map(dartTrim).find((l) => l !== "" && !/^[#@]/.test(l)) ?? "";
    defaultLanguage = PATTERNS.ja.feature.test(firstElement) ? "ja" : "en";
  } else if (configuredLanguage === "en" || configuredLanguage === "ja") {
    defaultLanguage = configuredLanguage;
  } else {
    throw new Error(
      `Unsupported Gherkin language ${shown(configuredLanguage)} (the scanner reads en / ja)`,
    );
  }
  try {
    return readFeature(defaultLanguage, lines, leading);
  } catch (error) {
    if (error instanceof LineError) {
      throw new Error(`line ${error.index + leading + 1}: ${error.detail}`);
    }
    throw error;
  }
};

const readFeature = (
  defaultLanguage: DartLanguage,
  lines: readonly string[],
  leading: number,
): DartFeature | undefined => {
  const file: Runnable = { kind: "file", index: -1, line: "", children: [] };
  parseBlock(defaultLanguage, "file", file, lines, 0);

  let pendingFileTags: string[] = [];
  let feature: Runnable | undefined;
  let featureTags: string[] = [];
  for (const child of file.children!) {
    // 1 行のタグが非常に多くても、展開の引数でスタックを溢れさせない。
    if (child.kind === "tag") for (const tag of child.tags!) pendingFileTags.push(tag);
    if (child.kind === "feature") {
      if (feature !== undefined) throw new Error("Only one feature per file is supported");
      feature = child;
      featureTags = pendingFileTags;
      pendingFileTags = [];
    }
  }
  if (feature === undefined) return undefined;
  if (feature.name === undefined) throw new Error("Feature without a name");
  const featureLanguage: DartLanguage = PATTERNS.en.feature.test(dartTrim(feature.line))
    ? "en"
    : "ja";

  const scenarios: DartScenario[] = [];
  let background: DartStep[] = [];
  let pending: string[] = [];
  for (const child of feature.children!) {
    if (child.kind === "tag") for (const tag of child.tags!) pending.push(tag);
    if (child.kind === "background") {
      background = child.children!.filter((c) => c.kind === "step").map((s) => stepOf(s, leading));
    }
    if (child.kind === "scenario" || child.kind === "outline") {
      const outline = child.kind === "outline";
      const examples: { tags: string[]; cases: number }[] = [];
      let exampleTags: string[] | undefined;
      for (const c of child.children!) {
        if (c.kind === "tag") exampleTags = c.tags!;
        if (c.kind === "example") {
          const tags = [
            ...(exampleTags ?? []),
            ...c.children!.filter((t) => t.kind === "tag").flatMap((t) => t.tags!),
          ];
          exampleTags = undefined;
          examples.push({ tags, cases: casesOf(c) });
        }
      }
      if (outline && examples.length === 0) {
        throw new LineError(child.index, `a Scenario outline without an example block`);
      }
      scenarios.push({
        line: child.index + leading + 1,
        name: dartTrim(child.name!),
        outline,
        assignedTags: pending,
        steps: child.children!.filter((c) => c.kind === "step").map((s) => stepOf(s, leading)),
        examples,
      });
      pending = [];
    }
  }
  return { language: featureLanguage, tags: featureTags, background, scenarios };
};

/** Dart の step の行を、種類と本文に分ける。`*` は Dart では step にならない。 */
export const classifyDartStep = (
  text: string,
  language: DartLanguage,
): { kind: "given" | "when" | "then" | "continue"; text: string } => {
  const dialect = DIALECTS[language];
  const groups: ["given" | "when" | "then" | "continue", readonly string[]][] = [
    ["given", dialect.given],
    ["when", dialect.when],
    ["then", dialect.then],
    ["continue", dialect.and],
    ["continue", dialect.but],
  ];
  const lower = text.toLowerCase();
  // 正規表現の選択と同じく、辞書の順に最初に一致したキーワードを使う。
  for (const keyword of stepKeywords(dialect)) {
    if (lower.startsWith(keyword.toLowerCase())) {
      const kind = groups.find(([, words]) => words.includes(keyword))![0];
      return { kind, text: dartTrim(text.slice(keyword.length)) };
    }
  }
  return { kind: "continue", text };
};
