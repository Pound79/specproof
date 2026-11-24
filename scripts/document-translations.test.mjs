import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { indexIssues, translationIssues } from "./document-translations.mjs";

test("公開ガイドの日英版は互いの文書を参照できる", () => {
  const paths = execFileSync("git", ["ls-files", "-z", "*.md"], { encoding: "utf8" })
    .split("\0")
    .filter((name) => name && lstatSync(name, { throwIfNoEntry: false })?.isFile());
  const docs = new Map(paths.map((name) => [name, readFileSync(name, "utf8")]));
  assert.deepEqual(translationIssues(docs), []);
  assert.deepEqual(indexIssues(docs), []);
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

test("索引に載っているガイドは言語切替と対訳を同時に削除しても検査する", () => {
  const english = ["docs/README.md", "English | [日本語](README_ja.md)\n[Security](../SECURITY.md)"];
  const japanese = ["docs/README_ja.md", "[English](README.md) | 日本語\n[安全][policy]\n\n[policy]: ../SECURITY_ja.md#報告"];
  const docs = new Map([english, japanese, ["SECURITY.md", "# Security"]]);
  assert.deepEqual(indexIssues(docs), [
    "docs/README_ja.md: missing guide SECURITY_ja.md",
  ]);
});
