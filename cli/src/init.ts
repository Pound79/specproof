import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
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
 * Pick the templates root between the bundled copy and the monorepo
 * checkout source, preferring the monorepo source whenever both exist.
 *
 * `bundled` (<pkg>/templates) is a build artifact: cli/package.json's
 * `prepack` script copies the monorepo `templates/` there before `npm
 * pack` and `postpack` removes it afterward, purely so the tarball has a
 * self-contained copy. If a pack run is interrupted, that copy can be left
 * behind stale on disk. In a real published/installed package, `monorepo`
 * resolves to a path like `node_modules/@pound79/templates`, and no such
 * package exists in that scope — so both candidates existing at once can
 * only happen in a monorepo checkout with a stale `prepack` leftover, and
 * in that case the monorepo source is always the authoritative, current one.
 */
export const pickTemplatesRoot = (
  bundled: string,
  monorepo: string,
): string | undefined => {
  if (existsSync(monorepo)) return monorepo;
  if (existsSync(bundled)) return bundled;
  return undefined;
};

/**
 * Locate the templates root. Two layouts are supported:
 *   1. bundled inside the published package: <pkg>/templates  (cli/dist -> cli/templates)
 *   2. monorepo / git checkout:              <kitRoot>/templates  (cli/dist -> ../../templates)
 */
const resolveTemplatesRoot = (): string => {
  const bundled = path.resolve(here, "../templates");
  const monorepo = path.resolve(here, "../../templates");
  const found = pickTemplatesRoot(bundled, monorepo);
  if (!found) {
    throw new Error(
      `Could not locate the templates directory (looked in: ${bundled}, ${monorepo}).`,
    );
  }
  return found;
};

/** Recursively list files under dir, returned as paths relative to base. */
// Local build leftovers that can appear inside a template checkout (they are
// gitignored, so they exist only in working trees where someone ran the
// template locally). Copying them into a consumer scaffold — or into the
// published tarball via cli's prepack — would ship stale generated state.
const SCAFFOLD_EXCLUDED_DIRS = new Set([".dart_tool", "node_modules", ".git"]);
const SCAFFOLD_EXCLUDED_FILES = new Set([
  ".flutter-plugins",
  ".flutter-plugins-dependencies",
  "pubspec.lock",
]);

export const isScaffoldExcluded = (name: string, isDirectory: boolean): boolean =>
  isDirectory
    ? SCAFFOLD_EXCLUDED_DIRS.has(name)
    : SCAFFOLD_EXCLUDED_FILES.has(name);

const walk = (dir: string, base: string = dir): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const isDirectory = statSync(full).isDirectory();
    if (isScaffoldExcluded(name, isDirectory)) return [];
    return isDirectory ? walk(full, base) : [path.relative(base, full)];
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

export async function resolveAutoAdapter(
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
        "Specify an adapter explicitly: specproof init --adapter <playwright|flutter>",
    );
  }

  // No single high-confidence winner. A lone medium-confidence candidate
  // (e.g. a plain React app with no BDD deps yet) is still an unambiguous
  // pick — only low-confidence-only or genuinely competing candidates fall
  // through to the Ambiguous error below.
  if (highCandidates.length === 0) {
    const mediumCandidates = result.candidates.filter(
      (c) => c.confidence === "medium",
    );
    if (mediumCandidates.length === 1) {
      const picked = mediumCandidates[0];
      console.log(
        `Auto-detected adapter: ${picked.adapter} (medium confidence — signals: ${picked.signals.join(", ")}). ` +
          "Re-run with --adapter to override.",
      );
      return { adapter: picked.adapter, dir: picked.dir };
    }
  }

  const summary = result.candidates
    .map(
      (c) =>
        `  - ${c.adapter} (${c.confidence}): ${c.signals.join(", ")}`,
    )
    .join("\n");
  throw new Error(
    `Ambiguous detection — multiple or low-confidence candidates found:\n${summary}\n\n` +
      "Specify an adapter explicitly: specproof init --adapter <playwright|flutter>",
  );
}

const CLAUDE_NEXT_STEPS = `
Next steps (recommended) — let the Claude Code plugin drive the flow:
  1. /plugin marketplace add Pound79/specproof
  2. /plugin install specproof@specproof
  3. Run /specproof — it detects your framework + mode and walks you through
     editing specproof.config.yaml, reviewing the scaffold, and the BDD flow.`;

const CODEX_NEXT_STEPS = `
Next steps (recommended) — let the Codex skills drive the flow:
  1. npx @pound79/specproof setup-agent codex
  2. Ask the agent: "run the specproof skill"`;

export const buildNextSteps = (agent: AgentType): string => {
  if (agent === "claude") return CLAUDE_NEXT_STEPS;
  if (agent === "codex") return CODEX_NEXT_STEPS;
  return `${CLAUDE_NEXT_STEPS}

  — or, if you use Codex —
${CODEX_NEXT_STEPS}`;
};

/** Literal e2e-package path baked into each template's specproof.config.yaml. */
const templateDefaultDir = (adapter: string): string =>
  adapter === "flutter" ? "bdd_tests" : "packages/e2e";

export interface ScaffoldResult {
  written: string[];
  skipped: string[];
  skippedWorkflows: string[];
  layoutRewritten: boolean;
}

