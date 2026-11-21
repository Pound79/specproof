import type { ChangesSinceBless, GroupedReference } from "./bless-changes.js";
import { printable } from "./display-text.js";

const COMMIT_LIMIT = 20;
const SUBJECT_LIMIT = 120;
const SHORT_COMMIT = 12;

// 見えない書式の文字（ゼロ幅・タグ文字など）。件名から消し、読む人や AI に見えない文字を渡さない。
const INVISIBLE = /[\p{Cf}\u{E0000}-\u{E007F}]/gu;

const describeReference = (ref: GroupedReference): string =>
  printable(`    ${ref.side}  ${ref.path}  links: ${ref.linkIds.join(", ")}`);

// コミットの件名は誰でも書ける文字列なので、表示できる形にして長さを限る（code point 単位で切る）。
const describeSubject = (subject: string): string => {
  const shown = Array.from(printable(subject.replace(INVISIBLE, "")));
  return shown.length > SUBJECT_LIMIT
    ? `${shown.slice(0, SUBJECT_LIMIT - 3).join("")}...`
    : shown.join("");
};

const describeNotGrouped = ({
  noBlessedVersion,
  notSearched,
  failed,
}: ChangesSinceBless["notGrouped"]): string[] => {
  const total = noBlessedVersion + notSearched + failed;
  if (total === 0) return [];
  const reasons = [
    noBlessedVersion > 0 ? `${noBlessedVersion} without a blessed version` : undefined,
    notSearched > 0 ? `${notSearched} not searched` : undefined,
    failed > 0 ? `${failed} whose changes could not be traced` : undefined,
  ].filter((reason) => reason !== undefined);
  return [`  (${total} reference(s) not grouped: ${reasons.join(", ")})`];
};

export const CHANGES_SINCE_BLESS_INCOMPLETE =
  "--since-bless: stopped grouping changes by commit after reaching the limit on git calls, time or commits per file; the grouping above may be incomplete.";

/** --since-bless: drift した参照を、bless の後にそれを変えたコミットごとに出す。まとめるものが無ければ空。 */
export const describeChangesSinceBless = (changes: ChangesSinceBless): string[] => {
  const notGrouped = describeNotGrouped(changes.notGrouped);
  if (changes.commits.length === 0 && changes.uncommitted.length === 0 && notGrouped.length === 0) {
    return [];
  }
  const shown = changes.commits.slice(0, COMMIT_LIMIT);
  const hidden = changes.commits.length - shown.length;
  return [
    "Changes since bless, by commit (first-parent, newest first):",
    ...shown.flatMap((change) => [
      `  ${change.commit.slice(0, SHORT_COMMIT)} ${describeSubject(change.subject)}`,
      ...change.entries.map(describeReference),
    ]),
    ...(hidden > 0 ? [`  ...and ${hidden} more commit(s) (run with --json for every entry)`] : []),
    ...(changes.uncommitted.length > 0
      ? ["  (uncommitted)", ...changes.uncommitted.map(describeReference)]
      : []),
    ...notGrouped,
  ];
};
