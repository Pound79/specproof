import type { DriftEntry, DriftReport, DriftWarning } from "./check.js";

export const describeEntry = (entry: DriftEntry): string => {
  const location = entry.heading
    ? `${entry.path} § ${entry.heading}`
    : entry.path;
  return `[${entry.side}] ${location} — ${entry.status}`;
};

export const describeWarning = (warning: DriftWarning): string =>
  `[warning] ${warning.message}`;

export const toGithubWarningAnnotation = (warning: DriftWarning): string =>
  `::warning::bdd-kit traceability: ${warning.message}`;

// Pure exit-status decision shared by cli-check. Drift always fails the check;
// structural warnings (e.g. empty links) fail only under --strict, so a normal
// local run surfaces them without blocking while CI (which passes --strict)
// treats them as hard errors.
export const isCheckFailure = (
  report: DriftReport,
  strict: boolean,
): boolean => !report.clean || (strict && report.warnings.length > 0);

export const toGithubAnnotation = (entry: DriftEntry): string => {
  const message =
    `Traceability drift in link "${entry.linkId}" (${entry.side}, ${entry.status})` +
    (entry.heading ? ` at heading "${entry.heading}"` : "") +
    ". Sync the linked feature (bdd-sync) or run: bdd-traceability-update";
  return `::warning file=${entry.path}::${message}`;
};
