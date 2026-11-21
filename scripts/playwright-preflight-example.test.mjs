import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("Playwright の README は、テストの前に環境を確かめる例を設定の実態に合わせて示す", () => {
  // 古いビルドや別のブランチのバックエンドに気づかずに流すと、変えていないシナリオまで落ちる。
  // 雛形に globalSetup は無いので、README は playwright.config.ts に直接足す形で示す。
  const readme = read("templates/playwright/README.md");
  const from = readme.indexOf("### テストの前に環境を確かめる");
  const to = readme.indexOf("\n## ", from);
  assert.ok(from >= 0 && to > from, "環境の確認の節が無い");
  const section = readme.slice(from, to);
  assert.match(section, /globalSetup: "\.\/src\/setup\/preflight\.ts"/);
  // 確かめる URL はテストと同じ baseURL から取る（環境変数の名前を決め打ちしない）。
  assert.match(section, /preflight\(config: FullConfig\)/);
  assert.match(section, /use\.baseURL/);
  assert.doesNotMatch(section, /process\.env\.E2E_BASE_URL/);
  for (const check of ['"--is-ancestor"', "includes(buildId)", "if (!buildId)", "120_000"]) {
    assert.ok(section.includes(check), check);
  }
  // 資格情報は送らない。送るなら URL を確かめる関数を案内する。
  assert.match(section, /assertSecureBaseUrl\(\)/);
  // 資格情報を送らない要求で転送を拒むと、ルートがログイン画面へ転送するアプリで温める要求が必ず落ちる。
  assert.doesNotMatch(section, /redirect: "error", signal/);
  for (const file of ["templates/playwright/src/config/specproof-config.ts", "templates/playwright/playwright.config.ts"]) {
    assert.doesNotMatch(read(file), /globalSetup/, `${file}: globalSetup ができたら README の案内を直す`);
  }
});

// README の例をそのまま取り出し、ローカルの HTTP サーバに対して動かす。ヘルスチェックの URL がログイン画面へ
// 転送するとき（認証の要る URL を指している、など）に、転送先の 200 で通ってはいけない。

const extractExample = () => {
  const readme = read("templates/playwright/README.md");
  const from = readme.indexOf("// src/setup/preflight.ts（例）");
  const to = readme.indexOf("```", from);
  assert.ok(from >= 0 && to > from, "README に preflight の例が無い");
  return readme.slice(from, to);
};

// ブラウザの代役。@playwright/test はこのリポジトリの依存に無いので、例の 6 が使う範囲（chromium.launch・
// newPage・on("request")・waitForRequest・goto・close）だけを真似る。goto は開いたページの応答の
// x-test-requests ヘッダ（JSON）に並べた要求を、ページが出した要求として流す。afterGoto の要求は goto が
// 返った後に流す（読み込みの後に出る fetch）。launch と close は印を出し、close するまでプロセスを終わらせない。
// 確かめられるのは例の判定と失敗の文、ブラウザの起動と後始末までで、実際のブラウザでの動きではない。
const BROWSER_STUB = `
export const chromium = {
  launch: async () => {
    console.log("browser launched");
    const keepAlive = setInterval(() => {}, 1_000);
    return {
      close: async () => {
        clearInterval(keepAlive);
        console.log("browser closed");
      },
      newPage: async () => {
        const listeners = [];
        const waiters = [];
        const emit = (request) => {
          for (const listener of listeners) listener(request);
          for (const waiter of waiters) if (!waiter.done && waiter.predicate(request)) {
            waiter.done = true;
            waiter.resolve(request);
          }
        };
        return {
          on: (event, listener) => { if (event === "request") listeners.push(listener); },
          waitForRequest: (predicate, { timeout }) => new Promise((resolve, reject) => {
            const waiter = { predicate, resolve, done: false };
            waiters.push(waiter);
            setTimeout(() => { if (!waiter.done) { waiter.done = true; reject(new Error("timeout")); } }, Math.min(timeout, 300));
          }),
          goto: async (url) => {
            const res = await fetch(url);
            const requests = JSON.parse(res.headers.get("x-test-requests") ?? "[]");
            const toRequest = (r) => ({ url: () => new URL(r.url, url).toString(), resourceType: () => r.type ?? "fetch" });
            for (const r of requests.filter((r) => !r.afterGoto)) emit(toRequest(r));
            setTimeout(() => { for (const r of requests.filter((r) => r.afterGoto)) emit(toRequest(r)); }, 20);
            return { ok: () => res.ok, status: () => res.status };
          },
        };
      },
    };
  },
};
`;

