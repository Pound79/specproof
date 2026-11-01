import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// skill は設定の commands.* を展開して AI エージェントに実行させる。設定やコマンドが呼ぶ
// スクリプトは PR で書き換えられるので、既定ブランチから変わっていれば、実行する前に
// 展開後のコマンドを人に示して承認を待つ（「AI は提示し、人間が裁定する」をコマンドにも適用）。
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const files = execFileSync("git", ["ls-files", "plugins/specproof/skills"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  encoding: "utf8",
})
  .trim()
  .split("\n");
const skillDirs = [
  ...new Set(
    files
      .filter((file) => file.endsWith(".md") && read(file).includes("{{config:commands."))
      .map((file) => file.split("/").slice(0, 4).join("/")),
  ),
];
const HEADING = "## 設定のコマンドを実行する前の確認";

test("commands.* を実行する skill がある", () => {
  assert.ok(skillDirs.length >= 5, skillDirs.join(", "));
});

for (const dir of skillDirs) {
  test(`${path.basename(dir)}: 設定のコマンドを実行する前に差分を確かめ、変わっていれば承認を待つ`, () => {
    const skill = read(`${dir}/SKILL.md`);
    const start = skill.indexOf(HEADING);
    assert.ok(start >= 0, `${dir}/SKILL.md must have "${HEADING}"`);
    const section = skill.slice(start, skill.indexOf("\n## ", start + HEADING.length) >>> 0);
    for (const name of [
      "specproof.config.yaml",
      "specproof.config.yml",
      "bdd-kit.config.yaml",
      "bdd-kit.config.yml",
    ]) {
      assert.match(section, new RegExp(name.replaceAll(".", "\\.")));
    }
    assert.match(section, /package\.json/);
    assert.match(section, /承認を得るまで[^\n]*実行しない/);
    assert.match(section, /既定ブランチ/);
    assert.match(section, /\.npmrc/);
    assert.match(section, /git status --porcelain/);
    assert.match(section, /差分が無くても/);
  });

  // 手順は「## 0.」から始まり、そこでコマンドを実行しうる（それより前は説明でコマンドに触れるだけ）。
  test(`${path.basename(dir)}: 確認の節は最初の手順（## 0.）より前に置く`, () => {
    const skill = read(`${dir}/SKILL.md`);
    const start = skill.indexOf(HEADING);
    const firstStep = skill.indexOf("\n## 0.");
    assert.ok(firstStep >= 0, `${dir}: no "## 0." step`);
    assert.ok(start >= 0 && start < firstStep, `${dir}: the section must come before "## 0."`);
  });
}

test("確認の節はすべての skill で同じ文面にする", () => {
  const sections = skillDirs.map((dir) => {
    const skill = read(`${dir}/SKILL.md`);
    const start = skill.indexOf(HEADING);
    const end = skill.indexOf("\n## ", start + HEADING.length);
    return skill.slice(start, end < 0 ? undefined : end).trim();
  });
  assert.equal(new Set(sections).size, 1);
});
