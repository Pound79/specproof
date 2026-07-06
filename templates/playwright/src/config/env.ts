import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import type {
  SpecproofConfig,
  EnvironmentProfile,
  ProjectConfig,
} from "./specproof-config";

// ---------------------------------------------------------------------------
// Package root (used as base for dotenv file resolution)
// ---------------------------------------------------------------------------

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// ---------------------------------------------------------------------------
// loadDotenv — environment-profile-aware dotenv loading
// ---------------------------------------------------------------------------

/**
 * Loads the appropriate `.env` file based on the active environment profile.
 *
 * - When `env.dotenvFile` is set, loads that file instead of `.env`.
 * - When `env.envOverrides` is set, injects those values into `process.env`
 *   (shell-exported variables still take precedence, matching dotenv semantics).
 */
export function loadDotenv(env: EnvironmentProfile): void {
  const dotenvPath = env.dotenvFile
    ? path.join(packageRoot, env.dotenvFile)
    : path.join(packageRoot, ".env");

  // `quiet: true` keeps dotenv v17 from printing its runtime/tips banner to
  // stdout (v17 flipped the default to false), so it stays out of test output.
  dotenv.config({ path: dotenvPath, quiet: true });

  if (env?.envOverrides) {
    for (const [key, value] of Object.entries(env.envOverrides)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Credentials {
  readonly username: string;
  readonly password: string;
  /** Set only when the app requires a forced password-change flow on first login. */
  readonly newPassword?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const trimmed = (value: string | undefined): string | undefined => {
  const next = value?.trim();
  return next && next.length > 0 ? next : undefined;
};

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/**
 * Auto-start the app's dev server for local runs when explicitly opted in
 * via E2E_START_WEB_SERVER=true.
 *
 * Evaluated lazily (not at module load) so that `loadDotenv()` has a chance
 * to populate `process.env` before this value is read.
 */
export function shouldStartWebServer(): boolean {
  return process.env.E2E_START_WEB_SERVER === "true";
}

// ---------------------------------------------------------------------------
// Config-driven functions
// ---------------------------------------------------------------------------

/**
 * Resolves the target base URL from the env var named in cfg.env.baseUrl.
 * Falls back to http://localhost:5173 when unset.
 */
export function resolveBaseUrl(cfg: SpecproofConfig): string {
  return trimmed(process.env[cfg.env.baseUrl]) ?? "http://localhost:5173";
}

/**
 * Reads the credentials for a project from the env var names listed in
 * p.credentialsEnv. Returns null when the names are missing or the values
 * are unset/empty.
 */
export function credentialsFor(p: ProjectConfig): Credentials | null {
  if (!p.credentialsEnv) {
    return null;
  }

  const username = trimmed(process.env[p.credentialsEnv.username]);
  const password = trimmed(process.env[p.credentialsEnv.password]);

  if (username === undefined || password === undefined) {
    return null;
  }

  const newPassword =
    p.credentialsEnv.newPassword !== undefined
      ? trimmed(process.env[p.credentialsEnv.newPassword])
      : undefined;

  return { username, password, newPassword };
}
