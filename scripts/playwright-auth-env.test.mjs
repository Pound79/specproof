import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Playwright テンプレートの認証情報の扱い。テンプレートは依存を入れていないので、依存の無い
// auth-env.ts だけを tsx で読み込んで検査する。
const authEnvModule = fileURLToPath(
  new URL("../templates/playwright/src/config/auth-env.ts", import.meta.url),
);

const project = {
  name: "authed",
  tags: "",
  features: [],
  storageState: "playwright/.auth/user.json",
  setup: true,
  credentialsEnv: { username: "E2E_USERNAME", password: "E2E_PASSWORD", newPassword: "E2E_NEW_PASSWORD" },
};

/** auth-env.ts の関数を、指定した環境変数で別プロセスから呼ぶ。 */
const evaluate = (fn, env) => {
  const script = `
    const m = await import(${JSON.stringify(authEnvModule)});
    const result = m.${fn}(${JSON.stringify(project)}, ${JSON.stringify(env)});
    process.stdout.write(JSON.stringify(result ?? null));
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test("パスワードの前後の空白を削らずにそのまま渡す", () => {
  for (const password of [" password", "password ", " password ", "   "]) {
    const creds = evaluate("credentialsFor", { E2E_USERNAME: "user", E2E_PASSWORD: password });
    assert.equal(creds.password, password, JSON.stringify(password));
  }
  const creds = evaluate("credentialsFor", {
    E2E_USERNAME: "user",
    E2E_PASSWORD: "pw",
    E2E_NEW_PASSWORD: " new ",
  });
  assert.equal(creds.newPassword, " new ");
});

test("未設定と空文字列のパスワードだけを欠落とみなす", () => {
  assert.equal(evaluate("credentialsFor", { E2E_USERNAME: "user" }), null);
  assert.equal(evaluate("credentialsFor", { E2E_USERNAME: "user", E2E_PASSWORD: "" }), null);
});

test("欠落した環境変数の名前を返す", () => {
  assert.deepEqual(evaluate("missingCredentialEnv", {}), ["E2E_USERNAME", "E2E_PASSWORD"]);
  assert.deepEqual(evaluate("missingCredentialEnv", { E2E_USERNAME: "user" }), ["E2E_PASSWORD"]);
  assert.deepEqual(evaluate("missingCredentialEnv", { E2E_PASSWORD: "pw" }), ["E2E_USERNAME"]);
  assert.deepEqual(evaluate("missingCredentialEnv", { E2E_USERNAME: "  ", E2E_PASSWORD: "pw" }), [
    "E2E_USERNAME",
  ]);
  assert.deepEqual(evaluate("missingCredentialEnv", { E2E_USERNAME: "u", E2E_PASSWORD: "p" }), []);
});

test("auth setup は認証情報が欠けたとき skip せず失敗させる", () => {
  // skip すると依存する認証済み project が古い storageState のまま走るため、失敗させて止める。
  const setup = readFileSync(
    new URL("../templates/playwright/src/setup/auth.setup.ts", import.meta.url),
    "utf8",
  );
  const credentialBranch = setup.slice(setup.indexOf("missingCredentialEnv(p)"));
  assert.ok(setup.includes("missingCredentialEnv(p)"), "欠落の判定を使っていない");
  assert.match(credentialBranch.slice(0, 600), /throw new Error/);
  assert.doesNotMatch(credentialBranch.slice(0, 600), /setup\.skip/);
});
