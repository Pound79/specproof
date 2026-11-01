import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { test } from "vitest";
import { selectWarningsForDisplay } from "../cli-check-format.js";
import { collectUnknownConfigKeys, MAX_UNKNOWN_CONFIG_KEYS } from "../config-keys.js";

const dist = fileURLToPath(new URL("../../dist/cli-check.js", import.meta.url));
// src/__tests__ -> リポジトリのルートは 4 つ上。
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

// 綴りを誤ったキーは、どの consumer にも読まれず既定値に落ちる。黙って無視せず知らせる。
test("どの consumer も読まないトップレベルと layout のキーを列挙する", () => {
  assert.deepEqual(
    collectUnknownConfigKeys({
      adapter: "playwright",
      strictUnregisteredImp: true,
      layout: { manifest: "traceability.yaml", featureDir: "features" },
    }),
    ["strictUnregisteredImp", "layout.featureDir"],
  );
});

test("キーが固定の入れ子（commands・projects[]・environments[]・auth など）も検査する", () => {
  assert.deepEqual(
    collectUnknownConfigKeys({
      commands: { generate: "x", smokeTest: "y" },
      projects: [
        { name: "a", tags: "@a", credentialsEnv: { username: "U", pass: "P" } },
        "not a mapping",
        { name: "b", tag: "@b" },
      ],
      environments: [{ name: "local", auth: { provider: "mock", kind: "x" }, exclude: [] }],
      runner: { device: "Desktop Chrome", headless: true },
      flutter: { device: "macos", devices: [] },
      agents: { codeReviewer: "c", reviewer: "r" },
      git: { commitScope: "bdd", scope: "x" },
      conventions: { agentsDoc: "AGENTS.md", doc: "x" },
      examples: { domainName: "d", name: "x" },
      implement: { blastRadiusGlobs: [], globs: [] },
    }),
    [
      "commands.smokeTest",
      "projects[0].credentialsEnv.pass",
      "projects[2].tag",
      "environments[0].auth.kind",
      "environments[0].exclude",
      "runner.headless",
      "flutter.devices",
      "agents.reviewer",
      "git.scope",
      "conventions.doc",
      "examples.name",
      "implement.globs",
    ],
  );
});

test("名前を利用者が決める mapping（fixtures・tags・env・envOverrides）は検査しない", () => {
  assert.deepEqual(
    collectUnknownConfigKeys({
      fixtures: { anyPage: "src/pages/AnyPage.ts" },
      tags: { slow: "@slow", sf: "@sf" },
      env: { baseUrl: "E2E_BASE_URL", reviewerUsername: "E2E_REVIEWER" },
      environments: [{ name: "local", envOverrides: { ANY_NAME: "1" } }],
    }),
    [],
  );
});

test("mapping でない節の中は見ない（型の検査は読む側の責務）", () => {
  assert.deepEqual(collectUnknownConfigKeys({ layout: null, commands: "x", projects: {} }), []);
});

test("識別子でないキーは引用して示す", () => {
  assert.deepEqual(collectUnknownConfigKeys({ "a b": 1, layout: { "x.y": 1 } }), [
    '["a b"]',
    'layout["x.y"]',
  ]);
});

// テンプレートに無い既知のキーも含め、docs/config-schema.md の「未知のキー」の表にある全キーを
// 書いた設定。一覧から既知のキーを消すと、それを使う利用者の --strict が落ちるので検出する。
const EVERY_KNOWN_KEY = {
  adapter: "playwright",
  bddRunner: "playwright-bdd",
  bddGenTool: "bddgen",
  language: "en",
  strictUnregisteredImpl: false,
  strictUnregisteredSpecHeadings: false,
  strictFeatureLint: false,
  commands: Object.fromEntries(
    [
      "generate",
      "typecheck",
      "lint",
      "productTypecheck",
      "productLint",
      "smoke",
      "install",
      "traceabilityUpdate",
      "traceabilityCheck",
      "traceabilityList",
      "traceabilityStats",
    ].map((key) => [key, "x"]),
  ),
  layout: Object.fromEntries(
    [
      "e2eRoot",
      "featuresDir",
      "stepsDir",
      "stepFileSuffix",
      "stepFileExt",
      "pagesDir",
      "candidateSuffix",
      "textConstants",
      "i18nSource",
      "manifest",
      "specDir",
      "implGlobs",
      "scratchDir",
      "testRunnerConfig",
      "idiomGuide",
      "e2eReadme",
    ].map((key) => [key, "x"]),
  ),
  fixtures: {},
  tags: {},
  projects: [
    {
      name: "a",
      tags: "@a",
      features: [],
      storageState: "",
      setup: false,
      conditional: "env.x",
      credentialsEnv: { username: "U", password: "P", newPassword: "N" },
    },
  ],
  env: {},
  environments: [
    {
      name: "local",
      default: true,
      dotenvFile: ".env",
      auth: { provider: "mock", description: "d" },
      excludeTags: [],
      envOverrides: {},
    },
  ],
  implement: { blastRadiusGlobs: [] },
  git: { commitScope: "s", branchPrefix: "p" },
  agents: { codeReviewer: "c", securityReviewer: "s" },
  conventions: {
    agentsDoc: "a",
    i18nLintPlugin: "i",
    stepFrameworkPattern: "s",
    pendingStubBody: "p",
  },
  examples: { domainName: "d", specDoc: "s", internalConstants: [] },
  runner: { device: "d", webServerCommand: "w", globalTeardown: "g", i18nLocaleStorageKey: "k" },
  flutter: {
    gherkinParser: "g",
    testEntry: "t",
    device: "d",
    buildRunnerPin: "b",
    buildYamlSources: [],
    traceabilityHashSource: "feature",
  },
};

