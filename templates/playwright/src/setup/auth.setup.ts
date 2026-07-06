import { test as setup } from "@playwright/test";
import { loadSpecproofConfig, isConditionMet } from "../config/specproof-config";
import { credentialsFor } from "../config/env";
import { saveAuthState } from "./saveAuthState";

/**
 * Authentication setup file.
 *
 * For every project in specproof.config.yaml where `setup: true`, this file
 * registers a Playwright setup test that logs in with the configured
 * credentials and persists the browser session to `storageState`.
 *
 * Projects whose `conditional` expression is not met (e.g. the admin username
 * env var is unset) are skipped gracefully so the suite still runs with
 * whatever accounts ARE configured.
 */

const cfg = loadSpecproofConfig();

for (const p of cfg.projects) {
  if (!p.setup) continue;

  setup(`authenticate: ${p.name}`, async ({ page }) => {
    // Skip when the project's condition is not met (e.g. no admin account).
    if (!isConditionMet(p.conditional, cfg)) {
      setup.skip(
        true,
        `Project "${p.name}" condition not met (${p.conditional ?? "n/a"}) — skipping authentication`,
      );
      return;
    }

    const creds = credentialsFor(p);
    if (!creds) {
      setup.skip(
        true,
        `Credentials for project "${p.name}" are not configured — set the env vars named in credentialsEnv`,
      );
      return;
    }

    await saveAuthState(page, creds, p.storageState);
  });
}
