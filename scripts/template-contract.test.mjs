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

// start から end の手前までを切り出す。どちらかが見つからなければ失敗させ、
// 「見つからずファイル全体を検査して通る」を防ぐ。
const between = (text, start, end) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `not found: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to >= 0, `not found after ${start}: ${JSON.stringify(end)}`);
  return text.slice(from, to);
};

test("生成ガイドがドラフトの点検 5 項目を持ち、点検は提案だけにする", () => {
  // 条件の書き方の弱さ（否定だけの確認・値の無い確認など）を、人のレビュー任せにせず
  // AI が提案として挙げる。提案に留め、feature 本文を黙って書き換えない。
  const guide = read("plugins/specproof/skills/specproof-sync/prompts/system.md");
  const section = between(guide, "## ドラフトの点検", "\n---");
  // 各項目は、項目名と提案の要点が表の同じ行にあること（別の節の文言で通らないようにする）
  const row = (name) => section.split("\n").find((line) => line.startsWith(`| ${name} |`)) ?? "";
  assert.match(row("否定だけの確認"), /肯定で確かめる行/);
  assert.match(row("否定だけの確認"), /消さずに残す/);
  assert.match(row("値の無い確認"), /値を推測しない/);
  assert.match(row("統制できない前提"), /`@human`（人が確かめて記録を残す）を提案/);
  assert.match(row("確認を減らす変更"), /`@out-of-scope` に変える、`@red-contract` を外す/);
  assert.match(row("確認を減らす変更"), /停止/);
  assert.match(row("権限との矛盾"), /権限の節/);
  assert.match(row("権限との矛盾"), /どちらが正かは決めない/);
  assert.match(section, /点検の結果でドラフトを書き換えない/);
  assert.match(section, /idiomGuide.*を設定していても/);
  // bootstrap と new-feature はシナリオ単位の 4 項目を名前で列挙する。表に行を足すだけでは当たらない。
  assert.match(section, /否定だけの確認・値の無い確認・\s*統制できない前提・権限との矛盾/);
});

test("生成ガイドが feature 単位の認可の点検で欠落・未決・問題なしを区別する", () => {
  // 「無い拒否シナリオ」はシナリオを 1 件ずつ見ても見つからない。feature 全体を権限の節と照合する。
  const guide = read("plugins/specproof/skills/specproof-sync/prompts/system.md");
  const section = between(guide, "## ドラフトの点検", "\n---");
  // 点検の節の中（次の `---` より前）に置く。別の節の文言で通らないようにする。
  const authz = between(guide, "### 認可の点検（feature 単位）", "\n---");
  assert.ok(section.endsWith(authz), "認可の点検がドラフトの点検の節の末尾に無い");
  const row = (name) => authz.split("\n").find((line) => line.startsWith(`| ${name} |`)) ?? "";
  assert.match(authz, /シナリオを 1 件ずつ見るだけでは/);
  assert.match(row("矛盾"), /権限との矛盾/);
  assert.match(row("欠落"), /拒否/);
  assert.match(row("欠落"), /肯定で確かめる/);
  assert.match(row("欠落"), /「決めてほしいこと」/);
  assert.match(row("未決"), /推測で補わない/);
  assert.match(row("未決"), /「やってほしいこと」/);
  assert.match(row("問題なし"), /創作しない/);
  assert.match(row("矛盾"), /同じ指摘を重ねない/);
  assert.match(authz, /範囲の限定[\s\S]*?読み取らない/);
  assert.match(authz, /1 つに特定できるときだけ入力に含める/);
  assert.match(authz, /入力不足/);
  assert.match(authz, /否定だけの確認/);
  assert.match(authz, /rationale doc/);
  assert.match(authz, /製品側のテスト/);
  assert.match(authz, /`feature 名 \/ 区分 \/ 根拠の権限の節 \/ 提案`/);
  // 照合だけで実装の認可を確かめたと読まれないようにする。
  assert.match(row("問題なし"), /spec の権限の節と feature の照合のみ。実装の認可の検証ではない/);
  // 「創作しない」は新規の提案だけに当てる。根拠が消えた既存の拒否は未決にし、削除・緩和の規則に回す。
  assert.match(row("問題なし"), /新規の提案だけ/);
  assert.match(row("未決"), /既存の拒否シナリオの根拠が権限の節から消えた/);
  assert.match(row("未決"), /Step 3 の 5・6/);
  assert.match(authz, /実装・画面・既存 feature から権限を推測して入力にしない/);
  assert.match(authz, /new-feature と bootstrap では、feature を書く元にした spec 文書/);
  assert.match(authz, /対象の spec 文書に権限を決める記述が 1 つも無い/);
  assert.match(authz, /報告ごとに 1 回だけ/);
});

test("生成ガイドは sync での認可の点検の当て方と、当てないものを区別する", () => {
  const guide = read("plugins/specproof/skills/specproof-sync/prompts/system.md");
  const bullet = between(guide, "- 権限の節が drift したリンク:", "\n\n");
  assert.match(bullet, /権限の節が drift していないリンクには、sync は認可の点検を当てない。/);
  // spec のみ changed で権限の節に feature を合わせるのは決定表の更新。矛盾の行の「人に尋ねる」は当てない。
  assert.match(bullet, /Step 2 の決定表による更新/);
  assert.match(bullet, /「どちらに合わせるかを人に尋ねる」「提案に留める」は当てない/);
  assert.match(bullet, /権限に関わる行を変えずに停止し、manifest を更新しない/);
  // 停止は今回の drift で変わった記述に関わるものだけ。変わっていない記述の未決は報告して止めない。
  assert.match(bullet, /今回の drift で変わった記述/);
  assert.match(bullet, /変わっていない記述から出る未決は報告するが、それだけでは停止しない/);
  const others = between(guide, "sync は表のほかの項目", "\n");
  assert.match(others, /否定だけの確認・値の無い確認・統制できない前提）は当てず/);
  assert.match(others, /「否定だけの確認にも当たる」も報告しない/);
});

test("bootstrap と new-feature はドラフトの点検を報告の裁定に回し、書き換えない", () => {
  const steps = {
    "specproof-bootstrap": ["あわせて、`../specproof-sync/prompts/system.md`", "\n7. "],
    "specproof-new-feature": ["7. 作成物の一覧", "\n## "],
  };
  for (const [name, [start, end]] of Object.entries(steps)) {
    const step = between(read(`plugins/specproof/skills/${name}/SKILL.md`), start, end);
    assert.match(step, /「ドラフトの点検」/, name);
    assert.match(step, /権限との矛盾/, name);
    assert.match(step, /「認可の点検」/, name);
    assert.match(step, /feature 全体/, name);
    assert.match(step, /「決めてほしいこと」に提案として並べる/, name);
    assert.match(step, /書き換えない/, name);
    assert.match(step, /idiomGuide.*を設定していても/, name);
  }
  // 盲点の自己点検の横断認可は共通の点検に寄せ、他の盲点は残す。
  const blind = between(read("plugins/specproof/skills/specproof-bootstrap/SKILL.md"), "6. **bootstrap の盲点", "あわせて、");
  assert.match(blind, /「認可の点検」/);
  assert.match(blind, /API 契約バリデーション/);
  assert.match(blind, /別エンドポイント／別ページの操作フロー/);
  assert.match(blind, /認可以外のセキュリティ契約（セッション切れの扱いなど）/);
  assert.match(blind, /impl から権限を読み取って拒否シナリオを足さない/);
  // 「観測可能なら feature に追加し」は横断認可には当てない。
  const addRule = between(blind, "上の 3 つは", "\n");
  assert.match(addRule, /観測可能なら feature に追加し/);
  assert.ok(blind.indexOf("横断認可") > blind.indexOf("上の 3 つは"), "横断認可が追加の規則より前にある");
  const orchestrator = read("plugins/specproof/skills/specproof/SKILL.md");
  assert.match(between(orchestrator, "**決めてほしいこと", "**やってほしいこと"), /ドラフトの点検/);
  assert.match(between(orchestrator, "**決めてほしいこと", "**やってほしいこと"), /認可の点検/);
  assert.match(between(orchestrator, "**やってほしいこと", "\n5. "), /権限の節/);
});

test("sync は権限の節が drift したリンクに編集前の認可の点検を当て、報告だけにする", () => {
  const skill = read("plugins/specproof/skills/specproof-sync/SKILL.md");
  const gate = between(skill, "**認可の点検（編集前）**", "\n対象リンクごとに:");
  assert.match(gate, /`entries`/);
  assert.match(gate, /権限の節/);
  assert.match(gate, /feature 全体/);
  assert.match(gate, /矛盾・欠落・未決/);
  assert.match(gate, /報告/);
  assert.match(gate, /推測/);
  assert.match(gate, /Step 2 の決定表/);
  assert.match(gate, /編集を始める前に/);
  assert.match(gate, /編集前ゲートと同じ読み取りの段階で、全対象リンク/);
  assert.match(gate, /停止するときも点検の結果を報告に含める/);
  assert.match(gate, /「どちらに合わせるかを人に尋ねる」「提案に留める」は当てない/);
  assert.match(gate, /未決を含むリンク/);
  assert.match(gate, /権限に関わる行を変えずに停止/);
  assert.match(gate, /今回の drift で変わった記述/);
  assert.match(gate, /変わっていない記述から出る未決は報告するが、それだけでは停止しない/);
  assert.match(gate, /manifest を更新しない/);
  assert.match(gate, /「欠落（sync で追加済み）」/);
});

test("方法論が権限の節の manifest 登録と sync の起動契機を区別する", () => {
  const methodology = read("docs/methodology.md");
  const review = between(methodology, "### ドラフトの点検", "\n### drift 検知");
  assert.match(review, /認可の点検/);
  assert.match(review, /spec の権限の節と feature の照合で、実装の認可の検証ではない/);
  assert.match(review, /対象の spec 文書に権限を決める記述が 1 つも無/);
  assert.match(review, /決定表による更新/);
  assert.match(between(methodology, "### rationale doc は自動生成しない", "\n### "), /画面から観測できない部分の横断認可/);
  const section = between(methodology, "### 権限の節を各リンクに登録する", "\n### ");
  assert.match(section, /登録済みの見出しと同じレベルの見出しだけ/);
  assert.match(section, /`links\[\]\.spec\[\]`/);
  assert.match(section, /`criteria`/);
  assert.match(section, /登録しただけでは sync は起動しない/);
  assert.match(section, /`strictUnregisteredSpecHeadings: true`/);
  assert.match(section, /他のリンクへの登録漏れは検出できない/);
  assert.match(section, /レビューの承認や動作の確認の証拠ではない/);
});

test("sync は spec の明示が無い確認を減らす変更を行わず停止する", () => {
  const skill = read("plugins/specproof/skills/specproof-sync/SKILL.md");
  const rule = between(between(skill, "### 3. Feature / steps の更新", "### 4. "), "6. **確認を減らす変更", "\n\n");
  assert.match(rule, /spec が明示していない限り行わない/);
  assert.match(rule, /feature \/ manifest を変更せずに停止/);
  assert.match(rule, /`@out-of-scope` に変える/);
  assert.match(between(skill, "| spec のみ changed", "\n"), /Step 3 の 6/);
  const methodology = read("docs/methodology.md");
  assert.match(between(methodology, "| spec のみ changed", "\n"), /確認を減らす更新は spec の明示が要る/);
  assert.match(between(methodology, "### 既存シナリオを削除しない原則", "\n### "), /確認を減らす変更/);
});

// drift-check のコメント投稿スクリプトを、GitHub API を模したオブジェクトで実際に実行する。
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const runCommentScript = async (
  adapter,
  { headSha, currentHeadSha, checkedSha = headSha, headAfterPagination, report, comments = [] },
) => {
  const workflow = parse(read(`templates/${adapter}/github-workflows/specproof-drift-check.yml`));
  const step = workflow.jobs["drift-check"].steps.find((s) => s.name === "Comment on PR");
  const calls = [];
  const github = {
    paginate: async () => {
      if (headAfterPagination !== undefined) currentHeadSha = headAfterPagination;
      return comments;
    },
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
    sha: checkedSha,
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

for (const adapter of ["playwright", "flutter"]) {
  test(`${adapter}: コメント探索中に head が進んだら作成も更新もしない`, async () => {
    for (const [report, comments] of [[DRIFT, []], [DRIFT, [BOT_COMMENT]], [CLEAN, [BOT_COMMENT]]]) {
      const calls = await runCommentScript(adapter, {
        headSha: "a".repeat(40),
        currentHeadSha: "a".repeat(40),
        headAfterPagination: "b".repeat(40),
        report,
        comments,
      });
      assert.deepEqual(calls, []);
    }
  });

  test(`${adapter}: 実際に検査した merge commit と PR head を区別する`, async () => {
    for (const [report, comments] of [[DRIFT, []], [DRIFT, [BOT_COMMENT]], [CLEAN, [BOT_COMMENT]]]) {
      const calls = await runCommentScript(adapter, {
        headSha: "a".repeat(40),
        currentHeadSha: "a".repeat(40),
        checkedSha: "c".repeat(40),
        report,
        comments,
      });
      assert.equal(calls.length, 1);
      assert.match(calls[0][1].body, /Checked commit `ccccccc` \(PR head `aaaaaaa`\)/);
      assert.doesNotMatch(calls[0][1].body, /Checked commit `aaaaaaa`/);
    }
  });
}
