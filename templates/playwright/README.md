# specproof Playwright Scaffold

A config-driven, framework-agnostic Playwright + playwright-bdd scaffold.
Drop this package into your repository, adjust `specproof.config.yaml`, and
you have a working BDD E2E suite in minutes.

---

## Prerequisites

- Node.js 24+ (the specproof-traceability CLI requires Node >= 24)
- npm 10+

---

## Quick Start

### 1. Install dependencies

```bash
npm install
npm run install:browsers
```

### 2. Configure `specproof.config.yaml`

The `specproof.config.yaml` file at the **repository root** drives the entire
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
.                          <- repo root (specproof.config.yaml lives here)
packages/e2e/              <- this package
  features/                <- Gherkin .feature files
  steps/                   <- Step definitions  (*. steps.ts)
  src/
    config/
      specproof-config.ts  <- config loader (loadSpecproofConfig)
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
  playwright.config.ts     <- Playwright config (reads specproof.config.yaml)
  traceability.yaml        <- spec/impl/feature link manifest
  .env.example             <- env var template
```

---

## Config-Driven Behaviour

All runner behaviour is derived from `specproof.config.yaml`:

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
Use the specproof-sync skill, or the traceability CLI configured in
`specproof.config.yaml` (`commands.traceabilityCheck` / `commands.traceabilityUpdate`),
to keep the manifest up to date.

---

## BDD Methodology Pointers

The specproof-* skills resolve `{{config:layout.e2eReadme}}` to this file for
the conventions below. Full rationale lives in `docs/methodology.md`; this is
a summary + link, not a copy.

### 変更起点別フロー

- spec-first: `/specproof-new-feature` or `/specproof-sync` creates the
  feature + stub steps → `/specproof-implement` makes it green → bless.
- feature-first: a human edits the `.feature` directly → `/specproof-implement`
  makes it green → bless.
- impl-first: `/specproof-bootstrap` — **one-time only**, see below.

### bootstrap は一度きり・実装変更後の追従経路

`/specproof-bootstrap` seeds a feature from existing code exactly once per
domain. Never re-run it to regenerate an existing feature — that turns the
test into a copy of the code it should verify, so it stops catching
regressions. To follow an implementation change instead: `specproof-check`
(detect drift) → `/specproof-sync` (reflect the diff, never deletes existing
scenarios) → `specproof-update` (bless).

### 仕様の置き場所 と 「テストが難しい ≠ 観測不能」

Classify a behavior by whether it is **user-observable**, not by how hard it
is to automate: observable → keep it in `.feature` (tag `@fixme`/`@skip` with
a one-line reason if automation is hard); not observable (status-code
contracts, internal constants, non-functional requirements) → rationale doc
only. Do not move something to the rationale doc merely because it's hard to
test.

### なぜ層ドキュメント（rationale doc）の規約

Rationale docs are **human-authored, never auto-generated** from
implementation — auto-extraction just launders line numbers into fabricated
rationale, reproducing the spec rot specproof exists to catch.

---

## Further Reading

- [playwright-bdd docs](https://playwright-bdd.github.io/)
- [Playwright docs](https://playwright.dev/)
- [specproof config schema](../../docs/config-schema.md)
- [specproof methodology](../../docs/methodology.md)
