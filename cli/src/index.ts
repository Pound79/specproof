#!/usr/bin/env node
import { runInit } from "./init.js";
import { runDetect } from "./cli-detect.js";
import { parseFlags } from "./flags.js";

const argv = process.argv.slice(2);
const command = argv[0];

const usage = `bdd-kit — BDD behavior-test kit scaffolder

Usage:
  bdd-kit init --adapter <playwright|flutter|auto> [--dir <e2e-dir>] [--force]
  bdd-kit detect [--json]

Commands:
  init      Scaffold a BDD test package into the repo.
  detect    Detect the framework and suggest an adapter (read-only).

Options (init):
  --adapter   Test framework adapter (playwright | flutter | auto). Required.
  --dir       Target directory for the e2e package.
  --force     Overwrite existing files instead of skipping them.

Options (detect):
  --json      Output detection result as JSON.

  -h, --help  Show this help.
`;

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
    });
    return;
  }
  if (command === "detect") {
    const flags = parseFlags(argv.slice(1));
    await runDetect({ json: flags.json === true });
    return;
  }
  console.error(`Unknown command: ${command}\n\n${usage}`);
  process.exitCode = 1;
};

main().catch((error: unknown) => {
  console.error(
    "bdd-kit failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
