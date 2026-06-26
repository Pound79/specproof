import { test as base, createBdd } from "playwright-bdd";
import { LoginPage } from "../pages/LoginPage";
import { ExamplePage } from "../pages/ExamplePage";
import { forceAppLanguage } from "../config/locale";
import { loadBddKitConfig } from "../config/bdd-kit-config";

/**
 * Fixtures exposed to step definitions as Playwright BDD fixtures.
 *
 * Steps receive them by destructuring, e.g.:
 *   Given("...", async ({ loginPage }) => { ... })
 *
 * TODO: Add more page-object fixtures here as you build out coverage for
 *       additional screens. Follow the same pattern: import the page class,
 *       add a key to the Fixtures type, and wire it in test.extend().
 */
type Fixtures = {
  loginPage: LoginPage;
  examplePage: ExamplePage;
};

export const test = base.extend<Fixtures>({
  // Override the default BrowserContext fixture to pin the app language
  // (via localStorage) before any page script runs. This keeps text
  // assertions deterministic regardless of the browser's system locale.
  //
  // The language value and the localStorage key name are both read from
  // bdd-kit.config.yaml (cfg.language and cfg.runner.i18nLocaleStorageKey).
  // If i18nLocaleStorageKey is empty/unset this is a no-op.
  context: async ({ context }, use) => {
    const cfg = loadBddKitConfig();
    await forceAppLanguage(context, cfg);
    await use(context);
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  examplePage: async ({ page }, use) => {
    await use(new ExamplePage(page));
  },
});

export const { Given, When, Then } = createBdd(test);
