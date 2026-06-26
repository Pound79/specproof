import path from "node:path";
import type { Page } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";
import { ExamplePage } from "../pages/ExamplePage";
import type { Credentials } from "../config/env";
import { loadBddKitConfig } from "../config/bdd-kit-config";
import { forceAppLanguage } from "../config/locale";

/**
 * Log in with the given credentials and persist the authenticated browser
 * session to `authFile`. Confirming the post-login page is loaded before
 * saving ensures the stored state is valid.
 *
 * @param page        - Playwright Page instance (from setup fixture)
 * @param credentials - Username / password (and optional newPassword) to use
 * @param authFile    - Relative-or-absolute path where storageState is written
 */
export async function saveAuthState(
  page: Page,
  credentials: Credentials,
  authFile: string,
): Promise<void> {
  const cfg = loadBddKitConfig();

  // Pin the app language before navigating so the saved storageState carries
  // the correct locale and post-login assertions match the expected UI text.
  await forceAppLanguage(page, cfg);

  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(
    credentials.username,
    credentials.password,
    credentials.newPassword,
  );

  const examplePage = new ExamplePage(page);
  await examplePage.expectLoaded();

  await page
    .context()
    .storageState({ path: path.resolve(process.cwd(), authFile) });
}
