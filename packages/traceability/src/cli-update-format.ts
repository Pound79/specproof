import { printable } from "./display-text.js";
import { PENDING_HASH } from "./hash.js";
import type { UpdateChange, UpdateSkip } from "./update.js";

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

export const describeSkip = (skip: UpdateSkip): string =>
  printable(
    `skipped link ${JSON.stringify(skip.linkId)}: its impl also drifted (changed or missing), so blessing only the spec side would hide "both spec and impl changed" — decide with specproof-sync, then bless it with --link-id <link-id>`,
  );

/** --record-spec-source: 取り込み元の HEAD が paths の中で ref と違うことを 1 行で示す。違いが無ければ undefined。 */
export const describeHeadMismatch = (
  name: string,
  ref: string,
  read: { repoPath: string; head?: string; headMismatch: readonly string[] },
): string | undefined => {
  if (read.headMismatch.length === 0) return undefined;
  const source = `spec source ${JSON.stringify(name)}`;
  if (read.head === undefined) {
    return printable(
      `${source}: HEAD in ${read.repoPath} could not be resolved, so it cannot be compared with ${ref}`,
    );
  }
  const paths = read.headMismatch.map((entry) => JSON.stringify(entry)).join(", ");
  return printable(
    `${source}: HEAD (${read.head}) in ${read.repoPath} differs from ${ref} in ${paths}`,
  );
};

/** --record-spec-source: 記録したコミットと、前の記録からどう変わったかを 1 行で示す。 */
export const describeRecorded = (
  name: string,
  ref: string,
  read: { repoPath: string; commit: string },
  previous: string | undefined,
): string => {
  const change =
    previous === undefined
      ? " (first record)"
      : previous === read.commit
        ? " (unchanged)"
        : ` (was ${previous})`;
  return printable(`spec source ${name}: ${ref} in ${read.repoPath} is ${read.commit}${change}`);
};
