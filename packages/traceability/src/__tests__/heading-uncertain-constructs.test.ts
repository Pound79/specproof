import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import {
  hashHeadingSectionContent,
  inspectHistoricalV1Section,
  listHeadings,
  withSectionScanCache,
} from "../hash.js";

// 表示上の規則（CommonMark の近似）が読み方を決めきれない構文（引用の中のブロック、リスト項目の中の表、
// 方言で読み方が違う HTML など）が登録した節に掛かれば、範囲を推測せずに拒否する（fail-closed）。
// 掛からない節と、読み方が決まる構文は従来どおりの hash を返す。
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const doc = (...lines: string[]): string => lines.join("\n");
const UNCERTAIN = /cannot determine how this section renders near line (\d+)/;
const REJECTED = /cannot determine how this section renders|changes its boundaries/;

const uncertainAt = (content: string, line: number, construct: RegExp, heading = "A") => {
  assert.throws(
    () => hashHeadingSectionContent(content, heading),
    (error: Error) =>
      UNCERTAIN.exec(error.message)?.[1] === String(line) && construct.test(error.message),
  );
  assert.equal(inspectHistoricalV1Section(content, heading, 2).ambiguous, true);
};

const rejected = (content: string, heading = "A", level = 2) => {
  assert.throws(() => hashHeadingSectionContent(content, heading, level), REJECTED);
  assert.equal(inspectHistoricalV1Section(content, heading, level).ambiguous, true);
};

// 引用の中で段落以外のブロックが開いているか決めきれない行。引用を含むリスト項目が続くか（後ろの
// 字下げしたフェンスやコメントが項目の中か外か）がこの行で変わる。
const LAZY_TAIL = ["lazy", "  <!--", "## B", "  -->", "body", "## C"];
for (const [name, quoted, construct] of [
  ["フェンス", ["- > ```", "  > text"], /fenced code in a block quote/],
  ["コメント", ["- > <!--", "  > text"], /HTML in a block quote/],
  ["5 列以上字下げした項目", ["- > -     x", "  > text"], /list item in a block quote/],
  ["閉じないフェンス", ["- > ```", "  > foo"], /fenced code in a block quote/],
  ["閉じないコメント", ["- > <!--", "  > foo"], /HTML in a block quote/],
  ["記号の後のタブ", ["- >   \tx"], /tab in a block quote/],
] as const) {
  test(`リスト項目の中の引用の${name}は読み方を決めきれず拒否する`, () => {
    uncertainAt(doc("## A", ...quoted, ...LAZY_TAIL), 2, construct);
  });
}

for (const [name, separator] of [
  ["LF", "\n"],
  ["単独の CR", "\r"],
] as const) {
  test(`引用の中の 5 列以上字下げした項目の後の行（${name}）で拒否する`, () => {
    const content = `# Spec\n## A\nMust do X.\n- > -     x\ny${separator}  \`\`\` \n# B\n\`\`\`\nMust NOT do X.\n`;
    uncertainAt(content, 4, /list item in a block quote/);
  });
}

test("リスト項目の中の表の後の行は段落の続きか決めきれず拒否する", () => {
  uncertainAt(doc("## A", "- | a |", "  | - |", ...LAZY_TAIL), 4, /table/);
});

// 空行で終わる HTML ブロック（type 6・7）は読み方が決まるので、範囲の食い違いとして拒否する。
for (const [name, content] of [
  ["項目の中の div の後の行", doc("## A", "- <div>", "lazy", "  <!--", "## B", "  -->", "## C")],
  ["最上位の div の中の見出し", doc("## A", "<div>", "## B", "", "body", "## C")],
  ["完全なタグだけの行の中の見出し", doc("## A", "", '<a href="x">', "## B", "", "body")],
] as const) {
  test(`${name}は範囲が食い違うので拒否する`, () => {
    rejected(content);
  });
}

// 方言（CommonMark 0.31 と cmark-gfm 0.29、markdown-it）で読み方が違う HTML。どれかの読み方で範囲が
// 食い違えば拒否する。
const BASE = ["# T", "intro", "## A", "foo", "## B", "bar", ""];
for (const [name, inserted] of [
  ["小文字の宣言 <!x", ["<!x", "<!--", "x > y"]],
  ["textarea の閉じタグ", ["<script>", "</textarea>"]],
] as const) {
  test(`${name}は方言で読み方が違うので拒否する`, () => {
    rejected(doc(...BASE.slice(0, 2), ...inserted, ...BASE.slice(2)));
  });
}

