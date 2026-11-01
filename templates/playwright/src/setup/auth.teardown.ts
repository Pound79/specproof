import { rmSync } from "node:fs";
import { test as teardown } from "@playwright/test";
import { loadSpecproofConfig } from "../config/specproof-config";
import { resolveAuthStatePath } from "../config/env";

/**
 * Authentication teardown.
 *
 * Runs after every project that depends on the "setup" project has finished
 * (it is the setup project's `teardown`), and deletes the storageState files
 * that auth.setup.ts wrote. They hold the logged-in session (cookies and
 * localStorage), so they should not outlive the run — on a shared machine or in
 * a CI workspace that is uploaded or cached.
 *
 * If your global teardown needs the session (for example to call a cleanup
 * API), read it here before the files are deleted instead.
 */

const cfg = loadSpecproofConfig();

teardown("delete saved authentication state", () => {
  for (const p of cfg.projects) {
    if (!p.setup || !p.storageState) continue;
    rmSync(resolveAuthStatePath(p.storageState), { force: true });
  }
});
