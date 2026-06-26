# bdd-setup: auto-detect adapter and scaffold

## Problem

Users must manually determine the correct adapter (`playwright` | `flutter`) and
run `bdd-kit init --adapter <choice>`. When a bdd-* skill fires without
`bdd-kit.config.yaml` it stops and asks the user to run the CLI manually.
There is no entry point that reads the repo and drives the entire setup flow.

## Solution

Two-layer addition:

1. **CLI**: deterministic detection logic (`bdd-kit detect` + `init --adapter auto`)
   tested with vitest.
2. **Plugin skill**: `bdd-setup` — natural-language entry point that calls the CLI,
   confirms with the user, and tailors `bdd-kit.config.yaml` to the repo.

## CLI changes

### `cli/src/detect.ts` (pure function, no fs)

```ts
interface RepoSnapshot {
  rootFiles: string[];
  packageJson?: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    workspaces?: string[] | { packages: string[] };
  };
  pubspecYaml?: { hasFlutterSdk: boolean };
}

type Confidence = "high" | "medium" | "low";
type Adapter = "flutter" | "playwright";

interface AdapterCandidate {
  adapter: Adapter;
  confidence: Confidence;
  dir: string;
  signals: string[];
}

interface ConfigHints {
  baseUrl?: string;
  language?: string;
  monorepo: boolean;
}

interface DetectResult {
  candidates: AdapterCandidate[];
  hints: ConfigHints;
}

function detectAdapter(snapshot: RepoSnapshot): DetectResult;
```

Detection rules (strongest first):

| Signal | Adapter | Confidence |
|--------|---------|------------|
| pubspec.yaml with flutter SDK | flutter | high |
| deps include `@playwright/test` or `playwright-bdd` | playwright | high |
| deps include web framework (react/vue/svelte/next/vite/@angular/core) | playwright | medium |
| package.json exists, no web framework detected | playwright | low |
| neither pubspec.yaml nor package.json | no candidates | - |

`collectSnapshot(root: string): Promise<RepoSnapshot>` reads the filesystem
and feeds the pure function.

### `bdd-kit detect` command

- Runs `collectSnapshot(cwd)` then `detectAdapter(snapshot)`.
- `--json`: print `DetectResult` to stdout.
- Human-readable summary by default.
- Always read-only (zero writes).

### `init --adapter auto`

- Calls `detectAdapter`. If exactly one high-confidence candidate, uses it.
- Otherwise prints candidates and exits with code 1 (does not guess).

### Test file: `cli/src/__tests__/detect.test.ts`

Tests the pure `detectAdapter()` with snapshot fixtures:
- Flutter-only repo
- Playwright-only repo (direct dep)
- Web framework repo (medium confidence)
- Bare package.json (low confidence)
- Monorepo with both Flutter and web packages
- Empty repo (no candidates)

## Plugin skill: `bdd-setup`

### Frontmatter trigger

```yaml
name: bdd-setup
description: >
  Set up / introduce bdd-kit into the current repository. Detects the
  framework (Flutter / Playwright web), scaffolds config and templates,
  then tailors bdd-kit.config.yaml to the repo.
```

### Steps

0. Pre-check: if `bdd-kit.config.yaml` already exists, switch to
   verification mode (suggest bdd-drift / bdd-traceability-check).
1. Run `npx -y @pound79/bdd-kit detect --json` and parse result.
2. Confirmation gate: single high -> confirm and proceed; multiple/low/none ->
   ask the user (never guess).
3. Run `npx -y @pound79/bdd-kit init --adapter <confirmed> --dir <confirmed>`.
4. Tailor `bdd-kit.config.yaml` to repo reality:
   - `baseUrl` from dev script detection
   - `language` (ja/en from locale files or README language)
   - `projects` (auth role detection from env examples)
   - `layout.*` paths adjusted to actual directory structure
   - flutter: `device` target
5. Print next steps (install, build, test) without executing them.
6. Suggest next skill (`/bdd-bootstrap` for existing domains,
   `/bdd-new-feature` for new).

### Safety

- Never overwrite existing `bdd-kit.config.yaml` without explicit consent.
- Always confirm adapter choice when ambiguous.
- Do not auto-execute heavy side-effect commands (npm install, flutter create).

## Files changed

- `cli/src/detect.ts` (new)
- `cli/src/__tests__/detect.test.ts` (new)
- `cli/src/index.ts` (add detect command, init --adapter auto)
- `cli/src/init.ts` (auto adapter resolution)
- `cli/package.json` (add vitest, test script)
- `cli/tsconfig.json` (add noEmit tsconfig for typecheck vs build separation)
- `plugins/bdd-kit/skills/bdd-setup/SKILL.md` (new)
- `plugins/bdd-kit/.claude-plugin/plugin.json` (mention bdd-setup)
