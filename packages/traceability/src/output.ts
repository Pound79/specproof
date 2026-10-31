// CLI の出力の出口。GitHub Actions のランナーはジョブのログの各行を見て、行頭（空白を除く）の
// `::name params::value` と、行のどこかにある `##[name params]value` をワークフローコマンドと
// して読む（注記・マスク・出力値の設定・コマンドの停止など）。link id・見出し・パス・ラベルは
// PR の作者が書けるので、それを含む行をコマンドにさせない。
//
// - 行の区切りはランナーと同じく CR・LF・CRLF（改行や制御文字は各所で printable が ? にする）
// - `##[` は位置によらず `#?[` にする
// - 行頭の空白の後ろが `::` なら、最初の `:` を `?` にする。ランナーは .NET の char.IsWhiteSpace
//   の空白をすべて詰める。JS の trimStart は U+0085 を詰めないので使わず、集合を明示する
//   （U+FEFF は .NET では空白でないが、詰めすぎる側なので含めて安全側に倒す）
//
// specproof が意図して出すコマンド（--github-annotations の `::warning`）はこの出口を通さない。

const LEGACY_COMMAND = /##\[/g;
const LINE_BREAK = /(\r\n|\r|\n)/;
const LEADING_WHITESPACE =
  /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*/u;

const neutralizeLine = (line: string): string => {
  const safe = line.replace(LEGACY_COMMAND, "#?[");
  const indent = LEADING_WHITESPACE.exec(safe)?.[0].length ?? 0;
  return safe.startsWith("::", indent)
    ? `${safe.slice(0, indent)}?${safe.slice(indent + 1)}`
    : safe;
};

export const neutralizeWorkflowCommands = (text: string): string =>
  text
    .split(LINE_BREAK)
    .map((part, index) => (index % 2 === 1 ? part : neutralizeLine(part)))
    .join("");

/** 人が読むテキストを stdout に 1 行（または複数行）出す。 */
export const printText = (text: string): void => {
  console.log(neutralizeWorkflowCommands(text));
};

/** 人が読むテキストを stderr に出す。 */
export const printErrorText = (text: string): void => {
  console.error(neutralizeWorkflowCommands(text));
};

/**
 * JSON を stdout に出す。値は変えず、文字列の中の `##[` を `\u0023#[` と書く（JSON として同じ
 * 文字列で、ログでは読まれない）。整形した JSON の行は空白・引用符・括弧で始まるので、行頭の
 * `::` は生じない。
 */
export const printJson = (value: unknown): void => {
  console.log(JSON.stringify(value, null, 2).replace(LEGACY_COMMAND, "\\u0023#["));
};
