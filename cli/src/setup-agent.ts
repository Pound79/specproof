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
 * Pick the skills root between the bundled copy and the monorepo checkout
 * candidates (checked in preference order), preferring the first existing
 * monorepo candidate whenever any monorepo candidate exists.
 *
 * `bundled` (<pkg>/skills) is a build artifact: cli/package.json's
 * `prepack` script copies `plugins/specproof/skills` there before `npm pack`
 * and `postpack` removes it afterward. If a pack run is interrupted, that
 * copy can be left behind stale on disk. In a real published/installed
 * package none of the monorepo candidates exist, so this only changes
 * behavior inside a monorepo checkout — where the monorepo source is
 * always the authoritative, current one (same rationale as
 * init.ts's pickTemplatesRoot).
 */
export const pickPluginSkillsRoot = (
  bundled: string,
  monorepoCandidates: readonly string[],
): string | undefined => {
  const monorepoMatch = monorepoCandidates.find((dir) => existsSync(dir));
  if (monorepoMatch) return monorepoMatch;
  return existsSync(bundled) ? bundled : undefined;
};

/**
 * Locate the skills source. Three layouts are supported:
 *   1. bundled inside the published package: <pkg>/skills   (cli/dist -> cli/skills)
 *   2. monorepo / git checkout:              <kitRoot>/plugins/specproof/skills
 *   3. monorepo from src:                    <cli>/plugins/specproof/skills (rare)
 */
const resolvePluginSkillsRoot = (): string => {
  const bundled = path.resolve(here, "../skills");
  const monorepoCandidates = [
    path.resolve(here, "../../plugins/specproof/skills"),
    path.resolve(here, "../plugins/specproof/skills"),
  ];
  const found = pickPluginSkillsRoot(bundled, monorepoCandidates);
  if (!found) {
    throw new Error(
      `Could not locate the skills directory (looked in: ${[bundled, ...monorepoCandidates].join(", ")}).`,
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

  console.log(`specproof setup-agent codex — skills installed to .agents/skills/`);
  for (const w of written) console.log(`  + ${w}`);
  if (skipped.length > 0) {
    console.log(
      `\nSkipped ${skipped.length} existing file(s) (use --force to overwrite):`,
    );
    for (const s of skipped) console.log(`  = ${s}`);
  }
  console.log(`
Next steps:
  Ask the agent: "run the specproof skill"
  The skill will detect your framework and drive the BDD flow.`);
  return written;
};

const setupClaude = (): void => {
  console.log(`specproof setup-agent claude — install the plugin in Claude Code:

  /plugin marketplace add Pound79/specproof
  /plugin install specproof@specproof
  /specproof`);
};

export interface SetupAgentOptions {
  agent?: string;
  force?: boolean;
}

export function runSetupAgent(opts: SetupAgentOptions): void {
  const { agent } = opts;
  if (!agent) {
    throw new Error(
      `Usage: specproof setup-agent <${SUPPORTED_AGENTS.join("|")}> [--force]`,
    );
  }
  if (!SUPPORTED_AGENTS.includes(agent as SupportedAgent)) {
    throw new Error(
      `Unknown agent "${agent}". Supported: ${SUPPORTED_AGENTS.join(", ")}\nUsage: specproof setup-agent <${SUPPORTED_AGENTS.join("|")}> [--force]`,
    );
  }

  if (agent === "codex") {
    setupCodex(process.cwd(), opts.force ?? false);
  } else {
    setupClaude();
  }
}
