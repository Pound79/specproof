// Shared argv parsing + error-exit wrapper for the three traceability CLIs
// (cli-check / cli-update / cli-list). Each CLI destructures only the fields
// it needs; unknown tokens fall through to `flags` (e.g. --json, --github-annotations).

type ValueOptionKey =
  | "manifest"
  | "root"
  | "pagesDir"
  | "candidateSuffix"
  | "linkId";

// Maps a value-taking flag to the ParsedCliArgs key it populates. Anything not
// listed here is treated as a boolean flag.
const VALUE_OPTIONS: Record<string, ValueOptionKey> = {
  "--manifest": "manifest",
  "--root": "root",
  "--pages-dir": "pagesDir",
  "--candidate-suffix": "candidateSuffix",
  "--link-id": "linkId",
};

export interface ParsedCliArgs {
  /** Boolean flags and any unrecognized tokens (e.g. --json). */
  flags: Set<string>;
  manifest?: string;
  root?: string;
  pagesDir?: string;
  candidateSuffix?: string;
  linkId?: string;
}

export const parseCliArgs = (argv: string[]): ParsedCliArgs => {
  const flags = new Set<string>();
  const values: Partial<Record<ValueOptionKey, string>> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = VALUE_OPTIONS[arg];
    if (key === undefined) {
      flags.add(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`${arg} requires a value`);
    }
    values[key] = value;
    i += 1;
  }

  return { flags, ...values };
};

/**
 * Runs a CLI `main()`, funnelling any thrown error into a consistent
 * "<name> failed:" message and a non-zero exit code instead of an unhandled
 * promise rejection.
 */
export const runCli = (name: string, main: () => Promise<void>): void => {
  main().catch((error: unknown) => {
    console.error(`${name} failed:`, error);
    process.exitCode = 2;
  });
};
