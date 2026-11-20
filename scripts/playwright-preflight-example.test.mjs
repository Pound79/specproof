import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const runPreflight = async (healthStatus, healthLocation) => {
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(healthStatus, healthLocation ? { location: healthLocation } : {});
      res.end();
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>login</html>");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(path.join(os.tmpdir(), "specproof-preflight-"));
  writeFileSync(path.join(dir, "preflight.ts"), extractExample());
  writeFileSync(
    path.join(dir, "run.mjs"),
    `import preflight from "./preflight.ts";\nawait preflight({ projects: [{ use: { baseURL: ${JSON.stringify(base)} } }] });\nconsole.log("passed");\n`,
  );
  try {
    // spawnSync はイベントループを止めてサーバが応答できないので、非同期で起動する。
    const child = spawn(process.execPath, [path.join(dir, "run.mjs")], {
      // 手元の E2E_* などを受け継がない（例の 2・3 の確認が走って結果が環境で変わる）。
      env: { PATH: process.env.PATH, E2E_API_HEALTH_URL: `${base}/health` },
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    const code = await new Promise((resolve) => child.on("close", resolve));
    return { code, out };
  } finally {
    server.close();
  }
};

test("README の preflight の例は、ヘルスチェックが 200 なら通し、503 と転送では止める", async () => {
  assert.equal((await runPreflight(200)).code, 0);
  const unavailable = await runPreflight(503);
  assert.notEqual(unavailable.code, 0);
  assert.match(unavailable.out, /API health check returned 503/);
  const redirected = await runPreflight(302, "/login");
  assert.notEqual(redirected.code, 0, redirected.out);
  assert.match(redirected.out, /API health check returned 302 \(redirect to \/login/);
});
