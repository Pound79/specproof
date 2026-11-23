// check の warning を「直すもの」と「参考」に分ける。種類を問わず 1 つの列に並べると、本当の書き方の誤り
// （step-order など）が多数の参考（未登録の見出しなど）の中に埋もれ、直すきっかけにならない。
// 分け方はテキスト出力と注釈の並びにだけ使い、--json と終了コードには影響しない。
import type { DriftWarning } from "./check.js";
import { type IsCheckFailureOptions, warningFailsUnderStrict } from "./cli-check-format.js";

export type WarningGroup = "fix" | "reference";

// すべての種類をここに書く（Record なので、種類が増えたら型検査で落ちる）。--strict で落ちる種類と、
// --strict の opt-in の有無にかかわらず feature の書き方の誤りである種類は「直すもの」。
const DEFAULT_GROUP: Record<DriftWarning["kind"], WarningGroup> = {
  "empty-link": "fix",
  "unreviewed-draft": "fix",
  "missing-reason": "fix",
  "disallowed-tag": "fix",
  "unregistered-feature": "fix",
  "duplicate-heading": "fix",
  "features-dir-unset": "fix",
  "features-dir-missing": "fix",
  "unknown-config-key": "fix",
  "missing-then": "fix",
  "step-order": "fix",
  "duplicate-scenario-name": "fix",
  "duplicate-scenario": "fix",
  "unregistered-impl": "reference",
  "unregistered-spec-heading": "reference",
  "possible-contradiction": "reference",
  "spec-source-outdated": "reference",
  "spec-source-unrecorded": "reference",
  "spec-source-unresolved": "reference",
};

/** 設定で --strict の対象にした種類（strictUnregisteredImpl など）は「直すもの」に上げる。 */
export const warningGroup = (
  kind: DriftWarning["kind"],
  options: IsCheckFailureOptions = {},
): WarningGroup =>
  // 型を迂回して知らない種類が来ても黙って落とさず、目立つ側（直すもの）に倒す。
  warningFailsUnderStrict(kind, options) ? "fix" : (DEFAULT_GROUP[kind] ?? "fix");

// 並びの段: --strict で落ちる直すもの、[advisory] の直すもの、参考。PR の作者が増やせる [advisory] の直すもので、
// --strict で落ちる warning を GitHub の注釈の上限の外へ押し出させない。
const rankOf = (kind: DriftWarning["kind"], options: IsCheckFailureOptions): number => {
  if (warningFailsUnderStrict(kind, options)) return 0;
  return warningGroup(kind, options) === "fix" ? 1 : 2;
};

/** 直すもの（--strict で落ちるものが先）、参考の順に、同じ段の中は元の順に並べた新しい配列を返す。 */
export const orderWarningsByGroup = (
  warnings: DriftWarning[],
  options: IsCheckFailureOptions = {},
): DriftWarning[] =>
  [0, 1, 2].flatMap((rank) => warnings.filter((warning) => rankOf(warning.kind, options) === rank));

// 種類ごとの件数を多い順に（同数なら最初に現れた順）。
const countByKind = (warnings: DriftWarning[]): string => {
  const counts = new Map<string, number>();
  for (const warning of warnings) counts.set(warning.kind, (counts.get(warning.kind) ?? 0) + 1);
  return [...counts]
    .sort((left, right) => right[1] - left[1])
    .map(([kind, count]) => `${kind} ${count}`)
    .join(", ");
};

/**
 * テキスト出力の先頭に出す件数のまとめ。表示の上限で隠す前の全件で数える。check 自身のまとめの 1 件
 * （truncated）は項目ではないので数えない。warning が無ければ undefined。
 */
export const describeWarningSummary = (
  warnings: DriftWarning[],
  options: IsCheckFailureOptions = {},
): string | undefined => {
  const items = warnings.filter((warning) => warning.truncated !== true);
  if (items.length === 0) return undefined;
  const parts = (["fix", "reference"] as const).flatMap((group) => {
    const members = items.filter((warning) => warningGroup(warning.kind, options) === group);
    if (members.length === 0) return [];
    const label = group === "fix" ? "to fix" : "for reference";
    return [`${members.length} ${label} (${countByKind(members)})`];
  });
  return `Warnings: ${parts.join("; ")}`;
};
