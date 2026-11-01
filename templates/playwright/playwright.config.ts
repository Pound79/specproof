import { defineConfig, devices } from "@playwright/test";
import { defineBddProject } from "playwright-bdd";
import {
  loadSpecproofConfig,
  isConditionMet,
  resolveActiveEnvironment,
} from "./src/config/specproof-config";
import {
  loadDotenv,
  resolveAuthStatePath,
  resolveBaseUrl,
  shouldStartWebServer,
} from "./src/config/env";
import { assertSecureBaseUrl } from "./src/config/base-url-guard";

// ---------------------------------------------------------------------------
// Load config → resolve environment → load dotenv
// ---------------------------------------------------------------------------

const cfg = loadSpecproofConfig();
const activeEnv = resolveActiveEnvironment(cfg);
loadDotenv(activeEnv);

// Step definitions + the fixtures file that builds the BDD `test` instance.
// All BDD projects share the same step library.
const STEPS = ["src/fixtures/test.ts", "steps/**/*.ts"];

const device = cfg.runner?.device ?? "Desktop Chrome";

// ---------------------------------------------------------------------------
// Build projects list
// ---------------------------------------------------------------------------

// Determine whether any project needs the "setup" auth runner.
const needsSetup = cfg.projects.some((p) => p.setup === true && isConditionMet(p.conditional, cfg));

// Setup project — included only when at least one project requires it.
const setupProject = needsSetup
  ? [
      {
        name: "setup",
        testDir: "src/setup",
        testMatch: /\.setup\.ts$/,
        // Deletes the saved sessions once every project that depends on setup
        // has finished, so logged-in state does not outlive the run.
        teardown: "auth-teardown",
      },
      {
        name: "auth-teardown",
        testDir: "src/setup",
        testMatch: /\.teardown\.ts$/,
      },
    ]
  : [];

// ---------------------------------------------------------------------------
// Merge environment excludeTags into the project-level tag expression.
//
// When the active environment excludes tags (e.g. local excludes @google-auth),
// we append "and not (@google-auth)" to each project's tag filter so that
// playwright-bdd skips those scenarios at the runner level.
// ---------------------------------------------------------------------------

// Scenarios the E2E runner never executes, in every environment: @draft (not
// decided yet), @human (a person checks it) and @out-of-scope (excluded from
// the acceptance criteria). @red-contract is NOT here: it runs and stays red
// until implemented. There is deliberately no tag to switch a test off.
const NEVER_RUN_TAGS = ["@draft", "@human", "@out-of-scope"];

function mergeExcludeTags(
  projectTags: string | undefined,
  env: ReturnType<typeof resolveActiveEnvironment>,
): string {
  const exclusion = [...NEVER_RUN_TAGS, ...(env.excludeTags ?? [])]
    .map((t) => `not ${t}`)
    .join(" and ");
  if (!projectTags) {
    return exclusion;
  }
  return `(${projectTags}) and ${exclusion}`;
}

// Per-config app projects.
const appProjects = cfg.projects.flatMap((p) => {
  // Skip projects whose runtime condition is not met (e.g. no admin creds).
  if (!isConditionMet(p.conditional, cfg)) {
    return [];
  }

  const effectiveTags = mergeExcludeTags(p.tags, activeEnv);

  return [
    {
      ...defineBddProject({
        name: p.name,
        features: p.features,
        steps: STEPS,
        // Always a filter: @draft / @human / @out-of-scope never run, and the
        // project's own filter and the environment's excludeTags are added.
        tags: effectiveTags,
      }),
      use: {
        ...devices[device],
        // Empty storageState string means a clean, unauthenticated session.
        // Resolved against the e2e package root, the same place auth setup writes it.
        storageState: p.storageState
          ? resolveAuthStatePath(p.storageState)
          : { cookies: [], origins: [] },
      },
      // Wire the setup dependency only for projects that require auth.
      ...(p.setup ? { dependencies: ["setup"] } : {}),
    },
  ];
});

// ---------------------------------------------------------------------------
// Derive locale/timezone from the config language for Playwright's context.
// These control the browser Accept-Language header and JS Date behaviour.
// Adapt these mappings when adding more languages to your specproof.config.yaml.
// ---------------------------------------------------------------------------

const LANGUAGE_TO_LOCALE: Record<string, string> = {
  ja: "ja-JP",
  en: "en-US",
  zh: "zh-CN",
  ko: "ko-KR",
  fr: "fr-FR",
  de: "de-DE",
  es: "es-ES",
};

const LANGUAGE_TO_TIMEZONE: Record<string, string> = {
  ja: "Asia/Tokyo",
  en: "America/New_York",
  zh: "Asia/Shanghai",
  ko: "Asia/Seoul",
  fr: "Europe/Paris",
  de: "Europe/Berlin",
  es: "Europe/Madrid",
};

const locale = LANGUAGE_TO_LOCALE[cfg.language] ?? "en-US";
const timezoneId = LANGUAGE_TO_TIMEZONE[cfg.language] ?? "UTC";

// ---------------------------------------------------------------------------
// Web server
// ---------------------------------------------------------------------------

const webServerCommand = cfg.runner?.webServerCommand;

const webServer =
  shouldStartWebServer() && webServerCommand
    ? {
        command: webServerCommand,
        url: resolveBaseUrl(cfg),
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: "pipe" as const,
        stderr: "pipe" as const,
      }
    : undefined;

// ---------------------------------------------------------------------------
// Refuse plain http to a non-loopback host before any browser starts, when a
// selected project logs in or reads credentials. Opt in per environment with
// `allowInsecureHttp: true` (see src/config/base-url-guard.ts). Runs without
// credentials (e.g. only the guest project) are not blocked.
// ---------------------------------------------------------------------------

const usesCredentials = cfg.projects.some(
  (p) => (p.setup === true || p.credentialsEnv !== undefined) && isConditionMet(p.conditional, cfg),
);
if (usesCredentials) assertSecureBaseUrl(resolveBaseUrl(cfg), activeEnv);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export default defineConfig({
  globalTeardown: cfg.runner?.globalTeardown,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: resolveBaseUrl(cfg),
    locale,
    timezoneId,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [...setupProject, ...appProjects],
  webServer,
});
