import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { checkDrift } from "../check.js";
import { updateManifestHashes } from "../update.js";
import { versionHasher } from "../bless-history.js";
import { computeHeadingSectionHash, hashHeadingSectionContent, listHeadings } from "../hash.js";

for (const heading of [" ## Title", "   ## Title ###  ", "##\tTitle", "## Title ##"]) {
  test(`ATX の見出し表記を正規化して発見する: ${JSON.stringify(heading)}`, async () => {
    const content = `${heading}\nbody\n ## Next ##\nother\n`;
    assert.deepEqual(listHeadings(content, 2), [
      { line: 1, text: "Title" },
      { line: 3, text: "Next" },
    ]);
    const root = await mkdtemp(path.join(os.tmpdir(), "heading-commonmark-"));
    try {
      const file = path.join(root, "spec.md");
      await writeFile(file, content);
      assert.equal(
        await computeHeadingSectionHash(file, "Title"),
        createHash("sha256").update(`${heading}\nbody`).digest("hex"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("4スペースのコード、非見出し、fence 内を見出しにしない", () => {
  assert.deepEqual(
    listHeadings("    ## code\n##not-a-heading\n```\n ## fenced\n```\n## real\n", 2),
    [{ line: 6, text: "real" }],
  );
});

test("空見出しと閉じ記号でない末尾の # を区別する", () => {
  assert.deepEqual(listHeadings("##\n## ###\n## name#\n## name #suffix\n", 2), [
    { line: 1, text: "" },
    { line: 2, text: "" },
    { line: 3, text: "name#" },
    { line: 4, text: "name #suffix" },
  ]);
});

test("HTML コメントの中の見出しは、登録節の終端にも見出し一覧にも現れない", () => {
  const content = ["## 支払い", "   <!--", "## 古い見出し", "-->", "手数料は0円。", "## 完了"].join(
    "\n",
  );
  assert.deepEqual(listHeadings(content, 2), [
    { line: 1, text: "支払い" },
    { line: 6, text: "完了" },
  ]);
  for (const heading of ["支払い", "古い見出し"]) {
    assert.throws(() => hashHeadingSectionContent(content, heading), /HTML comment.*indent/i);
  }
  assert.equal(
    hashHeadingSectionContent(content, "完了"),
    createHash("sha256").update("## 完了").digest("hex"),
  );
  const oldHash = createHash("sha256").update("## 支払い\n   <!--").digest("hex");
  assert.equal(versionHasher(content).section("支払い", 2), oldHash);
});

test("コメントとコードフェンスの内側の開始記号はブロックの終端を変えない", () => {
  const content = [
    "```",
    "<!--",
    "```",
    "## 公開",
    "<!-- 注記 -->",
    "<!--",
    "```",
    "-->",
    "## 次の節",
    "<!-- 閉じていないコメント",
    "## 非表示",
  ].join("\n");
  assert.deepEqual(listHeadings(content, 2), [
    { line: 4, text: "公開" },
    { line: 9, text: "次の節" },
  ]);
});

test("コメント内の見出しで切れた v1 の保存値を clean にせず、更新も書き込み前に止める", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heading-boundary-"));
  try {
    const content = "## 支払い\n<!--\n## 古い仕様\n-->\n手数料は500円。\n";
    const oldHash = createHash("sha256").update("## 支払い\n<!--").digest("hex");
    const manifest = [
      "version: 1",
      "links:",
      "  - id: card",
      "    label: 支払い",
      "    spec:",
      "      - path: spec.md",
      "        heading: 支払い",
      `        hash: ${oldHash}`,
      "    impl: []",
      "    features: []",
      "",
    ].join("\n");
    const file = path.join(root, "traceability.yaml");
    await writeFile(path.join(root, "spec.md"), content);
    await writeFile(file, manifest);
    await assert.rejects(checkDrift(file, root), /HTML comment.*indent/i);
    await assert.rejects(updateManifestHashes(file, root), /HTML comment.*indent/i);
    assert.equal(await readFile(file, "utf8"), manifest);
    await writeFile(path.join(root, "spec.md"), content.replace("## 古い仕様", "    ## 古い仕様"));
    assert.equal((await checkDrift(file, root)).clean, false);
    assert.equal((await updateManifestHashes(file, root)).changes.length, 1);
    assert.equal((await checkDrift(file, root)).clean, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
