export type Flags = Record<string, string | boolean>;
export type Command = "init" | "detect" | "setup-agent";

const VALUE_OPTIONS = new Set(["--adapter", "--dir", "--agent"]);
const BOOLEAN_OPTIONS = new Set(["--force", "--json"]);
const COMMAND_OPTIONS: Record<Command, readonly string[]> = {
  init: ["--adapter", "--dir", "--agent", "--force"],
  detect: ["--json"],
  "setup-agent": ["--force"],
};

// 次のオプションやヘルプ指定を値として飲み込まない。`-e2e` のような単一ハイフンの値は通す。
const looksLikeOption = (value: string): boolean => value.startsWith("--") || value === "-h";

/** サブコマンドの引数に help 指定が含まれるか。 */
export const wantsHelp = (args: readonly string[]): boolean =>
  args.includes("--help") || args.includes("-h");

// コマンド実行前に全引数を検証し、誤記や値の欠落を黙って無視しない。
export const parseFlags = (args: string[], command?: Command): Flags => {
  const allowed = new Set(
    command ? COMMAND_OPTIONS[command] : [...VALUE_OPTIONS, ...BOOLEAN_OPTIONS],
  );
  const flags: Flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!allowed.has(arg)) {
      throw new Error(`Unknown option or argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (BOOLEAN_OPTIONS.has(arg)) {
      flags[key] = true;
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value.length === 0 || looksLikeOption(value)) {
      throw new Error(`${arg} requires a value`);
    }
    flags[key] = value;
    i += 1;
  }
  return flags;
};
