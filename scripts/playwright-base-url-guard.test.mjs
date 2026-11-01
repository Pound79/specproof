import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { assertSecureBaseUrl } from "../templates/playwright/src/config/base-url-guard.ts";

// 認証情報を平文の http で送らないための検査。loopback 以外の http は、環境プロファイルが
// allowInsecureHttp: true で明示したときだけ通す。
const profile = (extra = {}) => ({ name: "staging", ...extra });

for (const url of [
  "http://localhost:5173",
  "http://LOCALHOST:5173/app",
  "http://127.0.0.1:3000",
  "http://127.9.9.9",
  "http://[::1]:3000",
  "http://app.localhost:3000",
  "http://a.b.LOCALHOST",
  "https://example.com",
  "https://10.0.0.5:8443",
]) {
  test(`${url} は既定で通る`, () => {
    assert.doesNotThrow(() => assertSecureBaseUrl(url, profile()));
  });
}

for (const url of [
  "http://example.com",
  "http://10.0.0.5:8080",
  "http://localhost.example.com",
  "http://localhost.",
  "http://app.localhost.",
  "http://evillocalhost",
  "http://127.0.0.1.example.com",
  "http://[::ffff:127.0.0.1]",
  "http://0.0.0.0:5173",
  "HTTP://Example.com",
]) {
  test(`${url} は既定で止め、allowInsecureHttp での許可の仕方を示す`, () => {
    assert.throws(
      () => assertSecureBaseUrl(url, profile()),
      (error) =>
        error instanceof Error &&
        error.message.includes('environments[] entry "staging"') &&
        error.message.includes("allowInsecureHttp: true") &&
        error.message.includes("https://"),
    );
  });

  test(`${url} は allowInsecureHttp: true の環境では通る`, () => {
    assert.doesNotThrow(() => assertSecureBaseUrl(url, profile({ allowInsecureHttp: true })));
  });
}

for (const value of ["true", 1, "yes"]) {
  test(`allowInsecureHttp が真偽値の true でなければ（${JSON.stringify(value)}）許可しない`, () => {
    assert.throws(
      () => assertSecureBaseUrl("http://example.com", profile({ allowInsecureHttp: value })),
      /allowInsecureHttp: true/,
    );
  });
}

test("エラー文は URL の認証情報・パス・クエリを出さず、制御文字を表示しない", () => {
  const nul = String.fromCharCode(0);
  assert.throws(
    () =>
      assertSecureBaseUrl(
        "http://user:secret@example.com/path?token=abc",
        profile({ name: `bad${String.fromCharCode(27)}[2Jname` }),
      ),
    (error) =>
      !error.message.includes("secret") &&
      !error.message.includes("token=abc") &&
      !error.message.includes(String.fromCharCode(27)) &&
      !error.message.includes(nul) &&
      // host（認証情報・パス・クエリを除いた部分）だけは示す。
      /plain http to example\.com\. /.test(error.message),
  );
});

for (const url of ["ws://example.com", "ftp://example.com", "file:///etc/hosts", "blob:http://example.com/x"]) {
  test(`${url} は http でも https でもないので、allowInsecureHttp があっても止める`, () => {
    assert.throws(
      () => assertSecureBaseUrl(url, profile({ allowInsecureHttp: true })),
      /must use https:\/\//,
    );
  });
}

test("解釈できない baseURL は止める", () => {
  assert.throws(() => assertSecureBaseUrl("not a url", profile()), /not a valid URL/);
});

test("雛形の既定の baseURL と環境プロファイルは検査を通る", () => {
  const config = parse(
    readFileSync(new URL("../templates/playwright/specproof.config.yaml", import.meta.url), "utf8"),
  );
  for (const env of config.environments) {
    assert.doesNotThrow(() => assertSecureBaseUrl("http://localhost:5173", env));
  }
});

test("playwright.config.ts は認証情報を使う project があれば、ブラウザを起動する前に baseURL を検査する", () => {
  const source = readFileSync(new URL("../templates/playwright/playwright.config.ts", import.meta.url), "utf8");
    const guard = source.indexOf("assertSecureBaseUrl(resolveBaseUrl(cfg), activeEnv)");
  assert.ok(guard > 0 && guard < source.indexOf("export default defineConfig("));
});
