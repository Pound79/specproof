import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
