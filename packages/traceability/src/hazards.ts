// 読み方が実装（CommonMark の JavaScript の実装・cmark-gfm・markdown-it）で分かれうる形（hazard）を、
// 走査の状態を持たない単純な規則で探す（H1・H2・H4。H3 のリスト項目の中の HTML ブロックは、リスト項目の
// 中かどうかが要るので markdown-blocks.ts の scanVisible で見る）。実装ごとの読み方の癖を個別に追わず、
// hazard が出たら、その行から文書の末尾までを決めきれない行とみなす（Markdown は前から順に読むので、
// それより前の行の読み方は変わらない）。規則は過大に拾う側に倒してあり、拾いすぎた行は拒否になるだけ。
import { MAX_MATCHED_LINE } from "./markdown-html.js";
import type { VisibleLines } from "./markdown-blocks.js";
import { indentation, listMarkerAt } from "./markdown-lines.js";

/** 最初の hazard。line は表示上の行（単独の CR でも分けた行）の番号。kind は固定の語句。 */
export interface Hazard {
  line: number;
  kind: string;
}

// H1: タブ以外の C0 制御文字（U+0000-0008・U+000B-000C・U+000E-001F）・DEL・U+0085・U+2028・U+2029
// と単独の CR。実装ごとの扱いを個別に確かめず、すべて hazard にする（cmark-gfm は \v・\f を空白として
// 読み、NUL は U+FFFD に置き換え、U+0085・U+2028・U+2029 は実装によっては改行や空白として扱いうる）。
// LF は行の区切り。単独の CR は CommonMark では改行で、従来の規則（LF で分ける）と行の数え方が変わる。
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u2028\u2029]/;

const controlKind = (char: string): string => {
  if (char === "\u000b") return "vertical tab";
  if (char === "\u000c") return "form feed";
  const code = char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
  return `control or separator character U+${code}`;
};

// 記号だけのリスト項目の行か（字下げ・引用の `>`・入れ子の記号の後の記号も含め、記号の後に本文が
// 無い）。記号で終わらない行は、記号を 1 つずつ読まずに除く。
const isEmptyListItem = (line: string): boolean => {
  let end = line.length;
  while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end -= 1;
  if (!"-+*.)".includes(line[end - 1] ?? " ")) return false;
  let offset = 0;
  let marker = false;
  for (;;) {
    offset = indentation(line, offset).offset;
    if (line[offset] === ">") {
      offset += 1;
      continue;
    }
    const found = listMarkerAt(line, offset);
    if (found === undefined) return marker && offset === line.length;
    marker = true;
    offset += found.length;
  }
};

/** 最初の hazard を返す。無ければ undefined。 */
export const firstHazard = ({ lines, origin }: VisibleLines): Hazard | undefined => {
  // 直前の空でない行（空白だけの行と空の行を飛ばす）が、記号だけのリスト項目の行だったか。字下げ・
  // 引用の `>`・入れ子の記号の後の記号も数え、コードフェンスの中かどうかは見ない（過大に拾う）。
  let afterEmptyItem = false;
  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line];
    // H1: 単独の CR。LF で分けた行のうち CR を含む行の、先頭の表示上の行から決めきれない。
    if (origin !== undefined && origin[line + 1] === origin[line]) {
      return { line, kind: "carriage return" };
    }
    // H4: 長すぎる行。HTML のタグの正規表現（後戻りがスタックを使い切りうる）はこの行を照合しないので、
    // 読み方を決めきれない。
    if (text.length > MAX_MATCHED_LINE) {
      return { line, kind: `a line longer than ${MAX_MATCHED_LINE} characters` };
    }
    const control = CONTROL.exec(text);
    if (control !== null) return { line, kind: controlKind(control[0]) };
    if (indentation(text).offset === text.length) {
      // H2: 記号だけの項目の後の、空白だけの（空でない）行。cmark-gfm 0.29 は、まだ中身の無い項目の
      // 後の空白だけの行を、字下げが項目の本文の列に届けば項目の続きと読む（空の行なら項目は終わり、
      // CommonMark も同じ）。中身のある項目の後の空行は、どちらの形でも項目の続き。
      if (text.length > 0 && afterEmptyItem) {
        return { line, kind: "a line of only spaces or tabs after an empty list item" };
      }
      continue;
    }
    afterEmptyItem = isEmptyListItem(text);
  }
  return undefined;
};
