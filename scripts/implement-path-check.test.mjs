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
  assert.match(report, /7 項目/);
  assert.match(report, /状態を使い切るシナリオ/);
  assert.doesNotMatch(report, /[56] ?項目/);
  assert.match(report, /回帰（検知を確かめた／未確認: 理由）/);
});

test("状態を使い切るシナリオは、試行ごとに前提を作るか、前提を確かめて理由付きで止める", () => {
  // 1 回目の実行で前提の状態（未読など）を消費するシナリオは、seed が run ごとに 1 回しか入らないと、
  // CI の再試行で期待する要求が出ず、理由の分からない時間切れになる。
  const guide = read("plugins/specproof/skills/specproof-sync/prompts/system.md");
  const from = guide.indexOf("## ドラフトの点検");
  const check = guide.slice(from, guide.indexOf("\n---", from));
  // 生成ガイドでは、idiomGuide を設定していても読まれる「ドラフトの点検」の行に置き、提案だけにする。
  const row = check.split("\n").find((line) => line.startsWith("| 統制できない前提 |")) ?? "";
  assert.match(row, /操作で前提の状態を使い切る/);
  assert.match(row, /試行ごとにその試行専用の状態を作る/);
  assert.match(row, /ほかのシナリオと共有しない専用のデータを seed で作る/);
  assert.match(row, /自己点検の 7/);
  const skill = read("plugins/specproof/skills/specproof-implement/SKILL.md");
  const selfCheck = skill.slice(skill.indexOf("6. **gaming 自己点検"), skill.indexOf("7. **独立 adversarial"));
  const item = selfCheck.slice(selfCheck.indexOf("7. **状態を使い切るシナリオ**"));
  assert.ok(item.length > 0, "自己点検の 7 が無い");
  assert.match(item, /試行ごとにその試行専用の状態を作るか戻すか/);
  assert.match(item, /最初の試行の失敗を先に見る/);
  assert.match(item, /確かめが無ければ本体に足して流し直す/);
  // feature の変更は提案、共有の seed は blast radius に従って変えない。
  assert.match(item, /escalation ① で提案する/);
  assert.match(item, /blast radius に従い、範囲の外か共有の seed なら変えずに停止して提案する/);
  const methodology = read("docs/methodology.md");
  assert.match(methodology, /前提の状態を使い切るシナリオは、試行ごとに前提を作る/);
});