test("U+2028・U+2029 を含む ATX 見出しは表示上は見出しとして数える", () => {
  for (const separator of [" ", " "]) {
    const content = doc("## A", "x", `## B${separator}`, "y", "");
    assert.deepEqual(
      listHeadings(content, 2).map(({ line }) => line),
      [1, 3],
    );
    rejected(content);
  }
});

for (const [name, content, listed] of [
  [
    "従来の規則だけがフェンスと読む行",
    doc("## A", "``` a`", "## B", "```", ""),
    "line 2 (fence (CommonMark: not a fence))",
  ],
  ["単独の CR", "## A\nx\r## B\n## C\n", "renders from line 2 (carriage return)"],
] as const) {
  test(`エラーは${name}を原因の行として示す`, () => {
    assert.throws(
      () => hashHeadingSectionContent(content, "A"),
      (error: Error) => error.message.includes(listed),
    );
  });
}

// 読み方の決まらない構文があっても、登録した節に掛からなければ従来どおりの hash を返す。
for (const [name, after] of [
  ["引用の中のフェンスの後の記号だけの項目", ["> ```", "foo", "-", "## C"]],
  ["リスト項目の中の表", ["- | a |", "  | - |", "lazy"]],
  ["方言で読み方が違う宣言", ["<!x", "<!--", "x > y", "## C"]],
] as const) {
  test(`後ろの節の${name}は前の節の hash を変えない`, () => {
    const content = doc("## A", "foo", "## B", ...after);
    assert.equal(hashHeadingSectionContent(content, "A"), sha256(doc("## A", "foo")));
    assert.throws(() => hashHeadingSectionContent(content, "B"), REJECTED);
  });
}

test("項目の中の div は、リスト項目の中の HTML ブロックとして拒否する", () => {
  // CommonMark では `y` は段落の続きにならず（HTML ブロックは段落でない）項目を閉じ、表示上も従来の規則も
  // 節は末尾まで続く。リスト項目の中の HTML ブロックは実装で読み方が分かれうるので、個別に追わず拒否する。
  const content = "## A\nMust do X.\n- <div>\ny\n  ``` \n# B\n```\nMust NOT do X.\n";
  assert.throws(
    () => hashHeadingSectionContent(content, "A"),
    /renders from line 3 \(an HTML block in a list item\)/,
  );
});

// 読み方が決まる形は従来どおり（許可側の回帰）。期待値を変えるなら CHANGELOG の保証範囲も直す。
for (const [name, body] of [
  ["最上位の表", ["| a | b |", "| - | - |", "| 1 | 2 |"]],
  ["表の直後の見出しの前の本文", ["| a |", "| - |", "", "text"]],
  ["空行で閉じる最上位の div", ["<div>", "x", "", "text"]],
  ["段落の続きの完全なタグ", ["text", '<a href="x">']],
  ["引用の段落", ["> q", "> r", "lazy"]],
  ["リスト項目の中の引用の段落", ["- > q", "lazy"]],
  ["引用の中の見出しと区切り線", ["> # q", "> ---"]],
] as const) {
  test(`${name}は従来の範囲で読める`, () => {
    const lines = ["## A", ...body];
    assert.equal(
      hashHeadingSectionContent(doc(...lines, "## B", "tail"), "A"),
      sha256(doc(...lines)),
    );
  });
}

// リスト項目の外の表・引用・HTML の行は、空行（表と引用は、段落を中断するブロックの行）までに見出しや
// フェンスになりうる行が無ければ、どの読み方でも同じ状態に戻る（後ろの節は拒否しない）。
for (const [name, block] of [
  ["引用の中のフェンス", ["> ```", "> code", "lazy", ""]],
  ["引用の中の HTML", ["> <div>", "> text", ""]],
  ["表の後の HTML コメント", ["| a |", "| - |", "<!-- x -->"]],
  ["表の後の見出しの前の行", ["| a |", "| - |", "| <img src=x> |"]],
  ["表の後の引用", ["| a |", "| - |", "> q"]],
] as const) {
  test(`最上位の${name}の後ろの節は従来の範囲で読める`, () => {
    const lines = ["## A", ...block];
    assert.equal(
      hashHeadingSectionContent(doc(...lines, "## B", "tail"), "A"),
      sha256(doc(...lines)),
    );
  });
}

