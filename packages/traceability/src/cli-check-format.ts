import path from "node:path";
import type { DriftEntry, DriftReport, DriftWarning } from "./check.js";
import { printable } from "./display-text.js";

export const describeEntry = (entry: DriftEntry): string => {
  const location = entry.heading ? `${entry.path} § ${entry.heading}` : entry.path;
  return printable(`[${entry.side}] ${location} — ${entry.status}`);
};

// failsUnderStrict reflects the warning's *kind* (would --strict treat this
// as an error, per the repo's config), independent of whether this run
// actually passed --strict. It lets callers distinguish hard warnings from
// advisory ones (unregistered-impl / unregistered-spec-heading without their
// opt-in flags) even in a plain, non-strict run.
// linkId は manifest 由来。制御文字は manifest の検証で拒否するが、bidi 制御文字は通る。
export const describeLinkHeading = (linkId: string): string => `link: ${printable(linkId)}`;

export const describeBothSidesChanged = (linkId: string): string =>
  `!! link "${printable(linkId)}": BOTH spec and impl changed — specproof-sync must stop and ask which side is authoritative`;

// repoRoot は手元のテキスト出力にだけ渡す。注釈（CI のログと PR）には runner のパスを載せない。
export const describeAllReferencesMissing = (referenceCount: number, repoRoot?: string): string =>
  printable(
    `!! all ${referenceCount} reference(s) in the manifest are missing${repoRoot === undefined ? "" : ` under ${repoRoot}`} — the repo root or manifest is likely wrong, not drifted. Re-run with --root <repo root> (and --manifest if needed) before syncing anything.`,
  );

export const describeWarning = (warning: DriftWarning, failsUnderStrict: boolean): string =>
  printable(`[${failsUnderStrict ? "warning" : "advisory"}] ${warning.message}`);

// GitHub workflow command の data と property は異なる escape 規則を持つ。
const escapeData = (value: string): string =>
  value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (value: string): string =>
  escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");

// 注釈に要るのは message だけ。warning の種類に当たらない案内（全参照 missing）も同じ形で出す。
export const toGithubWarningAnnotation = (
  warning: Pick<DriftWarning, "message"> & Partial<DriftWarning>,
): string => `::warning::specproof traceability: ${escapeData(warning.message)}`;

export interface IsCheckFailureOptions {
  /** Opt-in hard enforcement for unregistered-impl under --strict (config
   *  `strictUnregisteredImpl`). implGlobs is structurally noisier than the
   *  other warning kinds, so it stays
   *  warn-only under --strict unless a repo explicitly opts in. */
  strictUnregisteredImpl?: boolean;
  /** Opt-in hard enforcement for unregistered-spec-heading under --strict
   *  (config `strictUnregisteredSpecHeadings`). A real spec doc often mixes
   *  multiple domains' headings with intentionally-unlinked sections (revision
   *  history, glossary, non-behavioral notes) in the same file, so scoping the
   *  scan to already-registered files still produces false positives — this
   *  stays warn-only under --strict unless a repo explicitly opts in. */
  strictUnregisteredSpecHeadings?: boolean;
  /** Opt-in hard enforcement for missing-then, step-order, duplicate-scenario-name
   *  and duplicate-scenario under
   *  --strict (config `strictFeatureLint`). Off by default so existing suites
   *  that have such scenarios keep passing until a repo opts in.
   *  possible-contradiction never escalates: it is a candidate a human judges. */
  strictFeatureLint?: boolean;
}

// Per-kind strict-escalation decision, shared by isCheckFailure (the actual
// exit-status gate) and the CLI's --json output (which annotates every
// warning with its effective failsUnderStrict verdict regardless of whether
// this run passed --strict). unregistered-impl and unregistered-spec-heading
// only escalate when the caller opts in via the matching options flag (both
// are structurally noisy enough to produce false positives — see ADR 0004's
// "no hard enforcement without a false-positive-free invariant"). Every other
// kind (unregistered-feature, duplicate-heading, empty-link, ...) escalates
// unconditionally under --strict.
export const warningFailsUnderStrict = (
  kind: DriftWarning["kind"],
  options: IsCheckFailureOptions = {},
): boolean => {
  if (kind === "unregistered-impl") {
    return options.strictUnregisteredImpl === true;
  }
  if (kind === "unregistered-spec-heading") {
    return options.strictUnregisteredSpecHeadings === true;
  }
  if (
    kind === "missing-then" ||
    kind === "step-order" ||
    kind === "duplicate-scenario-name" ||
    kind === "duplicate-scenario"
  ) {
    return options.strictFeatureLint === true;
  }
  if (kind === "possible-contradiction") {
    return false;
  }
  return true;
};

