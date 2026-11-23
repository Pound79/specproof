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
| Traces, screenshots and videos | `test-results/`, `playwright-report/` | A trace is kept for every failed test attempt, locally and in CI (including a failed first attempt of a test that passed on retry). It records the actions (including the typed login form), the network, cookies and localStorage, so it carries the test account's session. Both directories are gitignored. Do not share them. Do not upload them as CI artifacts; reproduce a CI-only failure locally and open the trace there (`npx playwright show-trace`). The only exception (traces of failed runs, kept briefly, when every condition holds) is in [the CI guide](https://github.com/Pound79/specproof/blob/main/docs/playwright-ci.md#例外-落ちた-run-の-trace-を短く残す). |

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

// 手元（ループバック）か。E2E_PREFLIGHT_ALLOWED_HOSTS（カンマ区切りのホスト名）に書いたホストも許す
// （docker compose のサービス名など、手元の使い捨ての環境だけを書く）。ポートは書かず、IPv6 は [::1] のように
// 角括弧で書く（URL の hostname と同じ形で比べる）。
const allowedHosts = new Set(
  (process.env.E2E_PREFLIGHT_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean),
);
const isLocalTarget = (url: URL): boolean => {
  const host = url.hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === "[::1]" ||
    allowedHosts.has(host)
  );
};

