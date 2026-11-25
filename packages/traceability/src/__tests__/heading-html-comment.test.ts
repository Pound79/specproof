import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { versionHasher } from "../bless-history.js";
import { checkDrift } from "../check.js";
import { hashHeadingSectionContent, listHeadings } from "../hash.js";
import { updateManifestHashes } from "../update.js";

// v1 の hash は従来の規則（コメントを認識しない）のまま。コメントを認識すると登録節の範囲が変わる
// 入力だけを拒否する。拒否する側と、従来どおり hash を返す側の両方を押さえる。
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const doc = (...lines: string[]): string => lines.join("\n");
const hashOf = (content: string, heading: string): string =>
  hashHeadingSectionContent(content, heading);

test("4 スペース字下げの <!-- はコメントを始めない（見出しを隠さず、拒否もしない）", () => {
  const content = doc("## A", "text", "    <!--", "## B", "    -->");
  assert.equal(hashOf(content, "A"), sha256(doc("## A", "text", "    <!--")));
  assert.deepEqual(
    listHeadings(content, 2).map((heading) => heading.text),
    ["A", "B"],
  );
});

test("3 スペースまでの字下げの <!-- はコメントを始める", () => {
  const content = doc("## A", "   <!--", "## B", "-->", "## C");
  assert.throws(() => hashOf(content, "A"), /HTML comment/);
  assert.deepEqual(
    listHeadings(content, 2).map((heading) => heading.text),
    ["A", "C"],
  );
});

test("--> の後ろに文字が続く行でもコメントは閉じる", () => {
  const content = doc("## A", "<!-- x --> tail", "## B", "text");
  assert.equal(hashOf(content, "A"), sha256(doc("## A", "<!-- x --> tail")));
  assert.deepEqual(
    listHeadings(content, 2).map((heading) => heading.text),
    ["A", "B"],
  );
});

test("複数行のコメントは --> を含む行で閉じ、その後ろの見出しは見える", () => {
  const content = doc("## A", "<!--", "note", "end --> tail", "## B");
  assert.equal(hashOf(content, "A"), sha256(doc("## A", "<!--", "note", "end --> tail")));
});

test("終端が同じでも、参照の開始がコメントの中か外かで変わるなら拒否する", () => {
  // 従来の規則は旧来の完全一致（コメント内の `## A`）を、コメントを認識すると `## A ##` を選ぶ。
  const content = doc("## A ##", "<!--", "## A", "-->", "## B");
  assert.throws(() => hashOf(content, "A"), /changes its boundaries/);
  assert.equal(versionHasher(content).sectionAmbiguous("A", 2), true);
  assert.equal(versionHasher(content).sectionAmbiguous("B", 2), false);
});

test("開始が同じでも、終端がコメントで変わるなら拒否する", () => {
  const content = doc("## A", "<!--", "## Old", "-->", "text", "## B");
  assert.throws(() => hashOf(content, "A"), /changes its boundaries/);
  assert.equal(versionHasher(content).sectionAmbiguous("A", 2), true);
});

test("コードフェンスの中の <!-- はコメントを始めない", () => {
  const content = doc("## A", "```", "<!--", "```", "## B", "-->", "## C");
  assert.equal(hashOf(content, "A"), sha256(doc("## A", "```", "<!--", "```")));
  assert.equal(hashOf(content, "B"), sha256(doc("## B", "-->")));
});

test("エラーは同じファイルの境界を変えるコメントをすべて開始行つきで並べ、リンク id を添える", () => {
  const content = doc(
    "## A",
    "<!--",
    "## X",
    "-->",
    "a",
    "<!--",
    "### deeper only",
    "-->",
    "## B",
    "<!--",
    "```",
    "-->",
    "b",
    "## C",
  );
  const error = (() => {
    try {
      hashHeadingSectionContent(content, "A", 2, { file: "spec.md", linkId: "card" });
    } catch (caught) {
      return (caught as Error).message;
    }
    return "";
  })();
  assert.match(error, /section "A" in "spec\.md" \(link "card"\)/);
  // 見出しを隠すコメント（2 行目）とフェンスを隠すコメント（10 行目）。深い見出しだけのコメント（6 行目）は並べない。
  assert.match(error, /by opening line: line 2, line 10\./);
  assert.doesNotMatch(error, /line 6/);
  assert.match(error, /indent heading or fence lines in the comment by at least four spaces/);
  // 参照の見出しより前・後ろのコメントには「参照の見出しを含む」の注記を付けない。
  assert.throws(() => hashOf(content, "B"), /by opening line: line 2, line 10\. /);
});

test("従来の規則でもフェンスの中にある見出しだけを含むコメントは並べない", () => {
  // 2 行目のコメントの中のフェンスが、従来の規則では末尾まで続く。6 行目のコメントの見出しは
  // 従来の規則でもフェンスの中なので、境界を変えていない。
  const content = doc("## A", "<!--", "```", "-->", "a", "<!--", "## X", "-->", "## B", "```");
  assert.throws(() => hashOf(content, "A"), /by opening line: line 2\. /);
});

test("並べるコメントの位置は先頭の 10 件と参照の見出しを含むものだけにし、残りは件数で示す", () => {
  const hiding = Array.from({ length: 30 }, (_, i) => ["<!--", `## X${i}`, "-->"]).flat();
  // 1〜90 行が 30 個のコメント、91 行目のコメントが参照の見出しを含む。
  const content = doc(...hiding, "<!--", "## Target", "-->", "## Next");
  const message = (() => {
    try {
      hashOf(content, "Target");
    } catch (caught) {
      return (caught as Error).message;
    }
    return "";
  })();
  const listed = message.match(/by opening line: (.*?)\. Close/)?.[1] ?? "";
  assert.match(listed, /^line 1, line 4, .*line 28, line 91 \(contains the referenced heading/);
  assert.equal(listed.match(/line \d+/g)?.length, 11);
  assert.match(listed, /, and 20 more$/);
});

test("閉じていないコメントには --> を補う対処を示す", () => {
  const content = doc("## A", "<!-- todo", "## B", "text");
  assert.throws(
    () => hashOf(content, "A"),
    /line 2 \(not closed: add "-->" where the comment should end\)/,
  );
});

test("登録した見出しがコメントの中なら、manifest から参照を外す対処を示す", () => {
  const content = doc("## A", "x", "<!--", "## Old", "old text", "-->", "## B");
  assert.throws(
    () => hashOf(content, "Old"),
    /line 3 \(contains the referenced heading: .*remove this reference from the manifest\)/,
  );
  // 同じコメントが原因でも、外の節の参照にはその注記を付けない。
  assert.throws(() => hashOf(content, "A"), /by opening line: line 3\. /);
});

test("check と update のエラーに、参照を登録したリンクの id とコメントの開始行が出る", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heading-comment-error-"));
  try {
    const content = "## 支払い\n<!--\n## 古い仕様\n-->\n手数料は500円。\n";
    const manifest = [
      "version: 1",
      "links:",
      "  - id: card",
      "    label: 支払い",
      "    spec:",
      "      - path: spec.md",
      "        heading: 支払い",
      `        hash: ${sha256("## 支払い\n<!--")}`,
      "    impl: []",
      "    features: []",
      "",
    ].join("\n");
    const file = path.join(root, "traceability.yaml");
    await writeFile(path.join(root, "spec.md"), content);
    await writeFile(file, manifest);
    const expected = /section "支払い" in "spec\.md" \(link "card"\).*by opening line: line 2\./;
    await assert.rejects(checkDrift(file, root), expected);
    await assert.rejects(updateManifestHashes(file, root), expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
