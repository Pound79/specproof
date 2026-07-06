import type { BrowserContext, Page } from "@playwright/test";
import type { SpecproofConfig } from "./specproof-config";

/**
 * Pins the app's i18n localStorage key to cfg.language before any app
 * script runs, so that Gherkin assertions match the expected locale text.
 *
 * Only active when cfg.runner?.i18nLocaleStorageKey is a non-empty string.
 * When not set this is a no-op, which is correct for apps that infer the
 * locale from the browser Accept-Language header (set via Playwright's
 * use.locale instead).
 *
 * The init script guards localStorage access in a try/catch because
 * localStorage may be unavailable on about:blank.
 */
export async function forceAppLanguage(
  target: Page | BrowserContext,
  cfg: SpecproofConfig,
): Promise<void> {
  const key = cfg.runner?.i18nLocaleStorageKey;
  if (!key) {
    return;
  }

  const language = cfg.language;

  await target.addInitScript(
    ({ storageKey, lng }) => {
      try {
        window.localStorage.setItem(storageKey, lng);
      } catch {
        // localStorage may be unavailable on about:blank; ignored.
      }
    },
    { storageKey: key, lng: language },
  );
}
