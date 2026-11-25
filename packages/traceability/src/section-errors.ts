import { originOf, type HiddenBlock, type VisibleScan } from "./markdown-blocks.js";
import { COMMONMARK } from "./markdown-html.js";
import {
  headingLevelOf,
  type BoundaryFailure,
  type ContentScans,
  type SectionRange,
} from "./section-scan.js";

/** エラー文に添える参照の情報。 */
export interface HeadingSectionSource {
  /** ファイル名（公開の CI ログに出るので、絶対パスでなく basename）。 */
  file?: string;
  linkId?: string;
}

// エラー文に並べるブロック・行の上限。8 MiB の spec でもエラー文が 1 行で膨らまないようにする。
const MAX_LISTED_COMMENTS = 10;

// LF で分けた行の番号で表した、エラー文に並べるブロックか行。
interface Listed {
  start: number;
  /** 従来の規則で選ばれた参照の見出しを含む（件数を絞っても並べる）。 */
  holding: boolean;
  text: string;
}

// ブロックの中に、従来の規則と表示上の規則で読み方が違い、節の境界を変えうる行があるか。従来の規則が
// level 以下の見出しとして読むのに表示上は隠れる行と、フェンスを開くか閉じるかの読みが違う行。両方の
// 規則で同じに読むフェンス（リスト内の 2 スペースのフェンスなど）や、見出しを含まないコメントは並べない。
const blockChanges = (
  scans: ContentScans,
  scan: VisibleScan,
  level: number,
  block: HiddenBlock,
): boolean => {
  const { lines, legacy } = scans;
  for (let index = block.start; index < block.end; index += 1) {
    const line = originOf(scan, index);
    const delimiter =
      block.kind === "fence" &&
      (index === block.start || (block.closed && index === block.end - 1));
    // CR を含む行は従来の規則でも見出しでないので、LF で分けた行の先頭の表示上の行でだけ調べる
    // （CR の多い行で、表示上の行ごとに行全体を読み直さない）。
    const first = index === 0 || originOf(scan, index - 1) !== line;
    const lineLevel = !first || legacy.ignored[line] ? null : headingLevelOf(lines[line]);
    if (
      legacy.delimiter[line] !== delimiter ||
      (scan.ignored[index] === 1 && lineLevel !== null && lineLevel <= level)
    ) {
      return true;
    }
  }
  return false;
};

const describeBlock = (block: HiddenBlock, start: number, holding: boolean): string => {
  const comment = block.kind === "comment";
  const notes = [
    block.closed
      ? undefined
      : `not closed: add ${block.closer} where the ${comment ? "comment" : "block"} should end`,
    holding
      ? `contains the referenced heading: if the whole section is ${comment ? "commented out" : "inside this block"}, remove this reference from the manifest`
      : undefined,
  ].filter((note) => note !== undefined);
  return notes.length === 0 ? `line ${start + 1}` : `line ${start + 1} (${notes.join("; ")})`;
};

const listedBlocks = (
  scans: ContentScans,
  scan: VisibleScan,
  level: number,
  original: SectionRange | undefined,
): Listed[] =>
  scan.blocks
    .filter((block) => blockChanges(scans, scan, level, block))
    .map((block) => {
      const start = originOf(scan, block.start);
      const end =
        block.end === scan.lines.length ? scans.lines.length : originOf(scan, block.end - 1) + 1;
      const holding = original !== undefined && original.start >= start && original.start < end;
      return { start, holding, text: describeBlock(block, start, holding) };
    });

// ブロックの外で、従来の規則だけがフェンスの区切りと読む行（表示上はフェンスでない）。単独の CR は
// hazard（hazards.ts）なので、原因の行として並べない。
const listedLines = (
  scans: ContentScans,
  scan: VisibleScan,
  original: SectionRange | undefined,
  visible: SectionRange | undefined,
): Listed[] => {
  const { lines, legacy } = scans;
  const firstVisible = new Int32Array(lines.length);
  for (let index = scan.lines.length - 1; index >= 0; index -= 1) {
    firstVisible[originOf(scan, index)] = index;
  }
  const visibleEnd =
    visible === undefined || visible.end === scan.lines.length
      ? lines.length
      : originOf(scan, visible.end) + 1;
  const limit = Math.max(original?.end ?? lines.length, visibleEnd);
  const listed: Listed[] = [];
  for (let line = 0; line < lines.length; line += 1) {
    if (line >= limit) break;
    if (legacy.delimiter[line] && scan.ignored[firstVisible[line]] === 0) {
      listed.push({
        start: line,
        holding: false,
        text: `line ${line + 1} (fence (CommonMark: not a fence))`,
      });
    }
  }
  return listed;
};

const describeSource = (heading: string, source: HeadingSectionSource): string => {
  const where = source.file === undefined ? "" : ` in ${JSON.stringify(source.file)}`;
  const link = source.linkId === undefined ? "" : ` (link ${JSON.stringify(source.linkId)})`;
  return `Cannot hash section ${JSON.stringify(heading)}${where}${link} with manifest version 1`;
};

// LF で分けた行の番号で、範囲（end は含まない）を 1 始まりの行の範囲として書く。
const describeLines = (start: number, end: number, length: number): string =>
  end >= length ? `lines ${start + 1} to the end of the file` : `lines ${start + 1}-${end}`;

// 表示上の範囲の終わり（含まない）を、LF で分けた行の番号にする。単独の CR の後で終わるなら、その行も含める。
const visibleEndOf = (scan: VisibleScan, length: number, end: number): number => {
  if (end === scan.lines.length) return length;
  const line = originOf(scan, end);
  return end > 0 && originOf(scan, end - 1) === line ? line + 1 : line;
};

