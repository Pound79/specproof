import assert from "node:assert/strict";
import { test } from "vitest";
import { parseCliArgs } from "../cli-args.js";

for (const args of [["--stric"], ["--strict=true"], ["unexpected"], ["--json", "false"]]) {
  test(`未知の traceability 引数を拒否する: ${args.join(" ")}`, () => {
    assert.throws(() => parseCliArgs(args), /Unknown option or argument/);
  });
}
for (const option of ["--manifest", "--root", "--pages-dir", "--candidate-suffix", "--link-id"]) {
  test(`${option} の値の欠落を拒否する`, () => {
    for (const tail of [[], ["--strict"], ["-h"], [""]]) {
      assert.throws(() => parseCliArgs([option, ...tail]), /requires a value/);
    }
  });
}
for (const [command, option] of [
  ["check", "--dry-run"], ["update", "--strict"],
  ["list", "--strict"], ["stats", "--github-annotations"],
] as const) {
  test(`${command} で未対応の ${option} を拒否する`, () => {
    assert.throws(() => parseCliArgs([option], command), /Unknown option or argument/);
  });
}
test("strict と値付きオプションを正しく保持する", () => {
  const result = parseCliArgs(["--strict", "--manifest", "m.yaml", "--root", "."], "check");
  assert.ok(result.flags.has("--strict"));
  assert.equal(result.manifest, "m.yaml");
  assert.equal(result.root, ".");
});
