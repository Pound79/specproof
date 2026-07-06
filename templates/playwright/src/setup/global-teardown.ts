/**
 * Global teardown — runs once after the entire Playwright test suite completes.
 *
 * This file is a no-op stub. Replace or extend it with app-specific cleanup
 * logic for your project (see the commented example below).
 *
 * Register it in specproof.config.yaml:
 *   runner:
 *     globalTeardown: "src/setup/global-teardown.ts"
 *
 * Playwright will then pass this path to `globalTeardown` in playwright.config.ts.
 */

export default async function globalTeardown(): Promise<void> {
  console.log("[cleanup] no teardown configured");

  // ---------------------------------------------------------------------------
  // EXAMPLE: add app-specific cleanup here.
  //
  // The block below shows a pattern for deleting test data created during the
  // run. Adapt it to your backend (REST API, database client, SDK, etc.).
  // Do NOT add backend-specific imports (SDKs, database clients) to this
  // template — copy this file into your project and add the imports there.
  //
  // import { readFileSync, existsSync } from "node:fs";
  // import path from "node:path";
  //
  // const AUTH_FILE = "playwright/.auth/user.json";
  //
  // function readSessionToken(authFile: string): string | null {
  //   const abs = path.resolve(process.cwd(), authFile);
  //   if (!existsSync(abs)) return null;
  //   try {
  //     const state = JSON.parse(readFileSync(abs, "utf8")) as {
  //       origins?: Array<{
  //         localStorage?: Array<{ name: string; value: string }>;
  //       }>;
  //     };
  //     for (const origin of state.origins ?? []) {
  //       for (const entry of origin.localStorage ?? []) {
  //         // TODO: replace "myapp.sessionToken" with your actual key name
  //         if (entry.name === "myapp.sessionToken") return entry.value;
  //       }
  //     }
  //   } catch {
  //     // unreadable / parse error — treat as no session
  //   }
  //   return null;
  // }
  //
  // async function deleteTestData(token: string): Promise<void> {
  //   // TODO: call your API / SDK to remove records created during the test run
  //   const res = await fetch(`${process.env.E2E_BASE_URL}/api/test-cleanup`, {
  //     method: "DELETE",
  //     headers: { Authorization: `Bearer ${token}` },
  //   });
  //   if (!res.ok) throw new Error(`Cleanup failed: ${res.status}`);
  // }
  //
  // const token = readSessionToken(AUTH_FILE);
  // if (!token) {
  //   console.log("[cleanup] no session token found — skipping data cleanup");
  //   return;
  // }
  // try {
  //   await deleteTestData(token);
  //   console.log("[cleanup] test data deleted successfully");
  // } catch (err) {
  //   console.warn(`[cleanup] data cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  //   // Re-throw in CI so leftover data does not silently accumulate:
  //   // if (process.env.CI) throw err;
  // }
  // ---------------------------------------------------------------------------
}
