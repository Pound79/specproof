// traceability CLI 共通の引数検証。未知の引数は処理を始める前に拒否する。
type ValueOptionKey =
  | "manifest"
  | "root"
  | "pagesDir"
  | "candidateSuffix"
  | "linkId";

const VALUE_OPTIONS: Record<string, ValueOptionKey> = {
  "--manifest": "manifest",
  "--root": "root",
  "--pages-dir": "pagesDir",
  "--candidate-suffix": "candidateSuffix",
  "--link-id": "linkId",
};
const BOOLEAN_OPTIONS = ["--strict", "--json", "--github-annotations", "--dry-run"];
export type TraceabilityCommand = "check" | "update" | "list" | "stats";
const COMMAND_OPTIONS: Record<TraceabilityCommand, readonly string[]> = {
  check: ["--manifest", "--root", "--strict", "--json", "--github-annotations"],
  update: ["--manifest", "--root", "--link-id", "--dry-run"],
  list: ["--manifest", "--root", "--pages-dir", "--candidate-suffix", "--json"],
  stats: ["--manifest", "--root", "--strict", "--json"],
};

export interface ParsedCliArgs {
  /** 検証済みの真偽値フラグ。 */
  flags: Set<string>;
  manifest?: string;
  root?: string;
  pagesDir?: string;
  candidateSuffix?: string;
  linkId?: string;
}

export const parseCliArgs = (
  argv: string[],
  command?: TraceabilityCommand,
): ParsedCliArgs => {
  const allowed = new Set(command
    ? COMMAND_OPTIONS[command]
    : [...Object.keys(VALUE_OPTIONS), ...BOOLEAN_OPTIONS]);
  const flags = new Set<string>();
  const values: Partial<Record<ValueOptionKey, string>> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!allowed.has(arg)) {
      throw new Error(`Unknown option or argument: ${arg}`);
    }
    const key = VALUE_OPTIONS[arg];
    if (key === undefined) {
      flags.add(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.length === 0 || value.startsWith("-")) {
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
