import assert from "node:assert/strict";
import { test } from "vitest";
import { missingSensitiveEntries } from "../gitignore-gap.js";

const TEMPLATE = ".env\n.env.*\nplaywright/.auth/\n";

// 末尾の空白を落とす処理が、空白の長い連なりのあとに文字がある行で 2 乗の時間にならないこと。
test("空白が長く続いたあとに文字がある行を、すぐに読み終える", () => {
  const started = Date.now();
  const missing = missingSensitiveEntries(TEMPLATE, `${" ".repeat(300_000)}x\n.env\n`);
  assert.ok(Date.now() - started < 2_000);
  assert.deepEqual(missing, [".env.*", "playwright/.auth"]);
});

// git が無視するのは末尾の空白だけで、タブは模様の一部として残る。
test("末尾のタブは落とさない（.env<TAB> は .env を除外しない）", () => {
  assert.ok(missingSensitiveEntries(TEMPLATE, ".env\t\n").includes(".env"));
  assert.ok(!missingSensitiveEntries(TEMPLATE, ".env   \n").includes(".env"));
});
