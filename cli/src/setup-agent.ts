import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SupportedAgent = "codex" | "claude";
const SUPPORTED_AGENTS: readonly SupportedAgent[] = ["codex", "claude"];

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Locate the skills source. Three layouts are supported:
 *   1. bundled inside the published package: <pkg>/skills   (cli/dist -> cli/skills)
 *   2. monorepo / git checkout:              <kitRoot>/plugins/bdd-kit/skills
 *   3. monorepo from src:                    <cli>/plugins/bdd-kit/skills (rare)
 */
const resolvePluginSkillsRoot = (): string => {
  const candidates = [
    path.resolve(here, "../skills"),
    path.resolve(here, "../../plugins/bdd-kit/skills"),
    path.resolve(here, "../plugins/bdd-kit/skills"),
  ];
  const found = candidates.find((dir) => existsSync(dir));
  if (!found) {
    throw new Error(
      `Could not locate the skills directory (looked in: ${candidates.join(", ")}).`,
    );
  }
  return found;
};

const walkDir = (dir: string, base: string = dir): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory()
      ? walkDir(full, base)
      : [path.relative(base, full)];
  });

const setupCodex = (repoRoot: string, force: boolean): string[] => {
  const skillsSource = resolvePluginSkillsRoot();
  const targetDir = path.join(repoRoot, ".agents", "skills");

  const written: string[] = [];
  const skipped: string[] = [];

  const skillDirs = readdirSync(skillsSource).filter((name) =>
    statSync(path.join(skillsSource, name)).isDirectory(),
  );

  for (const skillName of skillDirs) {
    const skillSrcDir = path.join(skillsSource, skillName);
    for (const rel of walkDir(skillSrcDir)) {
      const dest = path.join(targetDir, skillName, rel);
      if (existsSync(dest) && !force) {
        skipped.push(path.relative(repoRoot, dest));
        continue;
      }
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(path.join(skillSrcDir, rel), dest);
      written.push(path.relative(repoRoot, dest));
    }
  }

  console.log(`bdd-kit setup-agent codex — skills installed to .agents/skills/`);
  for (const w of written) console.log(`  + ${w}`);
  if (skipped.length > 0) {
    console.log(
      `\nSkipped ${skipped.length} existing file(s) (use --force to overwrite):`,
    );
    for (const s of skipped) console.log(`  = ${s}`);
  }
  console.log(`
Next steps:
  Ask the agent: "run the bdd-kit skill"
  The skill will detect your framework and drive the BDD flow.`);
  return written;
};

const setupClaude = (): void => {
  console.log(`bdd-kit setup-agent claude — install the plugin in Claude Code:

  /plugin marketplace add Pound79/bdd-kit
  /plugin install bdd-kit@bdd-kit
  /bdd-kit`);
};

export interface SetupAgentOptions {
  agent?: string;
  force?: boolean;
}

export function runSetupAgent(opts: SetupAgentOptions): void {
  const { agent } = opts;
  if (!agent) {
    throw new Error(
      `Usage: bdd-kit setup-agent <${SUPPORTED_AGENTS.join("|")}> [--force]`,
    );
  }
  if (!SUPPORTED_AGENTS.includes(agent as SupportedAgent)) {
    throw new Error(
      `Unknown agent "${agent}". Supported: ${SUPPORTED_AGENTS.join(", ")}\nUsage: bdd-kit setup-agent <${SUPPORTED_AGENTS.join("|")}> [--force]`,
    );
  }

  if (agent === "codex") {
    setupCodex(process.cwd(), opts.force ?? false);
  } else {
    setupClaude();
  }
}
