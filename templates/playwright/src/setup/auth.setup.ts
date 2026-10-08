import { test as setup } from "@playwright/test";
import { loadSpecproofConfig, isConditionMet } from "../config/specproof-config";
import { credentialsFor, missingCredentialEnv } from "../config/env";
import { saveAuthState } from "./saveAuthState";

/**
 * Authentication setup file.
 *
 * For every project in specproof.config.yaml where `setup: true`, this file
 * registers a Playwright setup test that logs in with the configured
 * credentials and persists the browser session to `storageState`.
 *
 * Projects whose `conditional` expression is not met (e.g. the admin username
 * env var is unset) are skipped gracefully: playwright.config.ts excludes the
 * same projects, so the suite still runs with whatever accounts ARE configured.
 *
 * A project that IS selected but lacks credentials fails instead of skipping.
 * A skipped setup would let its dependent project run with a stale storageState
 * left by an earlier run, without having authenticated in this run.
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

    const missing = missingCredentialEnv(p);
    const creds = credentialsFor(p);
    if (missing.length > 0 || !creds) {
      throw new Error(
        `Credentials for project "${p.name}" are missing: set ${missing.join(", ")}. ` +
          "Failing here so the dependent project does not reuse a stale storageState.",
      );
    }

    await saveAuthState(page, creds, p.storageState);
  });
}
