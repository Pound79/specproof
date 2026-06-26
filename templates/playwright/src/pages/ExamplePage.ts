import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Generic post-login "landed" page object. After a successful login the app
 * should render a recognisable landmark — a heading, nav item, or dashboard
 * element — that confirms the user is authenticated and the app is ready.
 *
 * This object is used by `saveAuthState` to verify that authentication
 * succeeded before persisting the storage state to disk.
 *
 * TODO: Replace the placeholder locator below with a landmark that is visible
 *       immediately after login in YOUR app (e.g. a main-nav heading, a
 *       dashboard title, or a user-avatar element).
 */
export class ExamplePage {
  readonly page: Page;
  readonly landingLandmark: Locator;

  constructor(page: Page) {
    this.page = page;

    // TODO: Replace "main" / "Main" with the role and accessible name of the
    //       first element that confirms the user is logged in and the app has
    //       fully loaded. Using a heading or a navigation landmark is reliable
    //       because they are present in the DOM as soon as the route mounts.
    //
    // Example alternatives:
    //   page.getByRole("heading", { name: "Dashboard" })
    //   page.getByRole("navigation").getByText("Home")
    //   page.getByTestId("app-shell")
    this.landingLandmark = page.getByRole("main");
  }

  /**
   * Assert that the post-login landing page has fully loaded.
   *
   * Called by `saveAuthState` to confirm authentication before
   * persisting storage state, and by step definitions that need to
   * verify a successful login outcome.
   *
   * TODO: Swap `toBeVisible` for a more specific assertion once you have
   *       identified the stable post-login landmark for your app.
   */
  async expectLoaded(): Promise<void> {
    await expect(this.landingLandmark).toBeVisible();
  }
}
