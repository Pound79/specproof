import { printable } from "./display-text.js";
import { PENDING_HASH } from "./hash.js";
import type { UpdateChange } from "./update.js";

// "PENDING" is the placeholder hash specproof-new-feature writes for a freshly
// scaffolded ref (see docs/methodology.md); showing it verbatim instead of an
// 8-char slice makes a first bless ("PENDING -> a1b2c3d4") visually distinct
// from a re-bless ("a1b2c3d4 -> e5f6a7b8").
const shortHash = (hash: string): string => (hash === PENDING_HASH ? hash : hash.slice(0, 8));

export const describeChange = (change: UpdateChange): string => {
  const location = change.heading ? `${change.path} § ${change.heading}` : change.path;
  return printable(
    `${change.linkId} ${change.side} ${location}: ${shortHash(change.oldHash)} -> ${shortHash(change.newHash)}`,
  );
};

// --link-id を付けたときは、指定したリンクを示す（重複は 1 つにまとめる）。付けなければ変わったリンクの数。
export const describeUpdateScope = (
  linkIds: readonly string[] | undefined,
  changedLinkCount: number,
): string => {
  const ids = [...new Set(linkIds ?? [])];
  if (ids.length === 0) return `${changedLinkCount} link(s)`;
  const quoted = ids.map((id) => JSON.stringify(id)).join(", ");
  return printable(ids.length === 1 ? `link ${quoted}` : `links ${quoted}`);
};