test("文書にある既知のキーをすべて書いても警告しない", () => {
  assert.deepEqual(collectUnknownConfigKeys(EVERY_KNOWN_KEY), []);
});

// 設定は PR の作者が書ける。YAML の alias で同じ mapping を何度も参照させると、経路の数が
// 掛け算で増えてメモリとログを埋められる。上限を超えたら走査を止め、超えたことを返す。
test("未知のキーは上限の数まで集め、超えたら走査を止める", () => {
  const many = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, 1]));
  const keys = collectUnknownConfigKeys({
    projects: Array.from({ length: 98 }, () => many),
  });
  assert.equal(keys.length, MAX_UNKNOWN_CONFIG_KEYS + 1);
  assert.equal(keys[0], "projects[0].k0");
});

test("check は上限を超えた未知のキーを 1 件の警告にまとめる", () => {
  const config = `layout:\n  manifest: traceability.yaml\n  featuresDir: .\n${Array.from(
    { length: MAX_UNKNOWN_CONFIG_KEYS + 5 },
    (_, i) => `k${i}: 1\n`,
  ).join("")}`;
  const json = run(config, ["--json"]);
  const warnings = (
    JSON.parse(json.stdout) as { warnings: { kind: string; message: string }[] }
  ).warnings.filter((w) => w.kind === "unknown-config-key");
  assert.equal(warnings.length, MAX_UNKNOWN_CONFIG_KEYS + 1);
  assert.match(warnings.at(-1)?.message ?? "", /more than 100 unknown keys/);
});

test("テキストと annotation に出す unknown-config-key は 20 件まで", () => {
  const warnings = Array.from({ length: 25 }, (_, index) => ({
    kind: "unknown-config-key" as const,
    path: "specproof.config.yaml",
    message: `k${index}`,
  }));
  const { shown, hiddenCount } = selectWarningsForDisplay(warnings);
  assert.equal(shown.length, 20);
  assert.equal(hiddenCount, 5);
});

for (const template of ["playwright", "flutter"]) {
  test(`${template} テンプレートの設定はすべて既知のキーで書かれている`, () => {
    const text = readFileSync(
      path.join(repoRoot, "templates", template, "specproof.config.yaml"),
      "utf8",
    );
    assert.deepEqual(collectUnknownConfigKeys(parse(text)), []);
  });
}

const run = (config: string, args: string[]) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-unknown-key-"));
  try {
    writeFileSync(path.join(root, "specproof.config.yaml"), config);
    writeFileSync(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
    const result = spawnSync(process.execPath, [dist, "--root", root, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const CONFIG = [
  "layout:",
  "  manifest: traceability.yaml",
  "  featuresDir: .",
  "  implGlob:",
  '    - "src/**"',
  "strictFeatureLin: true",
  "",
].join("\n");

test("check は未知のキーを unknown-config-key として出し、--strict で失敗する", () => {
  const json = run(CONFIG, ["--json"]);
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout) as {
    warnings: { kind: string; path?: string; failsUnderStrict: boolean; message: string }[];
  };
  const warnings = report.warnings.filter((w) => w.kind === "unknown-config-key");
  assert.equal(warnings.length, 2, json.stdout);
  for (const warning of warnings) {
    assert.equal(warning.path, "specproof.config.yaml");
    assert.equal(warning.failsUnderStrict, true);
  }
  assert.match(warnings[0].message, /layout\.implGlob\b/);
  assert.match(warnings[1].message, /strictFeatureLin\b/);
  // 値は出さない（キーだけを示す）。
  assert.doesNotMatch(warnings[0].message, /src\/\*\*/);

  const strict = run(CONFIG, ["--strict"]);
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /\[warning\] .*layout\.implGlob/);
});

test("既知のキーだけなら unknown-config-key を出さない", () => {
  const json = run("layout:\n  manifest: traceability.yaml\n  featuresDir: .\n", ["--json"]);
  const kinds = (JSON.parse(json.stdout) as { warnings: { kind: string }[] }).warnings.map(
    (w) => w.kind,
  );
  assert.ok(!kinds.includes("unknown-config-key"), json.stdout);
});
