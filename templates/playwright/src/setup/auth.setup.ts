import { test as setup } from "@playwright/test";
import {
  loadSpecproofConfig,
  isConditionMet,
  resolveActiveEnvironment,
} from "../config/specproof-config";
import { credentialsFor, missingCredentialEnv } from "../config/env";
import { assertSecureBaseUrl } from "../config/base-url-guard";
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
 * All authenticated projects share the single "setup" project, so this failure
 * also stops the other authenticated projects until the env vars are fixed.
 *
 * Before logging in, the base URL is checked: plain http:// to a host other
 * than localhost / 127.0.0.0/8 / ::1 fails unless the active environment
 * profile sets `allowInsecureHttp: true` in specproof.config.yaml.
 */

const cfg = loadSpecproofConfig();
const activeEnv = resolveActiveEnvironment(cfg);

for (const p of cfg.projects) {
  if (!p.setup) continue;

  setup(`authenticate: ${p.name}`, async ({ page, baseURL }) => {
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

    // 認証情報を送る前に、平文の http で loopback 以外へ送らないことを確かめる。
    assertSecureBaseUrl(baseURL ?? "", activeEnv);
    await saveAuthState(page, creds, p.storageState);
  });
}