// Pure exit-status decision shared by cli-check. Drift always fails the check;
// structural warnings (e.g. empty links) fail only under --strict, so a normal
// local run surfaces them without blocking while CI (which passes --strict)
// treats them as hard errors.
export const isCheckFailure = (
  report: DriftReport,
  strict: boolean,
  options: IsCheckFailureOptions = {},
): boolean => {
  if (!report.clean) {
    return true;
  }
  if (!strict) {
    return false;
  }
  return report.warnings.some((warning) => warningFailsUnderStrict(warning.kind, options));
};

export interface WarningWithStrictInfo extends DriftWarning {
  failsUnderStrict: boolean;
}

// CLI --json output annotation: attaches the effective failsUnderStrict
// verdict to each warning without teaching checkDrift/DriftWarning about
// config. Keep this at the CLI output layer only (see cli-check.ts).
export const attachFailsUnderStrict = (
  warnings: DriftWarning[],
  options: IsCheckFailureOptions = {},
): WarningWithStrictInfo[] =>
  warnings.map((warning) => ({
    ...warning,
    failsUnderStrict: warningFailsUnderStrict(warning.kind, options),
  }));

// A-3: display-only truncation (JSON output always carries the full list —
// see checkDrift). DISPLAY_LIMITS below is the single source of truth for
// which kinds are capped and at what count; any kind not listed there is
// never truncated. Warnings marked `truncated: true` (check's own summary
// line) are always shown and do not count toward the cap.
export interface DisplayWarnings {
  shown: DriftWarning[];
  /** Total hidden across all kinds (kept for compatibility). */
  hiddenCount: number;
  /** Hidden count per kind; only kinds with at least one hidden warning. */
  hiddenByKind: Partial<Record<DriftWarning["kind"], number>>;
}

// Advisory kinds that can fire many times on a real suite are capped so they
// do not push the other warnings (and GitHub's per-step annotation budget)
// out of view. The full list stays available in --json.
const DISPLAY_LIMITS: Partial<Record<DriftWarning["kind"], number>> = {
  "unregistered-impl": 20,
  "possible-contradiction": 10,
  // 設定のキーは PR の作者が書けるので、大量のキーでログと annotation を埋めさせない。
  "unknown-config-key": 20,
};

export const selectWarningsForDisplay = (warnings: DriftWarning[]): DisplayWarnings => {
  const seen = new Map<DriftWarning["kind"], number>();
  const hidden = new Map<DriftWarning["kind"], number>();
  const shown = warnings.filter((warning) => {
    const limit = DISPLAY_LIMITS[warning.kind];
    if (limit === undefined || warning.truncated === true) return true;
    const count = (seen.get(warning.kind) ?? 0) + 1;
    seen.set(warning.kind, count);
    if (count <= limit) return true;
    hidden.set(warning.kind, (hidden.get(warning.kind) ?? 0) + 1);
    return false;
  });
  return {
    shown,
    hiddenCount: warnings.length - shown.length,
    hiddenByKind: Object.fromEntries(hidden),
  };
};

// One line per hidden kind, in the order the kinds were first hidden. Names
// the kind and the shown/total counts so a reader does not mistake which
// warnings were omitted, and points at --json for the full list. check's own
// summary warning (`truncated: true`) is not an item of the list, so it is
// left out of both counts; it is printed on its own line anyway.
export const describeHiddenWarnings = (display: DisplayWarnings): string[] =>
  Object.entries(display.hiddenByKind).map(([kind, hiddenCount = 0]) => {
    const shownCount = display.shown.filter(
      (warning) => warning.kind === kind && warning.truncated !== true,
    ).length;
    const total = shownCount + hiddenCount;
    return `...and ${hiddenCount} more ${kind} (shown ${shownCount} of ${total}; run with --json for the full list)`;
  });

