import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("取り込み前の確かめは、読めなければ失敗する record の dry-run で行う", () => {
  // check --spec-sources は、記録が無い（unrecorded）・取り込み元を読めない（unavailable）ときも成功で終わるので、
  // 写す前の確かめに使うと、確かめないまま取り込みが進む。
  const schema = read("docs/config-schema.md");
  const from = schema.indexOf("- 取り込みのコマンドは、作業ツリーでなく `ref` から読む形にするとよい。");
  assert.ok(from >= 0, "ref から読む取り込みの項が無い");
  const item = schema.slice(from, schema.indexOf("\n- ", from + 1));
  assert.match(item, /写す前に `specproof-update --record-spec-source <name> --dry-run` を流し/);
  assert.match(item, /記録が無い初回でも確かめ/);
  assert.match(item, /`specproof-check\s*--spec-sources` は[^。]*この確かめには使えない/);
  assert.doesNotMatch(item, /先に `specproof-check --spec-sources` を流し/);
});
