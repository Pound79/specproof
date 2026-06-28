import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectSnapshot, detectAdapter } from "./detect.js";

export type AgentType = "claude" | "codex" | "all";

export interface InitOptions {
  adapter?: string;
  dir?: string;
  force?: boolean;
  agent?: AgentType;
}

const SUPPORTED = ["playwright", "flutter", "auto"];

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Locate the templates root. Two layouts are supported:
 *   1. bundled inside the published package: <pkg>/templates  (cli/dist -> cli/templates)
 *   2. monorepo / git checkout:              <kitRoot>/templates  (cli/dist -> ../../templates)
 */
const resolveTemplatesRoot = (): string => {
  const candidates = [
    path.resolve(here, "../templates"),
    path.resolve(here, "../../templates"),
  ];
  const found = candidates.find((dir) => existsSync(dir));
  if (!found) {
    throw new Error(
      `Could not locate the templates directory (looked in: ${candidates.join(", ")}).`,
    );
  }
  return found;
};

/** Recursively list files under dir, returned as paths relative to base. */
const walk = (dir: string, base: string = dir): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full, base)
      : [path.relative(base, full)];
  });

const resolveTargetDir = (repoRoot: string, dir: string): string => {
  const resolved = path.resolve(repoRoot, dir);
  const relative = path.relative(repoRoot, resolved);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return resolved;
  }
  throw new Error(`--dir must stay within the current repo: ${dir}`);
};

async function resolveAutoAdapter(
  repoRoot: string,
): Promise<{ adapter: string; dir: string }> {
  const snapshot = await collectSnapshot(repoRoot);
  const result = detectAdapter(snapshot);

  const highCandidates = result.candidates.filter(
    (c) => c.confidence === "high",
  );
  if (highCandidates.length === 1) {
    const picked = highCandidates[0];
    console.log(
      `Auto-detected adapter: ${picked.adapter} (${picked.signals.join(", ")})`,
    );
    return { adapter: picked.adapter, dir: picked.dir };
  }

  if (result.candidates.length === 0) {
    throw new Error(
      "Could not detect a framework. No pubspec.yaml (Flutter) or package.json found.\n" +
        "Specify an adapter explicitly: bdd-kit init --adapter <playwright|flutter>",
    );
  }

  const summary = result.candidates
    .map(
      (c) =>
        `  - ${c.adapter} (${c.confidence}): ${c.signals.join(", ")}`,
    )
    .join("\n");
  throw new Error(
    `Ambiguous detection — multiple or low-confidence candidates found:\n${summary}\n\n` +
      "Specify an adapter explicitly: bdd-kit init --adapter <playwright|flutter>",
  );
}

const CLAUDE_NEXT_STEPS = `
Next steps (recommended) — let the Claude Code plugin drive the flow:
  1. /plugin marketplace add Pound79/bdd-kit
  2. /plugin install bdd-kit@bdd-kit
  3. Run /bdd-kit — it detects your framework + mode and walks you through
     editing bdd-kit.config.yaml, reviewing the scaffold, and the BDD flow.`;

const CODEX_NEXT_STEPS = `
Next steps (recommended) — let the Codex skills drive the flow:
  1. npx @pound79/bdd-kit setup-agent codex
  2. Ask the agent: "run the bdd-kit skill"`;

export const buildNextSteps = (agent: AgentType): string => {
  if (agent === "claude") return CLAUDE_NEXT_STEPS;
  if (agent === "codex") return CODEX_NEXT_STEPS;
  return `${CLAUDE_NEXT_STEPS}

  — or, if you use Codex —
${CODEX_NEXT_STEPS}`;
};

export async function runInit(opts: InitOptions): Promise<void> {
  let { adapter } = opts;
  if (!adapter) {
    throw new Error(
      "--adapter is required (playwright | flutter | auto)",
    );
  }
  if (!SUPPORTED.includes(adapter)) {
    throw new Error(
      `Unknown adapter "${adapter}". Supported: ${SUPPORTED.join(", ")}`,
    );
  }

  const repoRoot = process.cwd();
  let autoDir: string | undefined;
  if (adapter === "auto") {
    const resolved = await resolveAutoAdapter(repoRoot);
    adapter = resolved.adapter;
    autoDir = resolved.dir;
  }

  const tplDir = path.join(resolveTemplatesRoot(), adapter);
  if (!existsSync(tplDir)) {
    throw new Error(`No template found for adapter "${adapter}" at ${tplDir}`);
  }

  const defaultDir =
    autoDir ?? (adapter === "flutter" ? "bdd_tests" : "packages/e2e");
  const e2eDir = resolveTargetDir(repoRoot, opts.dir ?? defaultDir);
  const force = opts.force ?? false;

  const written: string[] = [];
  const skipped: string[] = [];

  for (const rel of walk(tplDir)) {
    // npm strips files literally named ".gitignore" from the published tarball,
    // so templates ship it as "gitignore"; restore the leading dot on copy.
    const mappedRel =
      path.basename(rel) === "gitignore"
        ? path.join(path.dirname(rel), ".gitignore")
        : rel;
    // bdd-kit.config.yaml belongs at the repo root; the rest in the e2e package.
    const dest =
      mappedRel === "bdd-kit.config.yaml"
        ? path.join(repoRoot, "bdd-kit.config.yaml")
        : path.join(e2eDir, mappedRel);
    if (existsSync(dest) && !force) {
      skipped.push(path.relative(repoRoot, dest));
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(tplDir, rel), dest);
    written.push(path.relative(repoRoot, dest));
  }

  const e2eLabel = path.relative(repoRoot, e2eDir) || ".";
  console.log(`bdd-kit init (${adapter}) — scaffolded into ${e2eLabel}`);
  for (const w of written) console.log(`  + ${w}`);
  if (skipped.length > 0) {
    console.log(
      `\nSkipped ${skipped.length} existing file(s) (use --force to overwrite):`,
    );
    for (const s of skipped) console.log(`  = ${s}`);
  }
  const agentType = opts.agent ?? "all";
  const nextSteps = buildNextSteps(agentType);
  console.log(nextSteps);

  const manualSteps =
    adapter === "flutter"
      ? `  a. Edit bdd-kit.config.yaml at the repo root.
  b. cd ${e2eLabel} && flutter create --platforms=macos --project-name ${path.basename(e2eDir)} .
  c. flutter pub get && dart run build_runner build --delete-conflicting-outputs
  d. flutter test integration_test/gherkin_suite_test.dart -d macos

  See ${e2eLabel}/README.md for the verified Japanese-Gherkin recipe and gotchas.`
      : `  a. Edit bdd-kit.config.yaml at the repo root.
  b. cd ${e2eLabel} && npm install && npm run install:browsers
  c. Copy .env.example to .env and fill in credentials.
  d. npm run test:smoke`;
  console.log(`
Prefer to set things up by hand? Manual steps:
${manualSteps}`);
}
