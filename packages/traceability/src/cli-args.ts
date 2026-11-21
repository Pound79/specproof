// traceability CLI 共通の引数検証。未知の引数は処理を始める前に拒否する。
import { printable } from "./display-text.js";
import { printErrorText } from "./output.js";

type ValueOptionKey =
  | "manifest"
  | "root"
  | "pagesDir"
  | "candidateSuffix"
  | "linkId"
  | "specRef"
  | "recordSpecSource";

const VALUE_OPTIONS: Record<string, ValueOptionKey> = {
  "--manifest": "manifest",
  "--root": "root",
  "--pages-dir": "pagesDir",
  "--candidate-suffix": "candidateSuffix",
  "--link-id": "linkId",
  "--spec-ref": "specRef",
  "--record-spec-source": "recordSpecSource",
};
const BOOLEAN_OPTIONS = [
  "--strict",
  "--json",
  "--github-annotations",
  "--dry-run",
  "--since-bless",
  "--spec-sources",
  "--allow-head-mismatch",
];
export type TraceabilityCommand = "check" | "update" | "list" | "stats";
const COMMAND_OPTIONS: Record<TraceabilityCommand, readonly string[]> = {
  check: [
    "--manifest",
    "--root",
    "--strict",
    "--json",
    "--github-annotations",
    "--since-bless",
    "--spec-sources",
  ],
  update: [
    "--manifest",
    "--root",
    "--link-id",
    "--spec-ref",
    "--dry-run",
    "--record-spec-source",
    "--allow-head-mismatch",
  ],
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
  /** `--record-spec-source <name>`: 取り込み元のコミットを manifest に記録する（hash は更新しない）。 */
  recordSpecSource?: string;
  /** `--link-id` は重ねて指定でき、指定した順に集める（重複はそのまま。除くのは使う側）。 */
  linkIds?: string[];
  /** `--spec-ref` も重ねて指定でき、指定した順に集める。 */
  specRefs?: string[];
}

/** 引数の誤り。利用者が直す入力なので、スタックを出さずにメッセージだけを示す。 */
export class CliUsageError extends Error {
  override name = "CliUsageError";
}

// 次のオプションやヘルプ指定を値として飲み込まない。`-page.ts` のような単一ハイフンの値は通す。
const looksLikeOption = (value: string): boolean => value.startsWith("--") || value === "-h";

export const parseCliArgs = (argv: string[], command?: TraceabilityCommand): ParsedCliArgs => {
  const allowed = new Set(
    command ? COMMAND_OPTIONS[command] : [...Object.keys(VALUE_OPTIONS), ...BOOLEAN_OPTIONS],
  );
  const flags = new Set<string>();
  const values: Partial<Record<Exclude<ValueOptionKey, "linkId" | "specRef">, string>> = {};
  const linkIds: string[] = [];
  const specRefs: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!allowed.has(arg)) {
      throw new CliUsageError(`Unknown option or argument: ${arg}`);
    }
    const key = VALUE_OPTIONS[arg];
    if (key === undefined) {
      flags.add(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.length === 0 || looksLikeOption(value)) {
      throw new CliUsageError(`${arg} requires a value`);
    }
    if (key === "linkId") {
      linkIds.push(value);
    } else if (key === "specRef") {
      specRefs.push(value);
    } else {
      values[key] = value;
    }
    i += 1;
  }

  return {
    flags,
    ...values,
    ...(linkIds.length > 0 ? { linkIds } : {}),
    ...(specRefs.length > 0 ? { specRefs } : {}),
  };
};

/**
 * Runs a CLI `main()`, funnelling any thrown error into a consistent
 * "<name> failed:" message and a non-zero exit code instead of an unhandled
 * promise rejection.
 */
export const runCli = (name: string, main: () => Promise<void>): void => {
  main().catch((error: unknown) => {
    // 公開リポジトリの CI ログは誰でも読めるので、既定ではスタック（実行環境のファイル配置）を
    // 出さず、メッセージを 1 行にして出す。メッセージには利用者のリポジトリ由来の文字列が
    // 入りうるので、改行や制御文字で行頭にワークフローコマンドや偽の行を作らせない。
    // 調査でスタックが要るときは SPECPROOF_DEBUG=1 で出す。
    const message = error instanceof Error ? error.message : String(error);
    printErrorText(`${name} failed: ${printable(message)}`);
    if (!(error instanceof CliUsageError) && process.env.SPECPROOF_DEBUG === "1") {
      console.error(error);
    }
    process.exitCode = 2;
  });
};
