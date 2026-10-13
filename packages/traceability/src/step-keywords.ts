// Gherkin の step キーワード（英語・日本語）。feature-scan と feature-lint で共有する。
export type StepType = "given" | "when" | "then";
export type StepLanguage = "en" | "ja";

// [キーワード, 種類, 言語]。Gherkin の辞書と同じく、英語は ASCII の空白 1 文字までを
// キーワードに含み（"Given "）、日本語は本文との間に空白を要しない。正規表現を使わず
// 先頭一致と slice で読む（(.*)$ 型の正規表現は、単独の \r などで二乗時間になる）。
const KEYWORDS: ReadonlyArray<readonly [string, StepType | "continue", StepLanguage | "both"]> = [
  ["Given ", "given", "en"],
  ["When ", "when", "en"],
  ["Then ", "then", "en"],
  ["And ", "continue", "en"],
  ["But ", "continue", "en"],
  ["* ", "continue", "both"],
  ["前提", "given", "ja"],
  ["もし", "when", "ja"],
  ["ならば", "then", "ja"],
  ["かつ", "continue", "ja"],
  ["且つ", "continue", "ja"],
  ["しかし", "continue", "ja"],
  ["但し", "continue", "ja"],
  ["ただし", "continue", "ja"],
  ["然し", "continue", "ja"],
];

/**
 * 行頭の空白だけを除いた行を受け取る（Gherkin と同じく行末は削らないので、本文が空の
 * "And " も step になる）。language は `# language:` で明示された言語。明示が無ければ
 * runner の既定言語が分からないため、両方の言語のキーワードを step とする。
 */
export const matchStep = (
  lineStart: string,
  language?: StepLanguage,
): { kind: StepType | "continue"; text: string } | undefined => {
  for (const [keyword, kind, keywordLanguage] of KEYWORDS) {
    if (language !== undefined && keywordLanguage !== "both" && keywordLanguage !== language) {
      continue;
    }
    if (lineStart.startsWith(keyword))
      return { kind, text: lineStart.slice(keyword.length).trim() };
  }
  return undefined;
};
