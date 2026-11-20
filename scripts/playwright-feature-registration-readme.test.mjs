import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("Playwright の README の feature の登録手順は、setup が変えた projects の構成でも成り立つ", () => {
  // README は生成した時点の固定の文で、setup が projects を変えても書き換わらない。
  // guest やロールごとの project がある前提で書くと、それらの無い構成で手順が合わなくなる。
  const readme = read("templates/playwright/README.md");
  const from = readme.indexOf("### 新しい feature を追加するとき");
  const to = readme.indexOf("\n### ", from + 1);
  assert.ok(from >= 0 && to > from, "feature の登録の節が無い");
  const section = readme.slice(from, to);
  assert.doesNotMatch(section, /既存の guest/);
  assert.doesNotMatch(section, /guest は/);
  // 追加先は認証状態（ロール）で決め、tags は必要条件に留める。タグ無しのシナリオは guest の tags にも合う。
  assert.match(section, /どの認証状態で確かめるか/);
  assert.match(section, /タグが合うだけでは追加しない/);
  assert.match(section, /認証が要るタグ無しのシナリオもそこで実行させない/);
  assert.match(section, /明示列挙/);
  assert.match(section, /--list --project <project-name>/);
  assert.match(section, /未実行を GREEN と扱わない/);
  for (const dist of ["plugins/specproof/skills", ".agents/skills"]) {
    const skill = read(`${dist}/specproof-new-feature/references/runner-registration.md`);
    assert.match(skill, /タグが合うだけでは選ばない/, dist);
    assert.match(skill, /認証が要るシナリオ（タグ無しを含む）を含む feature を追加しない/, dist);
  }
});