// bless は link ごとに行う。引数なしの specproof-update は drift した全リンクを黙って bless するので勧めない。
// link id は manifest 由来で空白やシェルの記号も通るため、コマンドには埋め込まず <link-id> の形で示す。
const BLESS_ONE_LINK = "specproof-update --link-id <link-id>";
const IMPL_BEHAVIOR_NOTE =
  "if the observable behavior changed, decide with the specproof-sync decision table before blessing";

export const describeNextSteps = (entries: DriftEntry[]): string[] => [
  "Next: review each link's changes and sync features if needed, then bless one link at a time:",
  `  ${BLESS_ONE_LINK}`,
  ...(entries.some((entry) => entry.side === "impl")
    ? [`[impl] drift: ${IMPL_BEHAVIOR_NOTE}.`]
    : []),
];

// コマンドの形で示すのは、どのシェル（POSIX・PowerShell・cmd）でも引用の外に出られない文字だけのパス。
// それ以外は、コマンドに埋めずにコミットだけを示す（パスは上の行に出ている）。
const COMMAND_SAFE_PATH = /^[A-Za-z0-9._/@+-]+$/;

/**
 * --since-bless: bless した中身と同じ版のコミット（見つからなければ null、探していなければ undefined）。
 * prefix は設定のルートの git の最上位からの相対パス。示すコマンドは完全なコミット id（同名のブランチ・タグに
 * 負けない）と `:(top,literal)` のパス（どこから流しても同じファイルを指し、パスの記号を解釈させない）を使う。
 */
export const describeBlessedCommit = (
  entry: DriftEntry,
  commit: string | null | undefined,
  maxCommits: number,
  prefix = "",
): string | undefined => {
  if (commit === undefined) return undefined;
  if (commit === null) {
    return printable(
      `blessed version: not found in the last ${maxCommits} commit(s) touching ${entry.path} (the blessed content may never have been committed, the file may have been renamed, or the history may be shallow)`,
    );
  }
  const topPath = `${prefix}${path.posix.normalize(entry.path)}`;
  if (path.posix.isAbsolute(entry.path) || !COMMAND_SAFE_PATH.test(topPath)) {
    return printable(
      `blessed version: ${commit} (the path has characters not shown in a command; compare that file at this commit)`,
    );
  }
  return printable(
    `blessed version: ${commit} — compare with: git diff ${commit} -- ':(top,literal)${topPath}'`,
  );
};

export const BLESS_HISTORY_INCOMPLETE =
  "--since-bless: stopped searching after reaching the limit on git calls or time; references without a result were not searched to the end.";

// 設定で外した advisory の件数。外した対象を黙って消えたように見せない。
export const describeExcludedAdvisories = (
  excluded: DriftReport["excludedAdvisories"],
): string | undefined => {
  if (excluded === undefined) return undefined;
  const { unregisteredImpl, unregisteredSpecHeading } = excluded;
  if (unregisteredImpl + unregisteredSpecHeading === 0) return undefined;
  return `(excluded ${unregisteredImpl} unregistered-impl item(s) by layout.implExcludeGlobs and ${unregisteredSpecHeading} unregistered-spec-heading item(s) by layout.specHeadingIgnore)`;
};

export const GIT_HISTORY_UNAVAILABLE =
  "--since-bless: git history is not available here (not a git work tree, git is not installed, or git refused the repository); blessed versions were not searched.";

export const toGithubAnnotation = (entry: DriftEntry): string => {
  const message =
    `Traceability drift in link "${entry.linkId}" (${entry.side}, ${entry.status})` +
    (entry.heading ? ` at heading "${entry.heading}"` : "") +
    `. Sync the linked feature (specproof-sync) or bless this link: ${BLESS_ONE_LINK}` +
    (entry.side === "impl" ? ` (${IMPL_BEHAVIOR_NOTE})` : "");
  return `::warning file=${escapeProperty(entry.path)}::${escapeData(message)}`;
};
