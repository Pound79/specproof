import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const files = execFileSync("git", ["ls-files", "plugins/specproof/skills"], { encoding: "utf8" }).trim().split("\n").filter((file) => file.endsWith(".md"));
const keys = [...new Set(files.flatMap((file) => [...read(file).matchAll(/\{\{config:([A-Za-z]\w*(?:\.[A-Za-z]\w*)*)\}\}/g)].map((match) => match[1])))];

for (const adapter of ["playwright", "flutter"]) {
  test(`${adapter}: skill の参照キーがテンプレートまたは明示済み fallback で解決する`, () => {
    const config = parse(read(`templates/${adapter}/specproof.config.yaml`));
    const missing = keys.filter((key) => {
      if (adapter !== "flutter" && key.startsWith("flutter.")) return false;
      if (["agents.codeReviewer", "agents.securityReviewer", "implement.blastRadiusGlobs"].includes(key)) return false;
      const object = key.startsWith("auth.") ? { auth: config.environments[0].auth } : config;
      return key.split(".").reduce((value, part) => value?.[part], object) === undefined;
    });
    assert.deepEqual(missing, [], `Missing keys for ${adapter}`);
    assert.ok(config.projects.length > 0);
    assert.ok(config.env.baseUrl);
    assert.equal(config.strictUnregisteredImpl, false);
    assert.equal(config.strictUnregisteredSpecHeadings, false);
    assert.equal(config.conventions.i18nLintPlugin, "none");
    assert.match(config.conventions.pendingStubBody, /throw /);
    assert.equal(config.runner?.authDir, undefined);
  });
}

test("Claude と Codex の skill 配布物が同期している", () => {
  for (const file of files) assert.equal(read(file.replace("plugins/specproof/skills/", ".agents/skills/")), read(file), file);
});

test("Flutter の宣言キーは setup skill が実ファイルと照合する", () => {
  const config = parse(read("templates/flutter/specproof.config.yaml"));
  const setup = read("plugins/specproof/skills/specproof-setup/SKILL.md");
  for (const key of Object.keys(config.flutter)) assert.ok(setup.includes(`{{config:flutter.${key}}}`), key);
});

for (const adapter of ["playwright", "flutter"]) {
  test(`${adapter}: sticky comment は偽マーカーを無視し最新の Actions bot だけ選ぶ`, () => {
    const workflow = read(`templates/${adapter}/github-workflows/specproof-drift-check.yml`);
    const declaration = workflow.match(/const existing = comments[\s\S]*?;/)?.[0];
    assert.ok(declaration);
    const marker = "<!-- specproof-drift-check -->";
    const bot = { type: "Bot", login: "github-actions[bot]" };
    const human = { type: "User", login: "example" };
    const comments = [
      { id: 100, user: human, body: marker },
      { id: 99, user: { type: "Bot", login: "other[bot]" }, body: marker },
      { id: 10, user: bot, body: marker + "\nold" },
      { id: 12, user: bot, body: marker + "\nnew" },
      { id: 30, user: bot, body: "quoted " + marker },
    ];
    const select = new Function("comments", "marker", declaration + "\nreturn existing;");
    assert.equal(select(comments, marker).id, 12);
    assert.equal(select([comments[0], comments[1], comments[4]], marker), undefined);
  });
}

test("警告の JSON 仕様に未実装の heading フィールドを載せない", () => {
  const doc = read("docs/methodology.md");
  const warningExample = doc.slice(doc.indexOf('"warnings": ['), doc.indexOf('"bothSidesChanged":'));
  assert.doesNotMatch(warningExample, /"heading"\s*:/);
});

test("編集範囲の省略には対象ドメインに限定する明示済み fallback がある", () => {
  const skill = read("plugins/specproof/skills/specproof-implement/SKILL.md");
  assert.match(skill, /implement\.blastRadiusGlobs` が未設定なら/);
  assert.ok(skill.includes("対象ドメインに対応する"));
});

test("Flutter の smoke は projects のタグ条件を runner へ実際に渡す", () => {
  // 宣言だけでは flutter test の実行対象は変わらない。smoke の --dart-define が suite の入口で
  // FlutterTestConfiguration.tagExpression に渡り、runner が実行時に絞り込む。
  const config = parse(read("templates/flutter/specproof.config.yaml"));
  const suite = read("templates/flutter/integration_test/gherkin_suite_test.dart");
  const declared = config.projects[0].tags;
  assert.ok(declared.includes(config.tags.slow), "projects のタグ条件が @slow を除外していない");
  const define = config.commands.smoke.match(/--dart-define=SPECPROOF_TAGS=("[^"]*"|'[^']*'|\S+)/);
  assert.ok(define, "smoke が SPECPROOF_TAGS を渡していない");
  assert.equal(define[1].replace(/^["']|["']$/g, ""), declared);
  assert.match(suite, /String\.fromEnvironment\('SPECPROOF_TAGS'\)/);
  assert.match(suite, /tagExpression:/);
});
