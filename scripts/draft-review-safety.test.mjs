import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const distributions = [".agents/skills", "plugins/specproof/skills"];
const between = (text, start, end) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `not found: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to >= 0, `not found after ${start}: ${end}`);
  return text.slice(from, to);
};

// Check the gate before the numbered edit instructions, not a matching sentence
// later in the file. All links must be checked before the first file is written.
const checkPreflight = (skill) => {
  const gate = between(skill, "### 3. Feature / steps の更新", "\n対象リンクごとに:");
  assert.match(gate, /全対象リンク/);
  assert.match(gate, /変更案をメモリ上/);
  assert.match(gate, /5・6 の規則/);
  assert.match(gate, /全件完了するまで/);
  assert.match(gate, /feature \/ steps \/ page objects \/ manifest を変更しない/);
  assert.match(gate, /1 件でも spec の明示が無い削除・緩和があれば停止/);
};

const checkDeletion = (skill) => {
  const rule = between(skill, "\n5. 既存シナリオ", "\n6. **確認を減らす変更");
  assert.match(rule, /リンクされた spec が当該機能の削除を明示/);
  assert.match(rule, /impl の削除・変更だけを根拠にしない/);
  assert.match(rule, /人間の裁定/);
  assert.match(rule, /変更の前後と根拠の spec 節/);
  assert.match(rule, /報告と PR 本文/);
  assert.doesNotMatch(rule, /仕様\/実装/);
};

const checkWeakening = (skill) => {
  const rule = between(skill, "\n6. **確認を減らす変更", "\n### 4. ");
  assert.match(rule, /spec が明示していない限り行わない/);
  assert.match(rule, /feature \/ manifest を変更せずに停止/);
  for (const tag of ["@draft", "@red-contract", "@human", "@out-of-scope"]) {
    assert.ok(rule.includes(`\`${tag}\``), tag);
  }
  assert.match(rule, /Feature \/ Rule \/ Examples/);
  assert.match(rule, /継承/);
  assert.match(rule, /Examples の行を削る/);
};

const checkGuide = (guide) => {
  const section = between(guide, "## ドラフトの点検", "\n---");
  assert.match(section, /編集前/);
  assert.match(section, /spec の明示が無ければ停止する/);
  assert.match(section, /spec が明示している場合も変更の前後と根拠の spec 節を報告と PR 本文/);
  const row = section.split("\n").find((line) => line.startsWith("| 確認を減らす変更 |")) ?? "";
  assert.match(row, /Feature \/ Rule \/ Examples/);
  assert.match(row, /Examples の行を削る/);
  assert.match(section, /点検の結果でドラフトを書き換えない/);
};

for (const distribution of distributions) {
  const skillPath = `${distribution}/specproof-sync/SKILL.md`;
  const guidePath = `${distribution}/specproof-sync/prompts/system.md`;
  test(`${distribution}: sync は全リンクの削除・緩和を編集前に確認する`, () => {
    checkPreflight(read(skillPath));
  });
  test(`${distribution}: シナリオ削除も spec の根拠と人間の裁定を必要とする`, () => {
    checkDeletion(read(skillPath));
  });
  test(`${distribution}: タグ継承と Examples の削減も確認を減らす変更に含める`, () => {
    checkWeakening(read(skillPath));
  });
  test(`${distribution}: 生成ガイドも停止条件と進める条件を区別する`, () => {
    checkGuide(read(guidePath));
  });
}

test("sync の安全規則と生成ガイドは両配布先で同一", () => {
  for (const relative of ["specproof-sync/SKILL.md", "specproof-sync/prompts/system.md"]) {
    assert.equal(read(`${distributions[0]}/${relative}`), read(`${distributions[1]}/${relative}`));
  }
});

test("方法論も編集前の停止と spec に基づく削除を要求する", () => {
  const section = between(read("docs/methodology.md"), "### 既存シナリオを削除しない原則", "\n### ");
  assert.match(section, /spec が機能の削除を明示/);
  assert.match(section, /実装の削除だけでは/);
  assert.match(section, /全対象リンク/);
  assert.match(section, /feature \/ steps \/ page objects \/ manifest を変更しない/);
  assert.match(section, /Feature \/ Rule \/ Examples/);
  assert.match(section, /Examples の行の削除/);
  assert.match(section, /報告と PR 本文/);
});

test("安全規則の削除・弱体化を契約検査が検出する", () => {
  const skill = read("plugins/specproof/skills/specproof-sync/SKILL.md");
  const guide = read("plugins/specproof/skills/specproof-sync/prompts/system.md");
  // Verify the original first, so unrelated failures cannot kill every mutant.
  checkPreflight(skill);
  checkDeletion(skill);
  checkWeakening(skill);
  checkGuide(guide);
  const mutants = [
    [checkPreflight, skill, "全件完了するまで", "リンクごとに完了したら"],
    [checkDeletion, skill, "リンクされた spec が", "リンクされた仕様/実装が"],
    [checkDeletion, skill, "人間の裁定", "自動判定"],
    [checkWeakening, skill, "Feature / Rule / Examples", "Scenario"],
    [checkWeakening, skill, "Examples の行を削る", "Examples を確認する"],
    [checkGuide, guide, "spec の明示が無ければ停止する", "常に進める"],
  ];
  for (const [check, original, before, after] of mutants) {
    const mutated = original.replace(before, after);
    assert.notEqual(mutated, original, `mutation not applied: ${before}`);
    assert.throws(() => check(mutated), { name: "AssertionError" }, before);
  }
});
