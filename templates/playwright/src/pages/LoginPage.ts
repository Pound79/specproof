import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Generic login page object. Selectors use role/label-based locators so they
 * work with any standard HTML login form without relying on app-specific ids.
 *
 * TODO: Adapt the locators in the constructor to match your app's login form.
 *       Replace getByLabel / getByRole name strings with the visible text your
 *       app renders (check translations if the app is localised).
 */
export class LoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly newPasswordInput: Locator;
  readonly confirmNewPasswordInput: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    this.page = page;

    // TODO: Replace "Username" / "Email" with the visible label text your
    //       login form uses for the username / email field.
    this.usernameInput = page.getByLabel("Username");

    // TODO: Replace "Password" with the visible label text for the password field.
    this.passwordInput = page.getByLabel("Password");

    // TODO: Replace "Sign in" / "Log in" with the text on your submit button.
    this.submitButton = page.getByRole("button", { name: "Sign in" });

    // TODO: Replace "New password" with the label used in your
    //       forced-password-change / first-login flow (if any).
    this.newPasswordInput = page.getByLabel("New password");

    // TODO: Replace "Confirm new password" with the label for the
    //       password-confirmation field in the same flow.
    this.confirmNewPasswordInput = page.getByLabel("Confirm new password");

    // TODO: If your app renders an inline error as an ARIA alert, this locator
    //       should work as-is. Otherwise adapt to your error element's role/text.
    this.errorAlert = page.getByRole("alert");
  }

  /**
   * Navigate to the root path and wait for the login form to be visible.
   *
   * TODO: If your app's login page lives at a different path (e.g. "/login"),
   *       update the argument to page.goto() accordingly.
   */
  async goto(): Promise<void> {
    await this.page.goto("/");
    await this.expectVisible();
  }

  /** Assert that the username and password fields are visible. */
  async expectVisible(): Promise<void> {
    await expect(this.usernameInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
  }

  /**
   * Fill the credentials and click submit. When `newPassword` is provided and
   * the app raises a new-password challenge after the initial submit, completes
   * the challenge automatically.
   *
   * Does not assert on the post-login state — callers decide what success means
   * for their scenario (e.g. checking the URL or a post-login landmark).
   */
  async login(
    username: string,
    password: string,
    newPassword?: string,
  ): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitButton.click();

    if (newPassword) {
      try {
        await this.newPasswordInput.waitFor({
          state: "visible",
          timeout: 8_000,
        });
        await this.newPasswordInput.fill(newPassword);
        await this.confirmNewPasswordInput.fill(newPassword);
        await this.submitButton.click();
      } catch {
        // No new-password challenge raised — the account is already confirmed.
      }
    }
  }

  /**
   * Assert that an error alert is visible (e.g. after a failed login attempt).
   *
   * TODO: If your app uses a custom error element instead of an ARIA alert,
   *       update this.errorAlert in the constructor and this assertion
   *       accordingly.
   */
  async expectError(): Promise<void> {
    await expect(this.errorAlert).toBeVisible();
  }
}
