import assert from "node:assert/strict";
import { test } from "vitest";
import { parseFlags } from "../flags.js";

for (const args of [
  ["--dry-run"],
  ["--froce"],
  ["unexpected"],
  ["--force", "false"],
  ["--dir=tests"],
]) {
  test(`未知の scaffold 引数を拒否する: ${args.join(" ")}`, () => {
    assert.throws(() => parseFlags(args, "init"), /Unknown option or argument/);
  });
}
for (const option of ["--adapter", "--dir", "--agent"]) {
  test(`${option} の値の欠落を拒否する`, () => {
    for (const tail of [[], ["--force"], ["-h"], [""]]) {
      assert.throws(() => parseFlags([option, ...tail], "init"), /requires a value/);
    }
  });
}
for (const [command, option] of [
  ["init", "--json"],
  ["detect", "--force"],
  ["setup-agent", "--dir"],
] as const) {
  test(`${command} で未対応の ${option} を拒否する`, () => {
    assert.throws(() => parseFlags([option], command), /Unknown option or argument/);
  });
}
test("init の対応オプションを保持する", () => {
  assert.deepEqual(
    parseFlags(["--adapter", "playwright", "--dir", ".", "--force", "--agent", "codex"], "init"),
    {
      adapter: "playwright",
      dir: ".",
      force: true,
      agent: "codex",
    },
  );
});
test("単一ハイフンで始まる配置先を値として受け付ける", () => {
  assert.deepEqual(parseFlags(["--dir", "-e2e"], "init"), { dir: "-e2e" });
});
