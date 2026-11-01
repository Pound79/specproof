import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";
import { shellCdCommand } from "../scaffold-config.js";

// init が表示する手動セットアップの cd は、実際の配置先へ移る必要がある。表示で ? に置き換える
// 文字（BOM・bidi 制御文字・行区切り・C1）を含む名前でも、画面に生の文字を出さずに元の名前を
// 指すこと。
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\p{Bidi_Control}]/u;

// 入っているシェルすべてで確かめる（macOS の sh は bash 3.2、Linux の sh は dash のことが多い）。
const SHELLS = ["sh", "bash", "dash", "zsh", "ksh"].filter(
  (shell) => spawnSync(shell, ["-c", "exit 0"]).status === 0,
);

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

for (const name of [
  "tests\ufeffbdd",
  "e2e\u202etests",
  "a\u2028b",
  "it's\u0085x",
  'x\u202e!!$HOME`id`"q',
  "d\u00851",
  "sp\ufeff ",
  "-rf\u2028",
  "per%cent\\back\u200f",
  "e2e",
  "e2e tests",
]) {
  test(`cd は ${JSON.stringify(name)} へ移り、表示に危険な文字を含まない`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "shell-cd-"));
    created.push(root);
    mkdirSync(path.join(root, name));
    const command = shellCdCommand(name);
    assert.doesNotMatch(command, UNSAFE);
    // printf で組み立てる形では、書式に [A-Za-z0-9_./-] と 8 進表記以外を出さない（! $ ` " を含めない）。
    const format = /^cd -- "\$\(printf '(.*)'\)"$/.exec(command)?.[1];
    if (format !== undefined) assert.match(format, /^(?:[A-Za-z0-9_./-]|\\[0-7]{3})*$/);
    for (const shell of SHELLS) {
      const result = spawnSync(shell, ["-c", `${command} && pwd -P`], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
      assert.equal(result.stdout.replace(/\n$/, ""), realpathSync(path.join(root, name)), shell);
    }
  });
}

test("ふつうの名前は今までどおりの読みやすい形にする", () => {
  assert.equal(shellCdCommand("e2e"), "cd ./e2e");
  assert.equal(shellCdCommand("."), "cd .");
  assert.equal(shellCdCommand("e2e tests"), "cd -- './e2e tests'");
});