export default async function preflight(config: FullConfig): Promise<void> {
  const baseUrl = config.projects.find((project) => project.use.baseURL)?.use.baseURL;
  if (!baseUrl) throw new Error("preflight: baseURL is not set");

  // 0. 画面と API の URL が手元を指しているか。E2E は書き込む（データを作る・消す）ので、環境変数の書き換えの
  //    残りでステージングや本番を指したまま流さない。ほかの確認より先に、要求を 1 つも送る前に確かめる。
  //    確かめるのはここに並べた URL だけ。seed やテストの中の API クライアントが別の環境変数から URL を読むなら、
  //    その変数もここに足す。画面がビルドに埋め込んだ API の URL は、6（E2E_EXPECT_API_ORIGIN）で確かめる。
  const projectBaseUrls = config.projects.flatMap((project, index) =>
    project.use.baseURL ? [[`baseURL of project ${index}`, project.use.baseURL] as const] : [],
  );
  for (const [name, value] of [
    ...projectBaseUrls,
    ["E2E_API_HEALTH_URL", process.env.E2E_API_HEALTH_URL],
    ["E2E_EXPECT_API_ORIGIN", process.env.E2E_EXPECT_API_ORIGIN],
  ] as const) {
    const url = value?.trim() && URL.canParse(value.trim()) ? new URL(value.trim()) : undefined;
    // URL でない値は、その値を使う確認が値を写さずに止める。
    if (!url || !["http:", "https:"].includes(url.protocol)) continue;
    if (!isLocalTarget(url)) {
      throw new Error(
        `preflight: ${name} is not a local target (${url.origin}); ` +
          "point it at localhost, or list a disposable local host in E2E_PREFLIGHT_ALLOWED_HOSTS",
      );
    }
  }

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
  //    Next.js は本番用のビルド（next build）の .next/BUILD_ID を使う。App Router は ID を HTML の中の
  //    RSC の payload（self.__next_f.push(...) のスクリプト）に入れ、/_next/static/<id>/ のパスには出さないので、
  //    パスでなく HTML の全文から探す（Pages Router は __NEXT_DATA__ の buildId）。開発サーバ（next dev）の
  //    画面には出ないので、この確認は本番用のビルドで流すときに使う。ほかのフレームワークでは、ビルドの
  //    識別子（コミットなど）を HTML の meta などに出すようにして、それと比べる。
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
    // 指定が無ければ baseURL（パスを含む）をそのまま開く。
    const probePath = process.env.E2E_API_PROBE_PATH?.trim();
    const probeUrl = probePath ? new URL(probePath, app) : app;
    if (probeUrl.origin !== app.origin || probeUrl.username || probeUrl.password) {
      throw new Error("preflight: E2E_API_PROBE_PATH must be a path on baseURL");
    }
    // 開く画面も温める（開発モードの初回のコンパイル）。転送は追わない（転送先が手元の外でも送らない）。
    await get(probeUrl.toString(), { timeoutMs: 120_000, redirect: "manual" });
    const { chromium } = await import("@playwright/test"); // この確認を使うときだけブラウザを起動する
    const browser = await chromium.launch();
    try {
      // Service Worker を経た要求は route を通らないので、Service Worker を使わせない。
      const context = await browser.newContext({ serviceWorkers: "block" });
      const page = await context.newPage();
      // 画面が手元の外（解析のサービス、指し間違えた API など）へ送る要求は、送らずに止める。止めた
      // 要求も "request" には出るので、下の行き先の一覧に残る。止まらないもの: WebSocket（止めるなら
      // page.routeWebSocket）、手元の URL が返した転送の先（route は転送の最初の URL にだけ呼ばれる）。
      await page.route("**/*", (route) =>
        isLocalTarget(new URL(route.request().url())) ? route.continue() : route.abort("blockedbyclient"),
      );
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

  // 7. seed が書いたテスト用の JWT が、全件を流し終えるまで期限切れにならないか。途中で切れると、
  //    後半のシナリオだけがばらばらに 401 や時間切れで落ちる。E2E_SEED_TOKENS_FILE に seed の出力（JSON）を、
  //    E2E_RUN_BUDGET_MINUTES に全件の所要時間（分。再試行を含めて余裕を持たせる）を設定したときだけ確かめる。
  //    署名は確かめない（期限を読むだけ）。トークンもその一部も、ログに写さない。
  const tokensFile = process.env.E2E_SEED_TOKENS_FILE;
  const rawBudget = process.env.E2E_RUN_BUDGET_MINUTES?.trim();
  if (tokensFile && rawBudget) {
    const budgetMinutes = Number(rawBudget);
    if (!Number.isFinite(budgetMinutes) || budgetMinutes <= 0) {
      throw new Error("preflight: E2E_RUN_BUDGET_MINUTES must be a positive number of minutes");
    }
    let seedOutput: unknown;
    try {
      seedOutput = JSON.parse(readFileSync(tokensFile, "utf8"));
    } catch {
      throw new Error("preflight: could not read the seed output in E2E_SEED_TOKENS_FILE (run the seed first)");
    }
    // 値のどこかにある JWT（3 つの base64url をつないだ文字列）の exp を集める。
    const JWT = /^[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/;
    const expiries: number[] = [];
    const visit = (value: unknown): void => {
      if (typeof value === "string") {
        const payload = JWT.exec(value)?.[1];
        if (!payload) return;
        let exp: unknown;
        try {
          ({ exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown });
        } catch {
          return; // JWT の形でも中身が JSON でなければ数えない（エラーの文は入力の一部を含むので捨てる）。
        }
        if (typeof exp !== "number") return;
        // exp は秒。ミリ秒で入れる発行元だと遠い未来になって通ってしまうので、秒に見えなければ止める。
        if (exp > 1e11) {
          throw new Error("preflight: a seeded JWT has an exp claim that is not in seconds; check the token issuer");
        }
        expiries.push(exp * 1000);
      } else if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value && typeof value === "object") {
        Object.values(value).forEach(visit);
      }
    };
    visit(seedOutput);
    if (expiries.length === 0) {
      throw new Error("preflight: no JWT with an exp claim was found in E2E_SEED_TOKENS_FILE");
    }
    const earliest = expiries.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
    const remainingMinutes = Math.floor((earliest - Date.now()) / 60_000);
    if (remainingMinutes < budgetMinutes) {
      throw new Error(
        `preflight: a seeded JWT expires in ${remainingMinutes} minute(s), before the run budget of ${budgetMinutes} minute(s). ` +
          "Re-run the seed (or issue longer-lived test tokens) and start again.",
      );
    }
  }
}
```

止まったときは、原因を直してから流し直す。確認を外して流し、落ちたシナリオを
テスト対象の不具合として扱わない。

5 と 6 は、1〜4 が通っても起きる崩れを拾う。どちらも変数を設定したときだけ動く。5 の上限は、
温めた後の手元の値を見て決める（例: 500）。6 はブラウザ（chromium）を 1 回起動するので、ほかの確認より遅い。

0 は常に動く。書き込む E2E を手元以外へ向けないための確認なので、外さない。ただし確かめるのは例に並べた
URL（各 project の `baseURL` と、設定した `E2E_API_HEALTH_URL`・`E2E_EXPECT_API_ORIGIN`）だけで、画面が
ビルドに埋め込んだ API の URL は 6 を使わないと確かめない。seed やテストの API クライアントが別の変数から
URL を読むなら、その変数を 0 の一覧に足す。CI で docker compose の
サービス名などを使うときは、そのホスト名だけを `E2E_PREFLIGHT_ALLOWED_HOSTS` に書く。共有のステージングや
本番のホストは書かない。7 は、seed がテスト用のトークンを書く構成で使う（期限の無いトークンや、セッションの
cookie だけの構成では要らない）。

どれを残すかの目安: 0・1・4 はほぼどこでも使える（URL と上限を環境変数から読む）。7 は seed がトークンを
書くとき。3 はフレームワークごとに置き場所が違う。5 は遅さで落ちたことがあるとき。6 は画面と API の origin が
別のときだけ意味がある。

### 状態を使い切るシナリオのガード

seed が run ごとに 1 回しか入らず、試行ごとにデータを作る手段も無いと、操作で前提の状態を使い切るシナリオは
CI の再試行（`retries`）で前提が成り立たず、理由の分からない時間切れになる。前提を画面で確かめられないときは、
シナリオごとの印で、操作の前に理由を出して止める（specproof-implement の自己点検の 7）。雛形にはこのファイルが
無いので、使うときに作る。

対象は、操作の動詞でなく「その操作の後、同じシナリオがもう一度は成り立たないか」で選ぶ。削除・承認のほか、
参加する、通報する、対応済みなどの印を付ける、名前や本文を変える、も当てはまる。前提を確かめる assert
（「チェックが付いていない」「元の名前が出ている」など）が 2 回目に時間切れで落ちるものも対象。毎回新しい値で
作るもの、要求が断られて何も変わらないもの、失敗の経路を含めて次の試行が前提を確かめる前に状態が戻ることを
確かめたものは対象外。シナリオの最後の step で戻すだけのものは、途中で落ちると戻す step が走らないので対象に残す。

```ts
// src/support/seed-guard.ts（例）
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestInfo } from "@playwright/test";

