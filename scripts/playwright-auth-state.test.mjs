import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import * as configHelpers from "../templates/playwright/src/config/specproof-config.ts";

// storageState はログイン後のセッション（Cookie・localStorage）を持つ機密データ。
// 実行した場所に関係なく gitignore された e2e パッケージの playwright/.auth に置き、実行後に消す。
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const templateConfig = () => parse(read("templates/playwright/specproof.config.yaml"));
const PACKAGE_ROOT = "/pkg-root";
const envModule = {
  loadDotenv() {},
  resolveBaseUrl: () => "http://localhost:5173",
  shouldStartWebServer: () => false,
  resolveAuthStatePath: (file) => path.join(PACKAGE_ROOT, file),
};

// TypeScript の雛形を、import を差し替えた関数として実行する。
const run = (file, imports, transform = (source) => source) => {
  const source = transform(stripTypeScriptTypes(read(file)))
    .replace(
      /import\s*(?:\{([^}]+)\}|(\w+))\s*from\s*"([^"]+)";/g,
      (_, names, single, id) =>
        names
          ? `const {${names.replace(/\bas\b/g, ":")}} = imports[${JSON.stringify(id)}];`
          : `const ${single} = imports[${JSON.stringify(id)}];`,
    );
  return new Function("imports", source)(imports);
};

const buildConfig = (config) =>
  run(
    "templates/playwright/playwright.config.ts",
    {
      "@playwright/test": { defineConfig: (value) => value, devices: { "Desktop Chrome": {} } },
      "playwright-bdd": { defineBddProject: (value) => value },
      "./src/config/specproof-config": {
        ...configHelpers,
        loadSpecproofConfig: () => config,
        resolveActiveEnvironment: () => config.environments[0],
      },
      "./src/config/env": envModule,
    },
    (source) => source.replace("export default defineConfig(", "return defineConfig("),
  );

test("storageState は実行した場所でなく e2e パッケージを基準に読む", () => {
  const config = templateConfig();
  const { projects } = buildConfig(config);
  for (const declared of config.projects.filter((p) => p.storageState)) {
    const project = projects.find((p) => p.name === declared.name);
    if (!project) continue; // 条件を満たさない project は作られない
    assert.equal(project.use.storageState, path.join(PACKAGE_ROOT, declared.storageState));
  }
});

test("storageState を書く側も e2e パッケージを基準にする", () => {
  const source = read("templates/playwright/src/setup/saveAuthState.ts");
  assert.doesNotMatch(source, /process\.cwd\(\)/);
  assert.match(source, /resolveAuthStatePath\(authFile\)/);
});

test("setup の project は実行後に storageState を消す teardown を持つ", () => {
  const { projects } = buildConfig(templateConfig());
  const setup = projects.find((p) => p.name === "setup");
  assert.ok(setup, "the template config has an authenticated project");
  const teardown = projects.find((p) => p.name === setup.teardown);
  assert.ok(teardown, "setup.teardown must name a project");
  assert.equal(teardown.testDir, "src/setup");
  assert.ok(teardown.testMatch.test("auth.teardown.ts"));
  assert.ok(!setup.testMatch.test("auth.teardown.ts"));
});

test("teardown は setup が書いた storageState を消し、無くても失敗しない", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "specproof-auth-teardown-"));
  try {
    const config = templateConfig();
    const files = config.projects.filter((p) => p.setup && p.storageState).map((p) => p.storageState);
    assert.ok(files.length > 0);
    mkdirSync(path.join(dir, "playwright/.auth"), { recursive: true });
    writeFileSync(path.join(dir, files[0]), "{}");
    const registered = [];
    run("templates/playwright/src/setup/auth.teardown.ts", {
      "@playwright/test": { test: (name, fn) => registered.push(fn) },
      "../config/specproof-config": { loadSpecproofConfig: () => config },
      "../config/env": { resolveAuthStatePath: (file) => path.join(dir, file) },
      "node:fs": { rmSync },
    });
    assert.equal(registered.length, 1);
    await registered[0]();
    for (const file of files) assert.equal(existsSync(path.join(dir, file)), false, file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("storageState のパスは e2e パッケージの内側に限る（誤設定で外を書き換え・削除しない）", async () => {
  const { resolveAuthStatePath } = await import("../templates/playwright/src/config/auth-state.ts");
  const root = path.join(os.tmpdir(), "pkg");
  assert.equal(resolveAuthStatePath("playwright/.auth/user.json", root), path.join(root, "playwright/.auth/user.json"));
  for (const bad of ["../.env", "../../x.json", "/etc/passwd", ".", ""]) {
    assert.throws(() => resolveAuthStatePath(bad, root), /inside the e2e package/, bad);
  }
});
