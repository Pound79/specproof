import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("implement の自己点検は、確かめたい経路を通ったかと、回帰のシナリオが不具合を検知するかを見る", () => {
  // 期待値を実装から取っていないかだけでは、失敗の経路に入らずに同じ表示で通る step や、
  // 原因の状態を作らずに通る回帰のシナリオ（隠れた空振り）を見逃す。
  const skill = read("plugins/specproof/skills/specproof-implement/SKILL.md");
  const section = (start, end) => {
    const from = skill.indexOf(start);
    const to = skill.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `${start} から ${end} までが見つからない`);
    return skill.slice(from, to);
  };
  const selfCheck = section("6. **gaming 自己点検", "7. **独立 adversarial");
  assert.match(selfCheck, /6\. \*\*経路の確かめ\*\*/);
  assert.match(selfCheck, /要求が送られた/);
  // トレースにはテスト用アカウントのセッションが入るので、写す範囲を限る。
  assert.match(selfCheck, /メソッド・パス（クエリを除く）・\s*応答の状態コードだけ/);
  const baseline = section("2. **step の本体を書いてから RED 確認", "3. **実装計画**");
  assert.match(baseline, /不具合を検知するためのシナリオ/);
  assert.match(baseline, /修正を戻した/);
  assert.match(baseline, /command-handoff\.md/);
  // 戻す操作で作業中の変更を失わせない・コミットさせない。
  assert.match(baseline, /今の作業ツリーで戻さない（revert のコミット・stash・`reset --hard` をしない）/);
  assert.match(baseline, /戻す修正のコミットは人に確かめる（推測しない）/);
  const review = section("7. **独立 adversarial", "8. **");
  assert.match(review, /修正を戻したら落ちるか/);
  const report = section("## レポート様式", "## Safety rules");
  assert.match(report, /6 項目/);
  assert.doesNotMatch(report, /5 ?項目/);
  assert.match(report, /回帰（検知を確かめた／未確認: 理由）/);
});