for (const [name, content, line, construct] of [
  ["表の後の記号だけの項目", doc("## A", "| a |", "| - |", "-", "  <!--", "## B"), 3, /a table/],
  [
    "空白の扱いで読み方が分かれるタグの後の見出し",
    doc("## A", "", "<div x>", "## B", "", "## C"),
    3,
    /HTML tag/,
  ],
  [
    "見出しの行が HTML の形の表",
    doc("## A", "a", "<span>", ":-:", "## B", "", "## C"),
    4,
    /a table/,
  ],
  [
    "インデントコードの直後の記号だけの項目",
    doc("## A", "    code", "1.", "<span>", "## B"),
    3,
    /list item/,
  ],
  [
    "段落を中断する項目の中の記号だけの項目",
    doc("## A", "text", "* 1.", "<x-tag>", "## B"),
    3,
    /list item/,
  ],
  // markdown-it は、開いている引用の後の 4 列以上字下げした `>` を引用の続きと読む。
  ["引用の後の字下げした >", doc("## A", "> >", "      > a", "</pre>", "# B"), 3, /indented >/],
  // markdown-it は、項目の段落の後の 4 列字下げした `>` で項目を閉じ、インデントコードと読む。
  [
    "項目の段落の後の字下げした >",
    doc("## A", "   2) a", "    > b", "-", "  <!--", "## B"),
    3,
    /indented line/,
  ],
  [
    "引用の中のフェンスの後のインデントコードと空行の後の記号だけの項目",
    doc("## A", "> ```", "    x", "", "1.", "<span>", "## B"),
    5,
    /list item/,
  ],
] as const) {
  test(`${name}は読み方を決めきれず拒否する`, () => {
    uncertainAt(content, line, construct);
  });
}

test("実行の間だけの走査の使い回しは、結果を変えない（古い中身を追い出した後も）", async () => {
  const contents = Array.from({ length: 12 }, (_, i) =>
    doc("## A", `body ${i}`, "## B", "> ```", "foo", "-"),
  );
  const outside = contents.map((content) => hashHeadingSectionContent(content, "A"));
  const inside = await withSectionScanCache(async () =>
    [...contents, ...contents].map((content) => hashHeadingSectionContent(content, "A")),
  );
  assert.deepEqual(inside, [...outside, ...outside]);
  await withSectionScanCache(async () => {
    for (const content of [contents[0], contents[0]]) {
      assert.throws(() => hashHeadingSectionContent(content, "B"), REJECTED);
    }
  });
});

test("表の区切りの行の判定は記号の長い並びでも線形の時間で終わる", () => {
  const started = performance.now();
  // 照合する行の長さの上限（64 Ki）より短い行で、二乗の時間なら 1 秒を超える長さ。
  hashHeadingSectionContent(doc("## A", "foo", `${"-".repeat(60_000)}x`, "## B"), "A");
  assert.ok(performance.now() - started < 1_000, "table delimiter detection must stay linear");
});

test("リンク参照定義になりうる行の後の下線や記号だけの項目は、読み方を決めきれず拒否する", () => {
  // 定義なら段落は開かず `===` が段落、`-` がその setext の下線で、コメントは最上位になり `## B` を隠す。
  const content = doc("## A", "[a]: /u", "===", "-", "  <!--", "## B", "-->", "x");
  uncertainAt(content, 2, /link reference definition/);
});

for (const [name, block] of [
  ["空行で終わるリンク参照定義", ["[a]: /u", ""]],
  ["引用の中の注記の記号", ["> [!NOTE]", "> text", ""]],
  ["角括弧で始まる段落", ["[x] text", "more"]],
  // URL の後にタイトルでない文字や閉じたタイトルの後の文字が続けば定義にならず、段落として読む。
  ["定義にならない [x]: の行の後の下線", ["[x]: add `y` more", "==="]],
  ["閉じたタイトルの後に文字が続く行の後の項目", ['[x]: u "t" more', "- item"]],
] as const) {
  test(`${name}の後ろの節は従来の範囲で読める`, () => {
    const lines = ["## A", ...block];
    assert.equal(
      hashHeadingSectionContent(doc(...lines, "## B", "tail"), "A"),
      sha256(doc(...lines)),
    );
  });
}

for (const [name, body] of [
  ["段落の後の脚注の定義", ["text", "[^1]: note"]],
  ["表の後の脚注の定義", ["| a |", "| - |", "[^1]: note"]],
] as const) {
  test(`${name}の後の、見出しでない段落を中断しうる行は拒否する`, () => {
    // GFM では脚注の定義は空行の後も字下げした行を含むコンテナで、CommonMark では段落の文。
    uncertainAt(doc("## A", ...body, "", "    ```", "-", "  <!--", "## B"), 3, /footnote|table/);
  });
}

test("脚注の定義の後は、空行と字下げした行を挟んでも見出しで同期する", () => {
  const lines = ["## A", "text", "", "[^1]: note", "", "    ```", "[^2]: more"];
  assert.equal(
    hashHeadingSectionContent(doc(...lines, "## B", "tail"), "A"),
    sha256(doc(...lines)),
  );
});
