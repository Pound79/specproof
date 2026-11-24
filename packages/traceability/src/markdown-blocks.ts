// A markdown fenced-code delimiter per CommonMark §4.5: 0-3 leading spaces,
// then a run of 3+ backticks or 3+ tildes. `char` is the fence character and
// `len` its run length; `bare` is true when nothing but whitespace follows
// (an info string is allowed on the opening fence but not the closing one).
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

// 行は LF で分けるので、単独の CR と U+2028・U+2029 は行に残りうる。正規表現の `.` はこの 3 文字に
// 一致せず、含む行は下の正規表現に一致しない（区切りでも見出しでもない）。照合すると後戻りで二乗の
// 時間がかかるので、照合の前に同じ結果を返す。
export const hasLineTerminator = (line: string): boolean => /[\r\u2028\u2029]/.test(line);

export const parseFence = (line: string): { char: string; len: number; bare: boolean } | null => {
  if (hasLineTerminator(line)) return null;
  const match = line.match(FENCE_RE);
  if (match === null) {
    return null;
  }
  const run = match[1];
  return { char: run[0], len: run.length, bare: match[2].trim() === "" };
};

/** HTML コメントブロックの行の範囲（0 始まり、end は含まない）。閉じないまま末尾に達したら closed は false。 */
export interface CommentBlock {
  start: number;
  end: number;
  closed: boolean;
}

export interface BlockScan {
  /** 行ごとに、見出しの候補にもセクションの終端にも使わない行なら true。 */
  ignored: boolean[];
  comments: CommentBlock[];
}

type Fence = NonNullable<ReturnType<typeof parseFence>>;

const closesFence = (fence: Fence | null, open: Fence): boolean =>
  fence !== null && fence.bare && fence.char === open.char && fence.len >= open.len;

const indentation = (line: string, offset = 0, column = 0) => {
  while (line[offset] === " " || line[offset] === "\t") {
    column += line[offset] === "\t" ? 4 - (column % 4) : 1;
    offset += 1;
  }
  return { offset, column };
};

// CommonMark のリスト項目の本文は、マーカーとそれに続く字下げ（1〜4 列）を基準にする。
// 5 列以上なら 1 列だけが項目の字下げで、残りは本文（例: インデントコード）。
// 段落を中断できる番号付きリストは 1 から始まるものだけ。
const listMarker = /(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$)/y;

const findComments = (lines: string[]): CommentBlock[] => {
  const comments: CommentBlock[] = [];
  const margins = [0];
  let paragraph = false;
  let comment: { start: number; margin: number } | undefined;
  let fence: { open: Fence; margin: number } | undefined;

  for (const [index, line] of lines.entries()) {
    let { offset, column } = indentation(line);
    const blank = offset === line.length;
    if (comment !== undefined) {
      if (blank || column >= comment.margin) {
        if (line.includes("-->")) {
          comments.push({ start: comment.start, end: index + 1, closed: true });
          comment = undefined;
        }
        continue;
      }
      comments.push({ start: comment.start, end: index, closed: false });
      comment = undefined;
    }
    if (fence !== undefined) {
      if (blank || column >= fence.margin) {
        if (column < fence.margin + 4 && closesFence(parseFence(line.slice(offset)), fence.open)) {
          fence = undefined;
        }
        continue;
      }
      fence = undefined;
    }
    if (blank) {
      paragraph = false;
      continue;
    }
    while (column < margins[margins.length - 1]) {
      margins.pop();
      paragraph = false;
    }
    let margin = margins[margins.length - 1];
    while (column < margin + 4) {
      listMarker.lastIndex = offset;
      const marker = listMarker.exec(line)?.[0];
      if (
        marker === undefined ||
        (paragraph && /^\d/.test(marker) && Number.parseInt(marker, 10) !== 1)
      )
        break;
      const markerEnd = column + marker.length;
      ({ column, offset } = indentation(line, offset + marker.length, markerEnd));
      const padding = column - markerEnd;
      margin = markerEnd + (padding >= 1 && padding <= 4 && offset < line.length ? padding : 1);
      margins.push(margin);
      paragraph = false;
    }
    if (offset === line.length || column >= margin + 4) continue;
    const content = line.slice(offset);
    if (content.startsWith("<!--")) {
      if (line.includes("-->")) comments.push({ start: index, end: index + 1, closed: true });
      else comment = { start: index, margin };
      paragraph = false;
      continue;
    }
    const opening = parseFence(content);
    if (opening !== null) fence = { open: opening, margin };
    const headingOrQuote = /^(?:#{1,6}(?:[ \t]|$)|>)/.test(content);
    const thematicBreak = /^(?:-(?:[ \t]*-){2,}|_(?:[ \t]*_){2,}|\*(?:[ \t]*\*){2,})[ \t]*$/.test(
      content,
    );
    const setextUnderline: boolean = paragraph && /^(?:=+|-+)[ \t]*$/.test(content);
    paragraph = opening === null && !headingOrQuote && !thematicBreak && !setextUnderline;
  }
  if (comment !== undefined)
    comments.push({ start: comment.start, end: lines.length, closed: false });
  return comments;
};

// コメントを除くマスクにも v1 と同じフェンス規則を使う。リスト内のフェンスの認識は、
// 見本のコメントを実際の HTML コメントと取り違えないためだけに使い、既存の hash は変えない。
export const scanBlocks = (lines: string[], skipHtmlComments: boolean): BlockScan => {
  const comments =
    skipHtmlComments && lines.some((line) => line.includes("<!--")) ? findComments(lines) : [];
  const ignored: boolean[] = [];
  let commentIndex = 0;
  let openFence: Fence | null = null;
  for (const [index, line] of lines.entries()) {
    const block = comments[commentIndex];
    if (block !== undefined && index >= block.start) {
      ignored.push(true);
      if (index + 1 === block.end) commentIndex += 1;
      continue;
    }
    const fence = parseFence(line);
    ignored.push(openFence !== null || fence !== null);
    if (openFence === null) openFence = fence;
    else if (closesFence(fence, openFence)) openFence = null;
  }
  return { ignored, comments };
};