// 従来の規則と表示上の規則の範囲。表示上の範囲は表示上の行の番号なので、LF で分けた行の番号にする。
const describeRanges = (
  scans: ContentScans,
  scan: VisibleScan,
  original: SectionRange | undefined,
  visible: SectionRange | undefined,
): string => {
  const length = scans.lines.length;
  const legacy =
    original === undefined
      ? "version 1 does not find the heading"
      : `version 1 hashes ${describeLines(original.start, original.end, length)}`;
  if (visible === undefined) return `${legacy}, but the rendered heading is not found`;
  const start = originOf(scan, visible.start);
  const end = visibleEndOf(scan, length, visible.end);
  return `${legacy}, but the rendered section spans ${describeLines(start, end, length)}`;
};

// 並べる原因が無いとき、表示上の範囲に掛かる閉じないブロック（リスト項目の終わりなどで閉じの記号の
// 前に終わるブロック）。従来の規則はその閉じの記号まで読み続けうる。
const unclosedBlocks = (
  scans: ContentScans,
  scan: VisibleScan,
  original: SectionRange | undefined,
  visible: SectionRange | undefined,
): string[] => {
  const length = scans.lines.length;
  const limit = Math.max(
    original?.end ?? 0,
    visible === undefined ? 0 : visibleEndOf(scan, length, visible.end),
  );
  return scan.blocks
    .filter((block) => !block.closed && originOf(scan, block.start) < limit)
    .slice(0, MAX_LISTED_COMMENTS)
    .map((block) => {
      const start = originOf(scan, block.start) + 1;
      const where =
        block.end === scan.lines.length
          ? "at the end of the file"
          : `before line ${originOf(scan, block.end) + 1}`;
      return `line ${start} (ends ${where} without ${block.closer})`;
    });
};

export const boundaryError = (
  heading: string,
  level: number,
  scans: ContentScans,
  original: SectionRange | undefined,
  failure: Extract<BoundaryFailure, { reason: "boundaries" }>,
  source: HeadingSectionSource,
): Error => {
  const { scan, dialect } = failure.pass;
  // 同じファイルで同じ段の境界を変えうるブロックと行は、この 1 つのエラーで示す（check は最初のエラーで
  // 止まるので、ほかのファイル・段の衝突は直して流し直したときに出る）。エラー文は CI のログに出るので、
  // 並べるのは先頭の MAX_LISTED_COMMENTS 件と、参照の見出しを含むブロックだけにし、残りは件数で示す。
  const items = [
    ...listedBlocks(scans, scan, level, original),
    ...listedLines(scans, scan, original, failure.visible),
  ].sort((a, b) => a.start - b.start);
  const head = items.slice(0, MAX_LISTED_COMMENTS);
  const holding = items.slice(MAX_LISTED_COMMENTS).filter((item) => item.holding);
  const shown = [...head, ...holding];
  const more = items.length - shown.length;
  const unclosed = items.length === 0 ? unclosedBlocks(scans, scan, original, failure.visible) : [];
  const listed =
    items.length > 0
      ? ` HTML comment(s), other HTML block(s), fenced code or lines in this file that hide heading lines or read fence lines differently, by opening line: ${shown
          .map((item) => item.text)
          .join(", ")}${more > 0 ? `, and ${more} more` : ""}.`
      : unclosed.length > 0
        ? ` Blocks that CommonMark ends before their closing marker (for example, when a list item ends), by opening line: ${unclosed.join(", ")}.`
        : "";
  const reader = dialect === COMMONMARK ? "" : ` (as ${dialect.name} reads it)`;
  const ranges = describeRanges(scans, scan, original, failure.visible);
  return new Error(
    `${describeSource(heading, source)}: the Markdown block structure changes its boundaries${reader}: ${ranges}.${listed} Close a comment left open with "-->" (or another block with its closing marker, or end a block such as <div> with a blank line); remove a reference whose whole section is inside a comment or block; otherwise rewrite or indent heading or fence lines in the comment by at least four spaces (likewise in another HTML block or fenced code in a list item); replace a lone carriage return with a line feed; make a fence line follow CommonMark (no backtick in the info string of a backtick fence, only spaces or tabs after a closing fence). Then review the section before updating its hash.`,
  );
};

export const uncertaintyError = (
  heading: string,
  failure: Extract<BoundaryFailure, { reason: "uncertain" }>,
  source: HeadingSectionSource,
): Error => {
  const { scan, dialect } = failure.pass;
  const line = originOf(scan, failure.uncertainty.line) + 1;
  if (failure.uncertainty.hazard === true) {
    return new Error(
      `${describeSource(heading, source)}: cannot determine how this section renders from line ${line} (${failure.uncertainty.construct}). Markdown parsers can read the lines from there to the end of the file differently, so the section boundary is not checked there. Remove the character there or simplify the Markdown: for example, replace control characters with spaces, make lines of only spaces or tabs empty, move an HTML block out of a list item, or split a very long line; or move the section above that line. Then review the section before updating its hash.`,
    );
  }
  const reader = dialect === COMMONMARK ? "" : `; as ${dialect.name} reads it`;
  return new Error(
    `${describeSource(heading, source)}: cannot determine how this section renders near line ${line} (${failure.uncertainty.construct}${reader}). Markdown parsers can read this construct differently, and the section boundary cannot be checked from there to the end of the file. Simplify the Markdown there or move it outside the section: for example, end a table, HTML block or block quote with a blank line, or move it out of a list item; in a block quote, keep to plain paragraphs. Then review the section before updating its hash.`,
  );
};
