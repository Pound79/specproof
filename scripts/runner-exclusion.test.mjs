import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 実行しない条件（草案・人が確認・受け入れ対象外）を、どのテンプレートの runner も実行しない。
// @red-contract は実装待ちとして実行し、落ちるのを観測し続けるので、除外に入れない。
// テストを一時的に止める手段は持たない。
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const NEVER_RUN = ["@draft", "@human", "@out-of-scope"];

test("Playwright テンプレートは草案・人の確認・対象外を常に実行しない", () => {
  const config = read("templates/playwright/playwright.config.ts");
  const declared = config.match(/const NEVER_RUN_TAGS = \[([^\]]*)\]/)?.[1] ?? "";
  for (const tag of NEVER_RUN) assert.ok(declared.includes(`"${tag}"`), tag);
  assert.ok(!declared.includes("@red-contract"));
  // 環境の excludeTags の有無にかかわらず、常に除外を組み立てる。
  assert.match(config, /\[\.\.\.NEVER_RUN_TAGS, \.\.\.\(env\.excludeTags \?\? \[\]\)\]/);
});

test("Flutter テンプレートは草案・人の確認・対象外を常に実行しない", () => {
  const suite = read("templates/flutter/integration_test/gherkin_suite_test.dart");
  const declared = suite.match(/const _neverRun = '([^']*)'/)?.[1] ?? "";
  assert.equal(declared, NEVER_RUN.map((tag) => `not ${tag}`).join(" and "));
  assert.match(suite, /_tagExpression\.isEmpty \? _neverRun : '\(\$_tagExpression\) and \$_neverRun'/);
});

test("テンプレートの設定は実行を止めるタグの設定（tags.fixme / tags.skip）を持たない", () => {
  for (const adapter of ["playwright", "flutter"]) {
    const config = read(`templates/${adapter}/specproof.config.yaml`);
    assert.doesNotMatch(config, /^\s*(fixme|skip):/m, adapter);
  }
});

// excludeTags は環境ごとの除外のための単一タグ。状態タグを書くと実装待ちを黙らせたり、
// 草案や人の確認を実行させたりできるので、設定の読み込みで拒否する。
const configModule = new URL("../templates/playwright/src/config/specproof-config.ts", import.meta.url).pathname;
const resolveWith = (excludeTags) => {
  const script = `
    const m = await import(${JSON.stringify(configModule)});
    m.resolveActiveEnvironment({ environments: [{ name: "local", default: true, excludeTags: ${JSON.stringify(excludeTags)} }] });
  `;
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, SPECPROOF_ENV: "" },
  });
};

test("excludeTags に状態タグや式を書くと設定の読み込みで失敗する", () => {
  for (const tag of ["@red-contract", "@draft", "@human", "@out-of-scope", "@x or @draft", "@a)", "google-auth"]) {
    const result = resolveWith([tag]);
    assert.notEqual(result.status, 0, tag);
    assert.match(result.stderr, /excludeTags/, tag);
  }
  const ok = resolveWith(["@google-auth"]);
  assert.equal(ok.status, 0, ok.stderr);
});

test("Flutter テンプレートは不正な SPECPROOF_TAGS で例外を投げる", () => {
  const suite = read("templates/flutter/integration_test/gherkin_suite_test.dart");
  assert.match(suite, /_stateTags\.any\(_tagExpression\.contains\) \|\| !_balanced\(_tagExpression\)/);
  assert.match(suite, /throw StateError/);
});

// projects[].tags もタグ式として連結されるので、状態タグを含む式や括弧の釣り合わない式を拒否する。
const resolveWithProjectTags = (tags) => {
  const script = `
    const m = await import(${JSON.stringify(configModule)});
    m.resolveActiveEnvironment({
      projects: [{ name: "p", tags: ${JSON.stringify(tags)}, features: [], storageState: "", setup: false }],
      environments: [{ name: "local", default: true }],
    });
  `;
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, SPECPROOF_ENV: "" },
  });
};

test("projects[].tags に状態タグや釣り合わない括弧があると設定の読み込みで失敗する", () => {
  for (const tags of ["not @red-contract", "@draft", "@x and not @human", "@x) or (@draft", "(@x"]) {
    const result = resolveWithProjectTags(tags);
    assert.notEqual(result.status, 0, tags);
    assert.match(result.stderr, /projects/, tags);
  }
  for (const tags of ["", "@admin", "not @slow", "(@admin or @user) and not @slow"]) {
    const ok = resolveWithProjectTags(tags);
    assert.equal(ok.status, 0, `${tags}: ${ok.stderr}`);
  }
});

test("Flutter テンプレートは状態タグや釣り合わない括弧を含む SPECPROOF_TAGS を拒否する", () => {
  const suite = read("templates/flutter/integration_test/gherkin_suite_test.dart");
  const declared = suite.match(/const _stateTags = \[([^\]]*)\]/)?.[1] ?? "";
  for (const tag of ["@draft", "@red-contract", "@human", "@out-of-scope"]) {
    assert.ok(declared.includes(`'${tag}'`), tag);
  }
  assert.match(suite, /_balanced\(_tagExpression\)/);
});
