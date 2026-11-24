import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { translationIssues } from "./document-translations.mjs";

test("公開ガイドの日英版は互いの文書を参照できる", () => {
  const paths = execFileSync("git", ["ls-files", "-z", "*.md"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const docs = new Map(paths.map((name) => [name, readFileSync(name, "utf8")]));
  assert.deepEqual(translationIssues(docs), []);
});

test("片方の削除、別のガイドへのリンク、片方向だけの案内を検出する", () => {
  const english = [
    "cli/README.md",
    "English | [日本語](https://github.com/Pound79/specproof/blob/main/cli/README_ja.md)",
  ];
  const japanese = ["cli/README_ja.md", "[English](./README.md) | 日本語"];
  assert.deepEqual(translationIssues(new Map([english, japanese])), []);

  const incompletePairs = [
    [english],
    [japanese],
    [english, [japanese[0], "[English](../README.md)"]],
    [[english[0], "English"], japanese],
  ];
  for (const entries of incompletePairs) {
    assert.ok(translationIssues(new Map(entries)).length > 0);
  }
});
