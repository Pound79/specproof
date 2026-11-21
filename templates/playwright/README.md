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

#### Sensitive data this scaffold creates

| Data | Where | Protection |
|---|---|---|
| Variable names only | `.env.example` | Committed on purpose (`!.env.example` in `.gitignore`). Never put real values in it. |
| Test account credentials | `.env` (and CI secrets) | Use dedicated test accounts, never real users' or production accounts. `.env` and `.env.*` are gitignored; keep them out of commits and logs. |
| Logged-in browser state (cookies, localStorage) | `playwright/.auth/*.json` in this package (resolved against the package, wherever Playwright runs from; a `storageState` path outside the package or through a symbolic link is refused) | Gitignored, and deleted by the `auth-teardown` project after the authenticated projects finish. The teardown does not run when a run is interrupted (Ctrl-C, a cancelled CI job, `globalTimeout`), with `--no-deps`, or in UI mode, so delete `playwright/.auth/` by hand on shared machines after those. `--no-deps` also needs the setup project to have run first. Do not upload these files as CI artifacts. |
| Traces, screenshots and videos | `test-results/`, `playwright-report/` | A trace is kept for every failed test attempt, locally and in CI (including a failed first attempt of a test that passed on retry). It records the actions (including the typed login form), the network, cookies and localStorage, so it carries the test account's session. Both directories are gitignored. Do not share them. Do not upload them as CI artifacts; reproduce a CI-only failure locally and open the trace there (`npx playwright show-trace`). |

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

This generates glue code with `bddgen`, then runs all scenarios that are
**not** tagged `@slow`. Whatever you select, `@draft` / `@human` /
`@out-of-scope` scenarios never run. The template's own filters never exclude
`@red-contract`, so selected `@red-contract` scenarios run and stay RED until
implemented. Positive selection still applies to them: a project's `tags`
filter (such as `@admin`), a command-line `--grep`, or this command's
`--grep-invert @slow` selects among `@red-contract` scenarios like any other.
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
| `npm run test:smoke` | Generate + run non-`@slow` tests (CI default) |
| `npm run test:headed` | Run tests with browser visible |
| `npm run test:ui` | Open Playwright UI mode |
| `npm run report` | Open the last HTML report |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm run lint` | Lint placeholder (no linter configured; replace with eslint/prettier) |
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

### 新しい feature を追加するとき

manifest の登録に加えて、その feature のシナリオをどの認証状態で確かめるか（ログイン前か、
どのロールでログインした後か）から追加先の project を決め、その project の `tags` が対象のシナリオを
選ぶことを確かめてから、`specproof.config.yaml` の `projects[].features` にパスを追加する。
タグが合うだけでは追加しない。シナリオのロールが複数の project に分かれるなら、それぞれに追加する。
パスは E2E パッケージ相対。既定は明示列挙なので、features ディレクトリへ置くだけでは生成・実行されない。
ログインせずに実行することを前提にした project（雛形では `guest`。step の中でログインする project は
含めない）には、ログイン前の画面を確かめる feature だけを追加し、ロール付きのタグのシナリオも、
認証が要るタグ無しのシナリオもそこで実行させない。既存の project の `tags`・`conditional`・環境条件は広げない。
`npm run bddgen` の後に `npx playwright test --list --project <project-name>` で対象シナリオを確認する。
一覧に無ければ登録・`conditional`・タグ条件を確認し、未実行を GREEN と扱わない。

### テストの前に環境を確かめる

E2E が落ちた原因が、テスト対象のコードでなく環境にあることは多い。画面が古いビルドのまま、
バックエンドが別のブランチ、DB の migration を流していない、seed が失敗している、起動し直した
直後の遅さで最初のシナリオが待ちの上限を超える、などだ。テストを流すまで気づけないと、
変えていないシナリオまで落ちて切り分けに時間を使う。

specproof の CLI は環境を確かめない。確かめたい項目は Playwright の `globalSetup` に置き、
満たさなければシナリオを始める前に止める。雛形には `globalSetup` のファイルが無く、
`specproof.config.yaml` にもそのキーは無いので、ファイルを作り、`playwright.config.ts` の
`defineConfig` に `globalSetup: "./src/setup/preflight.ts"` を直接足す。（`auth.setup.ts` は
setup project で、`globalSetup` ではない。混ぜない。）次は置ける確認の例で、使うものだけを残す。
確かめる URL は、テストと同じく `playwright.config.ts` が決めた `baseURL` を使う。

```ts
// src/setup/preflight.ts（例）
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { FullConfig } from "@playwright/test";

