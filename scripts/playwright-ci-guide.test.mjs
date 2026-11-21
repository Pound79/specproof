import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("Playwright の CI の手引きは、trace を成果物に上げない方針を変えずに別のバックエンドの扱いを示す", () => {
  // 雛形の README は trace・スクリーンショット・動画・保存したセッションを CI の成果物に上げないとしている。
  const guide = read("docs/playwright-ci.md");
  assert.match(guide, /CI の成果物に上げない/);
  // 成果物に上げるのは、条件付きの例外の節の中だけ。
  const exceptionFrom = guide.indexOf("### 例外: 落ちた run の trace を短く残す");
  assert.ok(exceptionFrom >= 0, "trace の例外の節が無い");
  const exceptionTo = guide.indexOf("\n## ", exceptionFrom);
  const exception = guide.slice(exceptionFrom, exceptionTo < 0 ? undefined : exceptionTo);
  assert.equal(guide.split("upload-artifact").length - 1, exception.split("upload-artifact").length - 1);
  for (const dir of ["test-results/", "playwright-report/", "playwright/.auth/"]) {
    assert.ok(guide.includes(dir), dir);
  }
  // 非公開リポジトリは専用 App のトークンで読み、URL に埋めず、.git/config に残さない。
  for (const text of ["create-github-app-token", "permission-contents: read", "persist-credentials: false", "environment:"]) {
    assert.ok(guide.includes(text), text);
  }
  assert.match(guide, /トークンを URL に埋めない/);
  // PR から秘密と一緒に動かさない。
  assert.match(guide, /`pull_request`・`pull_request_target`・`workflow_run` では起動しない/);
  // 比べた SHA を checkout し、印は cache に残す。成果物の名前は偽造できるので使わない。
  assert.match(guide, /ref: \$\{\{ steps\.sha\.outputs\.backend \}\}/);
  assert.match(guide, /actions\/cache\/save/);
  assert.match(guide, /成果物の名前を印にしない/);
  // bash の UID は読み取り専用なので別の名前で渡す。
  assert.match(guide, /HOST_UID/);
  assert.doesNotMatch(guide, /\$\{UID\}/);
  assert.match(guide, /::add-mask::/);
  assert.match(read("templates/playwright/README.md"), /docs\/playwright-ci\.md/);
});

const sectionOf = (text, heading) => {
  const from = text.indexOf(heading);
  assert.ok(from >= 0, `${heading} が無い`);
  const level = heading.match(/^#+/)[0];
  const next = text.slice(from + heading.length).search(new RegExp(`\\n#{1,${level.length}} `));
  return next < 0 ? text.slice(from) : text.slice(from, from + heading.length + next);
};
// 箇条書きの 1 項（先頭が "- " の行から、同じ深さの次の項まで）。
const bulletOf = (text, start) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `${start} が無い`);
  const indent = text.slice(text.lastIndexOf("\n", from) + 1, from).replace(/- (\*\*)?$/, "");
  const rest = text.slice(from).split("\n");
  const end = rest.findIndex((line, i) => i > 0 && (line.startsWith(`${indent}- `) || !line.startsWith(indent) || line === ""));
  return rest.slice(0, end < 0 ? undefined : end).join("\n");
};
// 太字の見出しで始まる段落（次の空行まで）。
const paragraphOf = (text, start) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `${start} が無い`);
  const end = text.indexOf("\n\n", from);
  return text.slice(from, end < 0 ? undefined : end);
};

