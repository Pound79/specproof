import { htmlStart, type Dialect } from "./markdown-html.js";
import {
  type Ambiguity,
  type VisibleFence,
  closesOpening,
  fenceCloser,
  indentation,
  innermost,
  interruptsParagraph,
  isAtxHeading,
  isPlainHeaderRow,
  isPlainText,
  isSetextUnderline,
  isThematicBreak,
  lazyLine,
  listMarkerAt,
  mayBeFootnoteDefinition,
  mayBeLinkDefinition,
  mayBeTableDelimiter,
  openingFence,
  quoteLine,
  thematicBreakStarts,
} from "./markdown-lines.js";

/**
 * 表示上は見出しにも節の終端にもならない行のブロック（0 始まり、end は含まない）。HTML コメント、
 * ほかの HTML ブロックと、コードフェンス（リスト項目の中も含む）。閉じの記号が無いまま（末尾に達したか、
 * リスト項目が終わって）ブロックが終わったら closed は false。
 */
export interface HiddenBlock {
  start: number;
  end: number;
  closed: boolean;
  kind: "comment" | "html" | "fence";
  /**
   * エラー文に書く、ブロックを閉じる記号。`"-->"` のように引用符で囲んだ記号か、長いフェンスなら
   * `a fence of 12 backticks` のように長さを数で示した語句（エラー文を記号の長さで膨らませない）。
   */
  closer: string;
}

/** 表示上の行。CommonMark では単独の CR も改行なので、LF で分けた行をさらに CR で分ける。 */
export interface VisibleLines {
  lines: readonly string[];
  /** 表示上の行ごとに、その行を含む LF で分けた行の番号。CR が無ければ undefined（同じ番号）。 */
  origin: Int32Array | undefined;
}

/** 表示上の規則が読み方を決めきれない最初の行（表示上の行の番号）と、その構文。 */
export interface Uncertainty {
  line: number;
  construct: string;
  /** hazards.ts の規則で見つけた行（その行から末尾までを決めきれない）なら true。 */
  hazard?: boolean;
}

/** 表示上の規則（CommonMark の近似）の走査。ignored と blocks の位置は表示上の行の番号。 */
export interface VisibleScan extends VisibleLines {
  /** 表示上の行ごとに、見出しの候補にもセクションの終端にも使わない行なら 1。 */
  ignored: Uint8Array;
  /** 見出しやフェンスの行を隠しうるブロック（HTML ブロックとコードフェンス）。 */
  blocks: HiddenBlock[];
  /**
   * この行から末尾までは、どのブロックの中か（見出しやフェンスの行か）を決めきれない。ignored は
   * 最善の推測で埋めるが、節の範囲の判定には使わない。
   */
  uncertain: Uncertainty | undefined;
}

export const originOf = (scan: VisibleLines, index: number): number =>
  scan.origin === undefined ? index : scan.origin[index];

const NONE = 0;
const CERTAIN = 1;
// 段落か GFM の表か決まらない（どちらも空行か見出しまで続く）。
const TABLE = 2;

/** LF で分けた行を、CommonMark と同じく単独の CR でも分ける。CR が無ければ同じ配列を使う。 */
export const visibleLinesOf = (legacyLines: readonly string[]): VisibleLines => {
  if (!legacyLines.some((line) => line.includes("\r"))) {
    return { lines: legacyLines, origin: undefined };
  }
  // 読み込みでは CRLF を 1 回だけ LF に置き換えるので、LF の直前に CR が残りうる（元の中身の `\r\r\n` は
  // `\r\n` になる）。元の中身では、その CR は単独の改行で、後ろの CRLF が次の改行なので、残った CR と LF を
  // それぞれ改行として読めば、元の中身の表示上の行と一致する。正規化していない中身を渡されたら CRLF の
  // ところに空行が増え、従来の範囲と食い違って拒否する側に倒れる。
  let count = 0;
  for (const line of legacyLines) {
    for (let i = line.indexOf("\r"); i >= 0; i = line.indexOf("\r", i + 1)) count += 1;
  }
  const lines = new Array<string>(legacyLines.length + count);
  const origin = new Int32Array(lines.length);
  let index = 0;
  for (const [number, line] of legacyLines.entries()) {
    let from = 0;
    for (;;) {
      const cr = line.indexOf("\r", from);
      lines[index] = cr < 0 ? line.slice(from) : line.slice(from, cr);
      origin[index] = number;
      index += 1;
      if (cr < 0) break;
      from = cr + 1;
    }
  }
  return { lines, origin };
};

