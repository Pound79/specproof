# specproof Playwright Scaffold

[日本語](./README_ja.md)

A configurable Playwright + playwright-bdd scaffold.
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

#### Sensitive data this scaffold creates

| Data | Where | Protection |
|---|---|---|
| Variable names only | `.env.example` | Committed on purpose (`!.env.example` in `.gitignore`). Never put real values in it. |
| Test account credentials | `.env` (and CI secrets) | Use dedicated test accounts, never real users' or production accounts. `.env` and `.env.*` are gitignored; keep them out of commits and logs. |
| Logged-in browser state (cookies, localStorage) | `playwright/.auth/*.json` in this package (resolved against the package, wherever Playwright runs from; a `storageState` path outside the package or through a symbolic link is refused) | Gitignored, and deleted by the `auth-teardown` project after the authenticated projects finish. The teardown does not run when a run is interrupted (Ctrl-C, a cancelled CI job, `globalTimeout`), with `--no-deps`, or in UI mode, so delete `playwright/.auth/` by hand on shared machines after those. `--no-deps` also needs the setup project to have run first. Do not upload these files as CI artifacts. |
| Traces, screenshots and videos | `test-results/`, `playwright-report/` | A trace is kept for every failed test attempt, locally and in CI (including a failed first attempt of a test that passed on retry). It records the actions (including the typed login form), the network, cookies and localStorage, so it carries the test account's session. Both directories are gitignored. Do not share them. Do not upload them as CI artifacts; reproduce a CI-only failure locally and open the trace there (`npx playwright show-trace`). The only exception (traces of failed runs, kept briefly, when every condition holds) is in [the CI guide](https://github.com/Pound79/specproof/blob/main/docs/playwright-ci_en.md#limited-retention-for-ci-only-failures). |

`E2E_BASE_URL` defaults to `http://localhost:5173`. The scaffold sends the test
credentials to whatever URL you set, so use `https://` for any host other than
localhost. This is enforced: when a project in `specproof.config.yaml` (whose
`conditional` is met) logs in (`setup: true`), has `credentialsEnv`, or reuses a
saved session (a non-empty `storageState`), loading `playwright.config.ts` fails
before any browser starts (and the auth setup checks again before logging in)
if the base URL is `http://` to a host other than `localhost`, `*.localhost`,
`127.0.0.0/8` or `::1`, or uses a scheme other than `http://` / `https://`.
Plain http is allowed only when the active environment profile opts in:

```yaml
environments:
  - name: staging
    allowInsecureHttp: true # only for an environment that really has no https
```

Only the value `true` opts in. The decision uses the projects in the config
file, not the ones you pick with `--project`: a config whose projects are all
credential-free (like `guest`) is not checked, but `--project guest` on a config
that also has `authed` is. Limits:

- The opt-in is per environment, not per host: with `allowInsecureHttp: true`,
  any http host you set as the base URL for that environment is accepted.
- Only the base URL is checked. If your own code sends credentials to another
  URL (an absolute `page.goto()` target, a redirect to a different host, a
  cleanup API call), check that URL with `assertSecureBaseUrl()` from
  `src/config/base-url-guard.ts` as well.

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

This generates glue code with `bddgen`, then runs the selected scenarios
without the slow tag (default `@slow`). The run counts as smoke when
`SPECPROOF_SMOKE=1` is set, and then excludes the configured `tags.slow` as a
tag expression. When you run smoke by calling `bddgen` and `playwright`
directly instead of the npm script, set `SPECPROOF_SMOKE=1` on both commands.
Smoke generates into `.features-gen-smoke/`, so setting it on only one makes
generation and the run use different generated files. Whatever you select,
`@draft` / `@human` / `@out-of-scope` scenarios never run. The template's own filters never exclude
`@red-contract`, so selected `@red-contract` scenarios run and stay RED until
implemented. Positive selection still applies to them: a project's `tags`
filter (such as `@admin`), a command-line `--grep`, or this command's
slow-tag exclusion selects among `@red-contract` scenarios like any other.
`@red-contract @human` (implementation pending, verified by a person) does not
run, because `@human` never runs; it stays pending until a person confirms it
and removes the tag.

`environments[].excludeTags` in `specproof.config.yaml` accepts only single
tags (`/^@[^@\s()]+$/`, e.g. `@google-auth`). The config loader in
`playwright.config.ts` rejects tag expressions and state tags (`@draft`,
`@red-contract`, `@human`, `@out-of-scope`) there, and rejects a
`projects[].tags` expression that mentions a state tag or has unbalanced
parentheses, so `@red-contract` cannot be filtered out through the config to
make the run look green. A command-line `--grep-invert @red-contract` cannot be
blocked by the template: do not use it.