// 応答の確認と温める要求。資格情報は送らない。転送は既定で追い、ヘルスチェックだけ追わない（1 を参照）。
// 認証の要る URL にするなら、先に src/config/base-url-guard.ts の assertSecureBaseUrl() で
// その URL を確かめ、別のホストへ資格情報を持ち出さないよう redirect: "error" を付ける。
const get = async (
  url: string,
  { timeoutMs = 30_000, redirect = "follow" }: { timeoutMs?: number; redirect?: RequestRedirect } = {},
): Promise<Response> => {
  try {
    const res = await fetch(url, { redirect, signal: AbortSignal.timeout(timeoutMs) });
    await res.arrayBuffer().catch(() => undefined); // 本文を読み切って接続を残さない
    return res;
  } catch (error) {
    // URL のパス・クエリ（トークンを含むことがある）はログに写さない。
    const where = URL.canParse(url) ? new URL(url).origin : "a preflight URL";
    throw new Error(`preflight: ${where} did not respond: ${error instanceof Error ? error.name : "error"}`);
  }
};

export default async function preflight(config: FullConfig): Promise<void> {
  const baseUrl = config.projects.find((project) => project.use.baseURL)?.use.baseURL;
  if (!baseUrl) throw new Error("preflight: baseURL is not set");

  // 1. バックエンドが動いているか（認証の要らない URL 自身が 200 を返すか）。転送は追わない。追うと、
  //    認証の要る URL を指していてもログイン画面への転送先の 200 で通ってしまう。
  const healthUrl = process.env.E2E_API_HEALTH_URL;
  if (healthUrl) {
    const health = await get(healthUrl, { redirect: "manual" });
    if (health.status !== 200) {
      const location = health.headers.get("location");
      const hint = location ? ` (redirect to ${location}; set E2E_API_HEALTH_URL to the final URL)` : "";
      throw new Error(`preflight: API health check returned ${health.status}${hint}`);
    }
  }

  // 2. バックエンドのチェックアウトが、期待する修正のコミットを含むか。
  //    E2E_API_CHECKOUT は自分が管理するチェックアウトの絶対パスにする。
  const apiDir = process.env.E2E_API_CHECKOUT;
  const commit = process.env.E2E_API_REQUIRED_COMMIT;
  if (apiDir && commit) {
    if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
      throw new Error("preflight: E2E_API_REQUIRED_COMMIT must be a commit hash");
    }
    try {
      execFileSync("git", ["-C", apiDir, "merge-base", "--is-ancestor", commit, "HEAD"], {
        stdio: "ignore",
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      // 1 は「含まない」。それ以外（コミットが無い・リポジトリでない・git が無い）は取り違えない。
      if (status === 1) throw new Error(`preflight: E2E_API_CHECKOUT does not contain ${commit}`);
      throw new Error(`preflight: could not check ${commit} in E2E_API_CHECKOUT (git exit ${status ?? "n/a"})`);
    }
  }

  // 3. 画面が今のチェックアウトから作ったビルドで動いているか。ビルドの ID の置き場所は
  //    フレームワークごとに違うので、ビルドの出力にある ID が配信中の HTML に出るかで比べる例。
  const buildIdFile = process.env.E2E_WEB_BUILD_ID_FILE;
  if (buildIdFile) {
    const buildId = readFileSync(buildIdFile, "utf8").trim();
    if (!buildId) throw new Error("preflight: the build id file is empty");
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`preflight: the app returned ${res.status}`);
    if (!(await res.text()).includes(buildId)) {
      throw new Error("preflight: the served app is not this checkout's build");
    }
  }

  // 4. 温める。開発モードの初回の遅さで、最初のシナリオが待ちの上限を超えないようにする。
  //    初回のコンパイルを待てるよう、上限は webServer の timeout と同じくらい長くする。
  //    ログイン画面への転送が正常なアプリもあるので、ここは転送を追う。
  await get(baseUrl, { timeoutMs: 120_000 });

  // 5. 温めた後もバックエンドが遅くないか。ヘルスチェックが 200 でも、全要求が 1〜2 秒ずつ遅いと、
  //    1 画面で何回も API を呼ぶうちに待ちの上限を超える。1 回温めてから 3 回計り、1 回でも上限を超えたら止める。
  //    計る URL は 1 と同じ。プロキシが自分で返すヘルスチェックでなく、アプリの処理を通る URL にする。
  //    上限（ミリ秒）を E2E_API_MAX_RESPONSE_MS に設定したときだけ計る。
  const rawLimit = process.env.E2E_API_MAX_RESPONSE_MS?.trim();
  if (healthUrl && rawLimit) {
    const limitMs = Number(rawLimit);
    if (!Number.isFinite(limitMs) || limitMs <= 0) {
      throw new Error("preflight: E2E_API_MAX_RESPONSE_MS must be a positive number of milliseconds");
    }
    await get(healthUrl, { redirect: "manual" });
    const times: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const start = performance.now();
      await get(healthUrl, { redirect: "manual" });
      times.push(Math.round(performance.now() - start));
    }
    if (times.some((ms) => ms > limitMs)) {
      throw new Error(
        `preflight: the backend is slow (${times.join(", ")} ms after warm-up; limit ${limitMs} ms). ` +
          "Look for a development-mode file watcher scanning a large tree (e.g. node_modules under a watched directory) " +
          "or a slow network path between the containers.",
      );
    }
  }

  // 6. 画面が呼ぶバックエンドの行き先が、テストが期待するバックエンドか。ビルドに埋め込む値（API の URL）が
  //    空のまま作ると、画面は自分自身に要求を送って 404 になる。そのビルドも今のチェックアウトのものなので 3 は通る。
  //    E2E_EXPECT_API_ORIGIN に期待する API の origin を、E2E_API_PROBE_PATH に、ログインせずに開けて
  //    ブラウザから API を呼ぶ画面のパス（既定は baseURL）を設定したときだけ確かめる。
  //    サーバの側だけで API を呼ぶ画面や、API が画面と同じ origin の構成では見分けられないので使わない。
  //    chromium の新しいページ（資格情報もプロジェクトの use も引き継がない）で開き、
  //    失敗の文には origin だけを出す（パス・クエリを写さない）。
  const expectedApi = process.env.E2E_EXPECT_API_ORIGIN?.trim();
  if (expectedApi) {
    const app = new URL(baseUrl);
    const api = URL.canParse(expectedApi) ? new URL(expectedApi) : undefined;
    if (!api || !["http:", "https:"].includes(api.protocol)) {
      throw new Error("preflight: E2E_EXPECT_API_ORIGIN must be an http(s) URL");
    }
    if (api.origin === app.origin) {
      throw new Error("preflight: E2E_EXPECT_API_ORIGIN has the same origin as baseURL; this check cannot tell them apart");
    }
    const probeUrl = new URL(process.env.E2E_API_PROBE_PATH?.trim() || "/", app);
    if (probeUrl.origin !== app.origin || probeUrl.username || probeUrl.password) {
      throw new Error("preflight: E2E_API_PROBE_PATH must be a path on baseURL");
    }
    await get(probeUrl.toString(), { timeoutMs: 120_000 }); // 開く画面も温める（開発モードの初回のコンパイル）
    const { chromium } = await import("@playwright/test"); // この確認を使うときだけブラウザを起動する
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const isFetch = (request: { resourceType(): string }) => ["fetch", "xhr"].includes(request.resourceType());
      const isApiCall = (request: { resourceType(): string; url(): string }) =>
        isFetch(request) && new URL(request.url()).origin === api.origin;
      const seen = new Set<string>();
      let called = false;
      page.on("request", (request) => {
        if (isFetch(request)) seen.add(new URL(request.url()).origin);
        if (isApiCall(request)) called = true;
      });
      const response = await page.goto(probeUrl.toString(), { timeout: 120_000 }).catch(() => {
        throw new Error(`preflight: could not open the probe page on ${app.origin}`);
      });
      if (response && !response.ok()) {
        throw new Error(`preflight: the probe page returned ${response.status()}`);
      }
      // 画面の読み込みの後（hydration の後など）に出る要求も待つ。
      called ||= await page.waitForRequest(isApiCall, { timeout: 30_000 }).then(
        () => true,
        () => false,
      );
      if (!called) {
        const origins = [...seen].join(", ") || "none";
        throw new Error(
          `preflight: the app did not call ${api.origin} (fetch/xhr went to: ${origins}). ` +
            "Check the API URL built into the app (a build-time value such as NEXT_PUBLIC_* may have been empty).",
        );
      }
    } finally {
      await browser.close();
    }
  }
}
```

止まったときは、原因を直してから流し直す。確認を外して流し、落ちたシナリオを
テスト対象の不具合として扱わない。

5 と 6 は、1〜4 が通っても起きる崩れを拾う。どちらも変数を設定したときだけ動く。5 の上限は、
温めた後の手元の値を見て決める（例: 500）。6 はブラウザ（chromium）を 1 回起動するので、ほかの確認より遅い。

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
missing. See [what the drift gate does not guarantee](https://github.com/Pound79/specproof/blob/main/docs/security-model.md#drift-のゲートが保証しないこと).

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
(detect drift) → `/specproof-sync` → `specproof-update` (bless). A pure
refactor is blessed as-is. If observable behavior changed, sync stops and asks
you to decide against the spec: fix the implementation, update the spec first,
or confirm the spec already requires the new behavior. Expected values in the
feature always come from the spec, never from the implementation diff, and
existing scenarios are never deleted.

### 仕様の置き場所 と 「テストが難しい ≠ 観測不能」

Classify a behavior by whether it is **user-observable**, not by how hard it
is to automate: observable → keep it in `.feature` (if automation is hard, tag it
`@red-contract` to automate later, `@human` for a person to check, or
`@out-of-scope` with a one-line reason comment); not observable (status-code
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
- [specproof config schema](https://github.com/Pound79/specproof/blob/main/docs/config-schema.md)
- [specproof methodology](https://github.com/Pound79/specproof/blob/main/docs/methodology.md)
- [Running E2E that needs a separate backend in CI](https://github.com/Pound79/specproof/blob/main/docs/playwright-ci.md)
