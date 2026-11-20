// specproof-update --spec-ref の `<path>#<見出し>`。layout.specHeadingIgnore と同じく最初の `#` で分け、
// 見出しの無い指定（ファイル全体）は受け付けない。前後の空白を除くのは CLI に書いた値だけで、manifest に
// 保存した参照は hash の計算と同じ規則で区別する（旧形式の見出し `##  X` の参照 " X" や、末尾に空白のある
// ファイル名は、別の節・別のファイル。空白を除いて照合すると、指定していない節まで bless する）。
// 照合はパスと見出しを別々に比べる（文字列でつなぐと、`#` を含むパスと見出しの組が衝突する）。
import path from "node:path";
import type { SpecRef } from "./manifest.js";

export interface SpecRefSelector {
  /** 利用者が書いたままの値（メッセージに出す）。 */
  raw: string;
  path: string;
  heading: string;
}

// `./docs/x.md` と `docs/x.md` は同じファイル。空白は区別する（ファイル名の一部になりうる）。
const normalizePath = (relPath: string): string => path.posix.normalize(relPath);

// 値全体の前後の空白（貼り付けた改行など）だけを除く。`#` の前後の空白は黙って除かずに拒否する。除くと、
// 旧形式の見出し ` X` を見て `path# X` と書いた利用者が、別の節 `X` を bless してしまう。
export const parseSpecRefSelector = (value: string): SpecRefSelector => {
  const trimmed = value.trim();
  const hash = trimmed.indexOf("#");
  const relPath = hash < 0 ? "" : trimmed.slice(0, hash);
  const heading = hash < 0 ? "" : trimmed.slice(hash + 1);
  if (relPath.length === 0 || heading.length === 0) {
    throw new Error(
      `Cannot update: --spec-ref takes <path>#<heading> (got ${JSON.stringify(value)}).`,
    );
  }
  if (relPath.trim() !== relPath || heading.trim() !== heading) {
    throw new Error(
      `Cannot update: --spec-ref has whitespace around '#' (got ${JSON.stringify(value)}); bless references whose path or heading starts or ends with whitespace with --link-id.`,
    );
  }
  return { raw: value, path: normalizePath(relPath), heading };
};

/** --spec-ref で選べる参照か（前後に空白のあるパス・見出しと、`#` を含むパスは選べない）。 */
export const selectableBySpecRef = (relPath: string, heading: string): boolean =>
  relPath.trim() === relPath && heading.trim() === heading && !relPath.includes("#");

export const matchesSelector = (ref: SpecRef, selector: SpecRefSelector): boolean =>
  normalizePath(ref.path) === selector.path && ref.heading === selector.heading;

/** 見出しの深さ（manifest で省略したときは `##`）。同じ名前で深さの違う節は別の節。 */
export const headingLevelOf = (ref: SpecRef): number => ref.headingLevel ?? 2;

/** check の entry（path と見出し）を、--spec-ref と同じ規則で 1 つの節に数えるための鍵。 */
export const sectionKey = (relPath: string, heading: string): string =>
  JSON.stringify([normalizePath(relPath), heading]);
