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
      if (
        [
          "agents.codeReviewer",
          "agents.securityReviewer",
          "implement.blastRadiusGlobs",
          "commands.productLint",
          "commands.productTypecheck",
        ].includes(key)
      )
        return false;
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

test("implement スキルは E2E 側と製品側の検証を取り違えない", () => {
  // テンプレートの commands.lint / typecheck は E2E パッケージを検査する。製品コードを変更する
  // スキルがそれを製品側の検証と報告すると、製品側の lint / 型検査を確認せずに済ませてしまう。
  const skill = read("plugins/specproof/skills/specproof-implement/SKILL.md");
  for (const adapter of ["playwright", "flutter"]) {
    const config = parse(read(`templates/${adapter}/specproof.config.yaml`));
    const e2eRoot = config.layout.e2eRoot;
    for (const key of ["lint", "typecheck"]) {
      assert.ok(config.commands[key].includes(`cd ${e2eRoot}`), `${adapter}: commands.${key}`);
    }
  }
  assert.doesNotMatch(skill, /commands\.lint\}\}\s*#\s*製品/);
  assert.match(skill, /\{\{config:commands\.productLint\}\}/);
  assert.match(skill, /\{\{config:commands\.productTypecheck\}\}/);
  assert.match(skill, /未設定なら[^\n]*未検証/);
  const schema = read("docs/config-schema.md");
  assert.match(schema, /`productLint`/);
  assert.match(schema, /`productTypecheck`/);
});

test("オーケストレータの報告も E2E 側と製品側の検証を分ける", () => {
  // implement の結果を中継する上の層で、E2E の lint を製品側の検証として報告させない。
  const skill = read("plugins/specproof/skills/specproof/SKILL.md");
  const handoff = skill.slice(skill.indexOf("**到達した検証**"), skill.indexOf("**決めてほしいこと"));
  assert.match(handoff, /E2E lint（`\{\{config:commands\.lint\}\}`）/);
  assert.match(handoff, /\{\{config:commands\.productLint\}\}/);
  assert.match(handoff, /\{\{config:commands\.productTypecheck\}\}/);
  assert.match(handoff, /未設定なら[^\n]*未検証/);
});

// drift-check のコメント投稿スクリプトを、GitHub API を模したオブジェクトで実際に実行する。
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const runCommentScript = async (adapter, { headSha, currentHeadSha, report, comments = [] }) => {
  const workflow = parse(read(`templates/${adapter}/github-workflows/specproof-drift-check.yml`));
  const step = workflow.jobs["drift-check"].steps.find((s) => s.name === "Comment on PR");
  const calls = [];
  const github = {
    paginate: async () => comments,
    rest: {
      issues: {
        listComments: {},
        createComment: async (args) => calls.push(["create", args]),
        updateComment: async (args) => calls.push(["update", args]),
      },
      pulls: { get: async () => ({ data: { head: { sha: currentHeadSha } } }) },
    },
  };
  const context = {
    repo: { owner: "o", repo: "r" },
    payload: { pull_request: { number: 7, head: { sha: headSha } } },
  };
  const core = { warning() {}, notice() {}, info() {} };
  const require = (name) => {
    assert.equal(name, "fs");
    return { readFileSync: () => JSON.stringify(report) };
  };
  await new AsyncFunction("require", "core", "github", "context", step.with.script)(
    require,
    core,
    github,
    context,
  );
  return calls;
};

const DRIFT = {
  clean: false,
  driftCount: 1,
  driftLinkCount: 1,
  entries: [{ linkId: "a", side: "spec", path: "docs/a.md", status: "changed" }],
  warnings: [],
  bothSidesChanged: [],
};
const CLEAN = { clean: true, driftCount: 0, driftLinkCount: 0, entries: [], warnings: [], bothSidesChanged: [] };
const BOT_COMMENT = {
  id: 1,
  user: { type: "Bot", login: "github-actions[bot]" },
  body: "<!-- specproof-drift-check -->\nold",
};

for (const adapter of ["playwright", "flutter"]) {
  test(`${adapter}: drift-check は同じ PR の古い実行を取り消す`, () => {
    const workflow = parse(read(`templates/${adapter}/github-workflows/specproof-drift-check.yml`));
    assert.match(String(workflow.concurrency?.group), /github\.event\.pull_request\.number/);
    assert.equal(workflow.concurrency?.["cancel-in-progress"], true);
  });

  test(`${adapter}: head が進んだ古い実行はコメントを書かない`, async () => {
    for (const report of [DRIFT, CLEAN]) {
      const calls = await runCommentScript(adapter, {
        headSha: "a".repeat(40),
        currentHeadSha: "b".repeat(40),
        report,
        comments: [BOT_COMMENT],
      });
      assert.deepEqual(calls, []);
    }
  });

  test(`${adapter}: 最新の実行は検査したコミットを本文に示す`, async () => {
    const sha = "c".repeat(40);
    const created = await runCommentScript(adapter, { headSha: sha, currentHeadSha: sha, report: DRIFT });
    assert.equal(created.length, 1);
    assert.equal(created[0][0], "create");
    assert.match(created[0][1].body, new RegExp(sha.slice(0, 7)));
    const updated = await runCommentScript(adapter, {
      headSha: sha,
      currentHeadSha: sha,
      report: CLEAN,
      comments: [BOT_COMMENT],
    });
    assert.equal(updated[0][0], "update");
    assert.match(updated[0][1].body, new RegExp(sha.slice(0, 7)));
  });

  test(`${adapter}: 検査したコミットは report 由来の文字列より前に示す`, async () => {
    // report の文字列が閉じない HTML コメントなどで後続を隠しても、出所の行は残す。
    const sha = "d".repeat(40);
    const [[, { body }]] = await runCommentScript(adapter, { headSha: sha, currentHeadSha: sha, report: DRIFT });
    const checkedAt = body.indexOf(`Checked commit \`${sha.slice(0, 7)}\``);
    assert.ok(checkedAt !== -1 && checkedAt < body.indexOf("docs/a.md"), body);
  });
}
