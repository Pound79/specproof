import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("Playwright の CI の手引きは、trace を成果物に上げない方針を変えずに別のバックエンドの扱いを示す", () => {
  // 雛形の README は trace・スクリーンショット・動画・保存したセッションを CI の成果物に上げないとしている。
  const guide = read("docs/playwright-ci.md");
  assert.match(guide, /CI の成果物に上げない/);
  assert.doesNotMatch(guide, /upload-artifact/);
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
  // 比べた SHA を checkout し、印は通ったときだけ cache に残す。成果物の名前は偽造できるので使わない。
  assert.match(guide, /ref: \$\{\{ steps\.sha\.outputs\.backend \}\}/);
  assert.match(guide, /actions\/cache\/save/);
  assert.match(guide, /成果物の名前を印にしない/);
  // bash の UID は読み取り専用なので別の名前で渡す。
  assert.match(guide, /HOST_UID/);
  assert.doesNotMatch(guide, /\$\{UID\}/);
  assert.match(guide, /::add-mask::/);
  assert.match(read("templates/playwright/README.md"), /docs\/playwright-ci\.md/);
});
