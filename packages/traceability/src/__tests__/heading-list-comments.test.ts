import assert from "node:assert/strict";
import { test } from "vitest";
import { hashHeadingSectionContent, inspectHistoricalV1Section, listHeadings } from "../hash.js";

// CommonMark のレンダラで確認した見出しとブロックの境界。
// コメントの直後の料金は表示されるため、旧 v1 の短い範囲を clean として返せない。リスト項目の中の
// HTML ブロックは、markdown-it が空行で終えるなど実装で読み方が分かれるので、その行から末尾までを
// 決めきれない行（hazard）として拒否する。
for (const [name, opening, hidden] of [
  ["箇条書き", "- <!--", "  ## 旧仕様"],
  ["番号付き", "2) <!--", "   ## 旧仕様"],
  ["引用を抜けた番号付きリスト", "> 引用\n2. <!--", "   ## 旧仕様"],
  ["区切り線後の番号付きリスト", "---\n2. <!--", "   ## 旧仕様"],
  ["リストの続き", "- 既存の項目\n\n    <!--", "  ## 旧仕様"],
  ["タブで字下げしたリスト", "- 項目\n\n\t<!--", "  ## 旧仕様"],
]) {
  test(`${name}のコメント内にある見出しで仕様節を切らない`, () => {
    const content = [
      "## 支払い",
      "",
      opening,
      hidden,
      "   -->",
      "",
      "手数料は500円。",
      "## 次の節",
    ].join("\n");
    assert.deepEqual(
      listHeadings(content, 2).map(({ text }) => text),
      ["支払い", "次の節"],
    );
    assert.throws(
      () => hashHeadingSectionContent(content, "支払い"),
      /renders from line \d+ \(an HTML block in a list item\)/,
    );
    assert.equal(inspectHistoricalV1Section(content, "支払い", 2).ambiguous, true);
  });
}

// 表示上の見出しは CommonMark のとおりに数えるが、リスト項目の中でコメントが始まるので拒否する。
for (const [name, body, line] of [
  ["字下げの外で項目が終わる", "- <!--\n## 公開", 3],
  ["次のリスト項目に移る", "- <!--\n- 公開する項目\n  ## 公開", 3],
  ["十分に字下げされていない行はコメントの外になる", "- \t<!--\n  ## 公開\n  -->", 3],
] as const) {
  test(`${name}場合も、リスト項目の中のコメントは hazard として拒否する`, () => {
    const content = ["## 支払い", "", body, "", "## 次の節"].join("\n");
    assert.deepEqual(
      listHeadings(content, 2).map(({ text }) => text),
      ["支払い", "公開", "次の節"],
    );
    assert.throws(
      () => hashHeadingSectionContent(content, "支払い"),
      new RegExp(`renders from line ${line} \\(an HTML block in a list item\\)`),
    );
    assert.equal(inspectHistoricalV1Section(content, "支払い", 2).ambiguous, true);
  });
}

for (const [name, body] of [
  ["番号付きリストが段落を中断しない", "要件\n2) <!--\n   ## 公開\n   -->"],
  ["リスト内のインデントコードはコメントを開始しない", "-     <!--\n  ## 公開\n  -->"],
]) {
  test(`${name}場合は従来の v1 の範囲で読める`, () => {
    const content = ["## 支払い", "", body, "", "## 次の節"].join("\n");
    assert.deepEqual(
      listHeadings(content, 2).map(({ text }) => text),
      ["支払い", "公開", "次の節"],
    );
    assert.equal(inspectHistoricalV1Section(content, "支払い", 2).ambiguous, false);
  });
}

test("リスト内のコードフェンスにあるコメント開始文字はコメントを始めない", () => {
  const content = ["## 支払い", "", "- ```", "  <!--", "  ```", "", "## 次の節"].join("\n");
  // この入力には HTML コメントブロックがなく、次の節の見出しは表示される。ただし従来の v1 の規則は
  // フェンスの閉じ（`  ````）を開始と読み、次の節の見出しまで支払いの節に含める。表示上の範囲と
  // 食い違うので拒否する（v1 のフェンス解釈と hash の値は変えない）。
  assert.deepEqual(
    listHeadings(content, 2).map(({ text }) => text),
    ["支払い", "次の節"],
  );
  assert.throws(() => hashHeadingSectionContent(content, "支払い"), /fenced code in a list item/);
  assert.equal(inspectHistoricalV1Section(content, "支払い", 2).ambiguous, true);
});

test("子の項目のコメントは親の項目の見出しを隠さないが、リスト項目の中の HTML ブロックなので拒否する", () => {
  const content = [
    "## 支払い",
    "",
    "- 親",
    "  - 子",
    "",
    "    <!--",
    "  ## 旧仕様",
    "  -->",
    "手数料は500円。",
  ].join("\n");
  // 子（字下げ4）のコメントは、親の見出し（字下げ2）の直前で終了する。
  assert.deepEqual(
    listHeadings(content, 2).map(({ text }) => text),
    ["支払い", "旧仕様"],
  );
  assert.equal(inspectHistoricalV1Section(content, "支払い", 2).ambiguous, true);
});
