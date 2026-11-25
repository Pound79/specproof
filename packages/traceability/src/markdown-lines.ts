// 表示上の規則（CommonMark の近似）で、1 行がどのブロックを始めるかを読む。走査の状態は持たない
// （状態は markdown-blocks.ts の scanVisible が持つ）。
import { htmlStart, isSpaceOrTab, mayBeCompleteTag, type Dialect } from "./markdown-html.js";

export const indentation = (line: string, offset = 0, column = 0) => {
  while (isSpaceOrTab(line[offset])) {
    column += line[offset] === "\t" ? 4 - (column % 4) : 1;
    offset += 1;
  }
  return { offset, column };
};

// 区切り線（同じ記号 `-`・`_`・`*` が 3 個以上と空白だけ）になる開始位置の範囲。行末から 1 回だけ
// 走査し、空白でない位置 p は first <= p <= last のとき区切り線の開始になる。リスト記号を 1 段ずつ
// 読むたびに残り全体を照合すると、記号を並べた 1 行で二乗の時間がかかるので、この形にする。
export const thematicBreakStarts = (line: string): { first: number; last: number } | undefined => {
  let end = line.length;
  while (end > 0 && isSpaceOrTab(line[end - 1])) end -= 1;
  const char = line[end - 1];
  if (char !== "-" && char !== "_" && char !== "*") return undefined;
  let count = 0;
  let first = end;
  let last = -1;
  for (let i = end - 1; i >= 0; i -= 1) {
    if (line[i] === char) {
      count += 1;
      if (count === 3) last = i;
      first = i;
    } else if (!isSpaceOrTab(line[i])) break;
  }
  return last < 0 ? undefined : { first, last };
};

export type Breaks = ReturnType<typeof thematicBreakStarts>;

export const isThematicBreak = (offset: number, breaks: Breaks): boolean =>
  breaks !== undefined && offset >= breaks.first && offset <= breaks.last;

// setext の下線（`=` か `-` の並びと末尾の空白）。直前が段落のときだけ下線になる。
const setextUnderline = /(?:=+|-+)[ \t]*$/y;
export const isSetextUnderline = (line: string, offset: number): boolean => {
  setextUnderline.lastIndex = offset;
  return setextUnderline.test(line);
};

// CommonMark のリスト項目の本文は、マーカーとそれに続く字下げ（1〜4 列）を基準にする。
// 5 列以上なら 1 列だけが項目の字下げで、残りは本文（例: インデントコード）。
// 段落を中断できる番号付きリストは 1 から始まるものだけで、中身の無い項目は段落を中断しない。
const listMarker = /(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$)/y;
export const listMarkerAt = (line: string, offset: number): string | undefined => {
  listMarker.lastIndex = offset;
  return listMarker.exec(line)?.[0];
};

export const isAtxHeading = (content: string): boolean => /^#{1,6}(?:[ \t]|$)/.test(content);

// 表示上の規則のフェンス（CommonMark §4.5）。content は字下げを除いた行。従来の parseFence と違い、
// バッククォートのフェンスの情報文字列にバッククォートがあればフェンスではなく、閉じのフェンスの後ろに
// 続いてよいのはスペースとタブだけ（JavaScript の trim が除く U+3000 などは続けられない）。U+2028・
// U+2029 は CommonMark では改行でないので、ほかの文字と同じに扱う。
export interface VisibleFence {
  char: string;
  len: number;
}

export const fenceRun = (content: string): VisibleFence | undefined => {
  const char = content[0];
  if (char !== "`" && char !== "~") return undefined;
  let len = 1;
  while (content[len] === char) len += 1;
  return len >= 3 ? { char, len } : undefined;
};

export const openingFence = (content: string): VisibleFence | undefined => {
  const run = fenceRun(content);
  return run !== undefined && run.char === "`" && content.includes("`", run.len) ? undefined : run;
};

export const closesOpening = (content: string, open: VisibleFence): boolean => {
  const run = fenceRun(content);
  if (run === undefined || run.char !== open.char || run.len < open.len) return false;
  for (let i = run.len; i < content.length; i += 1) {
    if (!isSpaceOrTab(content[i])) return false;
  }
  return true;
};

// エラー文に書く閉じのフェンス。長い記号の並びはそのまま書かず、数で示す。
const MAX_QUOTED_FENCE = 16;
export const fenceCloser = ({ char, len }: VisibleFence): string =>
  len <= MAX_QUOTED_FENCE
    ? JSON.stringify(char.repeat(len))
    : `a fence of ${len} ${char === "`" ? "backticks" : "tildes"}`;

// GFM の表の区切りの行になりうる行（`|`・`:`・`-` と空白だけ）。表は GFM だけの構文で、区切りの行が
// 来ると直前の段落の行が表の見出しの行になる。表の後ろの行は段落と読み方が変わりうる。
// 正規表現 `^[|:\- \t]*-[|:\- \t]*$` は `-` の長い並びの後の別の文字で後戻りし二乗の時間がかかるので、
// 1 回の走査で調べる。
export const mayBeTableDelimiter = (content: string, previous: string | undefined): boolean =>
  !/[^|:\- \t]/.test(content) &&
  content.includes("-") &&
  (content.includes("|") || content.includes(":") || previous?.includes("|") === true);