test("CI の手引きは、trace を上げる例外を条件付きで書き、既定は上げないままにする", () => {
  const guide = read("docs/playwright-ci.md");
  const exception = sectionOf(guide, "### 例外: 落ちた run の trace を短く残す");
  assert.match(exception, /すべて守れるときだけ/);
  assert.match(exception, /確かめられないなら、例外を使わない/);
  // やってはいけないことを、例の YAML の直前にチェックリストで並べる（間に別の段落を挟まない）。
  const yamlAt = exception.indexOf("```yaml");
  const listAt = exception.indexOf("上げる前の確認");
  assert.ok(listAt >= 0 && listAt < yamlAt, "上げる前の確認が YAML の前に無い");
  const checklist = exception.slice(listAt, yamlAt).trimEnd();
  assert.doesNotMatch(checklist.split("\n").slice(1).join("\n"), /\n\n(?!- \[ \]|```)/, "チェックリストと YAML の間に別の段落がある");
  const items = checklist.split("\n- [ ] ").slice(1);
  assert.ok(items.length >= 7, `チェックリストの項目が少ない: ${items.length}`);
  const item = (pattern) => {
    const found = items.find((text) => pattern.test(text));
    assert.ok(found, `チェックリストに ${pattern} が無い`);
    return found;
  };
  // 認証情報が実行の外で使えない・鍵をテストのプロセスに渡さない・合成データで DB を捨てる・公開では上げない。
  assert.match(item(/実行ごとに作って捨て/), /本物のアカウント/);
  // 鍵の渡し方は手段でなく条件で書き、env ファイルは例にする。
  const key = item(/テストのプロセス/);
  assert.match(key, /環境変数・引数・作業ディレクトリ\s*（`\$GITHUB_WORKSPACE` の下）に入れない/);
  assert.match(key, /\$GITHUB_ENV` に入れない/);
  assert.match(key, /例: `\$RUNNER_TEMP` の env ファイル/);
  assert.match(item(/デバッグ表示|スタックトレース/), /開発モードのバックエンド/);
  assert.match(item(/合成/), /DB/);
  assert.match(item(/公開リポジトリでは上げない/), /リポジトリを読める人/);
  assert.match(item(/入力でブランチを指定した回に上げない/), /if:/);
  const upload = item(/HTML レポート/);
  assert.match(upload, /上げるのは `test-results\/` だけにする/);
  assert.match(upload, /`playwright\/\.auth\/`/);
  // バックエンドが自分のチェックアウトから読む本物の鍵と、テストが添付するバックエンドのログも塞ぐ。
  assert.match(item(/本物の鍵/), /チェックアウトの中/);
  assert.match(item(/docker compose logs/), /添付せず/);
  // 開発モードで立てるバックエンドの外し方の例と、外せないなら例外を使わないこと。
  const devMode = paragraphOf(exception, "**開発モードのバックエンド**");
  assert.match(devMode, /デバッグ表示を切/);
  assert.match(devMode, /モードごと変わる/);
  assert.match(exception, /存在しない URL（404）/);
  for (const example of [/`config\.consider_all_requests_local`/, /`DEBUG`/, /`APP_DEBUG=false`/, /`NODE_ENV=production`/]) {
    assert.match(exception, example);
  }
  assert.match(exception, /切れない[^。]*なら、\s*例外を使わない/);
  assert.match(exception, /::add-mask::` が伏せるのはログだけ/);
  assert.match(exception, /if: \$\{\{ failure\(\)/);
  assert.match(exception, /retention-days: [1-7]\b/);
  assert.match(exception, /path: .*test-results\//);
  // 保存したセッションと HTML レポートは例外でも上げない。
  const yaml = exception.slice(exception.indexOf("```yaml"));
  assert.doesNotMatch(yaml, /playwright\/\.auth|playwright-report/);
  assert.match(exception, /`playwright\/\.auth\/`）と HTML レポート（`playwright-report\/`。[^）]*）は含めない/);
  // 雛形の README と設定のコメントは、既定は上げないまま、例外の条件は手引きを見るよう案内する。
  const row = read("templates/playwright/README.md").split("\n").find((line) => line.startsWith("| Traces, screenshots and videos"));
  assert.match(row, /Do not upload them as CI artifacts/);
  assert.match(row, /playwright-ci\.md#例外-落ちた-run-の-trace-を短く残す/);
  assert.match(read("templates/playwright/playwright.config.ts"), /do not upload them as CI artifacts \(the only exception[\s\S]*playwright-ci\.md/);
});

test("CI の手引きは、流したかの印の 2 つの付け方と、それぞれの注意を書く", () => {
  const guide = read("docs/playwright-ci.md");
  const when = sectionOf(guide, "## 1. いつ流すか");
  assert.match(bulletOf(when, "**通ったときだけ印を付ける**"), /落ちた組は次の回にもう一度流れる/);
  const evenIfFailed = bulletOf(when, "**流したら印を付ける（落ちても）**");
  assert.match(evenIfFailed, /`force` で流す/);
  assert.match(evenIfFailed, /!cancelled\(\) && needs\.e2e\.outputs\.ran == 'true'/);
  assert.match(evenIfFailed, /needs\.e2e\.result == 'failure'/);
  // 成果物を印にして head_branch で絞っても、fork の PR はブランチ名を自由に付けられる。
  const artifact = bulletOf(when, "成果物の名前を印にしない");
  assert.match(artifact, /head_branch/);
  assert.match(artifact, /fork/);
  // head_repository_id でも絞った後に残る経路まで書き、cache でも閉じないこと、閉じる手段、移行の手順に導く。
  assert.match(artifact, /head_repository_id/);
  assert.match(artifact, /`workflow_run` が null/);
  assert.match(artifact, /cache にも直接書ける/);
  // 経路ごとに、何で閉じるか・閉じないかを書き分ける（閉じない経路まで閉じたように書かない）。
  assert.match(artifact, /入力で指定したブランチのコード: ブランチを run の ref で選べば（手順 2）閉じる/);
  assert.match(artifact, /同じジョブで動くバックエンドのコード（手順 3）: 閉じない/);
  assert.match(artifact, /固定した依存[^:]*: 閉じない/);
  assert.match(artifact, /ほかのワークフロー[\s\S]*?: 閉じない/);
  // PR やコメントを起点に動く run は、cache-mode を書かなければ既定ブランチの cache を読むだけ。
  assert.match(artifact, /既定では読むだけで、`cache-mode: write`/);
  assert.match(artifact, /checkout しない `mark` ジョブ[^。]*上の経路は閉じない/);
  assert.match(artifact, /合否の証拠にしない/);
  // 移行: 印を置く手順を消し、最初の回は流れる。消すために actions: write を足さない。
  assert.match(artifact, /印の成果物を上げる手順を消す/);
  assert.match(artifact, /最初の回は変更が無くても流れる/);
  assert.match(artifact, /`actions: write` を足さない/);
  // 骨組み: 印の保存はテストを流すジョブと分け、checkout しないジョブで行う。テストを始めたかを ran で渡す。
  const from = guide.indexOf("# 骨組みの例");
  const skeleton = guide.slice(from, guide.indexOf("```", from));
  const e2eJob = skeleton.slice(skeleton.indexOf("\n  e2e:"), skeleton.indexOf("\n  mark:"));
  const markJob = skeleton.slice(skeleton.indexOf("\n  mark:"));
  assert.ok(markJob.length > 0, "印を保存するジョブが無い");
  assert.match(e2eJob, /outputs:\n\s+key: \$\{\{ steps\.sha\.outputs\.key \}\}\n\s+ran: \$\{\{ steps\.ran\.outputs\.ran \}\}/);
  // ran はテストの前に立てる（テストが落ちても立っている）。
  assert.ok(e2eJob.indexOf("- id: ran") >= 0 && e2eJob.indexOf("- id: ran") < e2eJob.indexOf("# ...テスト..."));
  assert.doesNotMatch(e2eJob, /actions\/cache\/save/);
  assert.match(markJob, /needs: e2e/);
  assert.match(markJob, /if: .*needs\.e2e\.outputs\.ran == 'true'/);
  assert.match(markJob, /permissions: \{\}/);
  assert.match(markJob, /actions\/cache\/save/);
  assert.doesNotMatch(markJob, /actions\/checkout/);
  // 値は run: に式で埋めず env で渡す。
  assert.doesNotMatch(markJob, /run: .*\$\{\{/);
});

test("CI の手引きは、別のブランチのコードを流せる作りの危険と、キャッシュを読むだけにすることを書く", () => {
  const guide = read("docs/playwright-ci.md");
  const cache = sectionOf(guide, "## 2. キャッシュは読むだけにする");
  // 第一の対策は run の ref で選ぶこと。
  assert.match(bulletOf(cache, "**ブランチは入力でなく、run の ref で選ぶ。**"), /gh workflow run --ref/);
  // 読むだけは、うっかりの保存を防ぐだけで、悪意のあるコードは防げない。
  assert.match(bulletOf(cache, "**読むだけにしても、悪意のあるコードは防げない。**"), /直接書ける/);
  assert.match(bulletOf(cache, "**Environment の制限が効かない。**"), /required reviewers/);
  assert.match(bulletOf(cache, "**印を付けない。**"), /流していない\s*既定ブランチの組に印が付く/);
  assert.match(cache, /actions\/cache\/restore/);
  // setup-node は cache: を書かなくても保存することがある。
  assert.match(cache, /package-manager-cache: false/);
  assert.match(cache, /\.\/\.github\/actions\//);
  assert.match(cache, /self-hosted/);
});

test("CI の手引きは、画面のビルドの設定と E2E の Node の版の注意を書く", () => {
  const compose = sectionOf(read("docs/playwright-ci.md"), "## 4. バックエンドを docker compose で立ち上げる");
  // ビルドに埋め込む値を git の外のファイルに頼らない。雛形をコピーしてからビルドする。
  const build = bulletOf(compose, "**画面のビルドの設定**");
  assert.match(build, /NEXT_PUBLIC_\*/);
  assert.match(build, /雛形.*をコピー/);
  assert.match(build, /git の外/);
  // 画面と E2E のパッケージで engines が違うことがある。
  const node = bulletOf(compose, "**Node の版**");
  assert.match(node, /`engines`/);
  assert.match(node, /E2E の前に/);
  assert.match(node, /package-manager-cache: false/);
});
