# bdd-kit Playwright Scaffold

A config-driven, framework-agnostic Playwright + playwright-bdd scaffold.
Drop this package into your repository, adjust `bdd-kit.config.yaml`, and
you have a working BDD E2E suite in minutes.

---

## Prerequisites

- Node.js 24+ (the bdd-traceability CLI requires Node >= 24)
- npm 10+

---

## Quick Start

### 1. Install dependencies

```bash
npm install
npm run install:browsers
```

### 2. Configure `bdd-kit.config.yaml`

The `bdd-kit.config.yaml` file at the **repository root** drives the entire
scaffold. Open it and update:

| Section | What to change |
|---------|----------------|
| `language` | Gherkin locale (`"en"`, `"ja"`, …) |
| `env.baseUrl` | Name of the env var that holds your app's URL |
| `projects[*].features` | Paths to your `.feature` files |
| `projects[*].credentialsEnv` | Names of env vars that hold credentials |
| `layout.implGlobs` | Globs pointing at your implementation source |
| `runner.webServerCommand` | Dev-server command (optional) |
| `runner.i18nLocaleStorageKey` | localStorage key for locale forcing (optional) |

Detailed field documentation is inline in the config file itself.

### 3. Create your `.env` file

```bash
cp .env.example .env
```

Edit `.env` and set real values. **Never commit `.env`.**

```env
E2E_BASE_URL=http://localhost:5173
E2E_USERNAME=user@example.com
E2E_PASSWORD=YourPassword1!
```

### 4. (Optional) Create test users

If your auth provider requires pre-created users, adapt and run:

```bash
./scripts/setup-auth-users.sh
```

See the comments inside the script for provider-specific examples.

### 5. Run the fast smoke suite

```bash
npm run test:smoke
```

This generates glue code with `bddgen`, then runs all scenarios that are
**not** tagged `@slow`.

---

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run bddgen` | Generate step glue code from `.feature` files |
| `npm test` | Generate + run all tests |
| `npm run test:smoke` | Generate + run non-`@slow` tests (CI default) |
| `npm run test:headed` | Run tests with browser visible |
| `npm run test:ui` | Open Playwright UI mode |
| `npm run report` | Open the last HTML report |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm run install:browsers` | Install Chromium browser binary |

---

## Project Structure

```
.                          <- repo root (bdd-kit.config.yaml lives here)
packages/e2e/              <- this package
  features/                <- Gherkin .feature files
  steps/                   <- Step definitions  (*. steps.ts)
  src/
    config/
      bdd-kit-config.ts    <- config loader (loadBddKitConfig)
      env.ts               <- env-var helpers (resolveBaseUrl, credentialsFor)
      locale.ts            <- language forcing helper (forceAppLanguage)
    fixtures/
      test.ts              <- playwright-bdd fixture wiring + createBdd exports
    pages/
      LoginPage.ts         <- Page Object — adapt selectors to your app
      ExamplePage.ts       <- Page Object — post-login landmark assertion
    setup/
      auth.setup.ts        <- Playwright global setup — saves auth storage state
      saveAuthState.ts     <- reusable auth-save helper
      global-teardown.ts   <- no-op teardown stub
  scripts/
    setup-auth-users.sh    <- optional: pre-create test users
  playwright.config.ts     <- Playwright config (reads bdd-kit.config.yaml)
  traceability.yaml        <- spec/impl/feature link manifest
  .env.example             <- env var template
```

---

## Config-Driven Behaviour

All runner behaviour is derived from `bdd-kit.config.yaml`:

- **Projects** — one Playwright project per entry; `authed-admin` is skipped
  automatically when `E2E_ADMIN_USERNAME` is not set.
- **Auth setup** — projects with `setup: true` run `auth.setup.ts` first and
  load the saved storage state.
- **Language** — `forceAppLanguage` pins the app locale via `localStorage`
  before each scenario (configure `runner.i18nLocaleStorageKey`).
- **Web server** — set `E2E_START_WEB_SERVER=true` and
  `runner.webServerCommand` to let Playwright start your dev server.

---

## Customising Page Objects

`LoginPage.ts` and `ExamplePage.ts` contain `TODO` comments marking every
selector that must be adapted to your application's DOM. Use
`getByRole` / `getByLabel` locators rather than CSS ids wherever possible.

---

## Traceability

`traceability.yaml` links spec docs, implementation files, and feature files.
Use the bdd-sync skill, or the traceability CLI configured in
`bdd-kit.config.yaml` (`commands.traceabilityCheck` / `commands.traceabilityUpdate`),
to keep the manifest up to date.

---

## Further Reading

- [playwright-bdd docs](https://playwright-bdd.github.io/)
- [Playwright docs](https://playwright.dev/)
- [bdd-kit config schema](../../docs/config-schema.md)
