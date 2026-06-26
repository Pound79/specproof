/**
 * UI string constants used by page objects and step definitions.
 *
 * This file mirrors the visible text produced by your app's i18n layer
 * (e.g. the values in your translation JSON/YAML for the active locale).
 * Centralising strings here means a copy change only needs editing in
 * one place — page objects and steps import from here rather than
 * scattering literals across files.
 *
 * Convention:
 *   - The trailing comment on each entry shows the i18n key it maps to.
 *   - Group entries by feature area with a comment header.
 *   - For strings that carry a placeholder (e.g. "Hello, {{name}}"),
 *     add a helper function below the constant object.
 *
 * TODO: Replace the placeholder entries below with the actual visible
 *       strings your app renders. Check your app's translation files
 *       (e.g. public/locales/en/translation.json) for the canonical values.
 *       Delete entries that do not apply to your app.
 *
 * Example (English app):
 *
 *   export const UI = {
 *     // auth.*
 *     loginButton: "Sign in",           // auth.loginButton
 *     forgotPasswordLink: "Forgot password?",  // auth.forgotPassword
 *     loginValidationRequired: "Please enter your email and password.", // auth.validationRequired
 *
 *     // dashboard.*
 *     dashboardTitle: "Dashboard",      // dashboard.title
 *     logoutButton: "Log out",          // dashboard.logout
 *   } as const;
 */

// TODO: Populate this object with your app's visible UI strings.
//       See the example above and the comments in this file for guidance.
export const UI = {} as const;

/**
 * Parameterised label helpers.
 *
 * TODO: Add helper functions here for any i18n strings that embed a runtime
 *       value (e.g. a user name or count). Example:
 *
 *   export const UI_LABEL = {
 *     welcomeUser: (name: string): string => `Welcome, ${name}`,
 *   } as const;
 */
// export const UI_LABEL = {} as const;
