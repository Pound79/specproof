// v1 の従来の規則（v1 の hash の範囲を決める規則）。表示上の規則（markdown-blocks.ts）とは独立に保ち、
// 変えない。

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

/** v1 の従来の規則の走査。行は LF だけで分けた行。 */
export interface LegacyScan {
  /** 行ごとに、見出しの候補にもセクションの終端にも使わない行なら true。 */
  ignored: boolean[];
  /** 行ごとに、フェンスを開くか閉じる行なら true。 */
  delimiter: boolean[];
}

type Fence = NonNullable<ReturnType<typeof parseFence>>;

const closesFence = (fence: Fence | null, open: Fence): boolean =>
  fence !== null && fence.bare && fence.char === open.char && fence.len >= open.len;

// v1 の従来の規則: 0〜3 スペースのフェンスだけを認識し、HTML ブロックもリストも読まない。
// v1 の hash はこの規則で求めた範囲（ignored）で計算するので、この規則は変えない。delimiter は
// エラー文で食い違いの原因を示すためだけに使う。
export const scanLegacy = (lines: string[]): LegacyScan => {
  const ignored: boolean[] = [];
  const delimiter: boolean[] = [];
  let openFence: Fence | null = null;
  for (const line of lines) {
    const fence = parseFence(line);
    ignored.push(openFence !== null || fence !== null);
    if (openFence === null) {
      delimiter.push(fence !== null);
      openFence = fence;
    } else {
      const closes = closesFence(fence, openFence);
      delimiter.push(closes);
      if (closes) openFence = null;
    }
  }
  return { ignored, delimiter };
};