---

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run bddgen` | Generate step glue code from `.feature` files |
| `npm test` | Generate + run all tests |
| `npm run test:smoke` | Generate + run tests without the slow tag (CI default) |
| `npm run test:headed` | Run tests with browser visible |
| `npm run test:ui` | Open Playwright UI mode |
| `npm run report` | Open the last HTML report |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm run lint` | Check scaffold code with Biome |
| `npm run format:check` | Check formatting with Biome |
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
      auth.setup.ts        <- setup project (runs before authed projects) — saves auth storage state
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
  load the saved storage state. A selected project with missing credentials
  (e.g. `E2E_ADMIN_USERNAME` set but `E2E_ADMIN_PASSWORD` empty) fails the
  shared `setup` project, so every project that depends on it is not run;
  set the missing variables or unset the conditional one.
- **Language** — `forceAppLanguage` pins the app locale via `localStorage`
  before each scenario (configure `runner.i18nLocaleStorageKey`).
- **Web server** — set `E2E_START_WEB_SERVER=true` and
  `runner.webServerCommand` to let Playwright start your dev server.

### Registering a new feature

Register the feature in the traceability manifest and in each applicable project's `projects[].features`. Choose the project by the state in which the scenario starts (signed out, or signed in with a particular role), then check its tag filter. A matching tag alone is insufficient. A feature covering several roles may belong in several projects. Paths are relative to the E2E package. With the default explicit file lists, dropping a file into `features/` does not register it.

