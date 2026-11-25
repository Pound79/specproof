// 表示上の規則で HTML ブロックの開始を判定する。CommonMark の HTML ブロックの種類（1〜7）のうち、
// 実装で読み方が分かれるものは方言として持つ。方言は文書全体に効くので、方言ごとに文書を走査する。

/** HTML ブロックの開始の読み方の違い。 */
export interface Dialect {
  name: string;
  /** type 1（閉じのタグまで続く）のタグ名。 */
  rawNames: readonly string[];
  /** type 4 の `<!` の後に小文字も認めるか（大文字だけなら false）。 */
  declarationLowercase: boolean;
  /** type 6（空行まで続く）のタグ名。 */
  blockNames: ReadonlySet<string>;
}

const BLOCK_NAMES = [
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
];

/** CommonMark 0.31（micromark も同じ）。 */
export const COMMONMARK: Dialect = {
  name: "CommonMark 0.31",
  rawNames: ["script", "pre", "style", "textarea"],
  declarationLowercase: true,
  blockNames: new Set([...BLOCK_NAMES, "search"]),
};

/** GitHub の cmark-gfm（CommonMark 0.29）。 */
export const CMARK_GFM: Dialect = {
  name: "cmark-gfm 0.29",
  rawNames: ["script", "pre", "style"],
  declarationLowercase: false,
  blockNames: new Set([...BLOCK_NAMES, "source"]),
};

/** markdown-it 14（type 1 は CommonMark 0.31、type 4 は大文字だけ）。 */
export const MARKDOWN_IT: Dialect = {
  name: "markdown-it",
  rawNames: ["script", "pre", "style", "textarea"],
  declarationLowercase: false,
  blockNames: new Set([...BLOCK_NAMES, "search"]),
};

// 方言で読み方が変わりうる文字列。どれも含まない文書は、どの方言でも同じに走査される。
const DIALECT_SENSITIVE = /textarea|search|source|<![a-z]/i;

/** 走査する方言。方言で読み方が変わりうる文字列を含まなければ CommonMark だけ。 */
export const dialectsFor = (content: string): readonly Dialect[] =>
  DIALECT_SENSITIVE.test(content) ? [COMMONMARK, CMARK_GFM, MARKDOWN_IT] : [COMMONMARK];

/** 閉じの記号で終わる HTML ブロック（type 1〜5）の開始。 */
export interface ClosedHtmlStart {
  kind: "comment" | "html";
  end: (line: string) => boolean;
  closer: string;
}

export type HtmlStart =
  | { type: "closed"; start: ClosedHtmlStart }
  /** 空行で終わる HTML ブロック（type 6・7）。 */
  | { type: "blank" }
  /**
   * 方言や空白の扱いで読み方が分かれる。blank なら、どの読み方でも空行までに終わる（type 6・7 か段落）。
   * false なら閉じのタグまで続く読み方（type 1）がある。
   */
  | { type: "ambiguous"; blank: boolean };

const COMMENT: ClosedHtmlStart = {
  kind: "comment",
  end: (line) => line.includes("-->"),
  closer: "-->",
};
const PROCESSING: ClosedHtmlStart = {
  kind: "html",
  end: (line) => line.includes("?>"),
  closer: "?>",
};
const DECLARATION: ClosedHtmlStart = {
  kind: "html",
  end: (line) => line.includes(">"),
  closer: ">",
};
const CDATA: ClosedHtmlStart = { kind: "html", end: (line) => line.includes("]]>"), closer: "]]>" };

const rawStart = (name: string, dialect: Dialect): ClosedHtmlStart => {
  const closing = new RegExp(`</(?:${dialect.rawNames.join("|")})>`, "i");
  return { kind: "html", end: (line) => closing.test(line), closer: `</${name}>` };
};

// CommonMark の空白（スペースとタブ）と、ほかの実装が空白として扱いうる文字（JavaScript の \s）。
export const isSpaceOrTab = (char: string | undefined): boolean => char === " " || char === "\t";
const isOtherSpace = (char: string | undefined): boolean =>
  char !== undefined && !isSpaceOrTab(char) && /\s/.test(char);