// このファイルを src/support/ に置く前提の深さ（src/config/auth-state.ts と同じ）。別の深さに置くなら直す。
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// seed のスクリプトが、seed が成功した後に消す。
const consumedDir = path.join(packageRoot, "state", "consumed");

// testId は project、ファイルの場所、タイトルから決まり、行番号を含まない。再試行でも run をまたいでも同じで、
// 例の表（Scenario Outline）の行ごとに別になる。再試行の番号や行番号を鍵にしない。
const markPath = (testInfo: TestInfo): string =>
  path.join(consumedDir, createHash("sha256").update(testInfo.testId).digest("hex").slice(0, 32));

// 例の表の行は、既定では title が「例: #2」だけになるので、先頭のファイルを除いた titlePath でシナリオ名から出す。
const scenarioName = (testInfo: TestInfo): string => testInfo.titlePath.slice(1).join(" > ");

export function guardSeedData(testInfo: TestInfo): { consume: () => void } {
  if (existsSync(markPath(testInfo))) {
    throw new Error(
      `"${scenarioName(testInfo)}" already used its seed data in an earlier attempt or run. ` +
        "Re-run the seed before running it again (look at the first attempt's failure first).",
    );
  }
  return {
    // 取り返しのつかない要求を出す確定の操作の直前に呼ぶ。
    consume: () => {
      mkdirSync(consumedDir, { recursive: true, mode: 0o700 });
      writeFileSync(markPath(testInfo), "", { flag: "wx", mode: 0o600 });
    },
  };
}
```

```ts
// step の例: 最初にガードを呼び、確認のダイアログの確定の直前に印を残す。
import { expect } from "@playwright/test";
import { When } from "../src/fixtures/test";
import { guardSeedData } from "../src/support/seed-guard";

When("ユーザー{string}を削除する", async ({ page, $testInfo }, name: string) => {
  const guard = guardSeedData($testInfo);
  await page.getByRole("row", { name }).getByRole("button", { name: "削除" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  guard.consume();
  await dialog.getByRole("button", { name: "削除する" }).click();
});
```

```sh
# seed のスクリプトの最後（seed が成功した後だけ届くようにする。失敗したら印を残す）。
# STATE_DIR は上の packageRoot の state と同じ場所を、スクリプトの場所から絶対パスで決める（例は、このスクリプトを
# パッケージの scripts/ に置いたとき）。外から受け継いだ環境変数を rm の起点にしない。空でも広がらない形にする。
STATE_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd -P)/state"
rm -rf -- "${STATE_DIR:?}/consumed"
```

守ること:

- 印は、取り返しのつかない要求を出す確定の操作の直前に残す。ダイアログを開く前などに残すと、ダイアログを
  待つ間に落ちた試行が、何も使っていないのに印を残し、通るはずの再試行を止める。共通の関数の中で操作する
  ときも、その関数の前でなく、確定の操作の直前で残す。確定の操作そのものが落ちたときは、要求が届いていなくても
  印が残る（seed を流し直す）
- 1 つのシナリオに置けるガードは 1 つまで。印はシナリオごとなので、2 つ目は 1 つ目の印で止まる。ガードを
  置いた step が、どのシナリオでも 1 回しか通らないことを確かめる（feature を step の文で検索するなど）
- 守れないもの: `--repeat-each` の繰り返しは testId が変わるので止められない。同じ feature を複数の project で
  流すと、印は project ごとに別になる（seed のデータを project ごとに分ける）。seed を流し直さずに例の表の行を
  足す・並べ替える・値を変えると、印が別の行に付くか、付いた印が使われなくなることがある（行のタイトルは既定では
  行の番号で、`<列名>` や `examplesTitleFormat` で列の値にもなる）
- 印を消すのは seed のスクリプトで、step や `globalSetup` では消さない（消すと、使い切った状態のまま流れる）
- `state/` を `.gitignore` に足す（コミットすると、新しく取り出した環境で該当のシナリオが全部止まる）。`state/` と
  `state/consumed/` をシンボリックリンクにしない（例は途中のリンクを確かめないので、`rm` がリンク先を消す）
- 印は取り違えを防ぐためのもので、改ざんへの防御ではない（同じディレクトリに書ける人は、印を置いて止めることも
  消して外すこともできる）。共有のマシンでは自分だけが書けるディレクトリに置く
- 止めるメッセージにはシナリオ名が出る。行のタイトルを列の値にしている例の表には、秘密や個人のデータを置かない

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
