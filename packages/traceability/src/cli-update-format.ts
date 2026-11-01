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
