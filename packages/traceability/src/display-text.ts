// テキスト出力に差し込むリポジトリ由来の名前・パス・見出しを、端末で安全に表示できる形にする。
// 制御文字と行区切りは前の行の上書きや偽の行を、bidi 制御文字と BOM は表示順の偽装を起こすため ? にする。
// --json と GitHub annotation はそれぞれの形式でエスケープするので使わない。
// bidi 制御文字は Unicode の Bidi_Control プロパティで網羅する（U+061C などを個別に漏らさない）。
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\p{Bidi_Control}]/gu;

export const printable = (text: string): string => text.replace(UNSAFE, "?");
