import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { computeHeadingSectionHash, listHeadings } from "../hash.js";

for (const heading of [" ## Title", "   ## Title ###  ", "##\tTitle", "## Title ##"]) {
  test(`ATX の見出し表記を正規化して発見する: ${JSON.stringify(heading)}`, async () => {
    const content = `${heading}\nbody\n ## Next ##\nother\n`;
    assert.deepEqual(listHeadings(content, 2), [{ line: 1, text: "Title" }, { line: 3, text: "Next" }]);
    const root = await mkdtemp(path.join(os.tmpdir(), "heading-commonmark-"));
    try {
      const file = path.join(root, "spec.md");
      await writeFile(file, content);
      assert.equal(await computeHeadingSectionHash(file, "Title"), createHash("sha256").update(`${heading}\nbody`).digest("hex"));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("4スペースのコード、非見出し、fence 内を見出しにしない", () => {
  assert.deepEqual(listHeadings("    ## code\n##not-a-heading\n```\n ## fenced\n```\n## real\n", 2), [{ line: 6, text: "real" }]);
});

test("空見出しと閉じ記号でない末尾の # を区別する", () => {
  assert.deepEqual(listHeadings("##\n## ###\n## name#\n## name #suffix\n", 2), [
    { line: 1, text: "" }, { line: 2, text: "" }, { line: 3, text: "name#" }, { line: 4, text: "name #suffix" },
  ]);
});