In a project intended for signed-out screens (the template's `guest`), include only features written for that state. Exclude role-tagged scenarios and untagged scenarios that need an authenticated session. Preserve the project's existing tags, conditions and environment restrictions. After `npm run bddgen`, run `npx playwright test --list --project <project-name>` and look for the intended scenario. If it is missing, revisit registration, project conditions and tag filters before reporting a result.

### Checking the environment before E2E

An old frontend build, a backend checkout missing a fix, missing migrations, a failed seed or a cold dev server can all fail unrelated scenarios. Add checks for the prerequisites your suite actually depends on. The scaffold includes auth setup, but it has no global preflight. To add one, create `src/setup/preflight.ts` and set `globalSetup: "./src/setup/preflight.ts"` in the `defineConfig` call in `playwright.config.ts`. This is a Playwright setting, separate from the authentication setup project. Use the resolved project `use.baseURL` so checks and tests hit the same deployment.

The repository maintains one [complete, tested TypeScript example](./README_ja.md#preflight-example). Its checks run in this order:

| Check | Configuration and result |
|---|---|
| 0. Allowed destinations | Before sending requests, require the UI and configured API URLs to point to loopback or an explicitly listed local host. Add disposable Compose service names to `E2E_PREFLIGHT_ALLOWED_HOSTS` as comma-separated hostnames without ports (IPv6 example: `[::1]`). Include any additional URLs used by the seed or API client. Keep shared staging and production out of the list. |
| 1. Backend health | Set `E2E_API_HEALTH_URL` to an unauthenticated endpoint. Require a direct HTTP 200. A login redirect followed by a 200 must fail. |
| 2. Backend revision | Set `E2E_API_CHECKOUT` to an absolute path to a checkout you control and `E2E_API_REQUIRED_COMMIT` to the required revision. Verify that the revision is an ancestor of the checked-out commit. |
| 3. Frontend build | Set `E2E_WEB_BUILD_ID_FILE` to a build identifier exposed by the served HTML. The Next.js example compares a production build's `.next/BUILD_ID` with the HTML, including the App Router payload. Adapt the identifier for other frameworks. |
| 4. Warm-up | Open the UI without credentials. Allow a normal redirect to the login page and a long enough timeout for a cold compile (the example allows 120 seconds). |
| 5. Warm response time | Set `E2E_API_MAX_RESPONSE_MS` to an observed local budget in milliseconds (for example 500). Warm the health URL and time three requests. Use a URL that reaches the application rather than a proxy-generated response. |
| 6. Actual API origin | For a browser calling a different API origin, set `E2E_EXPECT_API_ORIGIN`. Optionally set `E2E_API_PROBE_PATH` to a public UI path that makes a request (default: base URL). A fresh Chromium page checks fetch/XHR targets without logging request paths or query strings. A current build can still have an incorrect API URL baked in. This check is unsuitable for server-side-only requests or a same-origin API. |
| 7. Seed token lifetime | For a seed that writes expiring JWTs, set `E2E_SEED_TOKENS_FILE` to its JSON output and `E2E_RUN_BUDGET_MINUTES` to the required duration, including retries. Compare the earliest expiration with the budget without printing tokens. Omit this check for cookie-only or nonexpiring sessions. |

Keep the local-destination check for suites that write data. It covers the URLs you list; check 6 observes the browser's API target. The example blocks non-local HTTP requests made by the probe, with exceptions for WebSockets and redirects from local endpoints. The health and warm-up requests send no credentials. If you adapt them to an authenticated URL, validate it first with `assertSecureBaseUrl()` and refuse redirects.

Checks 0, 1 and 4 suit most local suites. Add the others for concrete dependencies or failures you have observed. Fix a failed prerequisite and rerun before diagnosing scenario failures.

### Protecting single-use seed data

If the seed runs once per suite and scenarios cannot provision fresh data per attempt, a retry may encounter data consumed by an earlier attempt. This applies to deleting or approving records, joining a group, filing a report, marking a task complete, or changing a value the next attempt expects to see. If a scenario cannot reliably check its starting state through the UI, a per-scenario marker can stop it before a misleading timeout. Scenarios that create fresh data, leave no change after a rejected request, or restore the precondition on every exit path do not need a marker. A cleanup step at the end does not run when an earlier step fails.

Use the [tested guard, step and seed examples](./README_ja.md#seed-guard-example). They use a hash of Playwright's `testInfo.testId` for a stable per-scenario marker. Record it immediately before the irreversible confirmation, including when the click happens inside a helper. Marking before a dialog opens would also block retries that never consumed anything. If the confirmation itself fails after marking, inspect the first failure and rerun the seed.

- Use at most one guard per scenario. Check that its step occurs only once in every scenario that uses it.
- `--repeat-each` iterations have different IDs. Projects also use different markers, so partition seed data by project. Reseed before adding, reordering or editing Scenario Outline rows. Their generated titles can depend on row numbers or values, including `examplesTitleFormat`.
- Clear markers only after a successful seed, from the seed script. A step or global setup must not clear them while the underlying data is still consumed.
- Add `state/` to `.gitignore`. Keep `state/` and `state/consumed/` as real directories, not symbolic links. Derive the path from the script location. On shared machines restrict write access to the user running the suite; markers do not protect against tampering.
- The failure message contains the scenario title. Keep credentials and personal data out of Scenario Outline values used in titles.

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

`specproof init` also adds `.github/workflows/specproof-drift-check.yml`, which runs
`specproof-check --strict` on every pull request. A pull request can edit the manifest
hashes, `specproof.config.yaml` and the workflow itself, so the check alone does not
stop drift. Make it a required status check in your branch protection, and protect
`specproof.config.yaml` / `specproof.config.yml`, `traceability.yaml`, `.npmrc` and
`.github/workflows/` with CODEOWNERS. The workflow fails when the config file is
missing. See [what the drift gate does not guarantee](https://github.com/Pound79/specproof/blob/main/docs/security-model_en.md#protecting-the-drift-gate).

---

## BDD Methodology Pointers

The specproof-* skills resolve `{{config:layout.e2eReadme}}` to this file for
the conventions below. Full rationale lives in `docs/methodology_en.md`; this is
a summary + link, not a copy.

### Choosing a workflow

- spec-first: `/specproof-new-feature` or `/specproof-sync` creates the
  feature + stub steps → `/specproof-implement` makes it green → bless.
- feature-first: a human edits the `.feature` directly → `/specproof-implement`
  makes it green → bless.
- impl-first: `/specproof-bootstrap` — **one-time only**, see below.

### Following later implementation changes

`/specproof-bootstrap` seeds a feature from existing code exactly once per
domain. Never re-run it to regenerate an existing feature — that turns the
test into a copy of the code it should verify, so it stops catching
regressions. To follow an implementation change instead: `specproof-check`
(detect drift) → `/specproof-sync` → `specproof-update` (bless). A pure
refactor is blessed as-is. If observable behavior changed, sync stops and asks
you to decide against the spec: fix the implementation, update the spec first,
or confirm the spec already requires the new behavior. Expected values in the
feature always come from the spec, never from the implementation diff, and
existing scenarios are never deleted.

### Recording observable behavior

Classify a behavior by whether it is **user-observable**, not by how hard it
is to automate: observable → keep it in `.feature` (if automation is hard, tag it
`@red-contract` to automate later, `@human` for a person to check, or
`@out-of-scope` with a one-line reason comment); not observable (status-code
contracts, internal constants, non-functional requirements) → rationale doc
only. Do not move something to the rationale doc merely because it's hard to
test.

### Authoring rationale

Rationale docs are **human-authored, never auto-generated** from
implementation — auto-extraction just launders line numbers into fabricated
rationale, reproducing the spec rot specproof exists to catch.

---

## Further Reading

- [playwright-bdd docs](https://playwright-bdd.github.io/)
- [Playwright docs](https://playwright.dev/)
- [specproof config schema](https://github.com/Pound79/specproof/blob/main/docs/config-schema_en.md)
- [specproof methodology](https://github.com/Pound79/specproof/blob/main/docs/methodology_en.md)
- [Running E2E that needs a separate backend in CI](https://github.com/Pound79/specproof/blob/main/docs/playwright-ci_en.md)
