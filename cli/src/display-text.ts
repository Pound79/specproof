// 端末に出す文字列のうち、利用者のリポジトリ由来のもの（.env.example のキー・パス・
// エラー文）を安全に表示できる形にする。制御文字と行区切りは前の行の上書きや偽の行を、bidi
// 制御文字と BOM は表示順の偽装を起こすため ? にする。traceability の display-text.ts と同じ規則。
// --json は JSON のエスケープに任せるので使わない。
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\p{Bidi_Control}]/gu;

export const printable = (text: string): string => text.replace(UNSAFE, "?");

/** 改行で区切った複数行の文（エラー文など）を、行ごとに printable にする。改行そのものは残す。 */
export const printableLines = (text: string): string =>
  text.split(/\r?\n/).map(printable).join("\n");