// リンク参照定義（`[label]: url "title"`）になりうる段落の最初の行。定義として読まれると段落は開かず、
// 後ろの行（setext の下線・記号だけの項目など）の読み方が変わる。ラベルや URL・タイトルは次の行に
// 続きうるので、`]` の無い行や URL の無い行も含める。`[!NOTE]` や `[x]: text more` のように、`]:` の
// 無い行や URL の後にタイトルでない文字が続く行は定義にならない。
// 正規表現で書くと空白の長い並びで後戻りが増えるので、1 回だけ走査する。
export const mayBeLinkDefinition = (content: string): boolean => {
  if (content[0] !== "[") return false;
  let i = 1;
  while (i < content.length && content[i] !== "]") i += content[i] === "\\" ? 2 : 1;
  if (i >= content.length) return true;
  if (content[i + 1] !== ":") return false;
  i += 2;
  while (isSpaceOrTab(content[i])) i += 1;
  if (i >= content.length) return true;
  if (content[i] === "<") {
    const close = content.indexOf(">", i);
    if (close < 0) return false;
    i = close + 1;
  } else {
    while (i < content.length && !isSpaceOrTab(content[i])) i += 1;
  }
  const destinationEnd = i;
  while (isSpaceOrTab(content[i])) i += 1;
  if (i >= content.length) return true;
  if (i === destinationEnd) return false;
  const opener = content[i];
  if (opener !== '"' && opener !== "'" && opener !== "(") return false;
  // タイトルがこの行で閉じれば、後ろは空白だけ。閉じなければ次の行に続きうる。
  const closer = opener === "(" ? ")" : opener;
  for (i += 1; i < content.length && content[i] !== closer; i += content[i] === "\\" ? 2 : 1);
  if (i >= content.length) return true;
  for (i += 1; isSpaceOrTab(content[i]); i += 1);
  return i >= content.length;
};

// GFM の脚注の定義（`[^label]: text`）になりうる行。GFM（micromark）では段落を中断し、後ろの字下げした
// 行を含むコンテナになる。CommonMark では段落の文。
export const mayBeFootnoteDefinition = (content: string): boolean =>
  content.startsWith("[^") && content.includes("]:");

// 表の見出しの行（区切りの行の直前の行）が、行頭のリスト記号を除くと段落の続きにしかならない形か。
// micromark の GFM の表は、見出しの行が HTML の開始の形なら、そこから HTML ブロックとして読みうる
// （段落の途中の完全なタグだけの行でも段落を中断する）。
export const isPlainHeaderRow = (line: string, dialect: Dialect): boolean => {
  let offset = indentation(line).offset;
  for (let marker = listMarkerAt(line, offset); marker !== undefined; ) {
    offset = indentation(line, offset + marker.length).offset;
    marker = listMarkerAt(line, offset);
  }
  return isPlainText(line.slice(offset), undefined, 0, dialect);
};

// 段落を中断するかどうかが実装で揃わない形を除いた、どの読み方でも段落の続きになる行か。dialect を
// 渡せば、`<` で始まっても、段落の外でもその方言で HTML ブロックを始めない行（type 7 の完全なタグだけの
// 行でもない）は段落の続きとして扱う。
export const isPlainText = (
  content: string,
  breaks: Breaks,
  offset: number,
  dialect?: Dialect,
): boolean =>
  !isAtxHeading(content) &&
  !mayBeFootnoteDefinition(content) &&
  fenceRun(content) === undefined &&
  (content[0] !== "<" ||
    (dialect !== undefined && htmlStart(content, dialect, false) === undefined)) &&
  content[0] !== ">" &&
  listMarkerAt(content, 0) === undefined &&
  !isThematicBreak(offset, breaks) &&
  !isSetextUnderline(content, 0);

// column の行が収まる最も内側の項目の本文の列（margins は狭義の昇順で、先頭は 0）。段落の続きの行は
// 項目を閉じないので、深い入れ子のまま続く行ごとに先頭から辿ると二乗になる。二分探索で求める。
export const innermost = (margins: number[], column: number): number => {
  let low = 0;
  let high = margins.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (margins[middle] <= column) low = middle;
    else high = middle - 1;
  }
  return margins[low];
};

