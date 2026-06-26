import { defineConfig, devices } from "@playwright/test";
import { defineBddProject } from "playwright-bdd";
import {
  loadBddKitConfig,
  isConditionMet,
  resolveActiveEnvironment,
} from "./src/config/bdd-kit-config";
import { loadDotenv, resolveBaseUrl, shouldStartWebServer } from "./src/config/env";

// ---------------------------------------------------------------------------
// Load config → resolve environment → load dotenv
// ---------------------------------------------------------------------------

const cfg = loadBddKitConfig();
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
const needsSetup = cfg.projects.some(
  (p) => p.setup === true && isConditionMet(p.conditional, cfg),
);

// Setup project — included only when at least one project requires it.
const setupProject = needsSetup
  ? [
      {
        name: "setup",
        testDir: "src/setup",
        testMatch: /\.setup\.ts$/,
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

function mergeExcludeTags(
  projectTags: string | undefined,
  env: ReturnType<typeof resolveActiveEnvironment>,
): string | undefined {
  if (!env.excludeTags || env.excludeTags.length === 0) {
    return projectTags || undefined;
  }
  const exclusion = env.excludeTags
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
        // Pass tags only when the project defines a filter; undefined means
        // "run all scenarios" (defineBddProject treats undefined correctly).
        tags: effectiveTags,
      }),
      use: {
        ...devices[device],
        // Empty storageState string means a clean, unauthenticated session.
        storageState: p.storageState
          ? p.storageState
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
// Adapt these mappings when adding more languages to your bdd-kit.config.yaml.
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
