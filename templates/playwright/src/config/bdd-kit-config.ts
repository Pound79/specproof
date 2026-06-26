import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ProjectConfig {
  name: string;
  tags: string;
  features: string[];
  storageState: string;
  setup: boolean;
  conditional?: string;
  credentialsEnv?: {
    username: string;
    password: string;
    newPassword?: string;
  };
}

export interface RunnerConfig {
  device?: string;
  webServerCommand?: string;
  globalTeardown?: string;
  authDir?: string;
  i18nLocaleStorageKey?: string;
}

export interface EnvironmentAuth {
  readonly provider: string;
  readonly description?: string;
}

export interface EnvironmentProfile {
  readonly name: string;
  readonly default?: boolean;
  readonly dotenvFile?: string;
  readonly auth?: EnvironmentAuth;
  readonly excludeTags?: readonly string[];
  readonly envOverrides?: Readonly<Record<string, string>>;
}

export interface BddKitConfig {
  adapter: string;
  language: string;
  env: {
    baseUrl: string;
    username?: string;
    adminUsername?: string;
  };
  projects: ProjectConfig[];
  environments: readonly EnvironmentProfile[];
  runner?: RunnerConfig;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Config file names to look for when walking up the directory tree
// ---------------------------------------------------------------------------

const CONFIG_FILENAMES = ["bdd-kit.config.yaml", "bdd-kit.config.yml"];

// ---------------------------------------------------------------------------
// loadBddKitConfig
// ---------------------------------------------------------------------------

/**
 * Walks up the directory tree from `startDir` (default `process.cwd()`) until
 * it finds a `bdd-kit.config.yaml` (or `.yml`) file. Parses and returns the
 * contents as a {@link BddKitConfig}.
 *
 * Throws a descriptive error when no config file is found in any ancestor
 * directory.
 */
export function loadBddKitConfig(startDir?: string): BddKitConfig {
  const begin = path.resolve(startDir ?? process.cwd());
  let dir = begin;

  for (;;) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(dir, filename);
      if (existsSync(candidate)) {
        let raw: unknown;
        try {
          raw = parse(readFileSync(candidate, "utf8"));
        } catch (error) {
          throw new Error(
            `bdd-kit: failed to parse config file at "${candidate}": ${(error as Error).message}`,
          );
        }
        if (raw == null || typeof raw !== "object") {
          throw new Error(
            `bdd-kit: config file at "${candidate}" is empty or not a YAML mapping.`,
          );
        }
        return raw as BddKitConfig;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached the filesystem root without finding the config file.
      break;
    }
    dir = parent;
  }

  throw new Error(
    `bdd-kit: could not find ${CONFIG_FILENAMES.join(" or ")} in "${begin}" ` +
      "or any of its ancestor directories. " +
      "Run `bdd-kit init` to create a config file at your repo root, " +
      "or pass an explicit `startDir` to loadBddKitConfig().",
  );
}

// ---------------------------------------------------------------------------
// resolveActiveEnvironment
// ---------------------------------------------------------------------------

/**
 * Resolves the active environment profile from the config based on the
 * `BDD_KIT_ENV` environment variable.
 *
 * Selection order:
 * 1. `BDD_KIT_ENV` is set → match by `name`. Throws if no match.
 * 2. `BDD_KIT_ENV` is unset → first entry with `default: true`.
 * 3. No default → first entry in the list.
 *
 * `environments` is required (at least 1 entry) — this function always
 * returns a profile.
 */
export function resolveActiveEnvironment(
  cfg: BddKitConfig,
): EnvironmentProfile {
  const profiles = cfg.environments;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error(
      "bdd-kit: environments[] must have at least 1 entry in bdd-kit.config.yaml.",
    );
  }

  const envName = process.env.BDD_KIT_ENV?.trim();

  if (envName && envName.length > 0) {
    const match = profiles.find((p) => p.name === envName);
    if (match) {
      return match;
    }
    throw new Error(
      `bdd-kit: BDD_KIT_ENV="${envName}" does not match any environments[] entry ` +
        `(available: ${profiles.map((p) => p.name).join(", ")}).`,
    );
  }

  return profiles.find((p) => p.default === true) ?? profiles[0];
}

// ---------------------------------------------------------------------------
// resolveAuthProvider
// ---------------------------------------------------------------------------

/**
 * Returns the auth configuration for the active environment profile.
 * Returns `null` when the profile has no `auth` block.
 */
export function resolveAuthProvider(
  env: EnvironmentProfile,
): EnvironmentAuth | null {
  return env.auth ?? null;
}

// ---------------------------------------------------------------------------
// isTagExcludedByEnvironment
// ---------------------------------------------------------------------------

/**
 * Returns `true` when `tag` appears in the environment's `excludeTags` list.
 */
export function isTagExcludedByEnvironment(
  tag: string,
  env: EnvironmentProfile,
): boolean {
  if (!env.excludeTags || env.excludeTags.length === 0) {
    return false;
  }
  return env.excludeTags.includes(tag);
}

// ---------------------------------------------------------------------------
// isConditionMet
// ---------------------------------------------------------------------------

/**
 * Evaluates a project-level `conditional` expression against the loaded
 * config.
 *
 * Supported expression format: `"env.<fieldName>"` where `<fieldName>` is a
 * key on `cfg.env` whose value is an environment-variable **name** (e.g.
 * `"env.adminUsername"` resolves to `cfg.env.adminUsername`, then checks
 * `process.env[cfg.env.adminUsername]`).
 *
 * Returns `true` when:
 * - `condition` is `undefined` (no condition — always run the project), or
 * - the referenced environment variable is set to a non-empty string.
 *
 * Returns `false` when the env var is absent or empty, signalling that the
 * project should be skipped.
 */
export function isConditionMet(
  condition: string | undefined,
  cfg: BddKitConfig,
): boolean {
  if (condition === undefined) {
    return true;
  }

  // Parse "env.<fieldName>" expressions.
  const envPrefix = "env.";
  if (condition.startsWith(envPrefix)) {
    const fieldName = condition.slice(envPrefix.length) as keyof typeof cfg.env;
    const envVarName = cfg.env[fieldName];
    if (typeof envVarName !== "string" || envVarName.length === 0) {
      // The config field itself is missing or empty — treat as not met.
      return false;
    }
    const value = process.env[envVarName];
    return typeof value === "string" && value.length > 0;
  }

  // Unknown expression format — conservatively treat as met so projects are
  // not silently dropped when new expression types are introduced.
  return true;
}