/**
 * Copy a template tree into the target repo, applying the same path
 * mappings `specproof init` has always used (gitignore -> .gitignore,
 * specproof.config.yaml -> repo root) plus two additions:
 *   - specproof.config.yaml's hardcoded layout paths are rewritten to match
 *     `e2eDir` when it differs from the template's default (H4).
 *   - files under `github-workflows/` land in `<repoRoot>/.github/workflows/`
 *     instead of the e2e package, and are never overwritten (even with
 *     --force) so a consumer's own CI edits are never clobbered.
 */
export function scaffoldTemplate(params: {
  tplDir: string;
  repoRoot: string;
  e2eDir: string;
  templateDefaultDir: string;
  force: boolean;
}): ScaffoldResult {
  const { tplDir, repoRoot, e2eDir, templateDefaultDir, force } = params;
  const e2eRelPosix = path.relative(repoRoot, e2eDir).split(path.sep).join("/");

  const written: string[] = [];
  const skipped: string[] = [];
  const skippedWorkflows: string[] = [];
  let layoutRewritten = false;

  for (const rel of walk(tplDir)) {
    // npm strips files literally named ".gitignore" from the published tarball,
    // so templates ship it as "gitignore"; restore the leading dot on copy.
    const mappedRel =
      path.basename(rel) === "gitignore"
        ? path.join(path.dirname(rel), ".gitignore")
        : rel;

    const relParts = mappedRel.split(path.sep);
    const isWorkflow = relParts[0] === "github-workflows";
    const isConfig = mappedRel === "specproof.config.yaml";

    // specproof.config.yaml belongs at the repo root; github-workflows/* belongs
    // in .github/workflows/; everything else lands in the e2e package.
    const dest = isConfig
      ? path.join(repoRoot, "specproof.config.yaml")
      : isWorkflow
        ? path.join(repoRoot, ".github", "workflows", ...relParts.slice(1))
        : path.join(e2eDir, mappedRel);

    // Workflow files never overwrite an existing consumer CI file, even with
    // --force; everything else follows the usual --force semantics.
    if (existsSync(dest) && (isWorkflow || !force)) {
      (isWorkflow ? skippedWorkflows : skipped).push(
        path.relative(repoRoot, dest),
      );
      continue;
    }

    mkdirSync(path.dirname(dest), { recursive: true });

    if (isConfig) {
      const raw = readFileSync(path.join(tplDir, rel), "utf-8");
      const content =
        e2eRelPosix !== templateDefaultDir
          ? raw.split(templateDefaultDir).join(e2eRelPosix)
          : raw;
      if (content !== raw) layoutRewritten = true;
      writeFileSync(dest, content);
    } else {
      copyFileSync(path.join(tplDir, rel), dest);
    }

    written.push(path.relative(repoRoot, dest));
  }

  return { written, skipped, skippedWorkflows, layoutRewritten };
}

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

  const fallbackDir =
    autoDir ?? (adapter === "flutter" ? "bdd_tests" : "packages/e2e");
  const e2eDir = resolveTargetDir(repoRoot, opts.dir ?? fallbackDir);
  const force = opts.force ?? false;

  const { written, skipped, skippedWorkflows, layoutRewritten } =
    scaffoldTemplate({
      tplDir,
      repoRoot,
      e2eDir,
      templateDefaultDir: templateDefaultDir(adapter),
      force,
    });

  const e2eLabel = path.relative(repoRoot, e2eDir) || ".";
  console.log(`specproof init (${adapter}) — scaffolded into ${e2eLabel}`);
  for (const w of written) console.log(`  + ${w}`);
  if (layoutRewritten) {
    console.log(`layout paths rewritten for ${e2eLabel}`);
  }
  if (skipped.length > 0) {
    console.log(
      `\nSkipped ${skipped.length} existing file(s) (use --force to overwrite):`,
    );
    for (const s of skipped) console.log(`  = ${s}`);
  }
  if (skippedWorkflows.length > 0) {
    console.log(
      `\nSkipped ${skippedWorkflows.length} existing CI workflow file(s) ` +
        "(never overwritten, even with --force — merge manually):",
    );
    for (const s of skippedWorkflows) console.log(`  = ${s}`);
  }
  const agentType = opts.agent ?? "all";
  const nextSteps = buildNextSteps(agentType);
  console.log(nextSteps);

  const manualSteps =
    adapter === "flutter"
      ? `  a. Edit specproof.config.yaml at the repo root.
  b. cd ${e2eLabel} && flutter create --platforms=macos --project-name ${path.basename(e2eDir)} .
  c. flutter pub get && dart run build_runner build --delete-conflicting-outputs
  d. flutter test integration_test/gherkin_suite_test.dart -d macos

  See ${e2eLabel}/README.md for the verified Japanese-Gherkin recipe and gotchas.`
      : `  a. Edit specproof.config.yaml at the repo root.
  b. cd ${e2eLabel} && npm install && npm run install:browsers
  c. Copy .env.example to .env and fill in credentials.
  d. npm run test:smoke`;
  console.log(`
Prefer to set things up by hand? Manual steps:
${manualSteps}`);
}