type OpenHtml = { start: number; margin: number; closer: string } & (
  | { kind: "comment" | "html"; end: (line: string) => boolean }
  | { kind: "blank" }
);

/**
 * 表示上（CommonMark の近似）のブロックの範囲を、リスト項目の字下げ・引用の段落の続き・HTML ブロック・
 * コードフェンスを追跡して求める。追跡しない構文（引用の中のブロック、段落と表の違いが効く行、方言で
 * 読み方が分かれる HTML など）に出会ったら、その行を uncertain に記録する（以降も最善の推測で走査する）。
 * setext 見出しは節の境界にしない。
 */
export const scanVisible = ({ lines, origin }: VisibleLines, dialect: Dialect): VisibleScan => {
  const ignored = new Uint8Array(lines.length);
  const blocks: HiddenBlock[] = [];
  const margins = [0];
  let paragraph = NONE;
  // 開いている段落が引用の中にあれば、その引用の深さ。paragraph が NONE の間は読まない。
  let quote = 0;
  // 直前の行が中身の無いリスト項目（記号だけ）で終わった。
  let emptyItem = false;
  let html: OpenHtml | undefined;
  let fence: { start: number; open: VisibleFence; margin: number } | undefined;
  // インデントコードの直後なら、そのコードを含むコンテナの本文の列。無ければ -1。
  let codeMargin = -1;
  // 直前の行が引用の行（`>` の行か、引用の段落の続き）で、引用が開いている。
  let quoteOpen = false;
  let uncertain: Uncertainty | undefined;
  const taint = (line: number, construct: string, hazard?: true) => {
    uncertain ??= hazard ? { line, construct, hazard } : { line, construct };
  };
  // 最上位（リスト項目の外）で、どの読み方でも空行までに終わる構文に出会った。空行まで、どの読み方でも
  // 見出しにもフェンスにも HTML ブロックの開始にもならない行だけが続けば、空行の後はどの読み方でも
  // 同じ状態（コンテナも段落も無い）に戻る。そうでない行が来たら、構文の行から末尾までを決めきれない。
  let region: (Uncertainty & { reading: Ambiguity["reading"] }) | undefined;
  const uncertainAt = (line: number, { construct, blank, reading = "html" }: Ambiguity) => {
    if (blank && margins.length === 1) region = { line, construct, reading };
    else taint(line, construct);
  };

  const endHtml = (end: number, closed: boolean) => {
    if (html !== undefined) {
      const { start, closer } = html;
      blocks.push({
        start,
        end,
        closed,
        kind: html.kind === "comment" ? "comment" : "html",
        closer,
      });
    }
    html = undefined;
  };
  const endFence = (end: number, closed: boolean) => {
    if (fence !== undefined) {
      const closer = fenceCloser(fence.open);
      blocks.push({ start: fence.start, end, closed, kind: "fence", closer });
    }
    fence = undefined;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let { offset, column } = indentation(line);
    const blank = offset === line.length;
    const afterCode = codeMargin;
    if (!blank) codeMargin = -1;
    const wasQuote: boolean = quoteOpen;
    quoteOpen = false;
    // 同期した行（ある読み方では段落を中断する行）か。
    let resynced = false;
    if (html !== undefined) {
      if (html.kind === "blank") {
        // 空行で終わる HTML ブロック（type 6・7）。空行はブロックの外の行として読む。
        if (blank) endHtml(index, true);
        else if (column >= html.margin) {
          ignored[index] = 1;
          continue;
        } else endHtml(index, false);
      } else if (blank || column >= html.margin) {
        ignored[index] = 1;
        if (html.end(line)) endHtml(index + 1, true);
        continue;
      } else endHtml(index, false);
    }
    if (fence !== undefined) {
      if (blank || column >= fence.margin) {
        ignored[index] = 1;
        if (column < fence.margin + 4 && closesOpening(line.slice(offset), fence.open)) {
          endFence(index + 1, true);
        }
        continue;
      }
      endFence(index, false);
    }
    if (region !== undefined) {
      const content = line.slice(offset);
      // GFM の脚注の定義はリスト項目のように空行の後も 4 列以上字下げした行を含むので、空行では同期しない。
      const footnote = region.reading === "footnote";
      if (blank) {
        if (!footnote) region = undefined;
        paragraph = NONE;
        emptyItem = false;
        continue;
      }
      // 字下げが 4 列以上の行は、どの読み方でも段落の続きかインデントコード（脚注の定義の中なら、その
      // 中のブロック）で、最上位の見出しやフェンスでない。インデントコードと読む読み方があるので、後ろの
      // 項目はインデントコードの直後として扱う。
      if (column >= 4) {
        codeMargin = 0;
        continue;
      }
      // `>` の行は引用の中か HTML ブロックの中。どちらも空行で終わる。
      if (content[0] === ">" && !footnote) continue;
      const breaks = thematicBreakStarts(line);
      if (isPlainText(content, breaks, offset, dialect)) continue;
      if (footnote && (mayBeFootnoteDefinition(content) || mayBeLinkDefinition(content))) continue;
      // HTML ブロックとして読む読み方があれば、その行もブロックの中なので、空行のほかは同期できない。
      // 脚注の定義の後は、それを閉じる見出しの行でだけ同期する。
      const synchronizes = footnote
        ? isAtxHeading(content)
        : region.reading !== "html" && interruptsParagraph(line, offset, breaks, dialect);
      if (!synchronizes) taint(region.line, region.construct);
      region = undefined;
      paragraph = NONE;
      quote = 0;
      resynced = true;
    }
    if (blank) {
      // 項目の先頭の空行は 1 行まで。記号だけの項目の後に空行が続くと、その項目は空のまま終わる。
      if (emptyItem) margins.pop();
      emptyItem = false;
      paragraph = NONE;
      continue;
    }
    const breaks = thematicBreakStarts(line);
    const relative = column - innermost(margins, column);
    // markdown-it は、引用が開いていれば 4 列以上字下げした `>` も引用の続きの記号として読む
    // （CommonMark では段落の続きかインデントコード）。
    if (wasQuote && relative >= 4 && line[offset] === ">") {
      const construct = "an indented > after a block quote";
      uncertainAt(index, { construct, blank: true, reading: "quote" });
      continue;
    }
    // 字下げの足りない行や、引用の段落の後の `>` の無い行でも、どのブロックも始めないなら直前の段落の
    // 続き（lazy continuation）で、リスト項目も引用も終わらない。始めるなら段落は終わる。
    const unmatchedQuote = quote > 0 && !(relative < 4 && line[offset] === ">");
    if (paragraph !== NONE && (column < margins[margins.length - 1] || unmatchedQuote)) {
      // 表（かリンク参照定義）の後でも、段落を中断するブロックの行はどの読み方でもブロックを始める。
      const tableBlock = relative < 4 && interruptsParagraph(line, offset, breaks, dialect);
      const reading =
        paragraph === TABLE && !tableBlock
          ? { construct: "a table in a list item or block quote", blank: false }
          : lazyLine(line, offset, relative, breaks, dialect);
      if (paragraph === TABLE && tableBlock) resynced = true;
      if (reading === "lazy") {
        quoteOpen = wasQuote;
        continue;
      }
      if (reading !== "block") {
        uncertainAt(index, reading);
        continue;
      }
      paragraph = NONE;
    }
    if (paragraph === TABLE) {
      // 段落か表かで、段落を中断できる行が違う。空行と見出しはどちらも同じに読む。
      const content = line.slice(offset);
      if (relative < 4 && isPlainText(content, breaks, offset, dialect)) continue;
      if (relative >= 4 || !interruptsParagraph(line, offset, breaks, dialect)) {
        taint(index, "a line right after a table");
      }
      paragraph = NONE;
      resynced = true;
    }
    while (column < margins[margins.length - 1]) {
      margins.pop();
      paragraph = NONE;
    }
    let margin = margins[margins.length - 1];
    const depth = margins.length;
    // micromark は、段落を中断して始まる行の入れ子の項目と、インデントコードの直後（空行を挟んでも）の
    // 同じコンテナの項目にも、段落の途中の制限（中身の無い項目と 1 以外の番号の項目はリストにしない）を
    // 当てる。ほかの実装はリストにするので、この形は読み方を決めきれない。
    const interrupting = paragraph !== NONE || resynced;
    const afterCodeHere = afterCode >= 0 && column >= afterCode;
    while (column < margin + 4) {
      // 区切り線はリスト項目より優先する。段落の直後の `-`（setext の下線）は中身の無い項目と
      // 同じ形なので、下の中身の無い項目の規則で項目にしない。
      if (isThematicBreak(offset, breaks)) break;
      const marker = listMarkerAt(line, offset);
      if (
        marker === undefined ||
        (paragraph !== NONE && /^\d/.test(marker) && Number.parseInt(marker, 10) !== 1)
      )
        break;
      const markerEnd = column + marker.length;
      const after = indentation(line, offset + marker.length, markerEnd);
      if (paragraph !== NONE && after.offset === line.length) break;
      const ordinal = /^\d/.test(marker) && Number.parseInt(marker, 10) !== 1;
      if (
        (ordinal || after.offset === line.length) &&
        (afterCodeHere || (interrupting && margins.length > depth))
      ) {
        taint(index, "an empty or numbered list item that parsers read differently here");
      }
      ({ column, offset } = after);
      const padding = column - markerEnd;
      margin = markerEnd + (padding >= 1 && padding <= 4 && offset < line.length ? padding : 1);
      margins.push(margin);
      paragraph = NONE;
    }
    emptyItem = margins.length > depth && offset === line.length;
    if (offset < line.length && column >= margin + 4 && paragraph === NONE) codeMargin = margin;
    if (offset === line.length || column >= margin + 4) continue;
    const content = line.slice(offset);
    // 脚注の定義はリスト項目のように後ろの字下げした行を含み、空行の後も続くので、同期できない。
    if (mayBeFootnoteDefinition(content)) {
      uncertainAt(index, {
        construct: "a footnote definition (GFM)",
        blank: true,
        reading: "footnote",
      });
      if (region !== undefined) continue;
    }
    const start = htmlStart(content, dialect, paragraph !== NONE);
    if (start?.type === "ambiguous") {
      const construct = `an HTML tag that ${dialect.name} and other parsers read differently`;
      uncertainAt(index, { construct, blank: start.blank });
      if (region !== undefined) continue;
    } else if (start !== undefined) {
      // H3: リスト項目の中の HTML ブロック。markdown-it はリスト項目の中の HTML ブロックを空行で終える
      // （CommonMark は閉じの記号まで続く）。個別に追わず、この行から末尾までを決めきれないとする。
      if (margins.length > 1) taint(index, "an HTML block in a list item", true);
      ignored[index] = 1;
      paragraph = NONE;
      if (start.type === "blank") {
        html = { kind: "blank", start: index, margin, closer: "a blank line" };
        continue;
      }
      const { kind, end, closer } = start.start;
      html = { kind, end, start: index, margin, closer: JSON.stringify(closer) };
      if (end(content)) endHtml(index + 1, true);
      continue;
    }
    const opening = openingFence(content);
    if (opening !== undefined) {
      ignored[index] = 1;
      fence = { start: index, open: opening, margin };
      paragraph = NONE;
      continue;
    }
    if (content[0] === ">") {
      const reading = quoteLine(content, paragraph === CERTAIN ? quote : 0, dialect);
      if (typeof reading === "string") {
        // 引用は空行で終わる（空行は段落の続きにならない）ので、引用の中は空行までで閉じる。
        uncertainAt(index, { construct: reading, blank: true, reading: "quote" });
        quote = 0;
        paragraph = NONE;
      } else {
        quote = reading;
        paragraph = reading > 0 ? CERTAIN : NONE;
        quoteOpen = true;
      }
      continue;
    }
    if (paragraph === CERTAIN && mayBeTableDelimiter(content, lines[index - 1])) {
      const reading = isPlainHeaderRow(lines[index - 1], dialect) ? "table" : "html";
      if (margins.length === 1) uncertainAt(index, { construct: "a table", blank: true, reading });
      else if (reading === "table") paragraph = TABLE;
      else taint(index, "a table in a list item");
      continue;
    }
    if (paragraph === NONE && mayBeLinkDefinition(content)) {
      // 定義なら段落は開かず、段落なら開く。どちらも空行か段落を中断する行で同じ状態に戻る。
      const construct = "a link reference definition";
      if (margins.length === 1) uncertainAt(index, { construct, blank: true, reading: "table" });
      else paragraph = TABLE;
      quote = 0;
      continue;
    }
    const underline = paragraph !== NONE && isSetextUnderline(line, offset);
    paragraph =
      isAtxHeading(content) || isThematicBreak(offset, breaks) || underline ? NONE : CERTAIN;
    quote = 0;
  }
  endHtml(lines.length, false);
  endFence(lines.length, false);
  return { lines, origin, ignored, blocks, uncertain };
};
