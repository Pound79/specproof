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

export interface SpecproofConfig {
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

const CONFIG_FILENAMES = ["specproof.config.yaml", "specproof.config.yml"];

// Pre-rename filenames (bdd-kit -> specproof). Still discovered, but emit a
// deprecation warning to stderr so repos migrate at their own pace.
const LEGACY_CONFIG_FILENAMES = ["bdd-kit.config.yaml", "bdd-kit.config.yml"];

// ---------------------------------------------------------------------------
// loadSpecproofConfig
// ---------------------------------------------------------------------------

/**
 * Walks up the directory tree from `startDir` (default `process.cwd()`) until
 * it finds a `specproof.config.yaml` (or `.yml`) file. Falls back to the
 * deprecated `bdd-kit.config.yaml` name when the current name is absent.
 * Parses and returns the contents as a {@link SpecproofConfig}.
 *
 * Throws a descriptive error when no config file is found in any ancestor
 * directory.
 */
export function loadSpecproofConfig(startDir?: string): SpecproofConfig {
  const begin = path.resolve(startDir ?? process.cwd());
  let dir = begin;

  for (;;) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(dir, filename);
      if (existsSync(candidate)) {
        return parseConfigFile(candidate);
      }
    }
    for (const filename of LEGACY_CONFIG_FILENAMES) {
      const candidate = path.join(dir, filename);
      if (existsSync(candidate)) {
        process.stderr.write(
          `${filename} is deprecated; rename it to specproof.config.yaml\n`,
        );
        return parseConfigFile(candidate);
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
    `specproof: could not find ${CONFIG_FILENAMES.join(" or ")} in "${begin}" ` +
      "or any of its ancestor directories. " +
      "Run `specproof init` to create a config file at your repo root, " +
      "or pass an explicit `startDir` to loadSpecproofConfig().",
  );
}

const parseConfigFile = (candidate: string): SpecproofConfig => {
  let raw: unknown;
  try {
    raw = parse(readFileSync(candidate, "utf8"));
  } catch (error) {
    throw new Error(
      `specproof: failed to parse config file at "${candidate}": ${(error as Error).message}`,
    );
  }
  if (raw == null || typeof raw !== "object") {
    throw new Error(
      `specproof: config file at "${candidate}" is empty or not a YAML mapping.`,
    );
  }
  return raw as SpecproofConfig;
};

// ---------------------------------------------------------------------------
// resolveActiveEnvironment
// ---------------------------------------------------------------------------

/**
 * Resolves the active environment profile from the config based on the
 * `SPECPROOF_ENV` environment variable (falling back to the deprecated
 * `BDD_KIT_ENV` when `SPECPROOF_ENV` is unset).
 *
 * Selection order:
 * 1. `SPECPROOF_ENV` is set → match by `name`. Throws if no match.
 * 2. `SPECPROOF_ENV` is unset, `BDD_KIT_ENV` is set → match by `name`. Throws if no match.
 * 3. Neither is set → first entry with `default: true`.
 * 4. No default → first entry in the list.
 *
 * `environments` is required (at least 1 entry) — this function always
 * returns a profile.
 */
export function resolveActiveEnvironment(
  cfg: SpecproofConfig,
): EnvironmentProfile {
  const profiles = cfg.environments;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error(
      "specproof: environments[] must have at least 1 entry in specproof.config.yaml.",
    );
  }

  const envName = process.env.SPECPROOF_ENV?.trim();
  const legacyEnvName = process.env.BDD_KIT_ENV?.trim();

  if (envName && envName.length > 0) {
    const match = profiles.find((p) => p.name === envName);
    if (match) {
      return match;
    }
    throw new Error(
      `specproof: SPECPROOF_ENV="${envName}" does not match any environments[] entry ` +
        `(available: ${profiles.map((p) => p.name).join(", ")}).`,
    );
  }

  if (legacyEnvName && legacyEnvName.length > 0) {
    process.stderr.write(
      "BDD_KIT_ENV is deprecated; rename it to SPECPROOF_ENV\n",
    );
    const match = profiles.find((p) => p.name === legacyEnvName);
    if (match) {
      return match;
    }
    throw new Error(
      `specproof: BDD_KIT_ENV="${legacyEnvName}" does not match any environments[] entry ` +
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
  cfg: SpecproofConfig,
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