// 引用の行（`>` で始まる content）の読み方。段落の本文で終われば引用の深さ（`>` の数）、段落で
// 終わらない（空の行・見出し・区切り線）なら 0。引用の中のブロック（フェンス・HTML・インデント
// コード・入れ子の項目・表）は追跡しないので、読み方が決まらなければ構文の名前を返す。previous は
// 直前の行で開いていた引用の段落の深さ（無ければ 0）。
export const quoteLine = (content: string, previous: number, dialect: Dialect): number | string => {
  let depth = 0;
  let offset = 0;
  let spaces = 0;
  while (content[offset] === ">") {
    depth += 1;
    offset += content[offset + 1] === " " ? 2 : 1;
    spaces = 0;
    while (content[offset + spaces] === " ") spaces += 1;
    if (content[offset + spaces] === "\t") return "a tab in a block quote";
    if (content[offset + spaces] !== ">" || spaces > 3) break;
    offset += spaces;
  }
  const rest = content.slice(offset + spaces);
  if (rest === "") return 0;
  if (spaces >= 4) return "indented code in a block quote";
  const breaks = thematicBreakStarts(rest);
  if (isAtxHeading(rest) || isThematicBreak(0, breaks)) return 0;
  const marker = listMarkerAt(rest, 0);
  if (marker !== undefined) {
    let padding = 0;
    while (rest[marker.length + padding] === " ") padding += 1;
    const inner = rest.slice(marker.length + padding);
    if (inner === "" || rest[marker.length + padding] === "\t" || padding >= 5) {
      return "a list item in a block quote";
    }
    return isPlainText(inner, thematicBreakStarts(inner), 0)
      ? depth
      : "a nested block in a list item in a block quote";
  }
  if (fenceRun(rest) !== undefined) return "fenced code in a block quote";
  if (
    htmlStart(rest, dialect, previous > 0) !== undefined ||
    (previous > 0 && mayBeCompleteTag(rest))
  ) {
    return "HTML in a block quote";
  }
  if (mayBeFootnoteDefinition(rest)) return "a footnote definition in a block quote";
  if ((previous === 0 || depth > previous) && mayBeLinkDefinition(rest))
    return "a link reference definition in a block quote";
  if (previous > 0 && (isSetextUnderline(rest, 0) || mayBeTableDelimiter(rest, "|"))) {
    return "a setext underline or table in a block quote";
  }
  return depth;
};

/**
 * 読み方が分かれる構文。blank なら、どの読み方でもその構文は空行までに終わる。reading は、どの読み方が
 * ありうるか: "html" は段落か空行で終わる HTML ブロック、"quote" は最上位の引用（中のブロックが分からない）、
 * "table" は段落か GFM の表。
 */
export interface Ambiguity {
  construct: string;
  blank: boolean;
  reading?: "html" | "quote" | "table" | "footnote";
}

// 最上位で、段落を中断するブロックをどの読み方でも始める行か（段落の続きの行でも始める形に限る）。
// 段落・表・引用はどれもこの行で終わるので、この行からはどの読み方でも同じ状態になる。
export const interruptsParagraph = (
  line: string,
  offset: number,
  breaks: Breaks,
  dialect: Dialect,
): boolean => {
  const content = line.slice(offset);
  if (isAtxHeading(content) || openingFence(content) !== undefined) return true;
  if (isThematicBreak(offset, breaks)) return true;
  const html = htmlStart(content, dialect, true);
  if (html !== undefined) return html.type !== "ambiguous";
  const marker = listMarkerAt(line, offset);
  if (marker === undefined) return false;
  const after = indentation(line, offset + marker.length);
  return after.offset < line.length && (!/^\d/.test(marker) || Number.parseInt(marker, 10) === 1);
};

// 段落の後の、コンテナ（リスト項目・引用）の外に出た行の読み方。新しいブロックを始めるなら
// "block"、段落の続き（lazy continuation）なら "lazy"。実装で読み方が分かれれば、その構文。
export const lazyLine = (
  line: string,
  offset: number,
  relative: number,
  breaks: Breaks,
  dialect: Dialect,
): "block" | "lazy" | Ambiguity => {
  const content = line.slice(offset);
  if (mayBeFootnoteDefinition(content)) {
    return { construct: "a footnote definition (GFM)", blank: false };
  }
  const html = htmlStart(content, dialect, true);
  const block =
    isThematicBreak(offset, breaks) ||
    listMarkerAt(line, offset) !== undefined ||
    isAtxHeading(content) ||
    content[0] === ">" ||
    openingFence(content) !== undefined ||
    html !== undefined;
  if (relative >= 4) {
    // CommonMark では段落の続き。markdown-it は、外に出たコンテナの字下げを基準に新しいブロックの開始と
    // 読み、項目や引用を閉じる（その行はインデントコードになる）。
    if (!block) return "lazy";
    return { construct: "an indented line after a paragraph", blank: true, reading: "quote" };
  }
  // micromark は、段落の続きになりうる行では完全なタグだけの行（type 7）にも段落を中断させる。
  if (html?.type === "ambiguous" || (html === undefined && mayBeCompleteTag(content))) {
    const blank = html === undefined || html.blank;
    const construct = "an HTML tag after a paragraph in a list item or block quote";
    return { construct, blank, reading: "html" };
  }
  if (block) return "block";
  if (mayBeTableDelimiter(content, undefined) && content.includes("|")) {
    const construct = "a table after a paragraph in a list item or block quote";
    return { construct, blank: true, reading: "quote" };
  }
  return "lazy";
};
