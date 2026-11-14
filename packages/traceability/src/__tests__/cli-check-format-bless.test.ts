import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { DriftEntry } from "../check.js";
import {
  describeBlessedCommit,
  describeExcludedAdvisories,
  describeNextSteps,
} from "../cli-check-format.js";

const entry = (refPath: string, side: DriftEntry["side"] = "impl"): DriftEntry => ({
  linkId: "l",
  side,
  path: refPath,
  storedHash: "a".repeat(64),
  currentHash: "b".repeat(64),
  status: "changed",
});
const commit = "c".repeat(40);

describe("describeBlessedCommit", () => {
  test("探していなければ何も出さない", () => {
    assert.equal(describeBlessedCommit(entry("src/a.ts"), undefined, 200), undefined);
  });

  test("見つからなければ、辿ったパスと見つからない理由の候補を出す", () => {
    const line = describeBlessedCommit(entry("src/alias.ts"), null, 200, "", "src/a.ts");
    assert.match(line ?? "", /not found in the last 200 commit\(s\) touching src\/a\.ts/);
    assert.match(line ?? "", /shallow/);
  });

  test("完全なコミット id と、最上位からの literal のパスでコマンドを示す", () => {
    assert.equal(
      describeBlessedCommit(entry("src/a.ts"), commit, 200, "e2e/"),
      `blessed version: ${commit} — compare with: git diff ${commit} -- ':(top,literal)e2e/src/a.ts'`,
    );
  });

  test("辿ったパス（シンボリックリンクの実体）があれば、それでコマンドを示す", () => {
    assert.match(
      describeBlessedCommit(entry("src/alias.ts"), commit, 200, "", "src/a.ts") ?? "",
      /':\(top,literal\)src\/a\.ts'$/,
    );
  });

  test("シェルで扱いにくい文字・絶対パスはコマンドにしない", () => {
    for (const refPath of ["src/x'; rm -rf ~; '.ts", "src/a b.ts", "/abs/a.ts", "src/$(id).ts"]) {
      const line = describeBlessedCommit(entry(refPath), commit, 200) ?? "";
      assert.match(line, new RegExp(`blessed version: ${commit} \\(`));
      assert.doesNotMatch(line, /git diff/);
    }
  });

  test("prefix も含めて文字を確かめる", () => {
    assert.doesNotMatch(
      describeBlessedCommit(entry("src/a.ts"), commit, 200, "my dir/") ?? "",
      /git diff/,
    );
  });
});

describe("describeExcludedAdvisories", () => {
  test("設定が無いか、外したものが無ければ何も出さない", () => {
    assert.equal(describeExcludedAdvisories(undefined), undefined);
    assert.equal(
      describeExcludedAdvisories({ unregisteredImpl: 0, unregisteredSpecHeading: 0 }),
      undefined,
    );
  });

  test("外した件数を設定のキーとともに出す", () => {
    assert.equal(
      describeExcludedAdvisories({ unregisteredImpl: 3, unregisteredSpecHeading: 1 }),
      "(excluded 3 unregistered-impl item(s) by layout.implExcludeGlobs and 1 unregistered-spec-heading item(s) by layout.specHeadingIgnore)",
    );
  });
});

describe("describeNextSteps", () => {
  test("feature だけの drift には決定表の添え書きを出さない", () => {
    assert.equal(describeNextSteps([entry("a.feature", "feature")]).length, 2);
    assert.equal(describeNextSteps([entry("src/a.ts", "impl")]).length, 3);
  });
});