const runPreflight = async (
  healthStatus,
  healthLocation,
  { healthDelayMs = 0, pageRequests = [], pageStatus = 200, env = {}, basePath = "", onlyPath } = {},
) => {
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      setTimeout(() => {
        res.writeHead(healthStatus, healthLocation ? { location: healthLocation } : {});
        res.end();
      }, healthDelayMs);
    } else {
      const requests = pageRequests.map((r) => (typeof r === "string" ? { url: r } : r));
      // onlyPath を指定したときは、そのパスのページだけがある（ほかは 404）。
      const status = onlyPath !== undefined && req.url !== onlyPath ? 404 : pageStatus;
      res.writeHead(status, { "content-type": "text/html", "x-test-requests": JSON.stringify(requests) });
      res.end("<html>login</html>");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(path.join(os.tmpdir(), "specproof-preflight-"));
  writeFileSync(path.join(dir, "preflight.ts"), extractExample());
  mkdirSync(path.join(dir, "node_modules", "@playwright", "test"), { recursive: true });
  writeFileSync(
    path.join(dir, "node_modules", "@playwright", "test", "package.json"),
    JSON.stringify({ name: "@playwright/test", type: "module", exports: "./index.js" }),
  );
  writeFileSync(path.join(dir, "node_modules", "@playwright", "test", "index.js"), BROWSER_STUB);
  writeFileSync(
    path.join(dir, "run.mjs"),
    `import preflight from "./preflight.ts";\nawait preflight({ projects: [{ use: { baseURL: ${JSON.stringify(`${base}${basePath}`)} } }] });\nconsole.log("passed");\n`,
  );
  try {
    // spawnSync はイベントループを止めてサーバが応答できないので、非同期で起動する。
    const child = spawn(process.execPath, [path.join(dir, "run.mjs")], {
      // 手元の E2E_* などを受け継がない（例の 2・3 の確認が走って結果が環境で変わる）。
      env: {
        PATH: process.env.PATH,
        E2E_API_HEALTH_URL: `${base}/health`,
        ...(typeof env === "function" ? env(base) : env),
      },
    });
    // ブラウザを閉じ忘れると代役の keepAlive でプロセスが終わらない。上限で止めて失敗にする。
    const timer = setTimeout(() => child.kill(), 15_000);
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    const code = await new Promise((resolve) => child.on("close", resolve));
    clearTimeout(timer);
    return { code, out };
  } finally {
    server.close();
  }
};

test("README の preflight の例は、ヘルスチェックが 200 なら通し、503 と転送では止める", async () => {
  const passed = await runPreflight(200);
  assert.equal(passed.code, 0);
  // 6 の変数を設定していなければブラウザを起動しない。
  assert.doesNotMatch(passed.out, /browser launched/);
  const unavailable = await runPreflight(503);
  assert.notEqual(unavailable.code, 0);
  assert.match(unavailable.out, /API health check returned 503/);
  const redirected = await runPreflight(302, "/login");
  assert.notEqual(redirected.code, 0, redirected.out);
  assert.match(redirected.out, /API health check returned 302 \(redirect to \/login/);
});

test("README の preflight の例は、上限を設定したときだけ、温めた後のバックエンドの遅さで止める", async () => {
  // ヘルスチェックが 200 でも、全要求が遅ければ画面ごとに積み重なり、待ちの上限を超えて落ちる。
  const slow = await runPreflight(200, undefined, {
    healthDelayMs: 600,
    env: { E2E_API_MAX_RESPONSE_MS: "100" },
  });
  assert.notEqual(slow.code, 0, slow.out);
  assert.match(slow.out, /preflight: the backend is slow/);
  assert.match(slow.out, /limit 100 ms/);
  // 上限の内なら通る（遅延と上限の差を大きく取り、時間で揺れないようにする）。
  const relaxed = await runPreflight(200, undefined, {
    healthDelayMs: 50,
    env: { E2E_API_MAX_RESPONSE_MS: "5000" },
  });
  assert.equal(relaxed.code, 0, relaxed.out);
  // 上限を設定していなければ計らない（1 だけを使っている既存の利用者の動きを変えない）。空も未設定と同じ。
  for (const env of [{}, { E2E_API_MAX_RESPONSE_MS: " " }]) {
    const unset = await runPreflight(200, undefined, { healthDelayMs: 600, env });
    assert.equal(unset.code, 0, unset.out);
  }
  const invalid = await runPreflight(200, undefined, { env: { E2E_API_MAX_RESPONSE_MS: "fast" } });
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.out, /E2E_API_MAX_RESPONSE_MS must be a positive number/);
});

const API = "http://api.example.test:4000";

