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

test("状態を使い切るシナリオは、動詞でなく再び成り立つかで選び、印のガードの落とし穴を守る", () => {
  // 削除・承認のような動詞で選ぶと、参加・通報・印を付ける更新・名前の変更が漏れる。印を早く残すと
  // 通るはずの再試行を止め、再試行の番号を鍵にすると再試行から前の試行の印が見えない。
  const skill = read("plugins/specproof/skills/specproof-implement/SKILL.md");
  const selfCheck = skill.slice(skill.indexOf("6. **gaming 自己点検"), skill.indexOf("7. **独立 adversarial"));
  const item = selfCheck.slice(selfCheck.indexOf("7. **状態を使い切るシナリオ**"));
  assert.match(item, /同じシナリオがもう一度は成り立たないか/);
  assert.match(item, /参加する、通報する、対応済みなどの印を付ける、名前や本文を変える/);
  assert.match(item, /2 回目に時間切れで落ちるものも対象/);
  assert.match(item, /毎回新しい値で作るもの、要求が断られて何も変わらないもの/);
  // 最後の step で戻すだけのものは、途中で落ちると戻らず再試行の前提が崩れるので、対象外にしない。
  assert.match(item, /失敗の経路を含めて、次の試行が前提を確かめる前に状態が戻ることを確かめたもの/);
  assert.match(item, /最後の step で戻すだけのものは.*対象に残す/s);
  assert.doesNotMatch(item, /対象外は、同じシナリオの中で自分で状態を戻すもの/);
  assert.match(item, /確定の操作（確認のダイアログの「削除する」など）の直前/);
  assert.match(item, /`testInfo\.testId`/);
  assert.match(item, /再試行の番号や行番号を鍵にしない/);
  assert.match(item, /印のガードは 1 つまで/);
  assert.match(item, /`--repeat-each`/);
  assert.match(item, /シナリオ名と、seed を流し直すことを出す/);
  assert.match(item, /印を消すのは seed の側（seed が成功した後）で、step では消さない/);
  const readme = read("templates/playwright/README.md");
  const from = readme.indexOf("### 状態を使い切るシナリオのガード");
  assert.ok(from >= 0, "雛形の README にガードの節が無い");
  const guide = readme.slice(from, readme.indexOf("\n---", from));
  assert.match(guide, /guardSeedData/);
  assert.match(guide, /testInfo\.testId/);
  assert.match(guide, /titlePath\.slice\(1\)/);
  assert.match(guide, /flag: "wx", mode: 0o600/);
  assert.match(guide, /rm -rf -- "\$\{STATE_DIR:\?\}\/consumed"/);
  assert.match(guide, /ガードは 1 つまで/);
  assert.match(guide, /最後の step で戻すだけのものは.*対象に残す/s);
  assert.doesNotMatch(guide, /中で自分で状態を戻すもの、毎回新しい値で作るもの/);
  assert.match(guide, /step や `globalSetup` では消さない/);
  assert.match(guide, /複数の project/);
  // rm の起点は、受け継いだ環境変数でなくスクリプトの場所から決める。
  assert.match(guide, /STATE_DIR="\$\(cd -- "\$\(dirname -- "\$0"\)\/\.\." && pwd -P\)\/state"/);
  assert.match(guide, /`state\/` を `\.gitignore` に足す/);
  // ガードは操作より前に呼び、印を残すのは確定の操作の直前（ダイアログが出た後）。
  assert.ok(guide.indexOf("guardSeedData($testInfo)") < guide.indexOf(".click()"));
  assert.ok(guide.indexOf("toBeVisible") < guide.indexOf("guard.consume()"));
  assert.ok(guide.indexOf("guard.consume()") < guide.indexOf('name: "削除する"'));
  const methodology = read("docs/methodology.md");
  assert.match(methodology, /「その操作の後、同じシナリオがもう一度は成り立たないか」/);
});
