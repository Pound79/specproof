import type { DriftEntry, DriftReport, DriftWarning } from "./check.js";

export const describeEntry = (entry: DriftEntry): string => {
  const location = entry.heading ? `${entry.path} § ${entry.heading}` : entry.path;
  return `[${entry.side}] ${location} — ${entry.status}`;
};

// failsUnderStrict reflects the warning's *kind* (would --strict treat this
// as an error, per the repo's config), independent of whether this run
// actually passed --strict. It lets callers distinguish hard warnings from
// advisory ones (unregistered-impl / unregistered-spec-heading without their
// opt-in flags) even in a plain, non-strict run.
export const describeWarning = (warning: DriftWarning, failsUnderStrict: boolean): string =>
  `[${failsUnderStrict ? "warning" : "advisory"}] ${warning.message}`;

// GitHub workflow command の data と property は異なる escape 規則を持つ。
const escapeData = (value: string): string =>
  value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (value: string): string =>
  escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");

export const toGithubWarningAnnotation = (warning: DriftWarning): string =>
  `::warning::specproof traceability: ${escapeData(warning.message)}`;

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

// A-3: display-only truncation for unregistered-impl warnings (JSON output
// always carries the full list — see checkDrift). A repo with implGlobs
// pointed at a broad tree can produce hundreds of matches; printing all of
// them buries the other warnings. Non-unregistered-impl warnings are never
// truncated.
export interface DisplayWarnings {
  shown: DriftWarning[];
  hiddenCount: number;
}

// Advisory kinds that can fire many times on a real suite are capped so they
// do not push the other warnings (and GitHub's per-step annotation budget)
// out of view. The full list stays available in --json.
const DISPLAY_LIMITS: Partial<Record<DriftWarning["kind"], number>> = {
  "unregistered-impl": 20,
  "possible-contradiction": 10,
};

export const selectWarningsForDisplay = (warnings: DriftWarning[]): DisplayWarnings => {
  const seen = new Map<DriftWarning["kind"], number>();
  const shown = warnings.filter((warning) => {
    const limit = DISPLAY_LIMITS[warning.kind];
    if (limit === undefined) return true;
    const count = (seen.get(warning.kind) ?? 0) + 1;
    seen.set(warning.kind, count);
    return count <= limit;
  });
  return { shown, hiddenCount: warnings.length - shown.length };
};

export const toGithubAnnotation = (entry: DriftEntry): string => {
  const message =
    `Traceability drift in link "${entry.linkId}" (${entry.side}, ${entry.status})` +
    (entry.heading ? ` at heading "${entry.heading}"` : "") +
    ". Sync the linked feature (specproof-sync) or run: specproof-update";
  return `::warning file=${escapeProperty(entry.path)}::${escapeData(message)}`;
};