test("README の preflight の例は、画面が期待するバックエンドを呼んでいなければ止める", async () => {
  // ビルドに埋め込む API の URL が空のまま作ると、画面は自分自身に要求を送る。配信中のビルドは
  // 今のチェックアウトのものなので、例の 3 では拾えない。
  const self = await runPreflight(200, undefined, {
    pageRequests: ["/widgets/1?token=do-not-print"],
    env: { E2E_EXPECT_API_ORIGIN: API },
  });
  assert.notEqual(self.code, 0, self.out);
  assert.match(self.out, /preflight: the app did not call http:\/\/api\.example\.test:4000/);
  assert.match(self.out, /fetch\/xhr went to: http:\/\/127\.0\.0\.1:\d+/);
  // 失敗の文には origin だけを出す（パス・クエリを写さない）。失敗してもブラウザを閉じる。
  assert.doesNotMatch(self.out, /widgets|do-not-print/);
  assert.match(self.out, /browser closed/);
  // fetch / xhr でない要求（画像など）は API を呼んだことにしない。
  const imageOnly = await runPreflight(200, undefined, {
    pageRequests: [{ url: `${API}/avatar.png`, type: "image" }],
    env: { E2E_EXPECT_API_ORIGIN: API },
  });
  assert.notEqual(imageOnly.code, 0, imageOnly.out);
  assert.match(imageOnly.out, /fetch\/xhr went to: none/);
  // 読み込みの前でも後でも、期待する origin への fetch / xhr があれば通る。
  for (const afterGoto of [false, true]) {
    const ok = await runPreflight(200, undefined, {
      pageRequests: ["/_next/data.json", { url: `${API}/widgets/1`, type: "xhr", afterGoto }],
      env: { E2E_EXPECT_API_ORIGIN: API },
    });
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /browser launched[\s\S]*browser closed/);
  }
  // 開いた画面が応答できていなければ、その状態で止める（API の行き先の案内にしない）。
  const broken = await runPreflight(200, undefined, { pageStatus: 500, env: { E2E_EXPECT_API_ORIGIN: API } });
  assert.notEqual(broken.code, 0);
  assert.match(broken.out, /the probe page returned 500/);
});

test("README の preflight の例は、probe を指定しなければ baseURL（パス付きを含む）をそのまま開く", async () => {
  // baseURL がパスを持つアプリ（/app/ の下で配信）で、ルートにページが無くても確認できる。
  const result = await runPreflight(200, undefined, {
    basePath: "/app/",
    onlyPath: "/app/",
    pageRequests: [{ url: `${API}/widgets/1`, type: "fetch" }],
    env: { E2E_EXPECT_API_ORIGIN: API },
  });
  assert.equal(result.code, 0, result.out);
});

test("README の preflight の例は、行き先の確認の設定の誤りを、値を写さずに止める", async () => {
  // 画面と同じ origin では見分けられないので、確認が通ったことにしない。
  const sameOrigin = await runPreflight(200, undefined, { env: (base) => ({ E2E_EXPECT_API_ORIGIN: base }) });
  assert.notEqual(sameOrigin.code, 0);
  assert.match(sameOrigin.out, /same origin as baseURL/);
  for (const value of ["http://u:do-not-print@[bad", "data:text/plain,do-not-print"]) {
    const invalid = await runPreflight(200, undefined, { env: { E2E_EXPECT_API_ORIGIN: value } });
    assert.notEqual(invalid.code, 0);
    assert.match(invalid.out, /E2E_EXPECT_API_ORIGIN must be an http\(s\) URL/);
    assert.doesNotMatch(invalid.out, /do-not-print/);
  }
  // 開くページは baseURL の上のパスに限る（別のホストへ要求を送らせない。userinfo も付けさせない）。
  const probes = [
    "https://elsewhere.example.test/",
    "//elsewhere.example.test/",
    "/\\elsewhere.example.test/",
  ];
  for (const probe of probes) {
    const elsewhere = await runPreflight(200, undefined, {
      env: { E2E_EXPECT_API_ORIGIN: API, E2E_API_PROBE_PATH: probe },
    });
    assert.notEqual(elsewhere.code, 0, probe);
    assert.match(elsewhere.out, /E2E_API_PROBE_PATH must be a path on baseURL/);
    assert.doesNotMatch(elsewhere.out, /browser launched/);
  }
  const withUser = await runPreflight(200, undefined, {
    env: (base) => ({
      E2E_EXPECT_API_ORIGIN: API,
      E2E_API_PROBE_PATH: base.replace("http://", "http://u:do-not-print@"),
    }),
  });
  assert.notEqual(withUser.code, 0);
  assert.match(withUser.out, /E2E_API_PROBE_PATH must be a path on baseURL/);
  assert.doesNotMatch(withUser.out, /do-not-print/);
});

test("README の preflight の例は、要求が届かないとき URL のパスとクエリを写さない", async () => {
  // 応答しないヘルスチェックの URL にトークンを含めても、失敗の文には origin だけを出す。
  const result = await runPreflight(200, undefined, {
    env: { E2E_API_HEALTH_URL: "http://127.0.0.1:9/health?token=do-not-print" },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.out, /preflight: http:\/\/127\.0\.0\.1:9 did not respond/);
  assert.doesNotMatch(result.out, /do-not-print/);
});

test("README の preflight の例は、行き先の確認を使うときだけブラウザを読み込む", () => {
  const section = extractExample();
  // 使わない人の globalSetup でブラウザを起動しない。
  assert.match(section, /await import\("@playwright\/test"\)/);
  assert.doesNotMatch(section, /^import \{[^}]*chromium/m);
});
