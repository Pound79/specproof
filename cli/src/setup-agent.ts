import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNotHardLinked,
  assertSafeRepositoryWrite,
  walkRegularFilesWithoutSymlinks,
} from "./path-security.js";
import { ScaffoldJournal } from "./scaffold-journal.js";

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

const setupCodex = (repoRoot: string, force: boolean): string[] => {
  const skillsSource = resolvePluginSkillsRoot();
  const targetDir = path.join(repoRoot, ".agents", "skills");
  assertSafeRepositoryWrite(repoRoot, targetDir);

  const written: string[] = [];
  const skipped: string[] = [];
  const journal = new ScaffoldJournal(repoRoot);

  try {
    for (const rel of walkRegularFilesWithoutSymlinks(skillsSource)) {
      const dest = path.join(targetDir, rel);
      assertSafeRepositoryWrite(repoRoot, dest);
      if (existsSync(dest) && !force) {
        skipped.push(path.relative(repoRoot, dest));
        continue;
      }
      assertNotHardLinked(dest);
      journal.recordCreatedDir(mkdirSync(path.dirname(dest), { recursive: true }));
      journal.recordBefore(dest);
      copyFileSync(path.join(skillsSource, rel), dest);
      journal.recordWritten(dest);
      written.push(path.relative(repoRoot, dest));
    }
  } catch (error) {
    // 半端な skill を残さない。この実行の書き込みを取り消してから知らせる（init と同じ）。
    const { undone, failed } = journal.rollback();
    const reason = (error instanceof Error ? error.message : String(error)).replace(/\.$/, "");
    const notRestored =
      failed.length === 0
        ? ""
        : ` Could not restore: ${failed.map((file) => path.relative(repoRoot, file)).join(", ")}.`;
    throw new Error(
      `specproof setup-agent codex failed and rolled back ${undone} file(s) it had written: ${reason}.${notRestored}`,
      { cause: error },
    );
  }

  console.log(`specproof setup-agent codex — skills installed to .agents/skills/`);
  for (const w of written) console.log(`  + ${w}`);
  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length} existing file(s) (use --force to overwrite):`);
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
    throw new Error(`Usage: specproof setup-agent <${SUPPORTED_AGENTS.join("|")}> [--force]`);
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
