#!/usr/bin/env node
import { runInit } from "./init.js";
import type { AgentType } from "./init.js";
import { runDetect } from "./cli-detect.js";
import { runSetupAgent } from "./setup-agent.js";
import { parseFlags } from "./flags.js";

const argv = process.argv.slice(2);
const command = argv[0];

const VALID_AGENT_FLAGS = ["claude", "codex"] as const;

const usage = `specproof — BDD behavior-test kit scaffolder

Usage:
  specproof init --adapter <playwright|flutter|auto> [--dir <e2e-dir>] [--force] [--agent <claude|codex>]
  specproof detect [--json]
  specproof setup-agent <codex|claude> [--force]

Commands:
  init          Scaffold a BDD test package into the repo.
  detect        Detect the framework and suggest an adapter (read-only).
  setup-agent   Install specproof skills for a specific AI coding agent.

Options (init):
  --adapter   Test framework adapter (playwright | flutter | auto). Required.
  --dir       Target directory for the e2e package.
  --force     Overwrite existing files instead of skipping them.
  --agent     Tailor next-steps to an agent (claude | codex). Omit for both.

Options (detect):
  --json      Output detection result as JSON.

Options (setup-agent):
  --force     Overwrite existing skill files.

  -h, --help  Show this help.
`;

const parseAgentType = (value: string | boolean | undefined): AgentType | undefined => {
  if (value === undefined) return undefined;
  if (value === true) {
    throw new Error(
      `--agent requires a value. Supported: ${VALID_AGENT_FLAGS.join(", ")}`,
    );
  }
  if (VALID_AGENT_FLAGS.includes(value as typeof VALID_AGENT_FLAGS[number])) {
    return value as AgentType;
  }
  throw new Error(
    `Unknown --agent value "${value}". Supported: ${VALID_AGENT_FLAGS.join(", ")}`,
  );
};

const main = async (): Promise<void> => {
  if (command === undefined || command === "--help" || command === "-h") {
    console.log(usage);
    return;
  }
  if (command === "init") {
    const flags = parseFlags(argv.slice(1));
    await runInit({
      adapter: typeof flags.adapter === "string" ? flags.adapter : undefined,
      dir: typeof flags.dir === "string" ? flags.dir : undefined,
      force: flags.force === true,
      agent: parseAgentType(flags.agent),
    });
    return;
  }
  if (command === "detect") {
    const flags = parseFlags(argv.slice(1));
    await runDetect({ json: flags.json === true });
    return;
  }
  if (command === "setup-agent") {
    const agentArg = argv[1];
    const flags = parseFlags(argv.slice(2));
    runSetupAgent({
      agent: agentArg,
      force: flags.force === true,
    });
    return;
  }
  console.error(`Unknown command: ${command}\n\n${usage}`);
  process.exitCode = 1;
};

main().catch((error: unknown) => {
  console.error(
    "specproof failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
