import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { parse } from "yaml";
import * as configHelpers from "../templates/playwright/src/config/specproof-config.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const templateConfig = () => parse(read("templates/playwright/specproof.config.yaml"));

// ライブラリへの引数を観測し、テンプレートが実際に選んだ feature・タグ・認証状態を確認する。
// dotenv は読み込まず、ライブラリ境界以外は同梱の設定処理を使う。
const buildProjects = (config) => {
  const source = stripTypeScriptTypes(read("templates/playwright/playwright.config.ts"));
  const script = source
    .replace(
      /import\s*\{([^}]+)\}\s*from\s*"([^"]+)";/g,
      (_, names, id) => `const {${names}} = imports[${JSON.stringify(id)}];`,
    )
    .replace("export default defineConfig(", "return defineConfig(");
  const imports = {
    "@playwright/test": { defineConfig: (value) => value, devices: { "Desktop Chrome": {} } },
    "playwright-bdd": { defineBddProject: (value) => value },
    "./src/config/specproof-config": {
      ...configHelpers,
      loadSpecproofConfig: () => config,
      resolveActiveEnvironment: () => config.environments[0],
    },
    "./src/config/env": {
      loadDotenv() {},
      resolveBaseUrl: () => "http://localhost:5173",
      shouldStartWebServer: () => false,
    },
  };
  return new Function("imports", script)(imports).projects;
};

test("guest の生成条件はロール付きシナリオを除外し、認証状態を持たない", () => {
  const guest = buildProjects(templateConfig()).find((project) => project.name === "guest");
  assert.equal(guest.tags, "(not @admin and not @user) and not @draft and not @human and not @out-of-scope");
  assert.deepEqual(guest.use.storageState, { cookies: [], origins: [] });
  assert.equal(guest.dependencies, undefined);
});

test("明示した guest の feature 範囲と環境除外を広げずに維持する", () => {
  const config = templateConfig();
  const selected = {
    ...config,
    projects: config.projects.map((project) =>
      project.name === "guest" ? { ...project, features: ["features/login.feature"] } : project,
    ),
    environments: [{ ...config.environments[0], excludeTags: ["@requires-real-smtp"] }],
  };
  const projects = buildProjects(selected);
  const guest = projects.find((project) => project.name === "guest");
  assert.deepEqual(guest.features, ["features/login.feature"]);
  assert.equal(
    guest.tags,
    "(not @admin and not @user) and not @draft and not @human and not @out-of-scope and not @requires-real-smtp",
  );
  assert.deepEqual(
    projects.find((project) => project.name === "authed").features,
    config.projects.find((project) => project.name === "authed").features,
  );
});

test("feature の作成・移動・実装前に登録と実ランナーの確認を行う", () => {
  for (const distribution of ["plugins/specproof/skills", ".agents/skills"]) {
    const guide = read(`${distribution}/specproof-new-feature/references/runner-registration.md`);
    assert.match(guide, /projects\[\]\.features/);
    assert.match(guide, /認証ロール/);
    assert.match(guide, /excludeTags/);
    assert.match(guide, /--list/);
    assert.match(guide, /0 件/);
    assert.match(guide, /GREEN/);
    for (const [skill, before] of [
      ["specproof-new-feature", "6. 検証:"],
      ["specproof-bootstrap", "{{config:commands.generate}}        #"],
      ["specproof-implement", "**着手前に対象を実行して RED を確認**"],
    ]) {
      const text = read(`${distribution}/${skill}/SKILL.md`);
      const registration = text.indexOf("runner-registration.md");
      assert.ok(registration >= 0 && registration < text.indexOf(before), skill);
    }
  }
});