// type 7 の完全なタグだけの行（CommonMark §6.6 の開きタグ・閉じタグと末尾の空白）。空白は CommonMark の
// スペースとタブ。ほかの実装は \v・\f や Unicode の空白も空白として読みうるので、それを含む行は
// 照合せずに読み方が分かれるとみなす（\s で照合すると、属性の値と空白の分け方で後戻りが増える）。
const attribute =
  "(?:[ \\t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \\t]*=[ \\t]*(?:[^\"'=<>`\\x00-\\x20]+|'[^']*'|\"[^\"]*\"))?)";
const COMPLETE_TAG = new RegExp(
  `^(?:<[A-Za-z][A-Za-z0-9-]*${attribute}*[ \\t]*/?>|</[A-Za-z][A-Za-z0-9-]*[ \\t]*>)[ \\t]*$`,
);
const OTHER_SPACE = /[^\S \t]/;

/**
 * 正規表現で照合する行の長さの上限（UTF-16 の単位）。COMPLETE_TAG は属性の繰り返しを後戻りで辿るので、
 * 属性を何百万も並べた行でスタックを使い切る。これより長い行は照合せず、hazards.ts が読み方を決めきれない
 * 行として拒否する。64 Ki 単位の行は、上限の手前で一致しない形でも照合が数十ミリ秒で終わる。
 */
export const MAX_MATCHED_LINE = 64 * 1024;

// type 7 の候補（`<` か `</` と英字で始まり、末尾の空白を除くと `>` で終わる）の読み方。
const completeTag = (content: string): "yes" | "no" | "ambiguous" => {
  if (!/^<\/?[A-Za-z]/.test(content) || content.trimEnd().at(-1) !== ">") return "no";
  if (content.length > MAX_MATCHED_LINE) return "ambiguous";
  if (COMPLETE_TAG.test(content)) return "yes";
  return OTHER_SPACE.test(content) ? "ambiguous" : "no";
};

/**
 * content（字下げとコンテナの記号を除いた行）が HTML ブロックを始めるか。interrupting は段落の
 * 途中か（type 7 は段落を中断できない）。
 */
export const htmlStart = (
  content: string,
  dialect: Dialect,
  interrupting: boolean,
): HtmlStart | undefined => {
  if (content[0] !== "<") return undefined;
  if (content.startsWith("<!--")) return { type: "closed", start: COMMENT };
  if (content.startsWith("<?")) return { type: "closed", start: PROCESSING };
  if (content.startsWith("<![CDATA[")) return { type: "closed", start: CDATA };
  const declaration = dialect.declarationLowercase ? /^<![A-Za-z]/ : /^<![A-Z]/;
  if (declaration.test(content)) return { type: "closed", start: DECLARATION };
  const tag = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(content);
  if (tag === null) return undefined;
  const name = tag[2].toLowerCase();
  const next = content[tag[0].length];
  const delimited = next === undefined || isSpaceOrTab(next) || next === ">";
  if (tag[1] === "" && dialect.rawNames.includes(name)) {
    if (delimited) return { type: "closed", start: rawStart(name, dialect) };
    if (isOtherSpace(next)) return { type: "ambiguous", blank: false };
  }
  if (dialect.blockNames.has(name)) {
    if (delimited || content.startsWith("/>", tag[0].length)) return { type: "blank" };
    if (isOtherSpace(next)) return { type: "ambiguous", blank: true };
  }
  if (interrupting) return undefined;
  const complete = completeTag(content);
  if (complete === "no") return undefined;
  return complete === "yes" ? { type: "blank" } : { type: "ambiguous", blank: true };
};

/** 段落の途中の行が、どこかの実装で type 7 の HTML ブロックとして読まれうるか。 */
export const mayBeCompleteTag = (content: string): boolean => completeTag(content) !== "no";
