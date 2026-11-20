import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("setup は版を上げるときに、新しい版で足された設定キーを利用側に提案する", () => {
  // 版の番号だけを上げると、足された設定（例: implExcludeGlobs）を知らないまま古い出力を見続ける。
  const skill = read("plugins/specproof/skills/specproof-setup/SKILL.md");
  const from = skill.indexOf("## 7. 版を上げるとき");
  const to = skill.indexOf("\n## ", from + 1);
  assert.ok(from >= 0 && to > from, "版を上げるときの節が無い");
  const section = skill.slice(from, to);
  assert.match(section, /CHANGELOG/);
  assert.match(section, /specproof-drift-check\.yml/);
  assert.match(section, /layout\.implExcludeGlobs/);
  assert.match(section, /unknown-config-key/);
  assert.match(section, /承認を待つ/);
  assert.match(section, /同じ変更で上げる/);
  // 他人のブランチ・差し替えたレジストリ・取得した文章の指示で動かない。
  assert.match(section, /他人の PR のブランチでは行わない/);
  assert.match(section, /--@pound79:registry=https:\/\/registry\.npmjs\.org/);
  assert.match(section, /データとして読み/);
  assert.match(section, /書き換えの承認は、コマンドを実行する承認を兼ねない/);
  // 導入済みのときの入口から辿れる。
  const setupEntry = skill.slice(skill.indexOf("## 0. 前提チェック"), skill.indexOf("## 1. フレームワーク検出"));
  assert.match(setupEntry, /§7「版を上げるとき」/);
  const orchestrator = read("plugins/specproof/skills/specproof/SKILL.md");
  const resolve = orchestrator.slice(orchestrator.indexOf("## 0. 設定の解決"), orchestrator.indexOf("\n## ", orchestrator.indexOf("## 0. 設定の解決") + 1));
  assert.match(resolve, /§7「版を上げるとき」/);
  // セキュリティモデルの通信先にも載せる。
  assert.match(read("docs/security-model.md"), /\| AI skill \| GitHub の公開ページ \|/);
});
