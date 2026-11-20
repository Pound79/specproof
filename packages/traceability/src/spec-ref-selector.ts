// specproof-update --spec-ref の `<path>#<見出し>`。layout.specHeadingIgnore と同じく最初の `#` で分け、
// パスは posix で正規化し、前後の空白を除く。見出しの無い指定（ファイル全体）は受け付けない。
// 照合はパスと見出しを別々に比べる（文字列でつなぐと、`#` を含むパスと見出しの組が衝突する）。
import path from "node:path";
import type { SpecRef } from "./manifest.js";

export interface SpecRefSelector {
  /** 利用者が書いたままの値（メッセージに出す）。 */
  raw: string;
  path: string;
  heading: string;
}

const normalizePath = (relPath: string): string => path.posix.normalize(relPath.trim());

export const parseSpecRefSelector = (value: string): SpecRefSelector => {
  const hash = value.indexOf("#");
  const relPath = hash < 0 ? "" : value.slice(0, hash).trim();
  const heading = hash < 0 ? "" : value.slice(hash + 1).trim();
  if (relPath.length === 0 || heading.length === 0) {
    throw new Error(
      `Cannot update: --spec-ref takes <path>#<heading> (got ${JSON.stringify(value)}).`,
    );
  }
  return { raw: value, path: normalizePath(relPath), heading };
};

export const matchesSelector = (ref: SpecRef, selector: SpecRefSelector): boolean =>
  normalizePath(ref.path) === selector.path && ref.heading.trim() === selector.heading;

/** 見出しの深さ（manifest で省略したときは `##`）。同じ名前で深さの違う節は別の節。 */
export const headingLevelOf = (ref: SpecRef): number => ref.headingLevel ?? 2;

/** check の entry（path と見出し）を、--spec-ref と同じ規則で 1 つの節に数えるための鍵。 */
export const sectionKey = (relPath: string, heading: string): string =>
  JSON.stringify([normalizePath(relPath), heading.trim()]);
