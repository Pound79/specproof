// テキスト出力に差し込むリポジトリ由来の名前・パス・見出しを、端末で安全に表示できる形にする。
// 制御文字と行区切りは前の行の上書きや偽の行を、bidi 制御文字と BOM は表示順の偽装を起こすため ? にする。
// --json と GitHub annotation はそれぞれの形式でエスケープするので使わない。
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

export const printable = (text: string): string => text.replace(UNSAFE, "?");
